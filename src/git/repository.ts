// 單一 git repository 的高階操作（不依賴 vscode，可在 Node 直接測試）
import * as path from 'node:path';
import type { ChangedFile, CommitDetails, CommitInfo, LogFilter, PushPlan, RepoState, StashInfo, UserInfo } from '../shared/protocol';
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
  REF_FORMAT,
} from './parsers';

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
    const [remotesOut, refsOut, headHash, headBranch, userName, userEmail] = await Promise.all([
      this.tryRun(['remote']),
      this.run(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.tryRun(['rev-parse', '--verify', '--quiet', 'HEAD']),
      this.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD']),
      this.tryRun(['config', 'user.name']),
      this.tryRun(['config', 'user.email']),
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

  /** 是否為 ancestor 的祖先（含自己） */
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
   */
  /**
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

  /** stash 的檔案：已追蹤檔案相對 stash 當時的 HEAD（parent 1），加上 -u 存入的未追蹤檔案（parent 3） */
  async getStashFiles(stash: StashInfo): Promise<(ChangedFile & { untracked?: boolean })[]> {
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
