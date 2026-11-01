// 執行 git 子行程（不經 shell），以 UTF-8 解碼輸出
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  /** 額外的環境變數（如 GIT_INDEX_FILE） */
  env?: Record<string, string>;
  /** 寫入 stdin 的內容（字串以 UTF-8 寫入；Buffer 原樣寫入） */
  input?: string | Buffer;
}

// i18n.logOutputEncoding 固定 UTF-8：使用者若設定 big5 等編碼，log／詳情的中文才不會變亂碼
const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'i18n.logOutputEncoding=UTF-8', '--no-pager'];

/** 每個 git 指令結束時的紀錄（給 Git 主控台） */
export interface GitCommandRecord {
  cwd: string;
  /** 不含固定的 -c 參數 */
  args: string[];
  /** 是否為只讀取的指令（log、status 等）；主控台預設只顯示會改變狀態的指令 */
  readOnly: boolean;
  exitCode: number | null;
  durationMs: number;
  stderr: string;
  /** 被取消（例如切換篩選時中止上一個 log） */
  cancelled: boolean;
}

let commandLogger: ((r: GitCommandRecord) => void) | undefined;
let startLogger: ((r: Pick<GitCommandRecord, 'cwd' | 'args' | 'readOnly'>) => void) | undefined;

/** 由 extension 註冊：指令開始與結束時呼叫（git 層不依賴 vscode） */
export function setGitLogger(onStart: typeof startLogger, onEnd: typeof commandLogger): void {
  startLogger = onStart;
  commandLogger = onEnd;
}

const READ_ONLY = new Set([
  'log', 'show', 'rev-parse', 'rev-list', 'status', 'for-each-ref', 'diff', 'ls-tree', 'ls-files', 'cat-file', 'shortlog',
  'merge-base', 'symbolic-ref', 'check-ref-format', 'name-rev', 'describe', 'version', 'blame', 'var', 'grep', 'show-ref', 'count-objects',
]);

/** 指令是否只讀取：子指令在清單中，或 config／branch／remote／stash／tag 的查詢形式 */
export function isReadOnlyCommand(args: readonly string[]): boolean {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += args[i] === '-c' || args[i] === '-C' ? 2 : 1;
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return true;
  if (READ_ONLY.has(sub)) return true;
  if (sub === 'config') return rest.some((a) => a === '--get' || a === '--get-all' || a === '--list' || a === '-l' || a === '--get-regexp') || rest.filter((a) => !a.startsWith('-')).length === 1;
  if (sub === 'branch') return rest.length === 0 || rest.some((a) => a === '--list' || a === '-l' || a.startsWith('--contains') || a.startsWith('--merged') || a.startsWith('--format') || a === '-a' || a === '-r' || a === '-v' || a === '-vv');
  if (sub === 'remote') return rest.length === 0 || rest[0] === '-v' || rest[0] === 'get-url' || rest[0] === 'show';
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  if (sub === 'tag') return rest.length === 0 || rest.some((a) => a === '-l' || a === '--list' || a.startsWith('--contains') || a.startsWith('--points-at'));
  return false;
}

function spawnGit(gitPath: string, args: string[], opts: RunOptions) {
  const child = spawn(gitPath, [...BASE_ARGS, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: process.env.LC_ALL ?? 'C.UTF-8', ...opts.env },
    stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
    signal: opts.signal,
  });
  if (opts.input !== undefined && child.stdin) {
    child.stdin.on('error', () => undefined);
    if (typeof opts.input === 'string') child.stdin.end(opts.input, 'utf8');
    else child.stdin.end(opts.input);
  }
  if (startLogger || commandLogger) {
    const readOnly = isReadOnlyCommand(args);
    const started = Date.now();
    let stderr = '';
    let logged = false;
    startLogger?.({ cwd: opts.cwd, args, readOnly });
    const done = (exitCode: number | null, extra = '') => {
      if (logged) return;
      logged = true;
      commandLogger?.({ cwd: opts.cwd, args, readOnly, exitCode, durationMs: Date.now() - started, stderr: stderr + extra, cancelled: !!opts.signal?.aborted });
    };
    child.stderr?.on('data', (b: Buffer) => {
      if (stderr.length < 20000) stderr += b.toString('utf8');
    });
    child.on('error', (e) => done(null, e.message));
    child.on('close', (code) => done(code));
  }
  return child;
}

/**
 * 串流執行 git：每收到一段 stdout 就呼叫 onData（已正確處理跨 chunk 的 UTF-8 字元）。
 */
export function streamGit(gitPath: string, args: string[], opts: RunOptions, onData: (text: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnGit(gitPath, args, opts);
    const decoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let stderr = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    child.stdout!.on('data', (buf: Buffer) => {
      try {
        onData(decoder.write(buf));
      } catch (e) {
        child.kill();
        finish(e as Error);
      }
    });
    child.stderr!.on('data', (buf: Buffer) => {
      stderr += errDecoder.write(buf);
    });
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      const tail = decoder.end();
      if (tail) onData(tail);
      if (code === 0) finish();
      else finish(new GitError(stderr.trim() || `git ${args.join(' ')} exited with code ${code}`, code, stderr));
    });
  });
}

/** 執行 git 並回傳完整 stdout */
export async function runGit(gitPath: string, args: string[], opts: RunOptions): Promise<string> {
  let out = '';
  await streamGit(gitPath, args, opts, (t) => {
    out += t;
  });
  return out;
}

/** 執行 git 並回傳原始位元組（檔案內容交給 VS Code 依編碼設定解碼） */
export function runGitBuffer(gitPath: string, args: string[], opts: RunOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawnGit(gitPath, args, opts);
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout!.on('data', (b: Buffer) => chunks.push(b));
    child.stderr!.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new GitError(stderr.trim() || `git ${args.join(' ')} exited with code ${code}`, code, stderr));
    });
  });
}
