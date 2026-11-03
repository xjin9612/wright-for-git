// 單一 git repository 的高階操作（不依賴 vscode，可在 Node 直接測試）
import * as path from 'node:path';
import type { ChangedFile, CommitDetails, CommitInfo, DiffHunk, FileStatus, LogFilter, PushPlan, RepoState, ShelfInfo, StashInfo, UserInfo, WorkingChange } from '../shared/protocol';
import { runGit, runGitBuffer, streamGit, GitError } from './gitRunner';
import {
  buildLogArgs,
  DETAILS_FORMAT,
  LOG_FORMAT,
  isHash,
  looksLikeHash,
  parseDetails,
  parseLogChunk,
  parseNameStatusZ,
  parseRefs,
  parseShortlog,
  parseStatusV2,
  remoteWebUrl,
  parseFileDiff,
  REF_FORMAT,
} from './parsers';

/** 路徑一律當作字面名稱（[id].tsx、:memo.txt 這類檔名不會被當成 pathspec 樣式） */
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' };

/** Shelf 的 ref 前綴（每筆 refs/git-workbench/shelf/<id>） */
const SHELF_REF = 'refs/git-workbench/shelf/';
/** stash 訊息中的 shelf 標記：git stash push -m 會存成「On <branch>: shelf:<id> <name>」 */
const SHELF_MARK = /shelf:([0-9A-Za-z_-]+)(?: (.*))?$/s;

function assertShelfId(id: string): void {
  if (!/^[0-9A-Za-z][0-9A-Za-z_-]{0,63}$/.test(id)) throw new GitError(`Invalid shelf id: ${id}`, null, '');
}

/** 只接受 repo 內的相對路徑 */
function assertRelPath(p: string): void {
  if (!p || p.startsWith('-') || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\0') || p.split(/[\\/]/).includes('..')) {
    throw new GitError(`Invalid path: ${p}`, null, '');
  }
}

export class GitRepository {
  private constructor(
    readonly gitPath: string,
    readonly root: string,
    readonly gitDir: string,
    readonly commonDir: string,
  ) {}

  /** 從任意資料夾找出所屬 repository；不是 git repo 則回傳 undefined */
  static async open(gitPath: string, folder: string): Promise<GitRepository | undefined> {
    return (await GitRepository.locate(gitPath, folder))?.repo;
  }

