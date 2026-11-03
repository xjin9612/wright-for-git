// Shelf 的跨 repo 協調（兩個真實 git repo）：一起擱置、清單合併、中途失敗還原、逐 repo 取回與結果
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { GitRepository } from '../src/git/repository';
import { dropShelfGroup, listShelfGroups, renameShelfGroup, shelveAcross, ShelveError, unshelveAcross, type ShelfGroup } from '../src/shelf';
import { makeRepo } from './helpers';

/** 兩個 repo，各有一個修改、一個未追蹤檔案與一個沒有變更的檔案 */
async function setup() {
  const make = async (name: string) => {
    const r = makeRepo();
    r.commit('init', { 'x.txt': `${name}1\n`, 'same.txt': 'same\n' });
    writeFileSync(path.join(r.dir, 'x.txt'), `${name}2\n`);
    writeFileSync(path.join(r.dir, 'new.txt'), `${name}-new\n`);
    const repo = (await GitRepository.open('git', r.dir))!;
    const read = (f: string) => (existsSync(path.join(r.dir, f)) ? readFileSync(path.join(r.dir, f), 'utf8') : undefined);
    return { ...r, repo, read };
  };
  const a = await make('a');
  const b = await make('b');
  const repoOf = (root: string) => [a.repo, b.repo].find((r) => r.root === root);
  return { a, b, repoOf, repos: [a.repo, b.repo] };
}

/** 每個 repo 的全部檔案（rename 含原路徑） */
async function allPaths(group: ShelfGroup, repoOf: (root: string) => GitRepository | undefined, roots?: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  for (const e of group.entries) {
    if (roots && !roots.includes(e.root)) continue;
    const files = await repoOf(e.root)!.getStashFiles(e.shelf);
    m.set(e.root, files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])));
  }
  return m;
}

test('跨兩個 repo 一起擱置：清單合併成一筆；整筆取回後兩邊都恢復並移除', async () => {
  const { a, b, repoOf, repos } = await setup();
  const { id, roots } = await shelveAcross(
    [
      { repo: a.repo, paths: ['x.txt', 'new.txt'] },
      { repo: b.repo, paths: ['x.txt', 'new.txt'] },
    ],
    '功能 X',
  );
  assert.deepEqual(roots, [a.repo.root, b.repo.root]);
  assert.equal(a.read('x.txt'), 'a1\n');
  assert.equal(b.read('new.txt'), undefined);

  const [group, ...rest] = await listShelfGroups(repos);
  assert.equal(rest.length, 0);
  assert.equal(group.id, id);
  assert.equal(group.name, '功能 X');
  assert.deepEqual(group.entries.map((e) => e.root), [a.repo.root, b.repo.root]);

  const outcomes = await unshelveAcross(group, repoOf, { paths: await allPaths(group, repoOf), remove: true });
  assert.deepEqual(outcomes.map((o) => [o.ok, o.removed]), [[true, 'dropped'], [true, 'dropped']]);
  assert.equal(a.read('x.txt'), 'a2\n');
  assert.equal(b.read('new.txt'), 'b-new\n');
  assert.deepEqual(await listShelfGroups(repos), []);
});

test('沒有變更可擱置的 repo 不列入；全部都沒有時 roots 為空', async () => {
  const { a, b, repos } = await setup();
  const r1 = await shelveAcross([{ repo: a.repo, paths: ['x.txt'] }, { repo: b.repo, paths: ['same.txt'] }], 'x');
  assert.deepEqual(r1.roots, [a.repo.root]);
  const r2 = await shelveAcross([{ repo: b.repo, paths: ['same.txt'] }], 'y');
  assert.deepEqual(r2.roots, []);
  assert.equal((await listShelfGroups(repos)).length, 1);
});

test('中途失敗：已擱置的 repo 還原、刪除 ref，丟出 ShelveError（指出失敗的 repo）', async () => {
  const { a, b, repos } = await setup();
  await assert.rejects(
    shelveAcross([{ repo: a.repo, paths: ['x.txt', 'new.txt'] }, { repo: b.repo, paths: ['../escape.txt'] }], 'x'),
    (e: unknown) => e instanceof ShelveError && e.root === b.repo.root && e.rollbackErrors.length === 0,
  );
  assert.equal(a.read('x.txt'), 'a2\n', 'a 的變更還原');
  assert.equal(a.read('new.txt'), 'a-new\n');
  assert.deepEqual(await listShelfGroups(repos), []);
});

test('keepChanges：中途失敗時只刪除 ref，工作區本來就沒動', async () => {
  const { a, b, repos } = await setup();
  await assert.rejects(shelveAcross([{ repo: a.repo, paths: ['x.txt'] }, { repo: b.repo, paths: ['../escape.txt'] }], 'x', { keepChanges: true }), ShelveError);
  assert.equal(a.read('x.txt'), 'a2\n');
  assert.deepEqual(await listShelfGroups(repos), []);
});

