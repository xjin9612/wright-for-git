import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { dedupePaths, pathKey, scanForRepositories } from '../src/git/discovery';
import { LogMerger } from '../src/git/logMerger';
import type { CommitInfo } from '../src/shared/protocol';

const initRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
};

test('三種資料夾情境：多 repo＋非 git 資料夾、巢狀 repo、排除清單、深度', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'scan-'));
  initRepo(path.join(base, 'api-server'));
  initRepo(path.join(base, 'api-server', 'libs', 'inner')); // repo 內的 repo
  initRepo(path.join(base, 'web-app'));
  mkdirSync(path.join(base, 'notes', 'deep'), { recursive: true }); // 非 git 資料夾
  initRepo(path.join(base, 'notes', 'deep', 'tool')); // 非 git 資料夾底下的 repo
  initRepo(path.join(base, 'node_modules', 'x')); // 應排除
  initRepo(path.join(base, 'a', 'b', 'c', 'too-deep')); // 第 4 層
  // worktree／submodule 的 .git 是檔案
  mkdirSync(path.join(base, 'wt'));
  writeFileSync(path.join(base, 'wt', '.git'), 'gitdir: ../api-server/.git/worktrees/wt\n');

  const found = (await scanForRepositories(base, 3)).map((p) => path.relative(base, p).split(path.sep).join('/'));
  assert.deepEqual(found.sort(), ['api-server', 'api-server/libs/inner', 'notes/deep/tool', 'web-app', 'wt']);
  assert.deepEqual(await scanForRepositories(path.join(base, 'web-app'), 3), [path.join(base, 'web-app')]);
  assert.equal((await scanForRepositories(base, 4)).some((p) => p.endsWith('too-deep')), true);
});

test('Windows 路徑去重不分大小寫', () => {
  assert.equal(pathKey('D:\\Projects\\api-server\\', 'win32'), pathKey('d:\\projects\\api-server', 'win32'));
  assert.notEqual(pathKey('/a/B', 'linux'), pathKey('/a/b', 'linux'));
  assert.equal(dedupePaths(['/x/a', '/x/a/', '/x/b'], 'linux').length, 2);
});

const c = (hash: string, t: number): CommitInfo => ({ hash, parents: [], author: '', authorEmail: '', authorTime: t, committer: '', committerEmail: '', commitTime: t, subject: '', repo: 0 });

test('LogMerger：跨 repo 依時間合併、單一 repo 內保持原順序、等待未到的 repo', () => {
  const m = new LogMerger(2);
  m.push(0, [c('a1', 100), c('a2', 50)]);
  assert.deepEqual(m.drain(), [], 'repo 1 尚無資料時不可輸出');
  m.push(1, [c('b1', 80)]);
  assert.deepEqual(m.drain().map((x) => x.hash), ['a1', 'b1']);
  m.finish(1);
  // repo 0 內 topo 順序優先：a3 時間較新但排在 a2 後面
  m.push(0, [c('a3', 999)]);
  m.finish(0);
  assert.deepEqual(m.drain().map((x) => x.hash), ['a2', 'a3']);
});
