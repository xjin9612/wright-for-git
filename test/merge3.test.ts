// 三方合併演算法：行比對、衝突與非衝突區塊、換行處理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, joinLines, merge3, splitText, type MergeSegment } from '../src/git/merge3';

/** 依 diff 把 a 套成 b，確認結果正確 */
function apply(a: string[], b: string[]): string[] {
  const out: string[] = [];
  let pos = 0;
  for (const h of diffLines(a, b)) {
    out.push(...a.slice(pos, h.a0), ...b.slice(h.b0, h.b1));
    pos = h.a1;
  }
  return [...out, ...a.slice(pos)];
}

test('diffLines：各種插入、刪除、修改都能還原', () => {
  const cases: [string, string][] = [
    ['', ''],
    ['a b c', 'a b c'],
    ['a b c', 'a x c'],
    ['a b c', 'x a b c y'],
    ['a b c d e', 'a c e'],
    ['', 'a b'],
    ['a b', ''],
    ['a b c a b b a', 'c b a b a c'],
  ];
  for (const [x, y] of cases) {
    const a = x ? x.split(' ') : [];
    const b = y ? y.split(' ') : [];
    assert.deepEqual(apply(a, b), b, `${x} → ${y}`);
  }
  // 隨機內容
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 200; n++) {
    const a = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcd'[Math.floor(rnd() * 4)]);
    const b = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcd'[Math.floor(rnd() * 4)]);
    assert.deepEqual(apply(a, b), b);
  }
});

test('diffLines：只回報真正不同的行', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'c']), [{ a0: 1, a1: 2, b0: 1, b1: 2 }]);
});

const chunks = (segs: MergeSegment[]) => segs.filter((s) => s.kind === 'chunk');

test('merge3：兩邊改同一行是衝突；只有一邊改的不是', () => {
  const base = ['// theme', '', 'export const theme = "light";', '', 'export const size = 1;'];
  const ours = ['// theme', '', 'export const theme = "system";', '', 'export const size = 2;'];
  const theirs = ['// theme', '', 'export const theme = "dark";', '', 'export const size = 1;'];
  const segs = merge3(base, ours, theirs);
  const cs = chunks(segs);
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0], { kind: 'chunk', base: ['export const theme = "light";'], ours: ['export const theme = "system";'], theirs: ['export const theme = "dark";'], oursChanged: true, theirsChanged: true, conflict: true });
  assert.equal(cs[1].kind === 'chunk' && cs[1].conflict, false);
  assert.equal(cs[1].kind === 'chunk' && cs[1].oursChanged && !cs[1].theirsChanged, true);
  // 段落依序接起來：base 的行數不變
  const baseBack = segs.flatMap((s) => (s.kind === 'stable' ? s.lines : s.base));
  assert.deepEqual(baseBack, base);
});

test('merge3：兩邊改得一樣不算衝突；兩邊各自在不同位置改都不算衝突', () => {
  const base = ['a', 'b', 'c', 'd', 'e'];
  const segs = merge3(base, ['a', 'B', 'c', 'd', 'e'], ['a', 'B', 'c', 'D', 'e']);
  const cs = chunks(segs);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.kind === 'chunk' && !c.conflict));
  const ours = segs.flatMap((s) => (s.kind === 'stable' ? s.lines : s.ours));
  const theirs = segs.flatMap((s) => (s.kind === 'stable' ? s.lines : s.theirs));
  assert.deepEqual(ours, ['a', 'B', 'c', 'd', 'e']);
  assert.deepEqual(theirs, ['a', 'B', 'c', 'D', 'e']);
});

test('merge3：相鄰的修改合成一個衝突（與 git 相同）；新增檔案（沒有 base）整個是衝突', () => {
  const segs = merge3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'b', 'Y']);
  assert.equal(chunks(segs).length, 1);
  assert.equal((chunks(segs)[0] as Extract<MergeSegment, { kind: 'chunk' }>).conflict, true);
  const added = merge3([], ['x', 'y'], ['x', 'z']);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0], { kind: 'chunk', base: [], ours: ['x', 'y'], theirs: ['x', 'z'], oursChanged: true, theirsChanged: true, conflict: true });
});

