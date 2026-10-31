// 底部 Panel 的 WebviewView：管理工作區內所有 repository、處理 webview 訊息、自動重新整理
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_SCAN_EXCLUDE, dedupePaths, pathKey, scanForRepositories } from './git/discovery';
import { LogMerger } from './git/logMerger';
import { isGraphFilter, isHash } from './git/parsers';
import { GitRepository } from './git/repository';
import { builtinRepositoryRoots, onRepositoryChange } from './gitExtension';
import { revisionUri } from './diffProvider';
import { buildPushPlans, runCommitAction, runCommitsAction, runPush, runRefAction, runSync, type RepoTarget } from './actions';
import { mapLimit } from './util';
import { combineChanges } from './shared/combine';
import { ModuleResolver } from './modules';
import { promises as fsp, statSync } from 'node:fs';
import { EMPTY_FILTER, type ChangedFile, type CommitInfo, type IssueLinkRule, type LogFilter, type RepoState, type SyncAction, type ToExtension, type ToWebview, type UserInfo } from './shared/protocol';
import { currentBundle, currentLanguage, t } from './i18n';
import { ConfirmHost, confirm, setWebviewConfirm } from './dialogs';
import { DialogPanels } from './dialogPanel';

interface RepoEntry {
  repo: GitRepository;
  key: string;
  name: string;
  state?: RepoState;
  stateJson?: string;
}

export interface RepositorySummary {
  root: string;
  name: string;
  branch?: string;
  /** 是否包含在目前 Log 的 Paths（repo）篩選中 */
  visible: boolean;
}

