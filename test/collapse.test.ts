// 長線性分支折疊：哪些段落會被收、顯示清單與 graph 的 parent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCollapse, findLinearRuns, type CollapsibleCommit } from '../src/shared/collapse';
import { GraphLayout } from '../src/shared/graph';

/** 示意圖的例子：main 與 feature/payment（6 筆）交錯；由新到舊 */
const c = (hash: string, ...parents: string[]): CollapsibleCommit => ({ hash, parents, repo: 0 });
const EXAMPLE = [
  c('M', 'm3', 'f6'), // Merge branch 'feature/payment'
  c('f6', 'f5'), // retry on timeout（feature/payment 標籤）
  c('f5', 'f4'),
  c('m3', 'm2'),
  c('f4', 'f3'),
  c('f3', 'f2'),
  c('f2', 'f1'),
  c('m2', 'm1'),
  c('f1', 'm1'), // payment page（分支第一筆）
  c('m1'), // release 2.3（v2.3.0）
];
const heads = new Map([[0, 'M']]);

test('分支中間連續的 commit 被收；上端、分支第一筆保留；主線不收', () => {
  const runs = findLinearRuns(EXAMPLE, heads, new Set());
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], { key: '0:f5', repo: 0, tip: 'f6', hidden: ['f5', 'f4', 'f3', 'f2'], last: 'f1' });
});

test('分支被合併後沒有標籤：最新一筆（合併的第二個 parent）仍保留', () => {
  // f6 是 M 的第二個 parent，M 在主線上；f6 本身也可收，但作為上端保留
  const runs = findLinearRuns(EXAMPLE, heads, new Set());
  assert.equal(runs[0].tip, 'f6');
});

test('有標籤的 commit 不收，把段落切開；切開後少於 3 筆的不收', () => {
  // f3 有 tag：f5、f4 只剩 2 筆（不收），f2 只剩 1 筆（不收）
  assert.deepEqual(findLinearRuns(EXAMPLE, heads, new Set(['0:f3'])), []);
  // f2 有標籤：f5、f4、f3 當中 f3 是下端，中間只剩 f5、f4 兩筆，不收
  assert.deepEqual(findLinearRuns(EXAMPLE, heads, new Set(['0:f2'])), []);
  // 分支再多一筆（f2 之前多一筆 f2b）就會收
  const longer = [...EXAMPLE.slice(0, 6), c('f2b', 'f2'), { ...EXAMPLE[6] }, ...EXAMPLE.slice(7)];
  longer[5] = c('f3', 'f2b');
  const runs = findLinearRuns(longer, heads, new Set(['0:f2']));
  assert.deepEqual(runs.map((r) => [r.hidden, r.last]), [[['f5', 'f4', 'f3'], 'f2b']]);
});

test('主線上很長的線性歷史不收', () => {
  const line = Array.from({ length: 10 }, (_, i) => c(`m${10 - i}`, ...(i < 9 ? [`m${9 - i}`] : [])));
  assert.deepEqual(findLinearRuns(line, new Map([[0, 'm10']]), new Set()), []);
});

test('分支底部還沒載入時，以最後載入的一筆當下端', () => {
  const partial = EXAMPLE.slice(0, 7); // 載到 f2，f1 與 m1 還沒載入
  const runs = findLinearRuns(partial, heads, new Set());
  // f5、f4、f3、f2 可收：f2 當下端（保留），中間 f5、f4、f3 三筆
  assert.deepEqual(runs.map((r) => [r.hidden, r.last]), [[['f5', 'f4', 'f3'], 'f2']]);
});

test('applyCollapse：收合列放在第一筆被收的位置，graph 的 parent 改接，其他列順序不變', () => {
  const runs = findLinearRuns(EXAMPLE, heads, new Set());
  const { view, graphParents } = applyCollapse(EXAMPLE, runs, () => true, (run) => ({ hash: `collapsed:${run.key}`, parents: [run.last], repo: run.repo }));
  assert.deepEqual(
    view.map((x) => x.hash),
    ['M', 'f6', 'collapsed:0:f5', 'm3', 'm2', 'f1', 'm1'],
  );
  assert.deepEqual(graphParents.get('0:f6'), ['collapsed:0:f5']);
  assert.deepEqual(graphParents.get('0:collapsed:0:f5'), ['f1']);
  // commit 本身的 parents 沒有被改
  assert.deepEqual(EXAMPLE[1].parents, ['f5']);
  // graph 照常計算：收合列與上下端在同一條 lane
  const g = new GraphLayout();
  g.add(view.map((x) => ({ hash: x.hash, parents: graphParents.get(`0:${x.hash}`) ?? x.parents })));
  const lane = (h: string) => g.rows[view.findIndex((x) => x.hash === h)].col;
  assert.equal(lane('f6'), lane('collapsed:0:f5'));
  assert.equal(lane('f1'), lane('collapsed:0:f5'));
  assert.notEqual(lane('m3'), lane('f6'));
});

test('applyCollapse：沒有收合的段落時回傳原清單', () => {
  const runs = findLinearRuns(EXAMPLE, heads, new Set());
  const { view } = applyCollapse(EXAMPLE, runs, () => false, (run) => ({ hash: run.key, parents: [], repo: 0 }));
  assert.equal(view, EXAMPLE);
});