  /**
   * 找出資料夾所屬的 repository，並回傳該資料夾相對 repo 根目錄的路徑（prefix，'/' 分隔、結尾帶 '/'）。
   * prefix 由 git 計算，經過 symlink／junction／subst 開啟的路徑也正確。
   */
  static async locate(gitPath: string, folder: string): Promise<{ repo: GitRepository; prefix: string } | undefined> {
    try {
      const out = await runGit(gitPath, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--show-prefix'], { cwd: folder });
      const [root, gitDir, commonDir, prefix] = out.split('\n').map((s) => s.trim());
      if (!root || !gitDir) return undefined;
      // --git-common-dir 的相對路徑是相對於執行時的 cwd（folder），不是 repo 根目錄
      const common = commonDir ? path.resolve(folder, commonDir) : gitDir;
      return { repo: new GitRepository(gitPath, path.normalize(root), path.normalize(gitDir), path.normalize(common)), prefix: prefix ?? '' };
    } catch {
      return undefined;
    }
  }

  private run(args: string[], signal?: AbortSignal): Promise<string> {
    return runGit(this.gitPath, args, { cwd: this.root, signal });
  }

  private async tryRun(args: string[]): Promise<string | undefined> {
    try {
      return await this.run(args);
    } catch {
      return undefined;
    }
  }

  async getState(): Promise<RepoState> {
    const [remotesOut, refsOut, headHash, headBranch, userName, userEmail, operation, originUrl, conflicts] = await Promise.all([
      this.tryRun(['remote']),
      this.run(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.tryRun(['rev-parse', '--verify', '--quiet', 'HEAD']),
      this.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD']),
      this.tryRun(['config', 'user.name']),
      this.tryRun(['config', 'user.email']),
      this.operationInProgress().catch(() => undefined),
      this.tryRun(['remote', 'get-url', 'origin']),
      this.conflictedPaths().catch(() => [] as string[]),
    ]);
    const remotes = (remotesOut ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    return {
      root: this.root,
      name: path.basename(this.root),
      head: { hash: headHash?.trim() || undefined, branch: headBranch?.trim() || undefined },
      refs: parseRefs(refsOut, remotes),
      remotes,
      userName: userName?.trim() || undefined,
      userEmail: userEmail?.trim() || undefined,
      operation,
      webUrl: remoteWebUrl(originUrl?.trim()),
      conflicts: conflicts.length || undefined,
    };
  }

  /**
   * 串流讀取 log。onBatch 會收到分批的 commit；第一批較小以加快首屏。
   * @param hasHead HEAD 是否指向 commit（unborn 時為 false）
   */
  async streamLog(
    filter: LogFilter,
    maxCount: number,
    onBatch: (commits: CommitInfo[]) => void,
    signal?: AbortSignal,
    hasHead = true,
  ): Promise<void> {
    // 搜尋字串像 hash（≥ 7 碼）且確實是某個 commit 的前綴時，先把它放在最前面；
    // 有 branch／User／Paths 篩選時不放，避免出現不符合篩選的 commit
    const text = filter.text.trim();
    const otherFilters = filter.branches.length > 0 || filter.users.length > 0 || filter.paths.length > 0 || !!filter.since || !!filter.until;
    if (looksLikeHash(text) && !otherFilters) {
      const hit = await this.tryRun(['log', '-1', '--no-color', `--format=${LOG_FORMAT}`, `${text}^{commit}`, '--']);
      if (hit) {
        const { commits } = parseLogChunk(hit);
        if (commits.length > 0 && commits[0].hash.toLowerCase().startsWith(text.toLowerCase())) onBatch(commits);
      }
    }

    let buffer = '';
    let pending: CommitInfo[] = [];
    let flushed = 0;
    let lastFlush = Date.now();
    const flush = () => {
      if (pending.length === 0) return;
      flushed += pending.length;
      onBatch(pending);
      pending = [];
      lastFlush = Date.now();
    };

    await streamGit(this.gitPath, buildLogArgs(filter, maxCount, { hasHead }), { cwd: this.root, signal }, (chunk) => {
      buffer += chunk;
      const { commits, rest } = parseLogChunk(buffer);
      buffer = rest;
      pending.push(...commits);
      const limit = flushed === 0 ? 300 : 3000;
      if (pending.length >= limit || Date.now() - lastFlush > 150) flush();
    });
    const { commits } = parseLogChunk(buffer + '\x1e');
    pending.push(...commits);
    flush();
  }

  async getDetails(hash: string, signal?: AbortSignal): Promise<CommitDetails> {
    if (!isHash(hash)) throw new GitError(`Invalid revision: ${hash}`, null, '');
    const out = await this.run(['show', '-s', '--no-color', `--format=${DETAILS_FORMAT}`, hash, '--'], signal);
    const base = parseDetails(out);
    const files = await this.getChangedFiles(base.hash, base.parents, signal);
    return { ...base, root: this.root, files };
  }

  /** 相對第一個 parent 的變更（merge commit 與 IntelliJ 預設一致，顯示對第一個 parent 的差異） */
  async getChangedFiles(hash: string, parents: readonly string[], signal?: AbortSignal): Promise<ChangedFile[]> {
    // 值可能來自 webview：只接受 hash，避免 `--output=…` 之類的選項注入
    if (!isHash(hash) || !parents.every(isHash)) throw new GitError(`Invalid revision: ${hash}`, null, '');
    const args =
      parents.length === 0
        ? ['diff-tree', '-r', '-M', '--root', '--no-commit-id', '--name-status', '-z', hash]
        : ['diff-tree', '-r', '-M', '--no-commit-id', '--name-status', '-z', parents[0], hash];
    return parseNameStatusZ(await this.run(args, signal));
  }

  async getContainingBranches(hash: string, signal?: AbortSignal): Promise<string[]> {
    if (!isHash(hash)) return [];
    const out = await this.run(['for-each-ref', '--contains', hash, '--format=%(refname:short)%00%(symref)', 'refs/heads', 'refs/remotes'], signal);
    return out
      .split('\n')
      .map((l) => l.split('\0'))
      .filter(([name, symref]) => name && !symref)
      .map(([name]) => name);
  }

  async getUsers(): Promise<UserInfo[]> {
    const out = await this.run(['shortlog', '-sne', '--all']);
    return parseShortlog(out).sort((a, b) => b.count - a.count);
  }

  /** HEAD 中所有目錄（供 Paths 篩選選單） */
  async listDirectories(limit = 20000): Promise<string[]> {
    const out = await this.tryRun(['ls-tree', '-r', '-d', '--name-only', '-z', 'HEAD']);
    return (out ?? '').split('\0').filter(Boolean).slice(0, limit);
  }

  /**
   * 讀取某個 revision 的檔案內容（原始位元組）；不存在時回傳空內容。
   * ref 只接受 commit hash，避免外部 URI 帶入 `--output=…` 這類選項。
   */
  async showFile(ref: string, filePath: string): Promise<Buffer> {
    if (!ref || !isHash(ref) || filePath.includes('\0')) return Buffer.alloc(0);
    try {
      return await runGitBuffer(this.gitPath, ['show', '--no-color', '--textconv', `${ref}:${filePath}`], { cwd: this.root });
    } catch (e) {
      if (e instanceof GitError) return Buffer.alloc(0);
      throw e;
    }
  }

  // ---------- 寫入操作（同步、commit 操作）----------

  /** 執行 git 指令（供操作層使用）；失敗時丟出 GitError，訊息為 git 的 stderr */
  exec(args: string[]): Promise<string> {
    return this.run(args);
  }

  /** 抓取所有 remote（是否 prune 依使用者的 fetch.prune 設定） */
  async fetch(): Promise<void> {
    await this.run(['fetch', '--all']);
  }

  /** 依使用者的 pull.rebase 等設定執行 pull */
  async pull(): Promise<void> {
    await this.run(['pull']);
  }

  /** ancestor 是否為 descendant 的祖先（含自己） */
  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    return (await this.tryRun(['merge-base', '--is-ancestor', ancestor, descendant])) !== undefined;
  }

  /**
   * Push 預覽：目前 branch（或 upTo commit）要推到哪裡、會推哪些 commit。
   * 目標預設為 upstream；沒有 upstream 時為 origin（或第一個 remote）上的同名 branch。
   */
  async getPushPlan(opts: { branch?: string; upTo?: string; remote?: string; remoteBranch?: string } = {}, limit = 500): Promise<Omit<PushPlan, 'name'>> {
    const remotes = ((await this.tryRun(['remote'])) ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const branch = opts.branch ?? ((await this.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim() || undefined);
    if (opts.branch && !(await this.isValidRefName(opts.branch, 'branch'))) throw new GitError(`Invalid branch name: ${opts.branch}`, null, '');
    const plan: Omit<PushPlan, 'name'> = { root: this.root, branch, remotes, hasUpstream: false, isNew: false, upTo: opts.upTo, commits: [], total: 0, behind: 0 };
    if (!branch) return { ...plan, problem: 'detached' };
    if (remotes.length === 0) return { ...plan, problem: 'noRemote' };

    const upRemote = (await this.tryRun(['config', '--get', `branch.${branch}.remote`]))?.trim();
    const upMerge = (await this.tryRun(['config', '--get', `branch.${branch}.merge`]))?.trim();
    plan.hasUpstream = !!upRemote && remotes.includes(upRemote) && !!upMerge?.startsWith('refs/heads/');
    const remote = opts.remote && remotes.includes(opts.remote) ? opts.remote : plan.hasUpstream ? upRemote! : remotes.includes('origin') ? 'origin' : remotes[0];
    const remoteBranch = opts.remoteBranch || (plan.hasUpstream && remote === upRemote ? upMerge!.slice('refs/heads/'.length) : branch);
    plan.remote = remote;
    plan.remoteBranch = remoteBranch;
    if (!(await this.isValidRefName(remoteBranch, 'branch'))) return { ...plan, problem: 'error', message: `Invalid branch name: ${remoteBranch}` };

    let src = `refs/heads/${branch}`;
    if (opts.upTo) {
      if (!isHash(opts.upTo) || !(await this.isAncestor(opts.upTo, src))) return { ...plan, problem: 'notAncestor' };
      src = opts.upTo;
    }
    const tracking = `refs/remotes/${remote}/${remoteBranch}`;
    const trackingHash = (await this.tryRun(['rev-parse', '-q', '--verify', tracking]))?.trim();
    plan.isNew = !trackingHash;
    plan.trackingHash = trackingHash ?? '';
    // 新 branch：遠端任何 branch 都還沒有的 commit 才算要推的
    const range = plan.isNew ? [src, '--not', '--remotes'] : [src, '--not', tracking];
    plan.total = Number((await this.run(['rev-list', '--count', ...range])).trim()) || 0;
    const out = await this.run(['log', `-n${limit}`, '--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e', ...range, '--']);
    plan.commits = out
      .split('\x1e')
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [hash, parents, author, at, subject] = r.split('\x1f');
        return { hash, parents: parents ? parents.split(' ') : [], author, authorTime: Number(at), subject: subject ?? '' };
      });
    if (!plan.isNew) plan.behind = Number((await this.run(['rev-list', '--count', tracking, '--not', src])).trim()) || 0;
    return plan;
  }

  /**
   * 以明確的 refspec 推送：`git push <remote> <src>:refs/heads/<remoteBranch>`。
   * src 為 refs/heads/<branch> 或 commit hash（Push All up to Here）。
   * force 一律使用 --force-with-lease：遠端若有本機沒看過的 commit 就拒絕，不提供無保護的 --force。
   * @param opts.force 搭配 lease：預覽時看到的遠端 commit（'' 表示遠端不應該有這個 branch）。
   *   遠端若已不是這個 commit（例如對話框開著時有人推了新 commit 又被 fetch 進來）就拒絕，避免覆蓋沒看過的 commit。
   */
  async pushTo(remote: string, src: string, remoteBranch: string, opts: { force?: boolean; lease?: string; tags?: boolean; setUpstream?: boolean } = {}): Promise<void> {
    await this.assertRemote(remote);
    if (!(await this.isValidRefName(remoteBranch, 'branch'))) throw new GitError(`Invalid branch name: ${remoteBranch}`, null, '');
    const isBranch = src.startsWith('refs/heads/') && (await this.isValidRefName(src.slice('refs/heads/'.length), 'branch'));
    if (!isBranch && !isHash(src)) throw new GitError(`Invalid push source: ${src}`, null, '');
    const args = ['push'];
    if (opts.force) {
      if (opts.lease !== undefined && opts.lease !== '' && !isHash(opts.lease)) throw new GitError(`Invalid lease: ${opts.lease}`, null, '');
      args.push(opts.lease !== undefined ? `--force-with-lease=refs/heads/${remoteBranch}:${opts.lease}` : '--force-with-lease');
    }
    if (opts.tags) args.push('--follow-tags');
    // upstream 只能為 branch 設定，推送單一 commit 時不設
    if (opts.setUpstream && isBranch) args.push('--set-upstream');
    args.push(remote, `${src}:refs/heads/${remoteBranch}`);
    await this.run(args);
  }

  /** 進行中的 cherry-pick／revert／merge／rebase（衝突待解決時） */
  async operationInProgress(): Promise<'cherry-pick' | 'revert' | 'merge' | 'rebase' | undefined> {
    const has = async (ref: string) => (await this.tryRun(['rev-parse', '-q', '--verify', ref])) !== undefined;
    if (await has('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (await has('REVERT_HEAD')) return 'revert';
    if (await has('MERGE_HEAD')) return 'merge';
    const { existsSync } = await import('node:fs');
    if (existsSync(path.join(this.gitDir, 'rebase-merge')) || existsSync(path.join(this.gitDir, 'rebase-apply'))) return 'rebase';
    return undefined;
  }

  async abortOperation(op: 'cherry-pick' | 'revert' | 'merge' | 'rebase'): Promise<void> {
    await this.run([op, '--abort']);
    await this.cleanupRebaseTemp();
  }

  /** 互動式 rebase 結束後，移除留下的訊息檔 */
  async cleanupRebaseTemp(): Promise<void> {
    if (await this.operationInProgress()) return;
    const { promises: fsp } = await import('node:fs');
    const names = await fsp.readdir(this.gitDir).catch(() => [] as string[]);
    for (const n of names) if (n.startsWith('gitworkbench-rebase-')) await fsp.rm(path.join(this.gitDir, n), { recursive: true, force: true });
  }

  /** 解決衝突後繼續（不開編輯器，沿用預設的提交訊息） */
  async continueOperation(op: 'cherry-pick' | 'revert' | 'merge' | 'rebase'): Promise<void> {
    const env = { GIT_EDITOR: 'true' };
    if (op === 'merge') await runGit(this.gitPath, ['commit', '--no-edit'], { cwd: this.root, env });
    else await runGit(this.gitPath, [op, '--continue'], { cwd: this.root, env });
    await this.cleanupRebaseTemp();
  }

  /** 略過目前的 commit（rebase／cherry-pick） */
  async skipOperation(op: 'cherry-pick' | 'rebase'): Promise<void> {
    await runGit(this.gitPath, [op, '--skip'], { cwd: this.root, env: { GIT_EDITOR: 'true' } });
    await this.cleanupRebaseTemp();
  }

  // ---------- 效能 ----------

  /**
   * 寫入 commit-graph（git 自己的索引檔，加快讀取歷史；--changed-paths 另外加快路徑篩選）。
   * 只新增 .git/objects/info 底下的檔案，不改動任何 commit 或工作區。git 2.27 以前沒有 --changed-paths，改用基本的寫法。
   */
  async writeCommitGraph(): Promise<{ changedPaths: boolean }> {
    try {
      await this.run(['commit-graph', 'write', '--reachable', '--changed-paths']);
      return { changedPaths: true };
    } catch (e) {
      if (!(e instanceof GitError) || !/changed-paths|unknown option/i.test(e.message)) throw e;
      await this.run(['commit-graph', 'write', '--reachable']);
      return { changedPaths: false };
    }
  }

  // ---------- 衝突 ----------

  /** 尚未解決的衝突檔案 */
  async conflictedPaths(): Promise<string[]> {
    const out = await this.tryRun(['diff', '--name-only', '--diff-filter=U', '-z']);
    return [...new Set((out ?? '').split('\0').filter(Boolean))];
  }

  /** 衝突檔案在 index 中的版本：stage 1（共同祖先）、2（我的）、3（他們的）的 blob */
  private async conflictStages(filePath: string): Promise<Map<number, string>> {
    assertRelPath(filePath);
    const out = await runGit(this.gitPath, ['ls-files', '-u', '-z', '--', filePath], { cwd: this.root, env: LITERAL });
    const stages = new Map<number, string>();
    for (const rec of out.split('\0')) {
      // <mode> <object> <stage>\t<path>
      const m = /^\d+ ([0-9a-f]+) ([123])\t(.*)$/s.exec(rec);
      if (m && m[3] === filePath) stages.set(Number(m[2]), m[1]);
    }
    return stages;
  }

  /** 衝突檔案的三個版本（原始位元組）；沒有該版本（例如一邊刪除）時為 undefined */
  async conflictVersions(filePath: string): Promise<{ base?: Buffer; ours?: Buffer; theirs?: Buffer }> {
    const stages = await this.conflictStages(filePath);
    const blob = async (stage: number) => {
      const id = stages.get(stage);
      return id ? runGitBuffer(this.gitPath, ['cat-file', 'blob', id], { cwd: this.root }) : undefined;
    };
    const [base, ours, theirs] = await Promise.all([blob(1), blob(2), blob(3)]);
    return { base, ours, theirs };
  }

  /** 合併兩邊的名稱（顯示在三方合併分頁的欄位標題） */
  async conflictLabels(): Promise<{ op?: 'cherry-pick' | 'revert' | 'merge' | 'rebase'; ours: string; theirs: string }> {
    const op = await this.operationInProgress();
    const short = async (ref: string) => ((await this.tryRun(['rev-parse', '--short', ref])) ?? '').trim();
    const name = async (ref: string) => {
      const n = ((await this.tryRun(['name-rev', '--name-only', '--no-undefined', ref])) ?? '').trim();
      return n.replace(/^remotes\//, '') || (await short(ref));
    };
    const subject = async (ref: string) => ((await this.tryRun(['log', '-1', '--format=%h %s', ref, '--'])) ?? '').trim();
    const branch = ((await this.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD'])) ?? '').trim() || (await short('HEAD'));
    switch (op) {
      case 'merge':
        return { op, ours: branch, theirs: await name('MERGE_HEAD') };
      case 'cherry-pick':
        return { op, ours: branch, theirs: await subject('CHERRY_PICK_HEAD') };
      case 'revert':
        return { op, ours: branch, theirs: await subject('REVERT_HEAD') };
      case 'rebase': {
        const { promises: fsp } = await import('node:fs');
        let onto = '';
        for (const dir of ['rebase-merge', 'rebase-apply']) {
          onto = (await fsp.readFile(path.join(this.gitDir, dir, 'onto'), 'utf8').catch(() => '')).trim();
          if (onto) break;
        }
        return { op, ours: onto && isHash(onto) ? await name(onto) : await short('HEAD'), theirs: await subject('REBASE_HEAD') };
      }
      default: {
        // 沒有進行中的操作：套用儲藏或取回擱置時的衝突（取回擱置時會留下名稱）
        const { promises: fsp } = await import('node:fs');
        const shelf = (await fsp.readFile(this.unshelveMarker, 'utf8').catch(() => '')).trim();
        return { op, ours: branch, theirs: shelf || 'stash' };
      }
    }
  }

  /**
   * 整個檔案採用某一邊：該邊有內容時取出並標記為已解決；該邊已刪除時刪除檔案。
   */
  async acceptConflictSide(paths: string[], side: 'ours' | 'theirs'): Promise<void> {
    const lit = (args: string[]) => runGit(this.gitPath, args, { cwd: this.root, env: LITERAL });
    for (const p of paths) {
      const stages = await this.conflictStages(p);
      if (stages.size === 0) continue; // 已經解決
      if (stages.has(side === 'ours' ? 2 : 3)) {
        await lit(['checkout', `--${side}`, '--', p]);
        await lit(['add', '--', p]);
      } else {
        await lit(['rm', '-q', '-f', '--', p]);
      }
    }
  }

  /** 標記為已解決：以工作區目前的內容為準（檔案已不存在則記為刪除） */
  async markConflictResolved(paths: string[]): Promise<void> {
    for (const p of paths) assertRelPath(p);
    for (let i = 0; i < paths.length; i += 200) {
      await runGit(this.gitPath, ['add', '-A', '--', ...paths.slice(i, i + 200)], { cwd: this.root, env: LITERAL });
    }
  }

  /** 寫入合併結果並標記為已解決 */
  async saveMergeResult(filePath: string, content: Buffer): Promise<void> {
    assertRelPath(filePath);
    const { promises: fsp } = await import('node:fs');
    await fsp.writeFile(path.join(this.root, filePath), content);
    await this.markConflictResolved([filePath]);
  }

  /**
   * 互動式 rebase 的 commit 清單：從 base（含）到 HEAD，由舊到新。含 merge commit 時回傳 hasMerges。
   */
  async rebaseCommits(base: string): Promise<{ commits: { hash: string; subject: string; message: string; author: string; authorTime: number }[]; hasMerges: boolean; onBranch: boolean }> {
    if (!isHash(base)) throw new GitError(`Invalid revision: ${base}`, null, '');
    const onBranch = !!(await this.tryRun(['symbolic-ref', '--quiet', 'HEAD']));
    if (!(await this.isAncestor(base, 'HEAD'))) throw new GitError('The commit is not on the current branch', null, '');
    const parent = (await this.tryRun(['rev-parse', '-q', '--verify', `${base}^`]))?.trim();
    const range = parent ? [`${parent}..HEAD`] : ['HEAD'];
    const merges = (await this.run(['rev-list', '--count', '--merges', ...range])).trim();
    const out = await this.run(['log', '--reverse', '--format=%H%x1f%an%x1f%at%x1f%s%x1f%B%x1e', ...range, '--']);
    const commits = out
      .split('\x1e')
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [hash, author, at, subject, message] = r.split('\x1f');
        return { hash, author, authorTime: Number(at), subject, message: (message ?? '').replace(/\s+$/, '') };
      });
    return { commits, hasMerges: merges !== '0', onBranch };
  }

  /**
   * 執行互動式 rebase。entries 由舊到新；action 為 pick／reword／edit／squash／fixup／drop。
   * 以 GIT_SEQUENCE_EDITOR 寫入我們的 todo；reword 以 exec 修改訊息（不開編輯器）；squash 有 message 時以它取代合併後的訊息，否則沿用預設訊息。
   * 遇到衝突或 edit 時 rebase 會停下，回傳 'stopped'。
   */
  async interactiveRebase(base: string, entries: { hash: string; action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'; message?: string }[]): Promise<'done' | 'stopped'> {
    const { promises: fsp } = await import('node:fs');
    if (!isHash(base) || entries.some((e) => !isHash(e.hash))) throw new GitError('Invalid revision', null, '');
    const ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
    if (entries.some((e) => !ACTIONS.includes(e.action))) throw new GitError('Invalid rebase action', null, '');
    await this.cleanupRebaseTemp();
    const parent = (await this.tryRun(['rev-parse', '-q', '--verify', `${base}^`]))?.trim();
    const stamp = `${process.pid}-${Date.now()}`;
    const dir = path.join(this.gitDir, `gitworkbench-rebase-${stamp}`);
    await fsp.mkdir(dir, { recursive: true });
    // git 透過 sh 執行編輯器指令：路徑一律用 '/'，並以單引號包住
    const q = (p: string) => `'${p.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
    const lines: string[] = [];
    let n = 0;
    for (const e of entries) {
      if (e.action === 'drop') {
        lines.push(`drop ${e.hash}`);
        continue;
      }
      const verb = e.action === 'reword' ? 'pick' : e.action;
      lines.push(`${verb} ${e.hash}`);
      if ((e.action === 'reword' || (e.action === 'squash' && e.message !== undefined)) && e.message !== undefined) {
        const file = path.join(dir, `msg-${n++}.txt`);
        await fsp.writeFile(file, e.message, 'utf8');
        // cleanup=whitespace：保留 # 開頭的行（如 #123 issue 編號）
        lines.push(`exec git commit --amend --allow-empty --cleanup=whitespace -q -F ${q(file)}`);
      }
    }
    const todo = path.join(dir, 'todo.txt');
    await fsp.writeFile(todo, `${lines.join('\n')}\n`, 'utf8');
    try {
      // --reschedule-failed-exec：reword 的 exec 失敗（如 commit-msg hook）時，繼續會重新執行而不是略過
      await runGit(this.gitPath, ['rebase', '-i', '--autostash', '--reschedule-failed-exec', ...(parent ? [parent] : ['--root'])], {
        cwd: this.root,
        env: { GIT_SEQUENCE_EDITOR: `cp ${q(todo)}`, GIT_EDITOR: 'true' },
      });
      // edit 停下時 git 以 0 結束
      if (await this.operationInProgress()) return 'stopped';
      await fsp.rm(dir, { recursive: true, force: true });
      return 'done';
    } catch (e) {
      // 停在 edit 或衝突：保留訊息檔（後續的 exec 還會用到），rebase 結束後再清除
      if (await this.operationInProgress()) return 'stopped';
      await fsp.rm(dir, { recursive: true, force: true });
      throw e;
    }
  }

  /** @param mainline merge commit 時以第幾個 parent 為主線（1 起算） */
  async cherryPick(hash: string, mainline?: number): Promise<void> {
    if (!isHash(hash)) throw new GitError(`Invalid revision: ${hash}`, null, '');
    await this.run(['cherry-pick', ...(mainline ? ['-m', String(mainline)] : []), hash]);
  }

  async revert(hash: string, mainline?: number): Promise<void> {
    if (!isHash(hash)) throw new GitError(`Invalid revision: ${hash}`, null, '');
    await this.run(['revert', '--no-edit', ...(mainline ? ['-m', String(mainline)] : []), hash]);
  }

  /** 依序 cherry-pick 多個 commit（由舊到新）；中途衝突時停在該 commit，可續做或中止整個序列 */
  async cherryPickMany(hashes: string[]): Promise<void> {
    if (hashes.length === 0 || !hashes.every(isHash)) throw new GitError('Invalid revision', null, '');
    await this.run(['cherry-pick', ...hashes]);
  }

  /** 依序 revert 多個 commit（由新到舊） */
  async revertMany(hashes: string[]): Promise<void> {
    if (hashes.length === 0 || !hashes.every(isHash)) throw new GitError('Invalid revision', null, '');
    await this.run(['revert', '--no-edit', ...hashes]);
  }

  async reset(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    if (!isHash(hash)) throw new GitError(`Invalid revision: ${hash}`, null, '');
    await this.run(['reset', `--${mode}`, hash]);
  }

  /** 工作區是否有未提交的變更（含 staged，不含未追蹤檔案） */
  async isDirty(): Promise<boolean> {
    const out = await this.run(['status', '--porcelain', '--untracked-files=no']);
    return out.trim() !== '';
  }

  /** 名稱是否為合法的 branch／tag 名稱（交給 git check-ref-format 判斷） */
  async isValidRefName(name: string, kind: 'branch' | 'tag'): Promise<boolean> {
    // @{-N} 會被 check-ref-format --branch 展開成先前的 branch，不能當作名稱
    if (!name || name.startsWith('-') || name.includes('@{')) return false;
    const args = kind === 'branch' ? ['check-ref-format', '--branch', name] : ['check-ref-format', `refs/tags/${name}`];
    return (await this.tryRun(args)) !== undefined;
  }

  /** 從指定 commit 建立 branch；checkout 時一併切換過去 */
  async createBranch(name: string, start: string, checkout: boolean): Promise<void> {
    if (!(await this.isValidRefName(name, 'branch'))) throw new GitError(`Invalid branch name: ${name}`, null, '');
    if (!isHash(start)) throw new GitError(`Invalid revision: ${start}`, null, '');
    await this.run(checkout ? ['checkout', '-b', name, start] : ['branch', name, start]);
  }

  /** 建立 tag；有 message 時為 annotated tag */
  async createTag(name: string, target: string, message?: string): Promise<void> {
    if (!(await this.isValidRefName(name, 'tag'))) throw new GitError(`Invalid tag name: ${name}`, null, '');
    if (!isHash(target)) throw new GitError(`Invalid revision: ${target}`, null, '');
    await this.run(message ? ['tag', '-a', '-m', message, name, target] : ['tag', name, target]);
  }

  /**
   * 文字／User 篩選時的簡化 graph：對每個符合的 commit 找出「最近的符合祖先」當作 parent
   * （不經過其他符合的 commit），讓篩選結果仍可畫出分支連線（對應 IntelliJ 篩選下的虛線連線）。
   * @param matched 符合篩選的 commit
   * @returns hash → 簡化後的 parent；超過 maxCount 而無法判斷時回傳 undefined
   */
  async simplifiedParents(filter: LogFilter, matched: ReadonlySet<string>, maxCount: number, signal?: AbortSignal, hasHead = true): Promise<Map<string, string[]> | undefined> {
    const args = buildLogArgs({ ...filter, text: '', users: [] }, maxCount + 1, { hasHead }).map((a) => (a.startsWith('--format=') ? '--format=%H %P' : a));
    const out = await this.run(args, signal);
    const lines = out.split('\n').filter(Boolean);
    if (lines.length > maxCount) return undefined;
    const CAP = 4;
    const frontier = new Map<string, string[]>();
    const result = new Map<string, string[]>();
    const union = (parents: string[]): string[] => {
      if (parents.length === 1) return frontier.get(parents[0]) ?? [];
      const set = new Set<string>();
      for (const p of parents) for (const f of frontier.get(p) ?? []) if (set.size < CAP) set.add(f);
      return [...set];
    };
    // 由舊到新（parent 先於 child）
    for (let i = lines.length - 1; i >= 0; i--) {
      const [hash, ...parents] = lines[i].split(' ');
      const reach = union(parents);
      if (matched.has(hash)) {
        result.set(hash, reach);
        frontier.set(hash, [hash]);
      } else {
        frontier.set(hash, reach);
      }
    }
    return result;
  }

  // ---------- 工作區變更與提交（提交視窗） ----------

  /** 工作區相對 HEAD 的變更、未追蹤檔案，以及（選用）已忽略的檔案 */
  async getWorkingChanges(includeIgnored = false, signal?: AbortSignal): Promise<WorkingChange[]> {
    const args = ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--find-renames'];
    if (includeIgnored) args.push('--ignored=matching');
    return parseStatusV2(await runGit(this.gitPath, args, { cwd: this.root, signal, env: { GIT_OPTIONAL_LOCKS: '0' } }));
  }

  /** HEAD 的 commit hash；尚未有任何 commit 時為 undefined */
  async headHash(): Promise<string | undefined> {
    return (await this.tryRun(['rev-parse', '-q', '--verify', 'HEAD^{commit}']))?.trim() || undefined;
  }

  async lastCommitMessage(): Promise<string> {
    return ((await this.tryRun(['log', '-1', '--format=%B'])) ?? '').replace(/\s+$/, '');
  }

  /** 檔案相對 HEAD 的 diff（各段 hunk），用於逐段選取提交 */
  async fileDiff(filePath: string): Promise<{ header: string[]; hunks: DiffHunk[] }> {
    return parseFileDiff((await this.rawFileDiff(filePath)).toString('utf8'));
  }

  /**
   * 原始位元組的 diff：組 patch 時以 latin1 拆行再轉回 Buffer，非 UTF-8 的檔案（Big5 等）才不會被改壞。
   * 固定 a/ b/ 前綴、不用 textconv，不受使用者的 diff.noprefix、diff.mnemonicPrefix 等設定影響。
   */
  async rawFileDiff(filePath: string): Promise<Buffer> {
    assertRelPath(filePath);
    const head = await this.headHash();
    return runGitBuffer(
      this.gitPath,
      ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/', '-U3', head ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '--', filePath],
      { cwd: this.root, env: LITERAL },
    );
  }

  /**
   * 提交勾選的變更（對應 IntelliJ 提交視窗）：以暫時的 index 只放入勾選的內容，
   * 不會動到使用者在內建原始檔控制暫存（stage）的其他檔案。
   * @param full 整個檔案提交的路徑（rename 需同時包含新舊路徑；含刪除與未追蹤檔案）
   * @param patches 只提交部分 hunk 的檔案：套用在 HEAD 上的 patch
   */
  async commitSelected(opts: { full: string[]; patches: { path: string; patch: Buffer }[]; message: string; amend?: boolean; signOff?: boolean; noVerify?: boolean }): Promise<{ head: string; indexError?: string }> {
    const { existsSync, promises: fsp } = await import('node:fs');
    if (!opts.message.trim()) throw new GitError('Commit message is empty', null, '');
    for (const p of [...opts.full, ...opts.patches.map((x) => x.path)]) assertRelPath(p);
    // merge／cherry-pick／revert 進行中時，只提交部分檔案會把另一邊的變更從歷史中丟掉
    const op = await this.operationInProgress();
    if (op && op !== 'rebase') throw new GitError(`A ${op} is in progress. Finish it with Continue (commits all resolved changes) or abort it first.`, null, '');
    const tmpIndex = path.join(this.gitDir, `gitworkbench-index-${process.pid}-${Date.now()}`);
    const msgFile = path.join(this.gitDir, `gitworkbench-msg-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: tmpIndex, ...LITERAL };
    const git = (args: string[], input?: Buffer) => runGit(this.gitPath, args, { cwd: this.root, env, input });
    try {
      const head = await this.headHash();
      // 暫時 index 從 HEAD 開始（amend 時也是：新的 commit = HEAD 的內容 + 勾選的變更）
      await git(head ? ['read-tree', head] : ['read-tree', '--empty']);
      if (opts.full.length > 0) {
        // 一次加太多路徑時分批，避免超過命令列長度上限
        for (let i = 0; i < opts.full.length; i += 200) await git(['add', '-A', '--', ...opts.full.slice(i, i + 200)]);
      }
      for (const p of opts.patches) await git(['apply', '--cached', '--recount', '--whitespace=nowarn', '-'], p.patch);
      await fsp.writeFile(msgFile, opts.message, 'utf8');
      // cleanup=whitespace（-F 的預設）：保留 # 開頭的行，如 #123 issue 編號
      const args = ['commit', '--quiet', '--cleanup=whitespace', '-F', msgFile];
      if (opts.amend) args.push('--amend');
      if (opts.signOff) args.push('--signoff');
      if (opts.noVerify) args.push('--no-verify');
      if (!head || opts.amend) args.push('--allow-empty');
      await git(args);
      const newHead = (await this.headHash()) ?? '';
      // 讓真正的 index 中這些路徑與新的 HEAD 一致（部分提交的檔案，剩下的變更留在工作區）
      const touched = [...opts.full, ...opts.patches.map((p) => p.path)];
      let indexError: string | undefined;
      for (let i = 0; i < touched.length; i += 200) {
        try {
          await runGit(this.gitPath, ['reset', '-q', '--', ...touched.slice(i, i + 200)], { cwd: this.root, env: LITERAL });
        } catch (e) {
          indexError = e instanceof Error ? e.message : String(e);
        }
      }
      return { head: newHead, indexError };
    } finally {
      for (const f of [tmpIndex, msgFile, `${tmpIndex}.lock`]) if (existsSync(f)) await fsp.rm(f, { force: true });
    }
  }

  /**
   * 捨棄變更（Rollback）：已追蹤的檔案還原成 HEAD 的內容；新增（已加入 index）的檔案移出 index，保留檔案本身。
   */
  async rollback(items: { path: string; oldPath?: string; status: FileStatus; kind: string }[]): Promise<void> {
    const head = await this.headHash();
    const added = items.filter((x) => x.kind === 'changed' && x.status === 'A').map((x) => x.path);
    const tracked = items.filter((x) => (x.kind === 'changed' || x.kind === 'conflict') && x.status !== 'A').flatMap((x) => (x.oldPath ? [x.path, x.oldPath] : [x.path]));
    for (const p of [...added, ...tracked]) assertRelPath(p);
    const lit = (args: string[]) => runGit(this.gitPath, args, { cwd: this.root, env: LITERAL });
    for (let i = 0; i < added.length; i += 200) await lit(['rm', '-q', '--cached', '-r', '--', ...added.slice(i, i + 200)]);
    if (!head || tracked.length === 0) return;
    // rename：新路徑若不在 HEAD 中，restore 會失敗，改用 rm --cached 再刪除檔案
    for (let i = 0; i < tracked.length; i += 200) {
      const chunk = tracked.slice(i, i + 200);
      const inHead = new Set((await lit(['ls-tree', '-r', '--name-only', '-z', head, '--', ...chunk])).split('\0').filter(Boolean));
      const restore = chunk.filter((p) => inHead.has(p));
      // 不在 HEAD 的路徑（rename 的新路徑）：只刪除確實在 index 中的檔案
      const inIndex = new Set((await lit(['ls-files', '-z', '--', ...chunk])).split('\0').filter(Boolean));
      const extra = chunk.filter((p) => !inHead.has(p) && inIndex.has(p));
      if (restore.length > 0) await lit(['restore', '--source', head, '--staged', '--worktree', '--', ...restore]);
      if (extra.length > 0) {
        await lit(['rm', '-q', '--cached', '-r', '--', ...extra]);
        const { promises: fsp } = await import('node:fs');
        for (const p of extra) await fsp.rm(path.join(this.root, p), { force: true });
      }
    }
  }

  // ---------- Stash ----------

  private assertStash(ref: string): void {
    if (!/^stash@\{\d+\}$/.test(ref)) throw new GitError(`Invalid stash: ${ref}`, null, '');
  }

  async listStashes(): Promise<StashInfo[]> {
    const out = (await this.tryRun(['stash', 'list', '--format=%gd%x1f%H%x1f%P%x1f%ct%x1f%gs%x1e'])) ?? '';
    return out
      .split('\x1e')
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [ref, hash, parents, ct, message = ''] = r.split('\x1f');
        const branch = /^(?:WIP on|On) ([^:]+):/.exec(message)?.[1];
        return { ref, hash, parents: parents ? parents.split(' ') : [], time: Number(ct), message, branch: branch === '(no branch)' ? undefined : branch };
      });
  }

  /** stash（或 shelf）的檔案：已追蹤檔案相對 stash 當時的 HEAD（parent 1），加上 -u 存入的未追蹤檔案（parent 3） */
  async getStashFiles(stash: Pick<StashInfo, 'hash' | 'parents'>): Promise<(ChangedFile & { untracked?: boolean })[]> {
    const files: (ChangedFile & { untracked?: boolean })[] = await this.getChangedFiles(stash.hash, stash.parents.slice(0, 1));
    const untrackedCommit = stash.parents[2];
    if (untrackedCommit && isHash(untrackedCommit)) {
      const out = await this.run(['ls-tree', '-r', '-z', '--name-only', untrackedCommit]);
      for (const p of out.split('\0').filter(Boolean)) files.push({ status: 'A', path: p, untracked: true });
    }
    return files;
  }

  /** 暫存目前變更；includeUntracked 時一併存入未追蹤檔案（-u） */
  async stashPush(message: string, includeUntracked: boolean, keepIndex = false): Promise<void> {
    const args = ['stash', 'push'];
    if (includeUntracked) args.push('--include-untracked');
    if (keepIndex) args.push('--keep-index');
    if (message.trim()) args.push('-m', message.trim());
    await this.run(args);
  }

  /** 套用 stash；pop 時成功後刪除；index 時同時還原 staged 狀態 */
  async stashApply(ref: string, opts: { pop?: boolean; index?: boolean } = {}): Promise<void> {
    this.assertStash(ref);
    await this.clearUnshelveMarker();
    await this.run(['stash', opts.pop ? 'pop' : 'apply', ...(opts.index ? ['--index'] : []), ref]);
  }

  async stashDrop(ref: string): Promise<void> {
    this.assertStash(ref);
    await this.run(['stash', 'drop', ref]);
  }

  /** 刪除所有 stash */
  async stashClear(): Promise<void> {
    await this.run(['stash', 'clear']);
  }

  /** 從 stash 建立 branch（以 stash 當時的 commit 為起點），成功後刪除該 stash */
  async stashBranch(name: string, ref: string): Promise<void> {
    this.assertStash(ref);
    if (!(await this.isValidRefName(name, 'branch'))) throw new GitError(`Invalid branch name: ${name}`, null, '');
    await this.run(['stash', 'branch', name, ref]);
  }

  // ---------- Shelf ----------

  /**
   * 把指定路徑的變更（含未追蹤檔案）擱置成一筆 shelf，並從工作區移除；keepChanges 時工作區保留原樣。
   * 用 git stash push 產生 commit 後搬到自己的 ref，再從 stash 清單移除。沒有可擱置的變更時回傳 undefined。
   */
  async shelve(id: string, name: string, paths: string[], keepChanges = false): Promise<string | undefined> {
    assertShelfId(id);
    for (const p of paths) assertRelPath(p);
    if (paths.length === 0) return undefined;
    const top = async () => (await this.tryRun(['rev-parse', '-q', '--verify', 'refs/stash']))?.trim() || undefined;
    const before = await top();
    // 路徑從 stdin 傳入（NUL 分隔），不受命令列長度限制
    await runGit(this.gitPath, ['stash', 'push', '--include-untracked', '-m', `shelf:${id} ${name.trim()}`.trim(), '--pathspec-from-file=-', '--pathspec-file-nul'], {
      cwd: this.root,
      env: LITERAL,
      input: paths.join('\0'),
    });
    const stashed = await top();
    if (!stashed || stashed === before) return undefined;
    // stash push 會把整個暫存區記進去：只留下選取的路徑，沒選的已暫存檔案（仍在工作區）不算擱置
    const hash = await this.rewriteShelfCommit(stashed, paths, 'only');
    if (hash) await this.run(['update-ref', '-m', 'shelve', SHELF_REF + id, hash]);
    await this.run(['stash', 'drop', '--quiet', 'stash@{0}']);
    if (hash && keepChanges) await this.run(['stash', 'apply', '--index', hash]);
    return hash;
  }

  async listShelves(): Promise<ShelfInfo[]> {
    const out = (await this.tryRun(['for-each-ref', '--format=%(refname)%1f%(objectname)%1f%(parent)%1f%(committerdate:unix)%1f%(subject)%1e', SHELF_REF])) ?? '';
    return out
      .split('\x1e')
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [ref, hash, parents, ct, subject = ''] = r.split('\x1f');
        const id = ref.slice(SHELF_REF.length);
        return { id, name: SHELF_MARK.exec(subject)?.[2] ?? '', hash, parents: parents ? parents.split(' ') : [], time: Number(ct) };
      })
      .sort((a, b) => b.time - a.time);
  }

  /** 取回擱置發生衝突時記下擱置名稱，讓衝突畫面標示「對方」是哪一筆擱置 */
  private get unshelveMarker(): string {
    return path.join(this.gitDir, 'gitworkbench-unshelve');
  }

  private async clearUnshelveMarker(): Promise<void> {
    const { promises: fsp } = await import('node:fs');
    await fsp.rm(this.unshelveMarker, { force: true });
  }

  /**
   * 取回 shelf 的變更到工作區。未指定 paths 時整筆套用（git stash apply，三方合併）；
   * 指定時只取回這些檔案：已追蹤的以 patch 套用（套不上時改用三方合併，衝突標記留在檔案中、仍會還原未追蹤檔案再丟出錯誤），
   * 未追蹤的直接還原（已存在時中止，overwrite 時覆蓋）。label 為衝突畫面上「對方」的名稱。
   */
  async unshelve(shelf: Pick<ShelfInfo, 'hash' | 'parents'>, paths?: string[], opts: { overwrite?: boolean; label?: string } = {}): Promise<void> {
    if (!isHash(shelf.hash)) throw new GitError(`Invalid shelf: ${shelf.hash}`, null, '');
    await this.clearUnshelveMarker();
    if (!paths) {
      await this.run(['stash', 'apply', shelf.hash]);
      return;
    }
    for (const p of paths) assertRelPath(p);
    const untrackedCommit = shelf.parents[2] && isHash(shelf.parents[2]) ? shelf.parents[2] : undefined;
    const untrackedAll = untrackedCommit ? (await this.run(['ls-tree', '-r', '-z', '--name-only', untrackedCommit])).split('\0').filter(Boolean) : [];
    const want = new Set(paths);
    const untracked = untrackedAll.filter((p) => want.has(p));
    const tracked = paths.filter((p) => !untracked.includes(p));
    const { existsSync, promises: fsp } = await import('node:fs');
    const exists = untracked.filter((p) => existsSync(path.join(this.root, p)));
    if (exists.length > 0 && !opts.overwrite) throw new GitError(`Already exists, not restored: ${exists.join(', ')}`, null, '');
    // 已追蹤的先套用：失敗（沒有衝突）時整批都沒套用，未追蹤的也不還原，工作區維持原樣
    let conflict: unknown;
    if (tracked.length > 0) {
      const patch = await this.diffPaths([`${shelf.hash}^1`, shelf.hash], tracked);
      if (patch.length > 0) {
        const apply = (args: string[]) => runGit(this.gitPath, ['apply', ...args, '--whitespace=nowarn', '-'], { cwd: this.root, input: patch });
        try {
          // 先直接套用（變更留在工作區、不動 index）；套不上再用三方合併（會寫入 index，衝突以標記留在檔案中）
          await apply([]).catch(() => apply(['--3way']));
        } catch (e) {
          if ((await this.conflictedPaths()).length === 0) throw e;
          conflict = e;
          if (opts.label) await fsp.writeFile(this.unshelveMarker, opts.label, 'utf8');
        }
      }
    }
    for (let i = 0; i < untracked.length; i += 200) {
      await runGit(this.gitPath, ['restore', `--source=${untrackedCommit}`, '--worktree', '--', ...untracked.slice(i, i + 200)], { cwd: this.root, env: LITERAL });
    }
    if (conflict) throw conflict;
  }

  /**
   * 從 shelf 移除這些檔案（取回後），其餘保留：重建 stash 結構的 commit，不動工作區與真正的 index。
   * 全部移除後沒有任何變更時刪除整筆，回傳 'dropped'。paths 中 rename 要包含新舊路徑。
   */
  async removeFromShelf(id: string, paths: string[]): Promise<'kept' | 'dropped'> {
    assertShelfId(id);
    for (const p of paths) assertRelPath(p);
    const ref = SHELF_REF + id;
    const hash = (await this.run(['rev-parse', '--verify', `${ref}^{commit}`])).trim();
    const rewritten = await this.rewriteShelfCommit(hash, paths, 'remove');
    if (!rewritten) {
      await this.run(['update-ref', '-d', ref, hash]);
      return 'dropped';
    }
    await this.run(['update-ref', '-m', 'unshelve files', ref, rewritten, hash]);
    return 'kept';
  }

  /**
   * 以暫時的 index 重建 stash 結構的 commit（工作區 tree、index commit、未追蹤檔案 commit），保留原本的訊息與時間：
   * - 'only'：只留下 paths 的變更（git stash push -- 路徑 會把整個暫存區記進去，擱置要排除沒選的檔案）
   * - 'remove'：移除 paths 的變更，其餘保留
   * 結果沒有任何變更時回傳 undefined。
   */
  private async rewriteShelfCommit(hash: string, paths: string[], mode: 'only' | 'remove'): Promise<string | undefined> {
    const [parentList, subject, authorDate, committerDate] = (await this.run(['log', '-1', '--format=%P%x1f%s%x1f%aI%x1f%cI', hash])).trim().split('\x1f');
    const [base, indexCommit, untrackedCommit] = parentList.split(' ');
    const { existsSync, promises: fsp } = await import('node:fs');
    const tmpIndex = path.join(this.gitDir, `gitworkbench-shelf-index-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: tmpIndex, ...LITERAL };
    const git = (args: string[], input?: string) => runGit(this.gitPath, args, { cwd: this.root, env, input });
    const dates = { GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: committerDate };
    const commitTree = async (tree: string, parents: string[], message: string) =>
      (await runGit(this.gitPath, ['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', message], { cwd: this.root, env: dates })).trim();
    /** treeish 中這些路徑（含資料夾底下）的項目：路徑 → 「mode blob」 */
    const entries = async (treeish: string): Promise<Map<string, string>> => {
      const map = new Map<string, string>();
      for (let i = 0; i < paths.length; i += 200) {
        const out = await runGit(this.gitPath, ['ls-tree', '-r', '-z', treeish, '--', ...paths.slice(i, i + 200)], { cwd: this.root, env: LITERAL });
        for (const rec of out.split('\0').filter(Boolean)) {
          const tab = rec.indexOf('\t');
          const [m, , blob] = rec.slice(0, tab).split(' ');
          map.set(rec.slice(tab + 1), `${m} ${blob}`);
        }
      }
      return map;
    };
    /** 從 start 的 tree 開始，把 paths 換成 source 中的內容（source 沒有、或未指定 source 時移除）後寫出 tree */
    const patchTree = async (start: string, source: string | undefined): Promise<string> => {
      await git(['read-tree', start]);
      const want = source ? await entries(source) : new Map<string, string>();
      const remove = [...(await entries(start)).keys()].filter((p) => !want.has(p));
      if (want.size > 0) await git(['update-index', '-z', '--index-info'], [...want].map(([p, e]) => `${e}\t${p}\0`).join(''));
      for (let i = 0; i < remove.length; i += 200) await git(['update-index', '--force-remove', '--', ...remove.slice(i, i + 200)]);
      return (await git(['write-tree'])).trim();
    };
    try {
      const msg = async (c: string) => (await this.run(['log', '-1', '--format=%B', c])).trim();
      const only = mode === 'only';
      const indexTree = only ? await patchTree(base, indexCommit) : await patchTree(indexCommit, base);
      const workTree = only ? await patchTree(base, hash) : await patchTree(hash, base);
      // 未追蹤檔案：git stash push -- 路徑 本來就只收指定的路徑
      const untrackedTree = untrackedCommit ? (only ? (await this.run(['rev-parse', `${untrackedCommit}^{tree}`])).trim() : await patchTree(untrackedCommit, undefined)) : undefined;
      const emptyTree = (await runGit(this.gitPath, ['hash-object', '-t', 'tree', '--stdin'], { cwd: this.root, input: '' })).trim();
      const baseTree = (await this.run(['rev-parse', `${base}^{tree}`])).trim();
      const hasUntracked = !!untrackedTree && untrackedTree !== emptyTree;
      if (workTree === baseTree && indexTree === baseTree && !hasUntracked) return undefined;
      const newIndex = await commitTree(indexTree, [base], await msg(indexCommit));
      const newUntracked = hasUntracked ? await commitTree(untrackedTree!, [], await msg(untrackedCommit)) : undefined;
      return await commitTree(workTree, [base, newIndex, ...(newUntracked ? [newUntracked] : [])], subject);
    } finally {
      for (const f of [tmpIndex, `${tmpIndex}.lock`]) if (existsSync(f)) await fsp.rm(f, { force: true });
    }
  }

  /** 二進位安全的 diff，路徑多時分批再串接 */
  private async diffPaths(range: string[], paths: string[]): Promise<Buffer> {
    const parts: Buffer[] = [];
    for (let i = 0; i < paths.length; i += 200) {
      parts.push(await runGitBuffer(this.gitPath, ['diff', '--binary', '--no-color', '--no-ext-diff', ...range, '--', ...paths.slice(i, i + 200)], { cwd: this.root, env: LITERAL }));
    }
    return Buffer.concat(parts);
  }

  /** 改名：以相同內容與時間建立新的 commit（訊息換成新名稱），ref 指向它 */
  async renameShelf(id: string, name: string): Promise<string> {
    assertShelfId(id);
    const ref = SHELF_REF + id;
    const [tree, parents, subject, authorDate, committerDate] = (await this.run(['log', '-1', '--format=%T%x1f%P%x1f%s%x1f%aI%x1f%cI', ref])).trim().split('\x1f');
    const prefix = /^(.*?)shelf:/s.exec(subject)?.[1] ?? '';
    const message = `${prefix}shelf:${id} ${name.trim()}`.trim();
    const args = ['commit-tree', tree, ...parents.split(' ').filter(Boolean).flatMap((p) => ['-p', p]), '-m', message];
    const hash = (await runGit(this.gitPath, args, { cwd: this.root, env: { GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: committerDate } })).trim();
    await this.run(['update-ref', '-m', 'rename shelf', ref, hash]);
    return hash;
  }

  async dropShelf(id: string): Promise<void> {
    assertShelfId(id);
    await this.run(['update-ref', '-d', SHELF_REF + id]);
  }

  /** 匯出成可用 git apply（或 IntelliJ）套用的 patch：已追蹤檔案的變更，加上未追蹤檔案（以新增檔的 diff 表示） */
  async shelfPatch(shelf: Pick<ShelfInfo, 'hash' | 'parents'>): Promise<Buffer> {
    if (!isHash(shelf.hash)) throw new GitError(`Invalid shelf: ${shelf.hash}`, null, '');
    const parts = [await runGitBuffer(this.gitPath, ['diff', '--binary', '--no-color', '--no-ext-diff', `${shelf.hash}^1`, shelf.hash], { cwd: this.root })];
    const untrackedCommit = shelf.parents[2];
    if (untrackedCommit && isHash(untrackedCommit)) {
      // 未追蹤檔案的 commit 沒有 parent：--root 讓它與空的 tree 比較，每個檔案都成為新增
      parts.push(await runGitBuffer(this.gitPath, ['diff-tree', '-p', '--binary', '--root', '--no-commit-id', '-r', '--no-color', '--no-ext-diff', untrackedCommit], { cwd: this.root }));
    }
    return Buffer.concat(parts);
  }

  /** 工作區是否有可 stash 的變更（含未追蹤檔案） */
  async hasChanges(includeUntracked: boolean): Promise<boolean> {
    const out = await this.run(['status', '--porcelain', includeUntracked ? '--untracked-files=normal' : '--untracked-files=no']);
    return out.trim() !== '';
  }

  // ---------- Branch／Tag 操作 ----------

  /** 只接受完整 ref 名稱（refs/…），避免被當成選項 */
  private assertFullRef(ref: string): void {
    if (!/^refs\/(heads|remotes|tags)\/[^\0\s]+$/.test(ref)) throw new GitError(`Invalid ref: ${ref}`, null, '');
  }

  /** 刪除 local branch；force 時即使尚未合併也刪除（-D） */
  async deleteBranch(name: string, force: boolean): Promise<void> {
    if (!(await this.isValidRefName(name, 'branch'))) throw new GitError(`Invalid branch name: ${name}`, null, '');
    await this.run(['branch', force ? '-D' : '-d', name]);
  }

  /** 刪除遠端 branch（git push <remote> --delete <branch>） */
  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.assertRemote(remote);
    if (!(await this.isValidRefName(branch, 'branch'))) throw new GitError(`Invalid branch name: ${branch}`, null, '');
    await this.run(['push', remote, '--delete', `refs/heads/${branch}`]);
  }

  async deleteTag(name: string): Promise<void> {
    if (!(await this.isValidRefName(name, 'tag'))) throw new GitError(`Invalid tag name: ${name}`, null, '');
    await this.run(['tag', '-d', name]);
  }

  async pushTag(remote: string, name: string): Promise<void> {
    await this.assertRemote(remote);
    if (!(await this.isValidRefName(name, 'tag'))) throw new GitError(`Invalid tag name: ${name}`, null, '');
    await this.run(['push', remote, `refs/tags/${name}`]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    if (!(await this.isValidRefName(oldName, 'branch')) || !(await this.isValidRefName(newName, 'branch'))) throw new GitError(`Invalid branch name: ${newName}`, null, '');
    await this.run(['branch', '-m', oldName, newName]);
  }

  /** 把 ref 合併到目前 branch（不開編輯器，使用預設 merge message） */
  async merge(ref: string): Promise<void> {
    this.assertFullRef(ref);
    await this.run(['merge', '--no-edit', ref]);
  }

  /** 把目前 branch rebase 到 ref 上 */
  async rebase(ref: string): Promise<void> {
    this.assertFullRef(ref);
    await this.run(['rebase', ref]);
  }

  /**
   * 更新 local branch：目前 branch 時執行 pull；其他 branch 則從 upstream fast-forward（不切換 branch）。
   */
  async updateBranch(branch: string): Promise<void> {
    if (!(await this.isValidRefName(branch, 'branch'))) throw new GitError(`Invalid branch name: ${branch}`, null, '');
    const remote = (await this.tryRun(['config', '--get', `branch.${branch}.remote`]))?.trim();
    const merge = (await this.tryRun(['config', '--get', `branch.${branch}.merge`]))?.trim();
    if (!remote || !merge?.startsWith('refs/heads/')) throw new GitError(`${branch} has no upstream`, null, '');
    const current = (await this.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim();
    if (current === branch) return this.pull();
    await this.assertRemote(remote);
    // 沒有 + 前綴：只允許 fast-forward
    await this.run(['fetch', remote, `${merge}:refs/heads/${branch}`]);
  }

  /** 兩個 revision 之間的檔案差異（a → b） */
  async diffBetween(a: string, b: string): Promise<ChangedFile[]> {
    if (!isHash(a) || !isHash(b)) return [];
    return parseNameStatusZ(await this.run(['diff', '-M', '--name-status', '-z', a, b, '--']));
  }

  /** ref 解析成 commit hash */
  async resolve(ref: string): Promise<string | undefined> {
    if (ref !== 'HEAD') this.assertFullRef(ref);
    return (await this.tryRun(['rev-parse', '-q', '--verify', `${ref}^{commit}`]))?.trim() || undefined;
  }

  private async assertRemote(remote: string): Promise<void> {
    const remotes = ((await this.tryRun(['remote'])) ?? '').split('\n').map((s) => s.trim());
    if (!remote || !remotes.includes(remote)) throw new GitError(`Unknown remote: ${remote}`, null, '');
  }

  /** 指定 commit 與目前工作區（含未 stage 的修改）之間的差異檔案 */
  async diffWithWorkingTree(hash: string): Promise<ChangedFile[]> {
    if (!isHash(hash)) return [];
    return parseNameStatusZ(await this.run(['diff', '-M', '--name-status', '-z', hash, '--']));
  }

  async checkout(target: string, opts: { track?: boolean } = {}): Promise<void> {
    // 防止以 '-' 開頭的值被當成選項
    if (!target || target.startsWith('-')) throw new GitError(`Invalid checkout target: ${target}`, null, '');
    await this.run(opts.track ? ['checkout', '--track', target] : ['checkout', target]);
  }
}
