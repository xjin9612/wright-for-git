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
import { promises as fsp } from 'node:fs';
import { EMPTY_FILTER, type ChangedFile, type CommitInfo, type LogFilter, type RepoState, type SyncAction, type ToExtension, type ToWebview, type UserInfo } from './shared/protocol';

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
  private pendingOpenPush = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** repository 清單、HEAD／refs 或 repo 篩選變動時觸發（供側邊欄 Repositories 更新） */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitPath: string,
  ) {}

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
      this.post({ type: 'repos', states: [], generation: this.generation, message: vscode.l10n.t('No Git repository found in the workspace.') });
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
    this.post({ type: 'repos', states, generation: this.generation });
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
      this.view.description = vscode.l10n.t('{0} repositories', visible.length);
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
    view.onDidDispose(() => {
      this.view = undefined;
      this.logAbort?.abort();
    });
  }

  private post(msg: ToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  private async onMessage(m: ToExtension): Promise<void> {
    try {
      switch (m.type) {
        case 'ready':
          if (this.pendingOpenPush) {
            this.pendingOpenPush = false;
            this.post({ type: 'openPush' });
          }
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
          await this.openDiff(m.root, m.hash, m.parent, m.file);
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
        case 'copy':
          await vscode.env.clipboard.writeText(m.text);
          vscode.window.setStatusBarMessage(vscode.l10n.t('Copied: {0}', m.text), 2000);
          break;
        case 'selectRepository':
          await this.selectRepository();
          break;
        case 'sync':
          await this.sync(m.action, m.roots);
          break;
        case 'pushPreview': {
          const plans = await buildPushPlans(await this.freshTargets(m.roots), m.upTo, m.overrides, m.branch);
          // 依 webview 傳入的順序排列
          plans.sort((a, b) => m.roots.indexOf(a.root) - m.roots.indexOf(b.root));
          this.post({ type: 'pushPreview', requestId: m.requestId, plans });
          break;
        }
        case 'pushCommitFiles': {
          const e = this.find(m.root);
          if (!e || !isHash(m.hash)) break;
          const parents = (await e.repo.exec(['rev-list', '--parents', '-n1', m.hash])).trim().split(' ').slice(1);
          this.post({ type: 'pushCommitFiles', requestId: m.requestId, root: m.root, hash: m.hash, files: await e.repo.getChangedFiles(m.hash, parents) });
          break;
        }
        case 'pushConfirm': {
          const targets = await this.freshTargets(m.targets.map((x) => x.root));
          const entries = m.targets.flatMap((push) => {
            const target = targets.find((t) => pathKey(t.repo.root) === pathKey(push.root));
            return target ? [{ target, push }] : [];
          });
          const started = await runPush(entries, m.force, m.tags, () => this.post({ type: 'pushStatus', requestId: m.requestId, status: 'started' }));
          if (!started) this.post({ type: 'pushStatus', requestId: m.requestId, status: 'cancelled' });
          await this.refresh(true);
          break;
        }
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
      void vscode.window.showErrorMessage(vscode.l10n.t('Git command failed: {0}', errorMessage(e)));
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
  async showHistory(uri: vscode.Uri | undefined): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== 'file') return;
    await this.ensureDiscovered();
    const fsPath = target.fsPath;
    let isDir = false;
    try {
      isDir = (await vscode.workspace.fs.stat(target)).type === vscode.FileType.Directory;
    } catch {
      // 檔案可能已刪除，仍以所在資料夾查詢歷史
    }
    const dir = isDir ? fsPath : path.dirname(fsPath);
    // 由 git 判斷所屬 repo（巢狀時為最內層）與相對路徑；經過 symlink／junction／subst 也正確
    const located = await GitRepository.locate(this.gitPath, dir);
    if (!located) {
      void vscode.window.showInformationMessage(vscode.l10n.t('{0} is not inside a Git repository.', path.basename(fsPath)));
      return;
    }
    const known = this.find(located.repo.root);
    const entry = known ?? (await this.addRepository(located.repo));
    if (!known) await this.refresh(true);
    const rel = (located.prefix + (isDir ? '' : path.basename(fsPath))).replace(/\/+$/, '');
    await this.applyFilter({ roots: [entry.repo.root], paths: rel ? [rel] : [], branches: [], text: '', users: [] }, true);
  }

  async selectRepository(): Promise<void> {
    await this.ensureDiscovered();
    if (this.entries.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t('No Git repository found in the workspace.'));
      return;
    }
    const visible = new Set(this.visibleEntries().map((e) => e.key));
    const picks = await vscode.window.showQuickPick(
      this.entries.map((e) => ({ label: e.name, description: e.repo.root, picked: visible.has(e.key), root: e.repo.root })),
      { placeHolder: vscode.l10n.t('Select repositories to show'), canPickMany: true },
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
      targets.push({ index, filter: { ...this.currentFilter, branches }, hasHead });
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
    await mapLimit(targets, 8, async (t, i) => {
      const index = t.index;
      try {
        await entries[index].repo.streamLog(
          t.filter,
          max,
          (commits) => {
            for (const c of commits) c.repo = index;
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
      if (!abort.signal.aborted) this.post({ type: 'details', details: { ...d, root } });
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
        const ordered = [...list].reverse();
        const changes = await mapLimit(ordered, 4, async (c) => ({
          hash: c.hash,
          parent: c.parents[0],
          files: await e.repo.getChangedFiles(c.hash, c.parents.slice(0, 1), abort.signal),
        }));
        groups.push({ root, files: combineChanges(changes) });
      }
      if (!abort.signal.aborted) this.post({ type: 'multiDetails', requestId, groups });
    } catch (err) {
      if (!abort.signal.aborted) void vscode.window.showErrorMessage(errorMessage(err));
    }
  }

  private async openDiff(root: string, hash: string, parent: string | undefined, file: ChangedFile): Promise<void> {
    const e = this.find(root);
    if (!e) return;
    // 多選合併的變更自帶左右兩側的 revision
    const leftRef = file.left !== undefined ? file.left : file.status === 'A' || !parent ? '' : parent;
    const rightRef = file.right !== undefined ? file.right : file.status === 'D' ? '' : hash;
    const left = revisionUri(e.repo.root, leftRef, file.oldPath ?? file.path);
    const right = revisionUri(e.repo.root, rightRef, file.path);
    const short = (h: string) => (h ? h.slice(0, 8) : '∅');
    const title = `${path.basename(file.path)} (${short(leftRef)} ↔ ${short(rightRef)})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
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
    if (this.view) this.post({ type: 'openPush' });
    else this.pendingOpenPush = true;
    await vscode.commands.executeCommand(`${WorkbenchViewProvider.viewId}.focus`);
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

    const ok = vscode.l10n.t('Checkout');
    const label = plans[0].label;
    if (isTag) {
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Checkout tag {0}? This will put the repository in detached HEAD state.', label),
        { modal: true, detail: plans.map((p) => p.entry.name).join('\n') },
        ok,
      );
      if (answer !== ok) return;
    } else if (plans.length > 1) {
      const answer = await vscode.window.showInformationMessage(
        vscode.l10n.t('Checkout {0} in {1} repositories?', label, plans.length),
        { modal: true, detail: plans.map((p) => p.entry.name).join('\n') },
        ok,
      );
      if (answer !== ok) return;
    }
    await this.runCheckouts(plans, label);
  }

  private async checkoutRevision(root: string, hash: string): Promise<void> {
    const entry = this.find(root);
    if (!entry) return;
    const ok = vscode.l10n.t('Checkout');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('Checkout revision {0}? This will put the repository in detached HEAD state.', hash.slice(0, 8)),
      { modal: true, detail: entry.name },
      ok,
    );
    if (answer === ok) await this.runCheckouts([{ entry, target: hash, track: false }], hash.slice(0, 8));
  }

  private async runCheckouts(plans: { entry: RepoEntry; target: string; track: boolean }[], label: string): Promise<void> {
    const failures: string[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Checking out {0}…', label) },
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
    if (failures.length > 0) void vscode.window.showErrorMessage(vscode.l10n.t('Checkout failed: {0}', failures.join('\n')));
    await this.refresh(true);
  }

  // ---------- html ----------

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Git Workbench</title>
</head>
<body>
<div id="app"></div>
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
