import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphLayout, SNAPSHOT_INTERVAL, applyRow, passThrough } from '../src/shared/graph';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

test('線性歷史全部在 lane 0、同色', () => {
  const g = new GraphLayout();
  g.add([c('c', 'b'), c('b', 'a'), c('a')]);
  assert.deepEqual(g.rows.map((r) => r.col), [0, 0, 0]);
  assert.equal(new Set(g.rows.map((r) => r.color)).size, 1);
  // 中間列：上下都有直線
  assert.deepEqual(g.rows[1].top, [{ from: 0, to: 0, color: 0 }]);
  assert.deepEqual(g.rows[1].bottom, [{ from: 0, to: 0, color: 0 }]);
  // root commit 沒有下半線段
  assert.deepEqual(g.rows[2].bottom, []);
});

test('merge：第二個 parent 開新 lane，最後匯回', () => {
  //   m
  //   |\
  //   x y
  //   |/
  //   b
  const g = new GraphLayout();
  g.add([c('m', 'x', 'y'), c('x', 'b'), c('y', 'b'), c('b')]);
  const [m, x, y, b] = g.rows;
  assert.equal(m.col, 0);
  assert.deepEqual(m.bottom.map((s) => [s.from, s.to]), [[0, 0], [0, 1]]);
  assert.equal(x.col, 0);
  assert.equal(y.col, 1);
  assert.notEqual(y.color, x.color);
  // y 的第一個 parent b 已由 lane 0 等待 → 連到 lane 0
  assert.deepEqual(y.bottom.filter((s) => s.from === 1).map((s) => s.to), [0]);
  assert.equal(b.col, 0);
  assert.equal(b.width, 1);
});

test('兩個 branch head 指向不同 commit，最後匯集', () => {
  // a1 (feature) 與 m1 (main) 皆以 base 為 parent
  const g = new GraphLayout();
  g.add([c('m1', 'base'), c('a1', 'base'), c('base')]);
  assert.equal(g.rows[0].col, 0);
  // a1 是新 head → lane 1，其 parent base 已由 lane 0 等待 → 斜線連回 lane 0
  assert.equal(g.rows[1].col, 1);
  assert.deepEqual(g.rows[1].bottom.filter((s) => s.from === 1).map((s) => s.to), [0]);
  assert.equal(g.rows[2].col, 0);
  assert.equal(g.rows[2].width, 1);
});

test('增量 add 與一次 add 結果相同', () => {
  const commits = [c('m', 'x', 'y'), c('x', 'b'), c('y', 'b'), c('b', 'a'), c('a')];
  const all = new GraphLayout();
  all.add(commits);
  const inc = new GraphLayout();
  inc.add(commits.slice(0, 2));
  inc.add(commits.slice(2));
  assert.deepEqual(inc.rows, all.rows);
});

test('直通線由 lane 狀態推出，不存在每列中', () => {
  // 兩條平行 branch
  const g = new GraphLayout();
  g.add([c('a2', 'a1'), c('b2', 'b1'), c('a1', 'r'), c('b1', 'r'), c('r')]);
  const b2 = g.rows[1];
  assert.equal(b2.col, 1);
  assert.ok(!b2.top.some((s) => s.from === 0), '直通 lane 不應記在列中');
  // lane 0（等 a1）直通 b2 這一列
  assert.deepEqual(passThrough(g.stateBefore(1), b2), [{ lane: 0, color: 0 }]);
});

test('stateBefore 以快照回放，與逐列套用結果一致（跨過多個快照）', () => {
  // 每 3 個 commit 開一條側分支再合併，製造 lane 變化
  const commits: { hash: string; parents: string[] }[] = [];
  const n = SNAPSHOT_INTERVAL * 3 + 7;
  for (let i = 0; i < n; i++) {
    const parents = i + 1 < n ? [`m${i + 1}`] : [];
    if (i % 3 === 0 && i + 5 < n) parents.push(`s${i}`);
    commits.push({ hash: `m${i}`, parents });
    if (i % 3 === 0 && i + 5 < n) commits.push({ hash: `s${i}`, parents: [`m${i + 5}`] });
  }
  const g = new GraphLayout();
  g.add(commits);
  let state: number[] = [];
  for (let i = 0; i <= g.rows.length; i++) {
    assert.deepEqual(g.stateBefore(i), state, `row ${i}`);
    if (i < g.rows.length) state = applyRow(state, g.rows[i]);
  }
});