export class WorkbenchViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'gitWorkbench.log';

  private view?: vscode.WebviewView;
  private entries: RepoEntry[] = [];
  private discovering?: Promise<void>;
  private discovered = false;
  /** 掃描進行中又被要求重新掃描（例如工作區資料夾變動） */
  private rediscoverAgain = false;
  private rediscoverNotify = false;
  /** entries 每次替換就加一；commit.repo 索引只在同一個 generation 內有效 */
  private generation = 0;
  /** watcher 重建世代，避免非同步註冊的監聽器在重建後才加入 */
  private watchGeneration = 0;
  /** 待重新讀取狀態的 repo（key） */
  private readonly dirtyKeys = new Set<string>();
  private detailsAbort?: AbortController;
  private containsAbort?: AbortController;
  private currentFilter: LogFilter = EMPTY_FILTER;
  private logAbort?: AbortController;
  private repoWatchers: vscode.Disposable[] = [];
  private refreshTimer?: NodeJS.Timeout;
  private dirtyWhileHidden = false;
  /** webview 尚未就緒時暫存的篩選（例如從檔案總管觸發「顯示 Git 歷史」） */
  private pendingFilter?: Partial<LogFilter>;
  /** Log 面板內的確認框 */
  private readonly confirms = new ConfirmHost(
    (msg) => this.post(msg),
    () => t('Cancel'),
  );
  /** 開在編輯器分頁的對話框（Push 等） */
  readonly dialogs = new DialogPanels(this);
  /** 最近一次從詳情開啟的 diff 所屬的檔案清單（diff 內切換上一個／下一個檔案） */
  private diffNav: { root: string; hash: string; parent?: string; files: ChangedFile[]; index: number; right?: string } | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** repository 清單、HEAD／refs 或 repo 篩選變動時觸發（供側邊欄 Repositories 更新） */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitPath: string,
  ) {
    // diff 內切換檔案的按鈕只在「從 Log 開啟的那個 diff」是目前分頁時顯示
    const tabs = vscode.window.tabGroups;
    if (tabs) this.disposables.push(tabs.onDidChangeTabs(() => this.updateDiffNavContext()), tabs.onDidChangeTabGroups(() => this.updateDiffNavContext()));
  }

  /** 目前分頁是否為最近一次從 Log 開啟的 diff（無法判斷分頁時視為是） */
  private isNavDiffActive(): boolean {
    const nav = this.diffNav;
    if (!nav?.right) return false;
    const tabs = vscode.window.tabGroups;
    if (!tabs) return true;
    const input = tabs.activeTabGroup?.activeTab?.input;
    return input instanceof vscode.TabInputTextDiff && input.modified.toString() === nav.right;
  }

  private updateDiffNavContext(): void {
    void vscode.commands.executeCommand('setContext', 'gitWorkbench.diffNav', this.isNavDiffActive());
  }

  // ---------- repository 清單 ----------

  private find(root: string): RepoEntry | undefined {
    const k = pathKey(root);
    return this.entries.find((e) => e.key === k);
  }

  /** 依 root 取得 repository（供 diff 內容提供者使用） */
  /** 目前所有 repository */
  repositoryList(): GitRepository[] {
    return this.entries.map((e) => e.repo);
  }

  getRepository(root: string): GitRepository | undefined {
    return this.find(root)?.repo;
  }

  async repositories(): Promise<RepositorySummary[]> {
    await this.ensureDiscovered();
    const roots = new Set(this.currentFilter.roots.map((r) => pathKey(r)));
    return this.entries.map((e) => ({
      root: e.repo.root,
      name: e.name,
      branch: e.state?.head.branch ?? (e.state?.head.hash ? `detached ${e.state.head.hash.slice(0, 8)}` : undefined),
      visible: roots.size === 0 || roots.has(e.key),
    }));
  }

  private ensureDiscovered(): Promise<void> {
    if (this.discovered) return Promise.resolve();
    return this.rediscover(false);
  }

  /**
   * 重新掃描工作區中的 repository。掃描進行中再次呼叫時，會在目前掃描結束後再掃一次，
   * 且只要任一次呼叫要求通知就會通知 webview。
   */
  rediscover(notify = true): Promise<void> {
    this.rediscoverNotify ||= notify;
    if (this.discovering) {
      this.rediscoverAgain = true;
      return this.discovering;
    }
    this.discovering = (async () => {
      do {
        this.rediscoverAgain = false;
        await this.discover();
      } while (this.rediscoverAgain);
      this.discovered = true;
      const shouldNotify = this.rediscoverNotify;
      this.rediscoverNotify = false;
      if (shouldNotify) await this.refresh(true);
      this.changeEmitter.fire();
    })().finally(() => (this.discovering = undefined));
    return this.discovering;
  }

  private async discover(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('gitWorkbench');
    const depth = cfg.get<number>('scanDepth', 3);
    const exclude = cfg.get<string[]>('scanExclude', DEFAULT_SCAN_EXCLUDE);
    const folders = await workspaceFolderPaths();

    const candidates: string[] = [...(await builtinRepositoryRoots())];
    for (const f of folders) candidates.push(f, ...(await scanForRepositories(f, depth, exclude)));
    // 從找到的資料夾解析出真正的 repo 根目錄（工作區資料夾本身可能位於 repo 內部）；限制並行數避免一次開大量程序
    const opened = await mapLimit(dedupePaths(candidates), 8, (c) => GitRepository.open(this.gitPath, c));
    const repos = new Map<string, GitRepository>();
    for (const r of opened) if (r && !repos.has(pathKey(r.root))) repos.set(pathKey(r.root), r);

    const old = new Map(this.entries.map((e) => [e.key, e]));
    this.entries = [...repos.entries()]
      .map(([key, repo]) => old.get(key) ?? { repo, key, name: displayName(repo.root, folders) })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    this.generation++;
    this.watchRepositories();
  }

  /** 加入掃描範圍外的 repository（例如從檔案總管開啟較深層的檔案歷史） */
  private async addRepository(repo: GitRepository): Promise<RepoEntry> {
    const existing = this.find(repo.root);
    if (existing) return existing;
    const entry: RepoEntry = { repo, key: pathKey(repo.root), name: displayName(repo.root, await workspaceFolderPaths()) };
    this.entries = [...this.entries, entry].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    this.generation++;
    this.watchRepositories();
    return entry;
  }

  /** 依目前設定重建 watcher（autoRefresh 變更時呼叫） */
  rewatch(): void {
    this.watchRepositories();
  }

  private watchRepositories(): void {
    const gen = ++this.watchGeneration;
    this.repoWatchers.forEach((d) => d.dispose());
    this.repoWatchers = [];
    if (!vscode.workspace.getConfiguration('gitWorkbench').get<boolean>('autoRefresh', true)) return;
    for (const { repo, key } of this.entries) {
      const trigger = () => this.scheduleRefresh(key);
      for (const dir of new Set([repo.commonDir, repo.gitDir])) {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), '{HEAD,packed-refs,refs/**}'));
        w.onDidChange(trigger);
        w.onDidCreate(trigger);
        w.onDidDelete(trigger);
        this.repoWatchers.push(w);
      }
      // 內建 Git 擴充套件的狀態事件作為備援（存檔也會觸發，因此只重新讀取這個 repo，且狀態沒變就不通知）
      void onRepositoryChange(repo.root, trigger).then((d) => {
        if (!d) return;
        if (gen === this.watchGeneration) this.repoWatchers.push(d);
        else d.dispose();
      });
    }
  }

  private scheduleRefresh(key?: string): void {
    if (key) this.dirtyKeys.add(key);
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(false), 400);
  }

  /**
   * 重新讀取每個 repository 的 refs／HEAD；有變動（或 force）才通知 webview，webview 收到後會重新載入 log。
   */
  async refresh(force: boolean): Promise<void> {
    if (!this.view) return;
    if (!this.view.visible && !force) {
      this.dirtyWhileHidden = true;
      return;
    }
    await this.ensureDiscovered();
    if (this.entries.length === 0) {
      this.post({ type: 'repos', states: [], generation: this.generation, message: t('No Git repository found in the workspace.') });
      this.view.description = undefined;
      return;
    }
    // 一般變動只重新讀取有變動的 repo；force 或尚無狀態的 repo 全部讀取
    const dirty = new Set(this.dirtyKeys);
    this.dirtyKeys.clear();
    const targets = this.entries.filter((e) => force || dirty.size === 0 || dirty.has(e.key) || !e.state);
    let changed = false;
    await mapLimit(targets, 6, async (e) => {
      let s: RepoState;
      try {
        s = await e.repo.getState();
      } catch (err) {
        // 讀取失敗時以空狀態佔位，確保 states 與 entries 一一對應（commit.repo 索引不會錯位）
        console.error('[Git Workbench] getState failed', e.repo.root, err);
        s = { root: e.repo.root, name: e.name, head: {}, refs: [], remotes: [] };
      }
      s.name = e.name;
      const json = JSON.stringify(s);
      if (json !== e.stateJson) changed = true;
      e.state = s;
      e.stateJson = json;
    });
    if (!force && !changed) return;
    const states = this.entries.map((e) => e.state ?? { root: e.repo.root, name: e.name, head: {}, refs: [], remotes: [] });
    this.updateDescription();
    this.post({ type: 'repos', states, generation: this.generation, issueLinks: issueLinkRules() });
    this.changeEmitter.fire();
  }

  /** 面板標題旁顯示「repo · branch」；多 repo 時顯示 repo 數 */
  private updateDescription(): void {
    if (!this.view) return;
    const visible = this.visibleEntries();
    if (visible.length === 1) {
      const s = visible[0].state;
      this.view.description = `${visible[0].name} · ${s?.head.branch ?? `detached ${s?.head.hash?.slice(0, 8) ?? ''}`}`;
    } else {
      this.view.description = t('{0} repositories', visible.length);
    }
  }

  private visibleEntries(filter: LogFilter = this.currentFilter): RepoEntry[] {
    if (filter.roots.length === 0) return this.entries;
    const keys = new Set(filter.roots.map((r) => pathKey(r)));
    return this.entries.filter((e) => keys.has(e.key));
  }

  // ---------- webview ----------

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [distUri, mediaUri] };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage((m: ToExtension) => this.onMessage(m), undefined, this.disposables);
    view.onDidChangeVisibility(
      () => {
        if (view.visible && this.dirtyWhileHidden) {
          this.dirtyWhileHidden = false;
          void this.refresh(false);
        }
      },
      undefined,
      this.disposables,
    );
    // 面板可見時，確認框顯示在面板內
    setWebviewConfirm((message, opts) => (this.view?.visible ? this.confirms.request(message, opts) : Promise.resolve(undefined)));
    view.onDidDispose(() => {
      this.view = undefined;
      setWebviewConfirm(undefined);
      this.confirms.cancelAll();
      this.logAbort?.abort();
    });
  }

  private post(msg: ToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  private async onMessage(m: ToExtension): Promise<void> {
    try {
      switch (m.type) {
        case 'confirmResult':
          this.confirms.resolve(m.id, m.ok);
          break;
        case 'ready':
          // webview 重新載入時，尚未回覆的確認框視為取消
          this.confirms.cancelAll();
          if (this.pendingFilter) {
            this.post({ type: 'applyFilter', filter: this.pendingFilter });
            this.pendingFilter = undefined;
          }
          await this.refresh(true);
          break;
        case 'loadLog':
          await this.loadLog(m.requestId, m.generation, m.filter);
          break;
        case 'selectCommit':
          await this.sendDetails(m.root, m.hash);
          break;
        case 'selectCommits':
          await this.sendMultiDetails(m.requestId, m.items);
          break;
        case 'containingBranches':
          await this.sendContaining(m.root, m.hash);
          break;
        case 'requestUsers':
          this.post({ type: 'users', users: await this.collectUsers() });
          break;
        case 'requestPaths': {
          const e = this.find(m.root);
          if (e) this.post({ type: 'paths', root: m.root, paths: await e.repo.listDirectories() });
          break;
        }
        case 'openDiff':
          this.diffNav = m.files && m.files.length > 1 ? { root: m.root, hash: m.hash, parent: m.parent, files: m.files, index: m.files.findIndex((f) => f.path === m.file.path) } : undefined;
          {
            const right = await this.openDiff(m.root, m.hash, m.parent, m.file);
            if (this.diffNav) this.diffNav.right = right;
            this.updateDiffNavContext();
          }
          break;
        case 'checkout':
          await this.checkoutRef(m.ref, m.roots);
          break;
        case 'checkoutRevision':
          await this.checkoutRevision(m.root, m.hash);
          break;
        case 'refresh':
          await this.rediscover(true);
          break;
        case 'openExternal':
          if (/^https?:\/\//i.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(m.text);
          vscode.window.setStatusBarMessage(t('Copied: {0}', m.text), 2000);
          break;
        case 'selectRepository':
          await this.selectRepository();
          break;
        case 'sync':
          await this.sync(m.action, m.roots);
          break;
        case 'pushPreview':
        case 'pushCommitFiles':
        case 'pushConfirm':
          await this.handlePushMessage(m, (msg) => this.post(msg));
          break;
        case 'openRebase':
          await this.dialogs.openRebase(m.root, m.hash);
          break;
        case 'operation': {
          const e = this.find(m.root);
          const op = await e?.repo.operationInProgress();
          if (!e || !op) break;
          try {
            if (m.action === 'continue') await e.repo.continueOperation(op);
            else if (m.action === 'skip' && (op === 'rebase' || op === 'cherry-pick')) await e.repo.skipOperation(op);
            else if (m.action === 'abort') await e.repo.abortOperation(op);
          } catch (err) {
            const next = await e.repo.operationInProgress();
            // 仍在進行中：多半是還有衝突沒解決
            if (next) {
              const open = t('Open Source Control');
              void vscode.window.showWarningMessage(t('{0}: {1} is still in progress. Resolve the remaining conflicts, then continue.', e.name, next), { detail: errorMessage(err) }, open).then((a) => {
                if (a === open) void vscode.commands.executeCommand('workbench.view.scm');
              });
            } else {
              void vscode.window.showErrorMessage(errorMessage(err));
            }
          }
          await this.refresh(true);
          break;
        }
        case 'openPushPanel':
          this.dialogs.openPush({ roots: m.roots, branch: m.branch, upTo: m.upTo });
          break;
        case 'refAction': {
          const targets = (await this.freshTargets(m.roots)).filter((x) => x.state?.refs.some((r) => r.name === m.ref));
          await runRefAction(m.action, m.ref, targets);
          await this.refresh(true);
          break;
        }
        case 'commitsAction': {
          const [target] = await this.freshTargets([m.root]);
          if (!target) break;
          await runCommitsAction(m.action, target, m.commits);
          await this.refresh(true);
          break;
        }
        case 'commitAction': {
          const [target] = await this.freshTargets([m.root]);
          if (!target) break;
          await runCommitAction(m.action, target, m.hash, m.parents, m.subject);
          await this.refresh(true);
          break;
        }
      }
    } catch (e) {
      void vscode.window.showErrorMessage(t('Git command failed: {0}', errorMessage(e)));
    }
  }

  /** 由 extension 端套用篩選（側邊欄、檔案總管）；webview 尚未建立時先暫存 */
  async applyFilter(filter: Partial<LogFilter>, focus: boolean): Promise<void> {
    if (this.view) this.post({ type: 'applyFilter', filter });
    else this.pendingFilter = { ...this.pendingFilter, ...filter };
    if (focus) await vscode.commands.executeCommand(`${WorkbenchViewProvider.viewId}.focus`);
  }

  /** 只顯示指定的 repository（空陣列表示全部） */
  async showRepositories(roots: string[], focus = true): Promise<void> {
    const all = roots.length === this.entries.length;
    await this.applyFilter({ roots: all ? [] : roots, paths: [] }, focus);
  }

  /**
   * 顯示某個檔案或資料夾的歷史：Paths 篩選到它所屬的 repository 與相對路徑。
   */
  /** 找出檔案或資料夾所屬的 repository（巢狀時為最內層）與相對路徑；不在 repo 內時提示並回傳 undefined */
  async locateUri(uri: vscode.Uri): Promise<{ repo: GitRepository; rel: string; isDir: boolean } | undefined> {
    await this.ensureDiscovered();
    const fsPath = uri.fsPath;
    let isDir = false;
    try {
      isDir = (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
    } catch {
      // 檔案可能已刪除，仍以所在資料夾判斷
    }
    const dir = isDir ? fsPath : path.dirname(fsPath);
    // 由 git 判斷所屬 repo 與相對路徑；經過 symlink／junction／subst 也正確
    const located = await GitRepository.locate(this.gitPath, dir);
    if (!located) {
      void vscode.window.showInformationMessage(t('{0} is not inside a Git repository.', path.basename(fsPath)));
      return undefined;
    }
    const known = this.find(located.repo.root);
    const entry = known ?? (await this.addRepository(located.repo));
    if (!known) await this.refresh(true);
    const rel = (located.prefix + (isDir ? '' : path.basename(fsPath))).replace(/\/+$/, '');
    return { repo: entry.repo, rel, isDir };
  }

  async showHistory(uri: vscode.Uri | undefined): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== 'file') return;
    const loc = await this.locateUri(target);
    if (!loc) return;
    await this.applyFilter({ roots: [loc.repo.root], paths: loc.rel ? [loc.rel] : [], branches: [], text: '', users: [] }, true);
  }

  /** 取得指定 repo 的操作目標（含最新狀態） */
  async targetOf(root: string): Promise<RepoTarget | undefined> {
    return (await this.freshTargets([root]))[0];
  }


  async selectRepository(): Promise<void> {
    await this.ensureDiscovered();
    if (this.entries.length === 0) {
      void vscode.window.showInformationMessage(t('No Git repository found in the workspace.'));
      return;
    }
    const visible = new Set(this.visibleEntries().map((e) => e.key));
    const picks = await vscode.window.showQuickPick(
      this.entries.map((e) => ({ label: e.name, description: e.repo.root, picked: visible.has(e.key), root: e.repo.root })),
      { placeHolder: t('Select repositories to show'), canPickMany: true },
    );
    if (!picks || picks.length === 0) return;
    await this.showRepositories(picks.map((p) => p.root));
  }

  // ---------- log / details ----------

  private async loadLog(requestId: number, generation: number, filter: LogFilter): Promise<void> {
    // webview 的 repos 清單已過期：commit.repo 索引會對不上，等它收到新的 repos 後重新請求
    if (generation !== this.generation) return;
    this.currentFilter = { ...EMPTY_FILTER, ...filter };
    this.updateDescription();
    this.changeEmitter.fire();
    this.logAbort?.abort();
    const abort = new AbortController();
    this.logAbort = abort;
    const max = vscode.workspace.getConfiguration('gitWorkbench').get<number>('maxCommits', 50000);
    const graph = isGraphFilter(filter);
    const entries = this.entries;

    // 每個 repo 的實際篩選：branch 篩選只套用到擁有該 ref 的 repo，沒有任何一個的 repo 略過
    const targets: { index: number; filter: LogFilter; hasHead: boolean }[] = [];
    const visible = new Set(this.visibleEntries(this.currentFilter).map((e) => e.key));
    entries.forEach((e, index) => {
      const state = e.state;
      if (!visible.has(e.key) || !state) return;
      const hasHead = !!state.head.hash;
      let branches = filter.branches;
      if (branches.length > 0) {
        branches = branches.filter((b) => (b === 'HEAD' ? hasHead : !b.startsWith('refs/') || state.refs.some((r) => r.name === b)));
        if (branches.length === 0) return;
      }
      // 沒有任何 commit 的 repo（剛 init）略過
      if (!hasHead && state.refs.length === 0) return;
      // 路徑篩選：Select… 跨 repo 勾選時各 repo 各自的路徑；沒有勾到資料夾的 repo 不限路徑
      const byRoot = this.currentFilter.pathsByRoot;
      const paths = byRoot ? (byRoot[e.repo.root] ?? []) : this.currentFilter.paths;
      targets.push({ index, filter: { ...this.currentFilter, branches, paths }, hasHead });
    });

    const merger = new LogMerger(targets.length);
    let flushed = 0;
    let pending: CommitInfo[] = [];
    let lastFlush = Date.now();
    const flush = (force: boolean) => {
      if (flushed >= max) return;
      pending.push(...merger.drain());
      const limit = flushed === 0 ? 300 : 3000;
      if (pending.length === 0 || (!force && pending.length < limit && Date.now() - lastFlush < 150)) return;
      // 多個 repo 合計也不超過 maxCommits（避免虛擬捲動高度超出瀏覽器上限）
      const batch = pending.slice(0, max - flushed);
      if (!abort.signal.aborted) this.post({ type: 'logBatch', requestId, commits: batch, done: false, graph });
      flushed += batch.length;
      pending = [];
      lastFlush = Date.now();
      if (flushed >= max) abort.abort();
    };

    const errors: string[] = [];
    /** 篩選結果（非 graph 模式時用來計算簡化 graph） */
    const matched = targets.map(() => new Set<string>());
    await mapLimit(targets, 8, async (t, i) => {
      const index = t.index;
      try {
        await entries[index].repo.streamLog(
          t.filter,
          max,
          (commits) => {
            for (const c of commits) {
              c.repo = index;
              if (!graph) matched[i].add(c.hash);
            }
            merger.push(i, commits);
            flush(false);
          },
          abort.signal,
          t.hasHead,
        );
      } catch (e) {
        if (!abort.signal.aborted) errors.push(`${entries[index].name}: ${errorMessage(e)}`);
      } finally {
        merger.finish(i);
        flush(false);
      }
    });
    if (this.logAbort !== abort) return; // 已有新的請求
    if (!abort.signal.aborted) flush(true);
    if (errors.length > 0 && flushed === 0) {
      this.post({ type: 'logError', requestId, message: errors.join('\n') });
      return;
    }
    this.post({ type: 'logBatch', requestId, commits: [], done: true, graph, warnings: errors.length > 0 ? errors : undefined });
    if (!graph && flushed > 0 && flushed < max && !abort.signal.aborted) await this.sendSimplifiedGraph(requestId, targets, matched, max, abort.signal);
  }

  /** 篩選結果顯示後，再計算簡化 graph 讓結果之間可以畫出連線 */
  private async sendSimplifiedGraph(
    requestId: number,
    targets: { index: number; filter: LogFilter; hasHead: boolean }[],
    matched: Set<string>[],
    max: number,
    signal: AbortSignal,
  ): Promise<void> {
    const parents: [number, string, string[]][] = [];
    try {
      await mapLimit(targets, 4, async (t, i) => {
        if (matched[i].size === 0) return;
        const map = await this.entries[t.index]?.repo.simplifiedParents(t.filter, matched[i], max, signal, t.hasHead);
        if (!map) return;
        for (const [hash, ps] of map) parents.push([t.index, hash, ps]);
      });
    } catch {
      return; // 取消或失敗時維持沒有連線的顯示
    }
    if (!signal.aborted && this.logAbort?.signal === signal) this.post({ type: 'logGraph', requestId, parents });
  }

  private async sendDetails(root: string, hash: string): Promise<void> {
    const e = this.find(root);
    if (!e) return;
    // 只保留最新的請求（方向鍵連續移動時取消前一個 git 程序）
    this.detailsAbort?.abort();
    const abort = new AbortController();
    this.detailsAbort = abort;
    try {
      const d = await e.repo.getDetails(hash, abort.signal);
      const modules = new ModuleResolver(e.repo.root);
      if (!abort.signal.aborted) this.post({ type: 'details', details: { ...d, root, files: d.files.map((f) => ({ ...f, module: modules.moduleOf(f.path) })) } });
    } catch (err) {
      if (!abort.signal.aborted) this.post({ type: 'detailsError', root, hash, message: errorMessage(err) });
    }
  }

  private async sendContaining(root: string, hash: string): Promise<void> {
    const e = this.find(root);
    if (!e) return;
    this.containsAbort?.abort();
    const abort = new AbortController();
    this.containsAbort = abort;
    try {
      const branches = await e.repo.getContainingBranches(hash, abort.signal);
      if (!abort.signal.aborted) this.post({ type: 'containing', root, hash, branches });
    } catch {
      // 取消或失敗時不更新
    }
  }

  private async collectUsers(): Promise<UserInfo[]> {
    const merged = new Map<string, UserInfo>();
    const lists = await Promise.all(this.visibleEntries().map((e) => e.repo.getUsers().catch(() => [] as UserInfo[])));
    for (const list of lists) {
      for (const u of list) {
        const k = `${u.name}\n${u.email}`;
        const prev = merged.get(k);
        if (prev) prev.count += u.count;
        else merged.set(k, { ...u });
      }
    }
    return [...merged.values()].sort((a, b) => b.count - a.count);
  }

  /** diff 視窗中切換到上一個／下一個變更檔案 */
  async navigateDiff(delta: 1 | -1): Promise<void> {
    const nav = this.diffNav;
    if (!nav || !this.isNavDiffActive()) return;
    const next = nav.index + delta;
    if (next < 0 || next >= nav.files.length) {
      vscode.window.setStatusBarMessage(delta > 0 ? t('Last changed file') : t('First changed file'), 2000);
      return;
    }
    nav.index = next;
    const file = nav.files[next];
    nav.right = await this.openDiff(nav.root, file.right ?? nav.hash, file.left ?? nav.parent, file);
    this.updateDiffNavContext();
    vscode.window.setStatusBarMessage(`${next + 1}/${nav.files.length} ${file.path}`, 2500);
  }

  /** 多選 commit：每個 repo 各自合併選取 commit 的淨變更 */
  private async sendMultiDetails(requestId: number, items: { root: string; hash: string; parents: string[] }[]): Promise<void> {
    this.detailsAbort?.abort();
    const abort = new AbortController();
    this.detailsAbort = abort;
    const byRoot = new Map<string, typeof items>();
    for (const it of items) byRoot.set(it.root, [...(byRoot.get(it.root) ?? []), it]);
    const groups: { root: string; files: ChangedFile[] }[] = [];
    try {
      for (const [root, list] of byRoot) {
        const e = this.find(root);
        if (!e) continue;
        // webview 依列順序（新到舊）送來，合併時要由舊到新
        // 值來自 webview：只接受 hash
        const ordered = [...list].reverse().filter((c) => isHash(c.hash) && c.parents.every(isHash));
        const changes = await mapLimit(ordered, 4, async (c) => ({
          hash: c.hash,
          parent: c.parents[0],
          files: await e.repo.getChangedFiles(c.hash, c.parents.slice(0, 1), abort.signal),
        }));
        const modules = new ModuleResolver(e.repo.root);
        groups.push({ root, files: combineChanges(changes).map((f) => ({ ...f, module: modules.moduleOf(f.path) })) });
      }
      if (!abort.signal.aborted) this.post({ type: 'multiDetails', requestId, groups });
    } catch (err) {
      if (!abort.signal.aborted) void vscode.window.showErrorMessage(errorMessage(err));
    }
  }

  /** @returns 右側（修改後）的 URI 字串，用來辨識這個 diff 分頁 */
  private async openDiff(root: string, hash: string, parent: string | undefined, file: ChangedFile, viewColumn?: vscode.ViewColumn): Promise<string | undefined> {
    const e = this.find(root);
    if (!e) return undefined;
    // 多選合併的變更自帶左右兩側的 revision
    const leftRef = file.left !== undefined ? file.left : file.status === 'A' || !parent ? '' : parent;
    const rightRef = file.right !== undefined ? file.right : file.status === 'D' ? '' : hash;
    const left = revisionUri(e.repo.root, leftRef, file.oldPath ?? file.path);
    const right = revisionUri(e.repo.root, rightRef, file.path);
    const short = (h: string) => (h ? h.slice(0, 8) : '∅');
    const title = `${path.basename(file.path)} (${short(leftRef)} ↔ ${short(rightRef)})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true, viewColumn });
    return right.toString();
  }

  // ---------- 同步 ----------

  /** 取得最新狀態的操作目標（避免用到過期的 upstream／branch 資訊） */
  private async freshTargets(roots: string[]): Promise<RepoTarget[]> {
    const keys = new Set(roots.map((r) => pathKey(r)));
    const list = this.entries.filter((e) => keys.has(e.key));
    return mapLimit(list, 6, async (e) => ({ repo: e.repo, name: e.name, state: await e.repo.getState().catch(() => e.state) }));
  }

  /** 對指定 repository 同步；未指定時為目前 Paths 篩選下可見的 repository */
  async sync(action: SyncAction, roots?: string[]): Promise<void> {
    await this.ensureDiscovered();
    const list = roots ?? this.visibleEntries().map((e) => e.repo.root);
    await runSync(action, await this.freshTargets(list));
    await this.refresh(true);
  }

  /** 開啟 Push 對話框（webview 尚未建立時，等 ready 後再開） */
  async openPush(): Promise<void> {
    await this.ensureDiscovered();
    this.dialogs.openPush({ roots: this.visibleRoots() });
  }

  // ---------- checkout ----------

  /** 在 roots 中所有擁有此 ref 的 repository checkout（同名 branch 一次切換） */
  private async checkoutRef(refName: string, roots: string[]): Promise<void> {
    const keys = new Set(roots.map((r) => pathKey(r)));
    const plans: { entry: RepoEntry; target: string; track: boolean; label: string }[] = [];
    let isTag = false;
    for (const entry of this.entries) {
      if (!keys.has(entry.key)) continue;
      const state = await entry.repo.getState();
      const ref = state.refs.find((r) => r.name === refName);
      if (!ref) continue;
      let target = ref.short;
      let track = false;
      if (ref.type === 'remote') {
        const local = state.refs.find((r) => r.type === 'local' && r.short === ref.remoteBranch);
        if (local) target = local.short;
        else track = true;
      } else if (ref.type === 'tag') {
        isTag = true;
        target = ref.name;
      }
      plans.push({ entry, target, track, label: ref.short });
    }
    if (plans.length === 0) return;

    const ok = t('Checkout');
    const label = plans[0].label;
    if (isTag) {
      if (!(await confirm(t('Checkout tag {0}? This will put the repository in detached HEAD state.', label), { detail: plans.map((p) => p.entry.name).join('\n'), ok, kind: 'warning' }))) return;
    } else if (plans.length > 1) {
      if (!(await confirm(t('Checkout {0} in {1} repositories?', label, plans.length), { detail: plans.map((p) => p.entry.name).join('\n'), ok, kind: 'info' }))) return;
    }
    await this.runCheckouts(plans, label);
  }

  private async checkoutRevision(root: string, hash: string): Promise<void> {
    const entry = this.find(root);
    if (!entry) return;
    const ok = t('Checkout');
    const yes = await confirm(t('Checkout revision {0}? This will put the repository in detached HEAD state.', hash.slice(0, 8)), { detail: entry.name, ok, kind: 'warning' });
    if (yes) await this.runCheckouts([{ entry, target: hash, track: false }], hash.slice(0, 8));
  }

  private async runCheckouts(plans: { entry: RepoEntry; target: string; track: boolean }[], label: string): Promise<void> {
    const failures: string[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('Checking out {0}…', label) },
      async () => {
        for (const p of plans) {
          try {
            await p.entry.repo.checkout(p.target, { track: p.track });
          } catch (e) {
            failures.push(plans.length > 1 ? `${p.entry.name}: ${errorMessage(e)}` : errorMessage(e));
          }
        }
      },
    );
    if (failures.length > 0) void vscode.window.showErrorMessage(t('Checkout failed: {0}', failures.join('\n')));
    await this.refresh(true);
  }

  // ---------- Push 對話框（Log 面板或編輯器分頁共用） ----------

  /** 處理 Push 對話框的訊息；reply 送回發出訊息的 webview；host 為該 webview 的確認框 */
  async handlePushMessage(m: Extract<ToExtension, { type: 'pushPreview' | 'pushCommitFiles' | 'pushConfirm' }>, reply: (msg: ToWebview) => void, host?: ConfirmHost): Promise<void> {
    if (m.type === 'pushPreview') {
      const plans = await buildPushPlans(await this.freshTargets(m.roots), m.upTo, m.overrides, m.branch);
      // 依 webview 傳入的順序排列
      plans.sort((a, b) => m.roots.indexOf(a.root) - m.roots.indexOf(b.root));
      reply({ type: 'pushPreview', requestId: m.requestId, plans });
    } else if (m.type === 'pushCommitFiles') {
      const e = this.find(m.root);
      if (!e || !isHash(m.hash)) return;
      const parents = (await e.repo.exec(['rev-list', '--parents', '-n1', m.hash])).trim().split(' ').slice(1);
      reply({ type: 'pushCommitFiles', requestId: m.requestId, root: m.root, hash: m.hash, files: await e.repo.getChangedFiles(m.hash, parents) });
    } else {
      const targets = await this.freshTargets(m.targets.map((x) => x.root));
      const entries = m.targets.flatMap((push) => {
        const target = targets.find((x) => pathKey(x.repo.root) === pathKey(push.root));
        return target ? [{ target, push }] : [];
      });
      const started = await runPush(entries, m.force, m.tags, () => reply({ type: 'pushStatus', requestId: m.requestId, status: 'started' }), host);
      if (!started) reply({ type: 'pushStatus', requestId: m.requestId, status: 'cancelled' });
      await this.refresh(true);
    }
  }

  get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  /** 從編輯器分頁的對話框開 diff（開在對話框旁邊，不蓋掉對話框） */
  async openDiffFromDialog(root: string, hash: string, parent: string | undefined, file: ChangedFile): Promise<void> {
    await this.openDiff(root, hash, parent, file, vscode.ViewColumn.Beside);
  }

  /** 目前 Paths 篩選下可見的 repository root */
  visibleRoots(): string[] {
    return this.visibleEntries().map((e) => e.repo.root);
  }

  /** 開在編輯器分頁的對話框用的 HTML（同一份樣式與翻譯） */
  dialogHtml(webview: vscode.Webview, config: unknown): string {
    return this.renderHtml(webview, { script: 'dialog.js', config });
  }

  /** 其他 webview（提交視窗）的 HTML：同一份樣式、翻譯與 CSP */
  pageHtml(webview: vscode.Webview, script: string, config: unknown): string {
    return this.renderHtml(webview, { script, config });
  }

  // ---------- html ----------

  /** 介面語言變更：重新產生 webview（篩選、版面等狀態由 webview 的 state 保存） */
  reloadWebview(): void {
    if (this.view) this.view.webview.html = this.renderHtml(this.view.webview);
  }

  private renderHtml(webview: vscode.Webview, page: { script: string; config?: unknown } = { script: 'webview.js' }): string {
    const nonce = makeNonce();
    // 加上檔案時間當版本參數：同版本號重新安裝時，避免 webview 沿用快取的舊檔
    const stamp = (rel: string[]) => {
      try {
        return String(Math.floor(statSync(vscode.Uri.joinPath(this.context.extensionUri, ...rel).fsPath).mtimeMs));
      } catch {
        return '0';
      }
    };
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', page.script)).with({ query: `v=${stamp(['dist', page.script])}` });
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css')).with({ query: `v=${stamp(['media', 'webview.css'])}` });
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    // 目前語系的翻譯（英文時為空）；跳脫 '<' 避免提早結束 script 區塊
    const l10nJson = JSON.stringify(currentBundle() ?? {}).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="${currentLanguage()}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Git Workbench</title>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="l10n-bundle">${l10nJson}</script>
<script type="application/json" id="dialog-config">${JSON.stringify(page.config ?? null).replace(/</g, '\\u003c')}</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.repoWatchers.forEach((d) => d.dispose());
    clearTimeout(this.refreshTimer);
    this.logAbort?.abort();
    this.repoWatchers.forEach((d) => d.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}

/** repo 顯示名稱：相對所屬工作區資料夾的路徑；多個工作區資料夾時加上資料夾名稱 */
/** 工作區資料夾路徑（解析成實際路徑，與 git 回傳的 repo 根目錄一致） */
async function workspaceFolderPaths(): Promise<string[]> {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  return Promise.all(folders.map((f) => fsp.realpath(f).catch(() => f)));
}

function displayName(root: string, folders: readonly string[]): string {
  const owner = folders.filter((f) => isInside(f, root)).sort((a, b) => b.length - a.length)[0];
  if (!owner) return path.basename(root);
  const rel = path.relative(owner, root).split(path.sep).join('/');
  if (!rel) return path.basename(root);
  return folders.length > 1 ? `${path.basename(owner)}/${rel}` : rel;
}

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** 設定 gitWorkbench.issueLinks；未設定時，GitHub／GitLab 等遠端的 #123 自動連到 issue */
function issueLinkRules(): IssueLinkRule[] {
  const custom = vscode.workspace.getConfiguration('gitWorkbench').get<IssueLinkRule[]>('issueLinks', []);
  const valid = custom.filter((r) => r && typeof r.pattern === 'string' && typeof r.url === 'string' && /^https?:\/\/|^\{repo\}/.test(r.url));
  return valid.length > 0 ? valid : [{ pattern: '#(\\d+)', url: '{repo}/issues/$1' }];
}
