// Git 主控台：只讀取／會改變狀態的指令分類，以及執行紀錄的回呼
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyCommand, runGit, setGitLogger, type GitCommandRecord } from '../src/git/gitRunner';
import { makeRepo } from './helpers';

test('isReadOnlyCommand：查詢類為只讀，會改變狀態的不是', () => {
  for (const a of [['log', '--oneline'], ['status', '--porcelain'], ['-c', 'x=y', 'rev-parse', 'HEAD'], ['config', '--get', 'user.name'], ['diff-tree', '-r', '--name-status', 'abc'], ['ls-remote', 'origin'], ['config', 'user.name'], ['branch', '--list'], ['remote', 'get-url', 'origin'], ['stash', 'list'], ['tag', '-l']]) {
    assert.equal(isReadOnlyCommand(a), true, a.join(' '));
  }
  for (const a of [['fetch', 'origin'], ['push', 'origin', 'main'], ['commit', '-m', 'x'], ['checkout', 'main'], ['config', 'user.name', 'Bob'], ['branch', '-D', 'x'], ['stash', 'push'], ['tag', 'v1'], ['remote', 'add', 'o', 'u'], ['rebase', '-i']]) {
    assert.equal(isReadOnlyCommand(a), false, a.join(' '));
  }
});

test('setGitLogger：記錄指令、結束代碼與錯誤輸出', async () => {
  const r = makeRepo();
  const starts: string[][] = [];
  const ends: GitCommandRecord[] = [];
  setGitLogger(
    (x) => starts.push(x.args),
    (x) => ends.push(x),
  );
  try {
    await runGit('git', ['status'], { cwd: r.dir });
    await assert.rejects(runGit('git', ['checkout', 'no-such-branch'], { cwd: r.dir }));
  } finally {
    setGitLogger(undefined, undefined);
  }
  assert.deepEqual(starts, [['status'], ['checkout', 'no-such-branch']]);
  assert.equal(ends[0].exitCode, 0);
  assert.equal(ends[0].readOnly, true);
  assert.notEqual(ends[1].exitCode, 0);
  assert.equal(ends[1].readOnly, false);
  assert.match(ends[1].stderr, /no-such-branch/);
});
