// 在資料夾底下尋找 git repository（不依賴 vscode，可直接測試）
// 支援三種情境：
//  1. 資料夾內有多個 repo，也有非 git 資料夾 → 略過非 git 資料夾、繼續往下找
//  2. repo 裡面還有 repo（submodule 或獨立巢狀 repo）→ 找到 repo 後仍繼續往內掃
//  3. 單一 repo
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_SCAN_EXCLUDE = [
  'node_modules',
  'target',
  'build',
  'dist',
  'out',
  'bin',
  'obj',
  'vendor',
  'coverage',
  '.idea',
  '.vscode',
  '.gradle',
  '.mvn',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
];

/** 路徑比較用的 key：Windows 不分大小寫（磁碟代號常有 d:／D: 之差） */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const n = path.normalize(p).replace(/[\\/]+$/, '');
  return platform === 'win32' ? n.toLowerCase() : n;
}

/**
 * 從 base 往下最多 maxDepth 層，找出含有 `.git`（目錄或檔案）的資料夾。
 * base 自身為第 0 層。不跟隨 symbolic link。
 */
export async function scanForRepositories(base: string, maxDepth: number, exclude: readonly string[] = DEFAULT_SCAN_EXCLUDE): Promise<string[]> {
  const excluded = new Set(exclude.map((e) => e.toLowerCase()));
  const found: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 無權限或已刪除
    }
    if (entries.some((e) => e.name === '.git')) found.push(dir);
    if (depth >= maxDepth) return;
    const subdirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink() && e.name !== '.git' && !excluded.has(e.name.toLowerCase()));
    await Promise.all(subdirs.map((e) => walk(path.join(dir, e.name), depth + 1)));
  };

  await walk(base, 0);
  return found.sort();
}

/** 依 key 去重，保留第一次出現的寫法 */
export function dedupePaths(paths: readonly string[], platform: NodeJS.Platform = process.platform): string[] {
  const seen = new Map<string, string>();
  for (const p of paths) {
    const k = pathKey(p, platform);
    if (!seen.has(k)) seen.set(k, path.normalize(p).replace(/[\\/]+$/, ''));
  }
  return [...seen.values()];
}
