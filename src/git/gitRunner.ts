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
