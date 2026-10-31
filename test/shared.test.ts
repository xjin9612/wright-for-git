import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLabels, naturalCompare } from '../src/shared/refs';
import { buildTree } from '../src/shared/tree';
import type { RefInfo } from '../src/shared/protocol';

const local = (short: string, hash = 'h'): RefInfo => ({ name: `refs/heads/${short}`, short, type: 'local', hash });
const remote = (short: string, hash = 'h'): RefInfo => {
  const [r, ...rest] = short.split('/');
  return { name: `refs/remotes/${short}`, short, type: 'remote', hash, remote: r, remoteBranch: rest.join('/') };
};
const tag = (short: string, hash = 'h'): RefInfo => ({ name: `refs/tags/${short}`, short, type: 'tag', hash });

test('同名 local 與 remote 合併為「origin & name」', () => {
  const labels = buildLabels([local('release'), remote('origin/release'), remote('origin/master')], { hash: 'x', branch: 'release' }, 'h');
  assert.deepEqual(
    labels.map((l) => [l.text, l.kind, l.current]),
    [
      ['origin & release', 'branch', true],
      ['origin/master', 'remote', false],
    ],
  );
});

test('目前 branch 排第一，tag 最後；detached HEAD 顯示 HEAD', () => {
  const labels = buildLabels([tag('v1'), local('a'), local('b')], { hash: 'h', branch: 'b' }, 'h');
  assert.deepEqual(labels.map((l) => l.text), ['b', 'a', 'v1']);
  const detached = buildLabels([tag('v1')], { hash: 'h' }, 'h');
  assert.deepEqual(detached.map((l) => l.text), ['HEAD', 'v1']);
});

test('naturalCompare', () => {
  assert.deepEqual(['v2.10.0', 'v2.9.1', 'v2.13.1'].sort(naturalCompare), ['v2.9.1', 'v2.10.0', 'v2.13.1']);
});

test('buildTree：資料夾在前、計數、壓縮單一子目錄', () => {
  const paths = ['docs/guides/setup/README.md', 'docs/guides/usage/README.md', 'README.md'];
  const tree = buildTree(paths, (p) => p);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].name, 'docs/guides');
  assert.equal(tree[0].count, 2);
  assert.deepEqual(tree[0].children.map((c) => c.name), ['setup', 'usage']);
  assert.equal(tree[1].item, 'README.md');
});

test('buildTree：不壓縮（branch 樹）', () => {
  const tree = buildTree(['feat/a/x', 'main'], (p) => p, { compress: false });
  assert.equal(tree[0].name, 'feat');
  assert.equal(tree[0].children[0].name, 'a');
});

import { MultiGraph } from '../src/shared/multiGraph';
import { mergeRefs } from '../src/shared/refs';

test('MultiGraph：各 repo 各自佈局，frame 分配不重疊的欄位與直通線', () => {
  const g = new MultiGraph(true);
  // repo0: a2→a1→a0 ; repo1: b1→b0，時間交錯
  g.add([
    { hash: 'a2', parents: ['a1'], repo: 0 },
    { hash: 'b1', parents: ['b0'], repo: 1 },
    { hash: 'a1', parents: ['a0'], repo: 0 },
    { hash: 'b0', parents: [], repo: 1 },
    { hash: 'a0', parents: [], repo: 0 },
  ]);
  assert.deepEqual(g.repoOf, [0, 1, 0, 1, 0]);
  const all = g.frame(0, 5);
  assert.equal(all.offsets.get(0), 0);
  assert.equal(all.offsets.get(1), 1);
  assert.equal(all.lanes, 2);
  // 第 1 列（repo1 的 b1）：repo0 的 lane 0 穿過
  assert.deepEqual(all.rows[1].others, [{ repo: 0, lane: 0, color: 0 }]);
  // 從第 3 列開始：repo0 由 a1 往下延伸
  const tail = g.frame(3, 5);
  assert.deepEqual(tail.rows[0].others.map((o) => o.repo), [0]);
  // 只看最後一列：repo1 已結束，不占欄位
  const last = g.frame(4, 5);
  assert.deepEqual([...last.offsets.keys()], [0]);
});

test('mergeRefs：同名 branch 合併並記錄所屬 repo', () => {
  const st = (root: string, branch: string, refs: string[]) => ({
    root, name: root, head: { branch }, remotes: [],
    refs: refs.map((n) => ({ name: `refs/heads/${n}`, short: n, type: 'local' as const, hash: root + n })),
  });
  const merged = mergeRefs([st('/a', 'main', ['main', 'release']), st('/b', 'release', ['main', 'release', 'only-b'])]);
  const byName = new Map(merged.map((m) => [m.short, m]));
  assert.deepEqual(byName.get('release')!.roots, ['/a', '/b']);
  assert.equal(byName.get('release')!.current, true);
  assert.deepEqual(byName.get('only-b')!.roots, ['/b']);
});