test('取回時某個 repo 衝突：其他 repo 照常；衝突的檔案已套用（留下標記）並從擱置移除，未追蹤檔案也還原', async () => {
  const { a, b, repoOf, repos } = await setup();
  await shelveAcross([{ repo: a.repo, paths: ['x.txt'] }, { repo: b.repo, paths: ['x.txt', 'new.txt'] }], 'x');
  // b 提交了與 shelf 衝突的內容
  writeFileSync(path.join(b.dir, 'x.txt'), 'b3\n');
  b.git('commit', '-q', '-am', 'change x');
  const [group] = await listShelfGroups(repos);
  const outcomes = await unshelveAcross(group, repoOf, { paths: await allPaths(group, repoOf), remove: true });
  assert.deepEqual([outcomes[0].ok, outcomes[0].removed], [true, 'dropped']);
  assert.deepEqual([outcomes[1].ok, outcomes[1].conflict, outcomes[1].removed], [false, true, 'dropped']);
  assert.match(b.read('x.txt') ?? '', /^<<<<<<< /m);
  assert.equal(b.read('new.txt'), 'b-new\n', '衝突時未追蹤檔案仍還原');
  assert.deepEqual(await listShelfGroups(repos), []);
  // 衝突畫面標示擱置的名稱
  assert.equal((await b.repo.conflictLabels()).theirs, 'x');
});

test('取回失敗（工作區有同一檔案的修改、沒有套用任何東西）：不從擱置移除', async () => {
  const { a, repoOf, repos } = await setup();
  await shelveAcross([{ repo: a.repo, paths: ['x.txt', 'new.txt'] }], 'x');
  writeFileSync(path.join(a.dir, 'x.txt'), 'local\n');
  const [group] = await listShelfGroups(repos);
  const [o] = await unshelveAcross(group, repoOf, { paths: await allPaths(group, repoOf), remove: true });
  assert.deepEqual([o.ok, o.conflict, o.removed], [false, undefined, undefined]);
  assert.equal(a.read('x.txt'), 'local\n');
  assert.equal(a.read('new.txt'), undefined, '沒有套用一半');
  assert.equal((await listShelfGroups(repos)).length, 1);
});

test('只取回部分檔案：取回的從擱置移除、其餘保留；不移除時全部保留；已存在的未追蹤檔案可覆蓋', async () => {
  const { a, b, repoOf, repos } = await setup();
  await shelveAcross([{ repo: a.repo, paths: ['x.txt', 'new.txt'] }, { repo: b.repo, paths: ['x.txt'] }], 'x');
  let [group] = await listShelfGroups(repos);
  const partial = await unshelveAcross(group, repoOf, { paths: new Map([[a.repo.root, ['new.txt']]]), remove: true });
  assert.deepEqual(partial.map((o) => [o.root, o.ok, o.removed]), [[a.repo.root, true, 'kept']]);
  assert.equal(a.read('new.txt'), 'a-new\n');
  assert.equal(a.read('x.txt'), 'a1\n');
  assert.equal(b.read('x.txt'), 'b1\n', '沒選的 repo 不動');
  [group] = await listShelfGroups(repos);
  const aFiles = await a.repo.getStashFiles(group.entries[0].shelf);
  assert.deepEqual(aFiles.map((f) => f.path), ['x.txt'], 'a 的擱置只剩 x.txt');

  const kept = await unshelveAcross(group, repoOf, { paths: await allPaths(group, repoOf, [b.repo.root]), remove: false });
  assert.deepEqual(kept.map((o) => [o.ok, o.removed]), [[true, undefined]]);
  assert.equal(b.read('x.txt'), 'b2\n');
  assert.equal((await listShelfGroups(repos))[0].entries.length, 2);

  // 再次擱置 a 的未追蹤檔案，工作區又建立同名檔案：預設中止，overwrite 時覆蓋
  await shelveAcross([{ repo: a.repo, paths: ['new.txt'] }], 'y');
  writeFileSync(path.join(a.dir, 'new.txt'), 'mine\n');
  const y = (await listShelfGroups(repos)).find((g) => g.name === 'y')!;
  const [refused] = await unshelveAcross(y, repoOf, { paths: new Map([[a.repo.root, ['new.txt']]]), remove: true });
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? '', /Already exists/);
  const [over] = await unshelveAcross(y, repoOf, { paths: new Map([[a.repo.root, ['new.txt']]]), remove: true, overwrite: true });
  assert.deepEqual([over.ok, over.removed], [true, 'dropped']);
  assert.equal(a.read('new.txt'), 'a-new\n');
});

test('改名與刪除套用到每個 repo', async () => {
  const { a, b, repoOf, repos } = await setup();
  await shelveAcross([{ repo: a.repo, paths: ['x.txt'] }, { repo: b.repo, paths: ['x.txt'] }], '舊名');
  let [group] = await listShelfGroups(repos);
  await renameShelfGroup(group, '新名', repoOf);
  [group] = await listShelfGroups(repos);
  assert.equal(group.name, '新名');
  assert.deepEqual(await Promise.all(repos.map(async (r) => (await r.listShelves())[0].name)), ['新名', '新名']);
  await dropShelfGroup(group, repoOf, [a.repo.root]);
  assert.deepEqual((await listShelfGroups(repos))[0].entries.map((e) => e.root), [b.repo.root]);
  await dropShelfGroup(group, repoOf);
  assert.deepEqual(await listShelfGroups(repos), []);
});
