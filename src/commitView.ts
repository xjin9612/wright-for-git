// 提交視窗（對應 IntelliJ 的 Commit 工具視窗）：「提交｜儲藏」兩個分頁
// 提交只放入勾選的內容（含逐段選取），不使用內建原始檔控制的暫存狀態。
import * as path from 'node:path';
import * as vscode from 'vscode';
import { revisionUri } from './diffProvider';
import { ConfirmHost, confirm } from './dialogs';
import { buildPatch } from './git/parsers';
import type { GitRepository } from './git/repository';
import { onRepositoryChange } from './gitExtension';
import { t } from './i18n';
import { ModuleResolver } from './modules';
import type { WorkbenchViewProvider } from './provider';
import type { Changelist, CommitState, DiffHunk, ToExtension, ToWebview, WorkingChange } from './shared/protocol';
import { stashChanges } from './stashView';

const DEFAULT_LIST: Changelist = { id: 'default', name: 'Changes' };

interface ChangelistStore {
  lists: Changelist[];
  active: string;
  assign: Record<string, string>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const keyOf = (root: string, p: string) => `${root}\0${p}`;

/** 以內容辨識 hunk（檔案在別處被修改後，段落序號可能改變） */
const hunkId = (h: DiffHunk) => h.lines.join('\n');

export class CommitViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'gitWorkbench.commit';
  private view: vscode.WebviewView | undefined;
  private readonly confirms = new ConfirmHost(
    (msg) => this.post(msg),
    () => t('Cancel'),
  );
  private showIgnored = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | undefined;
  private refreshAgain = false;
  private disposables: vscode.Disposable[] = [];
  private repoWatchers: vscode.Disposable[] = [];
  private watchedKey = '';
  /** 逐段提交：key → 選取的 hunk 內容 */
  private readonly partial = new Map<string, Set<string>>();
  /** 最近一次狀態（逐段選取需要 hunk 總數時使用） */
  private partialCounts: Record<string, { selected: number; total: number }> = {};

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: WorkbenchViewProvider,
  ) {
    // 工作區檔案變動、repo 狀態變動時重新整理（只在視圖可見時）
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const later = () => this.scheduleRefresh();
    this.disposables.push(watcher, watcher.onDidChange(later), watcher.onDidCreate(later), watcher.onDidDelete(later), provider.onDidChange(() => this.rewatch()));
    this.rewatch();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
    this.repoWatchers.forEach((d) => d.dispose());
  }

  /** 依 repository 清單掛上內建 Git 的狀態事件（存檔、stage 等都會觸發） */
  private rewatch(): void {
    const repos = this.provider.repositoryList();
    const key = repos.map((r) => r.root).join('\n');
    if (key !== this.watchedKey) {
      this.watchedKey = key;
      this.repoWatchers.forEach((d) => d.dispose());
      this.repoWatchers = [];
      for (const repo of repos) {
        void onRepositoryChange(repo.root, () => this.scheduleRefresh()).then((d) => {
          if (d) this.repoWatchers.push(d);
        });
      }
    }
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (!this.view?.visible) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 500);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const root = this.context.extensionUri;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(root, 'dist'), vscode.Uri.joinPath(root, 'media')] };
    view.webview.html = this.provider.pageHtml(view.webview, 'commit.js', null);
    view.webview.onDidReceiveMessage((m: ToExtension) => this.onMessage(m), undefined, this.disposables);
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.refresh();
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.confirms.cancelAll();
    });
  }

  reload(): void {
    if (this.view) this.view.webview.html = this.provider.pageHtml(this.view.webview, 'commit.js', null);
  }

  private post(msg: ToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  private get store(): ChangelistStore {
    const s = this.context.workspaceState.get<ChangelistStore>('gitWorkbench.changelists');
    const lists = s?.lists?.length ? s.lists : [DEFAULT_LIST];
    return { lists, active: s?.active && lists.some((l) => l.id === s.active) ? s.active : lists[0].id, assign: s?.assign ?? {} };
  }

  private async saveStore(store: ChangelistStore): Promise<void> {
    await this.context.workspaceState.update('gitWorkbench.changelists', store);
  }

  /** 重新讀取所有 repo 的工作區變更（同時只跑一次，期間有新的要求就再跑一次） */
  async refresh(): Promise<void> {
    if (!this.view) return;
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        await this.doRefresh();
      } while (this.refreshAgain);
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async doRefresh(): Promise<void> {
    const summaries = await this.provider.repositories();
    const repos: CommitState['repos'] = [];
    const live = new Set<string>();
    for (const s of summaries) {
      const repo = this.provider.getRepository(s.root);
      if (!repo) continue;
      let changes: WorkingChange[] = [];
      try {
        changes = await repo.getWorkingChanges(this.showIgnored);
      } catch {
        changes = [];
      }
      const modules = new ModuleResolver(repo.root);
      repos.push({ root: repo.root, name: s.name, branch: s.branch, changes: changes.map((c) => ({ ...c, module: c.kind === 'ignored' ? undefined : modules.moduleOf(c.path) })) });
      for (const c of changes) live.add(keyOf(repo.root, c.path));
    }
    // 已消失的檔案：移除逐段選取與 changelist 指派
    for (const k of [...this.partial.keys()]) if (!live.has(k)) this.partial.delete(k);
    const store = this.store;
    const assign = Object.fromEntries(Object.entries(store.assign).filter(([k]) => live.has(k)));
    if (Object.keys(assign).length !== Object.keys(store.assign).length) await this.saveStore({ ...store, assign });
    const counts: CommitState['partial'] = {};
    for (const [k, set] of this.partial) counts[k] = { selected: set.size, total: this.partialCounts[k]?.total ?? set.size };
    this.partialCounts = counts;
    this.post({ type: 'commitState', state: { repos, changelists: store.lists, activeList: store.active, assign, partial: counts, showIgnored: this.showIgnored } });
  }

  private async onMessage(m: ToExtension): Promise<void> {
    try {
      switch (m.type) {
        case 'commitReady':
          this.confirms.cancelAll();
          await this.refresh();
          break;
        case 'commitRefresh':
          this.showIgnored = m.showIgnored;
          await this.refresh();
          break;
        case 'commitDiff':
          await this.openDiff(m.root, m.change);
          break;
        case 'commitOpenFile':
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(m.root, m.path)));
          break;
        case 'commitRollback':
          await this.rollback(m.items);
          break;
        case 'commitLastMessage': {
          const repo = this.provider.getRepository(m.root);
          this.post({ type: 'commitLastMessage', root: m.root, message: (await repo?.lastCommitMessage()) ?? '' });
          break;
        }
        case 'commitRun':
          await this.commit(m);
          break;
        case 'commitHunks':
          await this.openHunks(m.root, m.path);
          break;
        case 'commitClearPartial':
          for (const k of m.keys) this.partial.delete(k);
          await this.refresh();
          break;
        case 'commitAddIgnore':
          await this.addToGitignore(m.root, m.paths);
          break;
        case 'changelistNew':
        case 'changelistRename':
        case 'changelistDelete':
        case 'changelistActivate':
        case 'changelistMove':
          await this.changelistOp(m);
          break;
        case 'stashSave': {
          const repos = await this.provider.repositories();
          let root = repos[0]?.root;
          if (repos.length > 1) {
            const pick = await vscode.window.showQuickPick(
              repos.map((r) => ({ label: r.name, description: r.branch, root: r.root })),
              { placeHolder: t('Stash changes in which repository?') },
            );
            root = pick?.root ?? '';
          }
          const repo = root ? this.provider.getRepository(root) : undefined;
          if (repo && (await stashChanges(repo))) await this.refresh();
          break;
        }
        case 'confirmResult':
          this.confirms.resolve(m.id, m.ok);
          break;
        case 'openUnstash':
          this.provider.dialogs.openUnstash(m.root);
          break;
        case 'copy':
          if (m.text) await vscode.env.clipboard.writeText(m.text);
          break;
        case 'unstashLoad':
        case 'unstashFiles':
        case 'unstashApply':
        case 'unstashDrop':
        case 'unstashClear':
        case 'openStashDiff':
          // 儲藏分頁與「取消儲藏」對話框共用同一套處理
          await this.provider.dialogs.handleUnstash(m, (msg) => this.post(msg), this.confirms, () => void this.refresh());
          break;
      }
    } catch (e) {
      void vscode.window.showErrorMessage(errorMessage(e));
    }
  }

  // ---------- 檔案操作 ----------

  private async openDiff(root: string, c: WorkingChange): Promise<void> {
    const repo = this.provider.getRepository(root);
    if (!repo) return;
    const file = vscode.Uri.file(path.join(root, c.path));
    if (c.kind === 'untracked' || c.kind === 'ignored') {
      await vscode.commands.executeCommand('vscode.open', file);
      return;
    }
    const head = (await repo.headHash()) ?? '';
    const left = revisionUri(root, c.status === 'A' ? '' : head, c.oldPath ?? c.path);
    const right = c.status === 'D' ? revisionUri(root, '', c.path) : file;
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(c.path)} (HEAD ↔ ${t('Working Tree')})`, { preview: true });
  }

  private async rollback(items: { root: string; change: WorkingChange }[]): Promise<void> {
    const list = items.filter((x) => x.change.kind === 'changed' || x.change.kind === 'conflict');
    if (list.length === 0) {
      void vscode.window.showInformationMessage(t('Only tracked changes can be rolled back. Unversioned files are left as they are.'));
      return;
    }
    const names = list.map((x) => x.change.path);
    const detail = [...names.slice(0, 15), ...(names.length > 15 ? [t('… and {0} more', names.length - 15)] : [])].join('\n');
    if (!(await confirm(t('Roll back changes in {0} file(s)? Local modifications will be lost.', list.length), { detail, ok: t('Rollback'), kind: 'danger' }, this.confirms))) return;
    const byRoot = new Map<string, WorkingChange[]>();
    for (const x of list) byRoot.set(x.root, [...(byRoot.get(x.root) ?? []), x.change]);
    for (const [root, changes] of byRoot) {
      try {
        await this.provider.getRepository(root)?.rollback(changes);
      } catch (e) {
        void vscode.window.showErrorMessage(errorMessage(e));
      }
      for (const c of changes) this.partial.delete(keyOf(root, c.path));
    }
    await this.refresh();
    await this.provider.refresh(true);
  }

  private async addToGitignore(root: string, paths: string[]): Promise<void> {
    const file = path.join(root, '.gitignore');
    const { existsSync, promises: fsp } = await import('node:fs');
    const current = existsSync(file) ? await fsp.readFile(file, 'utf8') : '';
    const add = paths.map((p) => `/${p}`).filter((p) => !current.split(/\r?\n/).includes(p));
    if (add.length === 0) return;
    await fsp.writeFile(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`, 'utf8');
    await this.refresh();
  }

  // ---------- 提交 ----------

  private async commit(m: Extract<ToExtension, { type: 'commitRun' }>): Promise<void> {
    const done = (ok: boolean) => this.post({ type: 'commitDone', requestId: m.requestId, ok });
    const items = m.items.filter((x) => x.changes.length > 0);
    if (items.length === 0 && !m.amend) {
      void vscode.window.showWarningMessage(t('No changes selected to commit.'));
      return done(false);
    }
    if (!m.message.trim()) {
      void vscode.window.showWarningMessage(t('Enter a commit message.'));
      return done(false);
    }
    const conflicts = items.flatMap((x) => x.changes.filter((c) => c.kind === 'conflict').map((c) => c.path));
    if (conflicts.length > 0) {
      void vscode.window.showWarningMessage(t('Resolve the merge conflicts before committing: {0}', conflicts.join(', ')));
      return done(false);
    }
    const committed: string[] = [];
    const failed: string[] = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: m.amend ? t('Amending commit…') : t('Committing…') }, async () => {
      for (const item of items) {
        const repo = this.provider.getRepository(item.root);
        if (!repo) continue;
        try {
          const { full, patches } = await this.collect(repo, item.root, item.changes);
          await repo.commitSelected({ full, patches, message: m.message, amend: m.amend, signOff: m.signOff, noVerify: m.noVerify });
          committed.push(item.root);
          for (const c of item.changes) this.partial.delete(keyOf(item.root, c.path));
        } catch (e) {
          failed.push(`${path.basename(item.root)}: ${errorMessage(e)}`);
        }
      }
    });
    if (failed.length > 0) void vscode.window.showErrorMessage(t('Commit failed: {0}', failed.join('\n')));
    else vscode.window.setStatusBarMessage(`$(check) ${t('Committed to {0} repositories', committed.length)}`, 4000);
    done(failed.length === 0);
    await this.refresh();
    await this.provider.refresh(true);
    if (m.push && committed.length > 0 && failed.length === 0) this.provider.dialogs.openPush({ roots: committed });
  }

  /** 整理要提交的內容：整個檔案的路徑，以及逐段選取的檔案 patch */
  private async collect(repo: GitRepository, root: string, changes: WorkingChange[]): Promise<{ full: string[]; patches: string[] }> {
    const full: string[] = [];
    const patches: string[] = [];
    for (const c of changes) {
      const sel = this.partial.get(keyOf(root, c.path));
      if (sel && c.kind === 'changed' && c.status === 'M') {
        const diff = await repo.fileDiff(c.path);
        const chosen = new Set(diff.hunks.filter((h) => sel.has(hunkId(h))).map((h) => h.index));
        const patch = buildPatch(diff.header, diff.hunks, chosen);
        if (patch) patches.push(patch);
        continue;
      }
      full.push(c.path);
      if (c.oldPath) full.push(c.oldPath);
    }
    return { full, patches };
  }

  // ---------- 逐段選取 ----------

  private async openHunks(root: string, filePath: string): Promise<void> {
    const repo = this.provider.getRepository(root);
    if (!repo) return;
    const diff = await repo.fileDiff(filePath);
    if (diff.hunks.length === 0) {
      void vscode.window.showInformationMessage(t('{0} has no changes against HEAD.', filePath));
      return;
    }
    const key = keyOf(root, filePath);
    const sel = this.partial.get(key);
    const selected = diff.hunks.filter((h) => !sel || sel.has(hunkId(h))).map((h) => h.index);
    this.provider.dialogs.openHunks(root, filePath, diff.hunks, selected, async (indices) => {
      const fresh = await repo.fileDiff(filePath);
      const chosen = new Set(indices);
      if (chosen.size === fresh.hunks.length) this.partial.delete(key);
      else this.partial.set(key, new Set(fresh.hunks.filter((h) => chosen.has(h.index)).map(hunkId)));
      this.partialCounts[key] = { selected: chosen.size, total: fresh.hunks.length };
      await this.refresh();
    });
  }

  // ---------- Changelist ----------

  private async changelistOp(m: Extract<ToExtension, { type: 'changelistNew' | 'changelistRename' | 'changelistDelete' | 'changelistActivate' | 'changelistMove' }>): Promise<void> {
    const store = this.store;
    const nameTaken = (name: string, except?: string) => store.lists.some((l) => l.name === name && l.id !== except);
    switch (m.type) {
      case 'changelistNew': {
        const name = (await vscode.window.showInputBox({ title: t('New Changelist'), validateInput: (v) => (nameTaken(v.trim()) ? t('A changelist with this name already exists.') : undefined) }))?.trim();
        if (!name) return;
        const id = `cl-${Date.now()}`;
        store.lists.push({ id, name });
        for (const k of m.keys ?? []) store.assign[k] = id;
        break;
      }
      case 'changelistRename': {
        const list = store.lists.find((l) => l.id === m.id);
        if (!list) return;
        const name = (await vscode.window.showInputBox({ title: t('Rename Changelist'), value: list.name, validateInput: (v) => (nameTaken(v.trim(), list.id) ? t('A changelist with this name already exists.') : undefined) }))?.trim();
        if (!name) return;
        list.name = name;
        break;
      }
      case 'changelistDelete': {
        if (store.lists.length <= 1) return;
        const list = store.lists.find((l) => l.id === m.id);
        if (!list) return;
        if (!(await confirm(t('Delete changelist {0}? Its files move to {1}.', list.name, store.lists.find((l) => l.id !== m.id && l.id === store.active)?.name ?? store.lists.find((l) => l.id !== m.id)!.name), { ok: t('Delete'), kind: 'warning' }, this.confirms))) return;
        store.lists = store.lists.filter((l) => l.id !== m.id);
        if (store.active === m.id) store.active = store.lists[0].id;
        for (const [k, v] of Object.entries(store.assign)) if (v === m.id) delete store.assign[k];
        break;
      }
      case 'changelistActivate':
        if (store.lists.some((l) => l.id === m.id)) store.active = m.id;
        break;
      case 'changelistMove': {
        let id = m.id;
        if (!id) {
          const NEW = '\0new';
          const pick = await vscode.window.showQuickPick([...store.lists.map((l) => ({ label: l.name, id: l.id })), { label: `$(add) ${t('New Changelist…')}`, id: NEW }], { placeHolder: t('Move to changelist') });
          if (!pick) return;
          if (pick.id === NEW) {
            await this.changelistOp({ type: 'changelistNew', keys: m.keys });
            return;
          }
          id = pick.id;
        }
        for (const k of m.keys) store.assign[k] = id;
        break;
      }
    }
    await this.saveStore(store);
    await this.refresh();
  }
}

export function registerCommitView(context: vscode.ExtensionContext, provider: WorkbenchViewProvider): CommitViewProvider {
  const view = new CommitViewProvider(context, provider);
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(CommitViewProvider.viewId, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('gitWorkbench.showCommit', () => vscode.commands.executeCommand(`${CommitViewProvider.viewId}.focus`)),
  );
  return view;
}
