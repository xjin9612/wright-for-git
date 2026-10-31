// 提交視窗：工作區變更、只提交勾選的內容（含部分 hunk）、捨棄變更
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { buildPatch, parseFileDiff, parseStatusV2 } from '../src/git/parsers';
import { GitRepository } from '../src/git/repository';
import { makeRepo } from './helpers';

test('parseStatusV2：一般、rename、衝突、未追蹤、忽略', () => {
  const text = [
    '1 .M N... 100644 100644 100644 aaa bbb src/a b.ts',
    '1 A. N... 000000 100644 100644 000 ccc new.ts',
    '1 .D N... 100644 100644 000000 ddd ddd gone.ts',
    '2 R. N... 100644 100644 100644 eee eee R100 docs/new.md',
    'docs/old.md',
    'u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.txt',
    '? notes.txt',
    '! dist/',
    '',
  ].join('\0');
  assert.deepEqual(parseStatusV2(text), [
    { path: 'src/a b.ts', status: 'M', kind: 'changed' },
    { path: 'new.ts', status: 'A', kind: 'changed' },
    { path: 'gone.ts', status: 'D', kind: 'changed' },
    { path: 'docs/new.md', oldPath: 'docs/old.md', status: 'R', kind: 'changed' },
    { path: 'conflict.txt', status: 'U', kind: 'conflict' },
    { path: 'notes.txt', status: 'A', kind: 'untracked' },
    { path: 'dist/', status: 'X', kind: 'ignored' },
  ]);
});

test('commitSelected：只提交勾選的檔案，不影響其他已暫存的檔案', async () => {
  const r = makeRepo();
  r.commit('init', { 'a.txt': '1\n', 'b.txt': '1\n', 'old.txt': 'x\n', '.gitignore': 'dist/\n' });
  const repo = (await GitRepository.open('git', r.dir))!;
  writeFileSync(path.join(r.dir, 'a.txt'), '2\n');
  writeFileSync(path.join(r.dir, 'b.txt'), '2\n');
  r.git('add', 'b.txt'); // 使用者在內建原始檔控制暫存了 b
  writeFileSync(path.join(r.dir, 'new.txt'), 'n\n');
  r.git('mv', 'old.txt', 'renamed.txt');
  mkdirSync(path.join(r.dir, 'dist'));
  writeFileSync(path.join(r.dir, 'dist', 'x.js'), '');

  const changes = await repo.getWorkingChanges(true);
  assert.deepEqual(
    changes.map((c) => `${c.kind}:${c.status}:${c.path}${c.oldPath ? `<${c.oldPath}` : ''}`).sort(),
    ['changed:M:a.txt', 'changed:M:b.txt', 'changed:R:renamed.txt<old.txt', 'ignored:X:dist/', 'untracked:A:new.txt'],
  );

  await repo.commitSelected({ full: ['a.txt', 'new.txt', 'renamed.txt', 'old.txt'], patches: [], message: 'pick some' });
  assert.equal(r.git('log', '-1', '--format=%s'), 'pick some');
  assert.deepEqual(r.git('show', '--name-status', '--format=', 'HEAD').split('\n').sort(), ['A\tnew.txt', 'M\ta.txt', 'R100\told.txt\trenamed.txt']);
  // b 仍維持使用者暫存的狀態，沒有被提交
  assert.equal(r.git('diff', '--cached', '--name-only'), 'b.txt');
  assert.equal(r.git('status', '--porcelain', '--', 'a.txt', 'new.txt'), '');

  // amend：只改訊息
  await repo.commitSelected({ full: [], patches: [], message: 'pick some (amended)', amend: true });
  assert.equal(r.git('log', '-1', '--format=%s'), 'pick some (amended)');
  assert.equal(r.git('rev-list', '--count', 'HEAD'), '2');
  assert.equal(await repo.lastCommitMessage(), 'pick some (amended)');
});

test('commitSelected：逐段（hunk）提交，剩下的變更留在工作區', async () => {
  const r = makeRepo();
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  r.commit('init', { 'f.txt': `${lines.join('\n')}\n` });
  const repo = (await GitRepository.open('git', r.dir))!;
  const changed = [...lines];
  changed[1] = 'line 2 CHANGED';
  changed[27] = 'line 28 CHANGED';
  writeFileSync(path.join(r.dir, 'f.txt'), `${changed.join('\n')}\n`);
  const diff = await repo.fileDiff('f.txt');
  assert.equal(diff.hunks.length, 2);
  const patch = buildPatch(diff.header, diff.hunks, new Set([1]))!;
  await repo.commitSelected({ full: [], patches: [{ path: 'f.txt', patch: Buffer.from(patch, 'latin1') }], message: 'second hunk only' });
  const committed = r.git('show', 'HEAD:f.txt');
  assert.match(committed, /line 28 CHANGED/);
  assert.doesNotMatch(committed, /line 2 CHANGED/);
  // 工作區保留兩處修改；未提交的那一段仍是變更
  assert.match(readFileSync(path.join(r.dir, 'f.txt'), 'utf8'), /line 2 CHANGED/);
  assert.match(r.git('diff', 'HEAD', '--', 'f.txt'), /line 2 CHANGED/);
  assert.doesNotMatch(r.git('diff', 'HEAD', '--', 'f.txt'), /line 28/);
});