test('merge3：各邊的段落內容可以還原成原本的檔案', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const mutate = (a: string[]) => a.flatMap((x) => (rnd() < 0.15 ? [] : rnd() < 0.15 ? [x, `n${Math.floor(rnd() * 9)}`] : rnd() < 0.1 ? [`m${x}`] : [x]));
  for (let n = 0; n < 200; n++) {
    const base = Array.from({ length: Math.floor(rnd() * 25) }, (_, i) => `l${i}`);
    const ours = mutate(base);
    const theirs = mutate(base);
    const segs = merge3(base, ours, theirs);
    assert.deepEqual(segs.flatMap((s) => (s.kind === 'stable' ? s.lines : s.ours)), ours);
    assert.deepEqual(segs.flatMap((s) => (s.kind === 'stable' ? s.lines : s.theirs)), theirs);
    assert.deepEqual(segs.flatMap((s) => (s.kind === 'stable' ? s.lines : s.base)), base);
  }
});

test('splitText／joinLines：保留 CRLF 與結尾換行', () => {
  assert.deepEqual(splitText('a\r\nb\r\n'), { lines: ['a', 'b'], eol: '\r\n', finalNewline: true });
  assert.deepEqual(splitText('a\nb'), { lines: ['a', 'b'], eol: '\n', finalNewline: false });
  assert.deepEqual(splitText(''), { lines: [], eol: '\n', finalNewline: false });
  assert.equal(joinLines(['a', 'b'], '\r\n', true), 'a\r\nb\r\n');
  assert.equal(joinLines([], '\n', true), '');
  assert.equal(joinLines([''], '\n', true), '\n');
});

test('repository：衝突的三個版本、名稱、整個採用一邊、標記已解決', async () => {
  const { GitRepository } = await import('../src/git/repository');
  const { makeRepo } = await import('./helpers');
  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const r = makeRepo();
  r.commit('base', { 'a.txt': 'base\n', 'gone.txt': 'x\n', '[id].txt': 'base\n' });
  r.git('checkout', '-q', '-b', 'topic');
  r.git('rm', '-q', 'gone.txt');
  r.commit('theirs', { 'a.txt': 'theirs\n', '[id].txt': 'theirs\n' });
  r.git('checkout', '-q', 'main');
  r.commit('ours', { 'a.txt': 'ours\n', 'gone.txt': 'changed\n', '[id].txt': 'ours\n' });
  assert.throws(() => r.git('merge', 'topic'));
  const repo = (await GitRepository.open('git', r.dir))!;
  assert.deepEqual((await repo.conflictedPaths()).sort(), ['[id].txt', 'a.txt', 'gone.txt']);
  const types = Object.fromEntries((await repo.getWorkingChanges()).filter((c) => c.kind === 'conflict').map((c) => [c.path, c.conflict]));
  assert.deepEqual(types, { 'a.txt': 'both-modified', 'gone.txt': 'deleted-by-them', '[id].txt': 'both-modified' });
  const v = await repo.conflictVersions('a.txt');
  assert.deepEqual([v.base?.toString(), v.ours?.toString(), v.theirs?.toString()], ['base\n', 'ours\n', 'theirs\n']);
  assert.equal((await repo.conflictVersions('gone.txt')).theirs, undefined);
  assert.deepEqual(await repo.conflictLabels(), { op: 'merge', ours: 'main', theirs: 'topic' });
  // 檔名含 pathspec 特殊字元也只處理該檔
  await repo.acceptConflictSide(['[id].txt'], 'theirs');
  assert.equal(readFileSync(path.join(r.dir, '[id].txt'), 'utf8'), 'theirs\n');
  // 他們刪除 → 採用他們的就是刪除
  await repo.acceptConflictSide(['gone.txt'], 'theirs');
  assert.equal(existsSync(path.join(r.dir, 'gone.txt')), false);
  writeFileSync(path.join(r.dir, 'a.txt'), 'merged\n');
  await repo.markConflictResolved(['a.txt']);
  assert.deepEqual(await repo.conflictedPaths(), []);
  assert.equal((await repo.getState()).conflicts, undefined);
  await repo.continueOperation('merge');
  assert.equal(r.git('show', 'HEAD:a.txt'), 'merged');
});
