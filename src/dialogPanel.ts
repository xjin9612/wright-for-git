// 開在編輯器分頁的對話框（Push、取消儲藏、逐段選取、互動式 rebase、衝突清單、三方合併）：比底部面板大，可拖到其他編輯器群組或用「移到新視窗」變成浮動視窗
import * as vscode from 'vscode';
import { ConfirmHost, confirm } from './dialogs';
import { ConflictResolver } from './conflicts';
import { t } from './i18n';
import { showGitError } from './gitConsole';
import type { WorkbenchViewProvider } from './provider';
import type { DiffHunk, MergeArgs, RebaseCommit, ToExtension, ToWebview } from './shared/protocol';
import { ModuleResolver } from './modules';
import { openStashFile } from './stashView';

export interface PushDialogArgs {
  roots: string[];
  branch?: string;
  upTo?: { root: string; hash: string };
}

/** webview 端依 kind 決定要畫哪個對話框 */
export type DialogConfig =
  | { kind: 'push'; args: PushDialogArgs }
  | { kind: 'unstash'; args: { root?: string } }
  | { kind: 'hunks'; args: { root: string; path: string; hunks: DiffHunk[]; selected: number[] } }
  | { kind: 'rebase'; args: { root: string; base: string; branch?: string; commits: RebaseCommit[] } }
  | { kind: 'conflicts'; args: { root?: string } }
  | { kind: 'merge'; args: MergeArgs };