test('rollback：還原修改、刪除與 rename；新增的檔案移出 index 但保留', async () => {
  const r = makeRepo();
  r.commit('init', { 'a.txt': '1\n', 'gone.txt': 'g\n', 'old.txt': 'o\n' });
  const repo = (await GitRepository.open('git', r.dir))!;
  writeFileSync(path.join(r.dir, 'a.txt'), '2\n');
  rmSync(path.join(r.dir, 'gone.txt'));
  r.git('mv', 'old.txt', 'new.txt');
  writeFileSync(path.join(r.dir, 'added.txt'), 'x');
  r.git('add', 'added.txt');
  const changes = (await repo.getWorkingChanges()).filter((c) => c.kind === 'changed');
  await repo.rollback(changes);
  assert.equal(readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), '1\n');
  assert.equal(readFileSync(path.join(r.dir, 'gone.txt'), 'utf8'), 'g\n');
  assert.equal(readFileSync(path.join(r.dir, 'old.txt'), 'utf8'), 'o\n');
  assert.equal(r.git('status', '--porcelain'), '?? added.txt');
});

test('commitSelected：檔名中的 [ ] : 當作字面名稱，不會帶入其他檔案', async () => {
  const r = makeRepo();
  r.commit('init', { 'pages/[id].tsx': 'a\n', 'pages/i.tsx': 'b\n' });
  const repo = (await GitRepository.open('git', r.dir))!;
  writeFileSync(path.join(r.dir, 'pages/[id].tsx'), 'a2\n');
  writeFileSync(path.join(r.dir, 'pages/i.tsx'), 'b2\n');
  await repo.commitSelected({ full: ['pages/[id].tsx'], patches: [], message: 'only id' });
  assert.equal(r.git('show', '--name-only', '--format=', 'HEAD'), 'pages/[id].tsx');
  await assert.rejects(repo.commitSelected({ full: ['../x'], patches: [], message: 'bad' }));
});

test('commitSelected：保留 # 開頭的訊息行；merge 進行中拒絕部分提交', async () => {
  const r = makeRepo();
  r.commit('init', { 'a.txt': '1\n' });
  const repo = (await GitRepository.open('git', r.dir))!;
  writeFileSync(path.join(r.dir, 'a.txt'), '2\n');
  await repo.commitSelected({ full: ['a.txt'], patches: [], message: '#123 fix crash\n\nbody' });
  assert.equal(r.git('log', '-1', '--format=%B').trim(), '#123 fix crash\n\nbody');

  r.git('checkout', '-q', '-b', 'feat');
  r.commit('feat', { 'b.txt': 'feat\n' });
  r.git('checkout', '-q', '-');
  r.commit('main', { 'c.txt': 'main\n' });
  r.git('merge', '--no-commit', '--no-ff', 'feat');
  writeFileSync(path.join(r.dir, 'a.txt'), '3\n');
  await assert.rejects(repo.commitSelected({ full: ['a.txt'], patches: [], message: 'partial' }), /merge is in progress/);
});

test('commitSelected：非 UTF-8（Big5）內容的逐段提交不會被改壞', async () => {
  const r = makeRepo();
  const big5 = Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]);
  const base = Buffer.concat(Array.from({ length: 20 }, (_, i) => Buffer.from(`line ${i}\n`)));
  writeFileSync(path.join(r.dir, 'b.txt'), base);
  r.git('add', 'b.txt');
  r.git('commit', '-q', '-m', 'init');
  const repo = (await GitRepository.open('git', r.dir))!;
  writeFileSync(path.join(r.dir, 'b.txt'), Buffer.concat([big5, Buffer.from('\n'), base]));
  r.git('config', 'diff.mnemonicPrefix', 'true');
  const raw = (await repo.rawFileDiff('b.txt')).toString('latin1');
  const bytes = parseFileDiff(raw);
  const patch = buildPatch(bytes.header, bytes.hunks, new Set([0]))!;
  await repo.commitSelected({ full: [], patches: [{ path: 'b.txt', patch: Buffer.from(patch, 'latin1') }], message: 'big5' });
  const shown = execFileSync('git', ['show', 'HEAD:b.txt'], { cwd: r.dir });
  assert.deepEqual(shown.subarray(0, 4), big5);
  // 真正的 index 已與新的 HEAD 一致（沒有殘留反向的暫存）
  assert.equal(r.git('diff', '--cached', '--name-only'), '');
});

test('rollback：intent-to-add 的檔案不會被刪除', async () => {
  const r = makeRepo();
  r.commit('init', { 'a.txt': '1\n' });
  const repo = (await GitRepository.open('git', r.dir))!;
  writeFileSync(path.join(r.dir, 'n.txt'), 'new\n');
  r.git('add', '-N', 'n.txt');
  const changes = await repo.getWorkingChanges();
  const n = changes.find((c) => c.path === 'n.txt')!;
  assert.equal(n.status, 'A');
  await repo.rollback([n]);
  assert.ok(existsSync(path.join(r.dir, 'n.txt')));
});
