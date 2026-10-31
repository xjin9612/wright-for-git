// 單一 git repository 的高階操作（不依賴 vscode，可在 Node 直接測試）
import * as path from 'node:path';
import type { ChangedFile, CommitDetails, CommitInfo, LogFilter, RepoState, UserInfo } from '../shared/protocol';
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
    const otherFilters = filter.branches.length > 0 || filter.users.length > 0 || filter.paths.length > 0;
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

  async checkout(target: string, opts: { track?: boolean } = {}): Promise<void> {
    // 防止以 '-' 開頭的值被當成選項
    if (!target || target.startsWith('-')) throw new GitError(`Invalid checkout target: ${target}`, null, '');
    await this.run(opts.track ? ['checkout', '--track', target] : ['checkout', target]);
  }
}