export type Reply = (msg: ToWebview) => void;
export type Handler = (m: ToExtension, reply: Reply, host: ConfirmHost, close: () => void) => Promise<void>;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class DialogPanels {
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; host: ConfirmHost; handler: Handler }>();

  /** 儲藏清單變動時通知（提交視窗的儲藏分頁） */
  onStashChanged: (() => void) | undefined;

  readonly conflicts: ConflictResolver;

  constructor(private readonly provider: WorkbenchViewProvider) {
    this.conflicts = new ConflictResolver(provider, this);
  }

  openPush(args: PushDialogArgs): void {
    const title = args.upTo ? t('Push Commits up to {0}', args.upTo.hash.slice(0, 8)) : args.branch ? t('Push {0}', args.branch) : t('Push Commits');
    this.open('push', title, { kind: 'push', args }, async (m, reply, host) => {
      if (m.type === 'pushPreview' || m.type === 'pushCommitFiles' || m.type === 'pushConfirm') await this.provider.handlePushMessage(m, reply, host);
      else if (m.type === 'openDiff') await this.provider.openDiffFromDialog(m.root, m.hash, m.parent, m.file);
    });
  }

  /** 逐段選取要提交的 hunk（提交視窗開啟）；onApply 收到選取的段落序號 */
  openHunks(root: string, filePath: string, hunks: DiffHunk[], selected: number[], onApply: (indices: number[]) => Promise<void>): void {
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    this.open('hunks', t('Select Changes: {0}', name), { kind: 'hunks', args: { root, path: filePath, hunks, selected } }, async (m) => {
      if (m.type === 'hunksSelect' && m.root === root && m.path === filePath) await onApply(m.selected);
    });
  }

  /** 互動式 rebase：從 hash（含）到 HEAD */
  async openRebase(root: string, hash: string): Promise<void> {
    const repo = this.provider.getRepository(root);
    if (!repo) return;
    let info: Awaited<ReturnType<typeof repo.rebaseCommits>>;
    try {
      info = await repo.rebaseCommits(hash);
    } catch (e) {
      void showGitError(errorMessage(e));
      return;
    }
    if (!info.onBranch) {
      void vscode.window.showWarningMessage(t('Interactive rebase needs a checked-out branch (HEAD is detached).'));
      return;
    }
    if (info.hasMerges) {
      void vscode.window.showWarningMessage(t('The selected range contains merge commits. Interactive rebase of merges is not supported; choose a commit after the last merge.'));
      return;
    }
    const state = await repo.getState();
    this.open('rebase', t('Interactive Rebase: {0}', state.head.branch ?? 'HEAD'), { kind: 'rebase', args: { root, base: hash, branch: state.head.branch, commits: info.commits } }, async (m, _reply, _host, close) => {
      if (m.type !== 'rebaseStart' || m.root !== root || m.base !== hash) return;
      // 對話框開著時 HEAD 可能已移動（例如又提交了一筆）：清單不符就重新整理，避免新提交被 rebase 丟掉
      const now = await repo.rebaseCommits(hash).catch(() => undefined);
      const nowState = await repo.getState();
      const same = now && nowState.head.branch === state.head.branch && now.commits.length === m.entries.length && now.commits.every((c) => m.entries.some((e) => e.hash === c.hash));
      if (!same) {
        void vscode.window.showWarningMessage(t('The branch changed since this dialog was opened. The list has been reloaded; review it and start again.'));
        await this.openRebase(root, hash);
        return;
      }
      try {
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Rebasing…') }, () => repo.interactiveRebase(m.base, m.entries));
        close();
        if (result === 'stopped') {
          void vscode.window.showInformationMessage(t('Rebase stopped: resolve conflicts or amend the commit, then use Continue in the Git Log.'));
        } else {
          vscode.window.setStatusBarMessage(`$(check) ${t('Rebase finished')}`, 4000);
        }
      } catch (e) {
        void showGitError(errorMessage(e));
      }
      await this.provider.refresh(true);
    });
  }

  openUnstash(root?: string): void {
    this.open('unstash', t('Unstash Changes'), { kind: 'unstash', args: { root } }, (m, reply, host, close) => this.handleUnstash(m, reply, host, close));
  }

  async handleUnstash(m: ToExtension, reply: Reply, host: ConfirmHost, close: () => void): Promise<void> {
    const repoOf = (root: string) => this.provider.getRepository(root);
    const findStash = async (root: string, hash: string) => (await repoOf(root)?.listStashes())?.find((s) => s.hash === hash);
    switch (m.type) {
      case 'unstashLoad': {
        const list = await this.provider.repositories();
        const repos = await Promise.all(
          list.map(async (r) => ({ root: r.root, name: r.name, stashes: (await repoOf(r.root)?.listStashes().catch(() => [])) ?? [] })),
        );
        reply({ type: 'unstashData', requestId: m.requestId, repos });
        return;
      }
      case 'unstashFiles': {
        const stash = await findStash(m.root, m.hash);
        const modules = new ModuleResolver(m.root);
        const files = stash ? ((await repoOf(m.root)?.getStashFiles(stash)) ?? []).map((f) => ({ ...f, module: modules.moduleOf(f.path) })) : [];
        reply({ type: 'unstashFiles', requestId: m.requestId, root: m.root, hash: m.hash, files });
        return;
      }
      case 'openStashDiff': {
        const stash = await findStash(m.root, m.hash);
        if (stash) await openStashFile(m.root, stash, m.file, vscode.ViewColumn.Beside);
        return;
      }
      case 'unstashApply': {
        const repo = repoOf(m.root);
        const stash = await findStash(m.root, m.hash);
        if (!repo || !stash) {
          void vscode.window.showWarningMessage(t('This stash no longer exists.'));
          return;
        }
        try {
          if (m.branch) {
            if (!(await repo.isValidRefName(m.branch, 'branch'))) {
              void showGitError(t('Not a valid branch name.'));
              return;
            }
            await repo.stashBranch(m.branch, stash.ref);
          } else {
            await repo.stashApply(stash.ref, { pop: m.pop, index: m.index });
          }
          vscode.window.setStatusBarMessage(`$(check) ${m.branch ? t('Created and checked out {0}', m.branch) : m.pop ? t('Popped {0}', stash.ref) : t('Applied {0}', stash.ref)}`, 4000);
          reply({ type: 'stashChanged' });
          this.onStashChanged?.();
          close();
        } catch (e) {
          const msg = errorMessage(e);
          if (/conflict/i.test(msg)) {
            void vscode.window.showWarningMessage(t('The stash was applied with conflicts. Resolve them, then the stash can be dropped; it was kept.'), t('Resolve Conflicts…')).then((a) => {
              if (a) this.conflicts.openList(m.root);
            });
            close();
          } else {
            void showGitError(msg);
          }
        }
        await this.provider.refresh(true);
        return;
      }
      case 'unstashDrop': {
        const stash = await findStash(m.root, m.hash);
        if (!stash) return;
        if (await confirm(t('Drop {0}? Its changes will be lost.', stash.ref), { detail: stash.message, ok: t('Drop'), kind: 'danger' }, host)) {
          // 確認期間可能又新增了儲藏（stash@{n} 會位移）：依 hash 重新找一次再刪
          const now = await findStash(m.root, m.hash);
          if (!now) {
            void vscode.window.showWarningMessage(t('This stash no longer exists.'));
            return;
          }
          await repoOf(m.root)?.stashDrop(now.ref);
          reply({ type: 'stashChanged' });
          this.onStashChanged?.();
        }
        return;
      }
      case 'unstashClear': {
        const repo = repoOf(m.root);
        const count = (await repo?.listStashes())?.length ?? 0;
        if (!repo || count === 0) return;
        if (await confirm(t('Drop all {0} stashes? Their changes will be lost.', count), { ok: t('Clear'), kind: 'danger' }, host)) {
          await repo.stashClear();
          reply({ type: 'stashChanged' });
          this.onStashChanged?.();
        }
        return;
      }
    }
  }

  /** 對已開啟的分頁送訊息（例如衝突清單在別處解決衝突後更新） */
  postTo(key: string, msg: ToWebview): boolean {
    const entry = this.panels.get(key);
    if (!entry) return false;
    void entry.panel.webview.postMessage(msg);
    return true;
  }

  isOpen(key: string): boolean {
    return this.panels.has(key);
  }

  close(key: string): void {
    this.panels.get(key)?.panel.dispose();
  }

  open(key: string, title: string, config: DialogConfig, handler: Handler): void {
    const existing = this.panels.get(key);
    if (existing) {
      // 已開啟：換成新的處理函式（對應新的檔案／repo），以新的內容重新載入並移到前面
      existing.handler = handler;
      existing.panel.title = title;
      existing.host.cancelAll();
      existing.panel.webview.html = this.provider.dialogHtml(existing.panel.webview, config);
      existing.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(`gitWorkbench.${key}`, title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.provider.extensionUri, 'dist'), vscode.Uri.joinPath(this.provider.extensionUri, 'media')],
    });
    panel.iconPath = vscode.Uri.joinPath(this.provider.extensionUri, 'media', 'activity.svg');
    const reply: Reply = (msg) => void panel.webview.postMessage(msg);
    const host = new ConfirmHost(reply, () => t('Cancel'));
    const entry = { panel, host, handler };
    this.panels.set(key, entry);
    panel.webview.onDidReceiveMessage(async (m: ToExtension) => {
      try {
        if (m.type === 'confirmResult') host.resolve(m.id, m.ok);
        else if (m.type === 'closeDialog') panel.dispose();
        else if (m.type === 'dialogPref') await this.provider.setDialogPref(m.key, m.value);
        else await entry.handler(m, reply, host, () => panel.dispose());
      } catch (e) {
        void showGitError(errorMessage(e));
      }
    });
    panel.onDidDispose(() => {
      host.cancelAll();
      if (this.panels.get(key)?.panel === panel) this.panels.delete(key);
    });
    panel.webview.html = this.provider.dialogHtml(panel.webview, config);
  }
}
