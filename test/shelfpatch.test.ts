// 擱置的匯出／匯入 patch（真實 git repo）：匯出後再匯入結果相同、依檔名與套用結果判斷 repo、沒有路徑前綴的 patch、套不上時的錯誤
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import * as path from 'node:path';
import { GitRepository } from '../src/git/repository';
import { importAcross, listShelfGroups, matchPatchRepos, patchFileName, shelfNameFromPatch, shelveAcross, unshelveAcross } from '../src/shelf';
import { makeRepo } from './helpers';

async function make(name: string) {
  const r = makeRepo();
  r.commit('init', { 'x.txt': `${name}1\n`, 'gone.txt': 'g\n' });
  const repo = (await GitRepository.open('git', r.dir))!;
  const read = (f: string) => (existsSync(path.join(r.dir, f)) ? readFileSync(path.join(r.dir, f), 'utf8') : undefined);
  return { ...r, repo, read };
}

test('匯出再匯入：成為一筆擱置（不動工作區），取回後與原本的變更相同（修改、刪除、新增檔）', async () => {
  const a = await make('a');
  writeFileSync(path.join(a.dir, 'x.txt'), 'a2\n');
  unlinkSync(path.join(a.dir, 'gone.txt'));
  writeFileSync(path.join(a.dir, 'new.txt'), 'n\n');
  await shelveAcross([{ repo: a.repo, paths: ['x.txt', 'gone.txt', 'new.txt'] }], '功能');
  const [group] = await listShelfGroups([a.repo]);
  const patch = await a.repo.shelfPatch(group.entries[0].shelf);
  await a.repo.dropShelf(group.id);

  const { roots } = await importAcross([{ repo: a.repo, patches: [patch] }], '匯入的功能');
  assert.deepEqual(roots, [a.repo.root]);
  assert.equal(a.read('x.txt'), 'a1\n', '匯入不動工作區');
  const [imported] = await listShelfGroups([a.repo]);
  assert.equal(imported.name, '匯入的功能');
  const files = await a.repo.getStashFiles(imported.entries[0].shelf);
  assert.deepEqual(files.map((f) => `${f.status} ${f.path}`).sort(), ['A new.txt', 'D gone.txt', 'M x.txt']);

  const repoOf = () => a.repo;
  const [o] = await unshelveAcross(imported, repoOf, { paths: new Map([[a.repo.root, files.map((f) => f.path)]]), remove: true });
  assert.deepEqual([o.ok, o.removed], [true, 'dropped']);
  assert.equal(a.read('x.txt'), 'a2\n');
  assert.equal(a.read('gone.txt'), undefined);
  assert.equal(a.read('new.txt'), 'n\n');
});

test('依檔名找 repo；檔名對不上時改用「能否套用」判斷；都套不上時沒有 repo', async () => {
  const a = await make('a');
  const b = await make('b');
  writeFileSync(path.join(a.dir, 'x.txt'), 'a2\n');
  const patch = Buffer.from(a.git('diff', '--binary') + '\n');
  a.git('checkout', '--', 'x.txt');
  const repos = [
    { repo: a.repo, name: 'ms/api' },
    { repo: b.repo, name: 'web' },
  ];
  const matched = await matchPatchRepos(
    [
      { fileName: 'feat-ms_api.patch', patch },
      { fileName: 'feat-web.patch', patch }, // 名稱指向 web，但只能套用到 api
      { fileName: 'other.patch', patch },
      { fileName: 'broken.patch', patch: Buffer.from('not a patch\n') },
    ],
    repos,
  );
  assert.deepEqual(
    matched.map((m) => m.repo?.root),
    [a.repo.root, a.repo.root, a.repo.root, undefined],
  );
});

test('沒有 a/ b/ 前綴的 patch（-p0）也能匯入；套不上 HEAD 時丟出錯誤', async () => {
  const a = await make('a');
  writeFileSync(path.join(a.dir, 'x.txt'), 'a2\n');
  const p0 = Buffer.from(a.git('diff', '--no-prefix') + '\n');
  a.git('checkout', '--', 'x.txt');
  await importAcross([{ repo: a.repo, patches: [p0] }], 'p0');
  const [g] = await listShelfGroups([a.repo]);
  assert.deepEqual((await a.repo.getStashFiles(g.entries[0].shelf)).map((f) => f.path), ['x.txt']);

  // HEAD 已改變，patch 的前後文對不上
  a.commit('change x', { 'x.txt': 'zzz\n' });
  await assert.rejects(a.repo.importShelf('s9', 'x', [p0]), /does not apply/);
});

test('匯入多個 repo 時其中一個失敗：已匯入的刪除，不留下一半', async () => {
  const a = await make('a');
  const b = await make('b');
  writeFileSync(path.join(a.dir, 'x.txt'), 'a2\n');
  const patch = Buffer.from(a.git('diff', '--binary') + '\n');
  a.git('checkout', '--', 'x.txt');
  await assert.rejects(importAcross([{ repo: a.repo, patches: [patch] }, { repo: b.repo, patches: [patch] }], 'x'));
  assert.deepEqual(await listShelfGroups([a.repo, b.repo]), []);
});

test('檔名：匯出依擱置與 repo 名稱命名（不合法字元換掉）；匯入時還原擱置名稱', () => {
  assert.equal(patchFileName('功能 X', 'ms/api', false), '功能 X.patch');
  assert.equal(patchFileName('a/b: c', 'ms/api', true), 'a_b_ c-ms_api.patch');
  assert.equal(shelfNameFromPatch('功能 X-ms_api.patch', 'ms/api'), '功能 X');
  assert.equal(shelfNameFromPatch('fix.diff'), 'fix');
});
