// 測試輔助：建立暫存 git repository
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

export function makeRepo(): { dir: string; git: (...args: string[]) => string; commit: (msg: string, files?: Record<string, string>, date?: string) => string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'gwb-'));
  let tick = 0;
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Alice');
  git('config', 'user.email', 'alice@example.com');
  git('config', 'commit.gpgsign', 'false');
  // Windows（含 GitHub Actions 的 Windows runner）預設 core.autocrlf=true，取出檔案時會轉成 CRLF；測試比對內容時固定不轉換
  git('config', 'core.autocrlf', 'false');
  const commit = (msg: string, files: Record<string, string> = {}, date?: string) => {
    tick++;
    const d = date ?? `2026-01-01T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}Z`;
    if (Object.keys(files).length === 0) files = { [`f${tick}.txt`]: `${tick}` };
    for (const [f, c] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      writeFileSync(path.join(dir, f), c);
    }
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', msg], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d },
    });
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, commit };
}
