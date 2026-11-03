// Shelf 的 git 層（對真實 git repository）：擱置、清單、取回（整筆／部分）、衝突、改名、刪除、匯出 patch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import * as path from 'node:path';
import { GitRepository } from '../src/git/repository';
import { buildPatch, parseFileDiff } from '../src/git/parsers';
import { makeRepo } from './helpers';

/** 建立有一個 commit 的 repo，並在工作區留下三種變更：修改、刪除、未追蹤；另有一個不擱置的修改 */
async function setup() {
  const r = makeRepo();
  r.commit('init', { 'a.txt': 'a1\n', 'b.txt': 'b1\n', 'keep.txt': 'k1\n', 'gone.txt': 'g\n' });
  writeFileSync(path.join(r.dir, 'a.txt'), 'a2\n');
  writeFileSync(path.join(r.dir, 'keep.txt'), 'k2\n');
  writeFileSync(path.join(r.dir, 'new.txt'), 'n\n');
  unlinkSync(path.join(r.dir, 'gone.txt'));
  const repo = (await GitRepository.open('git', r.dir))!;
  const read = (f: string) => readFileSync(path.join(r.dir, f), 'utf8');
  return { ...r, repo, read };
}

test('擱置選取的檔案（含刪除與未追蹤）：從工作區移除、不出現在 stash 清單；取回後恢復', async () => {
  const { repo, git, read, dir } = await setup();
  const hash = await repo.shelve('s1', '功能 X', ['a.txt', 'gone.txt', 'new.txt']);
  assert.ok(hash);
  assert.equal(read('a.txt'), 'a1\n');
  assert.ok(existsSync(path.join(dir, 'gone.txt')), '刪除被擱置，檔案回來');
  assert.ok(!existsSync(path.join(dir, 'new.txt')), '未追蹤檔案被擱置');
  assert.equal(read('keep.txt'), 'k2\n', '沒選的變更不動');
  assert.equal(git('stash', 'list'), '', '不在 stash 清單');

  const [shelf] = await repo.listShelves();
  assert.equal(shelf.id, 's1');
  assert.equal(shelf.name, '功能 X');
  assert.equal(shelf.hash, hash);
  const files = await repo.getStashFiles(shelf);
  assert.deepEqual(files.map((f) => `${f.status} ${f.path}${f.untracked ? ' (untracked)' : ''}`).sort(), ['A new.txt (untracked)', 'D gone.txt', 'M a.txt']);

  await repo.unshelve(shelf);
  assert.equal(read('a.txt'), 'a2\n');
  assert.ok(!existsSync(path.join(dir, 'gone.txt')));
  assert.equal(read('new.txt'), 'n\n');
  assert.equal((await repo.listShelves()).length, 1, '取回不會自動刪除');
});

test('沒選的已暫存檔案不會被記進擱置，也留在暫存區（git stash push 會記下整個暫存區）', async () => {
  const { repo, git, dir, read } = await setup();
  writeFileSync(path.join(dir, 'staged.txt'), 's\n');
  git('add', 'staged.txt');
  git('add', 'keep.txt');
  await repo.shelve('s1', 'x', ['a.txt']);
  const [shelf] = await repo.listShelves();
  assert.deepEqual((await repo.getStashFiles(shelf)).map((f) => `${f.status} ${f.path}`), ['M a.txt'], '只有選的檔案');
  assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').sort(), ['keep.txt', 'staged.txt'], '沒選的仍在暫存區');
  assert.equal(read('a.txt'), 'a1\n');
  await repo.unshelve(shelf, ['a.txt']);
  assert.equal(read('a.txt'), 'a2\n');
  // keepChanges 也只記選的檔案
  await repo.shelve('s2', 'y', ['a.txt'], true);
  const s2 = (await repo.listShelves()).find((s) => s.id === 's2')!;
  assert.deepEqual((await repo.getStashFiles(s2)).map((f) => f.path), ['a.txt']);
  assert.equal(read('a.txt'), 'a2\n');
});

test('沒有可擱置的變更時回傳 undefined，不留下任何 ref', async () => {
  const { repo } = await setup();
  assert.equal(await repo.shelve('s1', 'x', ['b.txt']), undefined);
  assert.deepEqual(await repo.listShelves(), []);
});

test('keepChanges：擱置後工作區保持原樣', async () => {
  const { repo, read, dir } = await setup();
  assert.ok(await repo.shelve('s1', 'x', ['a.txt', 'new.txt'], true));
  assert.equal(read('a.txt'), 'a2\n');
  assert.ok(existsSync(path.join(dir, 'new.txt')));
  assert.equal((await repo.listShelves()).length, 1);
});

test('只取回部分檔案：已追蹤與未追蹤分別取回；未追蹤檔案已存在時中止', async () => {
  const { repo, read, dir } = await setup();
  await repo.shelve('s1', 'x', ['a.txt', 'new.txt']);
  const [shelf] = await repo.listShelves();
  await repo.unshelve(shelf, ['a.txt']);
  assert.equal(read('a.txt'), 'a2\n');
  assert.ok(!existsSync(path.join(dir, 'new.txt')), '沒選的未追蹤檔案不取回');
  await repo.unshelve(shelf, ['new.txt']);
  assert.equal(read('new.txt'), 'n\n');
  await assert.rejects(repo.unshelve(shelf, ['new.txt']), /Already exists/);
});

test('工作區有同一檔案未提交的修改時，整筆與部分取回都中止（不覆蓋）', async () => {
  const { repo, read } = await setup();
  await repo.shelve('s1', 'x', ['a.txt']);
  writeFileSync(path.join(repo.root, 'a.txt'), 'a3\n');
  const [shelf] = await repo.listShelves();
  await assert.rejects(repo.unshelve(shelf));
  await assert.rejects(repo.unshelve(shelf, ['a.txt']));
  assert.equal(read('a.txt'), 'a3\n', '未提交的修改保留');
});

test('部分取回遇到衝突時留下衝突標記', async () => {
  const { repo, read, git } = await setup();
  await repo.shelve('s1', 'x', ['a.txt']);
  // 已提交的內容與 shelf 衝突（工作區乾淨，三方合併才會寫入衝突標記）
  writeFileSync(path.join(repo.root, 'a.txt'), 'a3\n');
  git('commit', '-q', '-am', 'change a');
  const [shelf] = await repo.listShelves();
  await assert.rejects(repo.unshelve(shelf, ['a.txt']));
  assert.match(read('a.txt'), /^<<<<<<< /m);
});

test('改名保留內容與時間；刪除移除 ref', async () => {
  const { repo } = await setup();
  await repo.shelve('s1', '舊名', ['a.txt', 'new.txt']);
  const [before] = await repo.listShelves();
  await repo.renameShelf('s1', '新名稱');
  const [after] = await repo.listShelves();
  assert.equal(after.name, '新名稱');
  assert.equal(after.time, before.time);
  assert.deepEqual(after.parents, before.parents);
  assert.deepEqual(await repo.getStashFiles(after), await repo.getStashFiles(before));
  await repo.dropShelf('s1');
  assert.deepEqual(await repo.listShelves(), []);
});

test('匯出 patch：在乾淨的工作區以 git apply 套用，得到相同的變更（含未追蹤檔案與刪除）', async () => {
  const { repo, read, git, dir } = await setup();
  await repo.shelve('s1', 'x', ['a.txt', 'gone.txt', 'new.txt']);
  const [shelf] = await repo.listShelves();
  const patch = await repo.shelfPatch(shelf);
  const file = path.join(dir, '..', `${path.basename(dir)}.patch`);
  writeFileSync(file, patch);
  git('checkout', '-q', '--', 'keep.txt');
  git('apply', file);
  assert.equal(read('a.txt'), 'a2\n');
  assert.equal(read('new.txt'), 'n\n');
  assert.ok(!existsSync(path.join(dir, 'gone.txt')));
});

test('從擱置移除部分檔案：重建後只剩其餘檔案、時間不變、不動工作區；全部移除時整筆刪除', async () => {
  const { repo, read } = await setup();
  await repo.shelve('s1', 'x', ['a.txt', 'gone.txt', 'new.txt']);
  const [before] = await repo.listShelves();
  assert.equal(await repo.removeFromShelf('s1', ['a.txt', 'new.txt']), 'kept');
  const [after] = await repo.listShelves();
  assert.equal(after.name, 'x');
  assert.equal(after.time, before.time);
  assert.deepEqual((await repo.getStashFiles(after)).map((f) => `${f.status} ${f.path}`), ['D gone.txt'], '只剩刪除的檔案，未追蹤的 parent 也移除');
  assert.equal(after.parents.length, 2, '沒有未追蹤檔案時只有兩個 parent');
  assert.equal(read('a.txt'), 'a1\n', '不動工作區');
  // 剩下的仍可取回
  await repo.unshelve(after, ['gone.txt']);
  assert.equal(await repo.removeFromShelf('s1', ['gone.txt']), 'dropped');
  assert.deepEqual(await repo.listShelves(), []);
});

/** 有兩段相隔很遠修改的檔案，回傳只含第一段的 patch（與提交視窗逐段選取相同的組法） */
async function twoHunks() {
  const r = await setup();
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  // 只提交 m.txt（setup 留下的其他修改要保留在工作區）
  writeFileSync(path.join(r.dir, 'm.txt'), `${lines.join('\n')}\n`);
  r.git('add', 'm.txt');
  r.git('commit', '-q', '-m', 'add m');
  const changed = [...lines];
  changed[1] = 'line 2 CHANGED';
  changed[17] = 'line 18 CHANGED';
  writeFileSync(path.join(r.dir, 'm.txt'), `${changed.join('\n')}\n`);
  const raw = await r.repo.rawFileDiff('m.txt');
  const d = parseFileDiff(raw.toString('latin1'));
  assert.equal(d.hunks.length, 2);
  const first = Buffer.from(buildPatch(d.header, d.hunks, new Set([d.hunks[0].index]))!, 'latin1');
  return { ...r, first };
}

test('只擱置部分段落：只有選的段落進擱置並從工作區移除，另一段留著；取回後兩段都在', async () => {
  const { repo, read, first } = await twoHunks();
  assert.ok(await repo.shelve('p1', 'part', ['a.txt'], false, [{ path: 'm.txt', patch: first }]));
  assert.doesNotMatch(read('m.txt'), /line 2 CHANGED/, '選的段落移除');
  assert.match(read('m.txt'), /line 18 CHANGED/, '沒選的段落留著');
  assert.equal(read('a.txt'), 'a1\n', '整個檔案的部分也擱置');
  const [shelf] = await repo.listShelves();
  assert.deepEqual((await repo.getStashFiles(shelf)).map((f) => f.path).sort(), ['a.txt', 'm.txt']);
  const patch = (await repo.shelfPatch(shelf)).toString('utf8');
  assert.match(patch, /line 2 CHANGED/);
  assert.doesNotMatch(patch, /line 18 CHANGED/, '擱置只有選的段落');
  await repo.unshelve(shelf, ['a.txt', 'm.txt']);
  assert.match(read('m.txt'), /line 2 CHANGED/);
  assert.match(read('m.txt'), /line 18 CHANGED/);
  assert.equal(read('a.txt'), 'a2\n');
});

test('只擱置部分段落（沒有整個檔案）；keepChanges 時工作區不動', async () => {
  const { repo, read, first } = await twoHunks();
  assert.ok(await repo.shelve('p1', 'only part', [], true, [{ path: 'm.txt', patch: first }]));
  assert.match(read('m.txt'), /line 2 CHANGED/, 'keepChanges：工作區不動');
  const [shelf] = await repo.listShelves();
  assert.equal(shelf.name, 'only part');
  assert.deepEqual((await repo.getStashFiles(shelf)).map((f) => f.path), ['m.txt']);
});

test('部分段落無法從工作區移除時什麼都不做：沒有擱置、工作區不變（整個檔案的部分也不動）', async () => {
  const { repo, read, first, dir } = await twoHunks();
  // 選段落之後檔案又改了那一段
  writeFileSync(path.join(dir, 'm.txt'), read('m.txt').replace('line 2 CHANGED', 'line 2 AGAIN'));
  await assert.rejects(repo.shelve('p1', 'x', ['a.txt'], false, [{ path: 'm.txt', patch: first }]));
  assert.deepEqual(await repo.listShelves(), []);
  assert.match(read('m.txt'), /line 2 AGAIN/);
  assert.equal(read('a.txt'), 'a2\n');
});

test('拒絕不合法的 id 與路徑', async () => {
  const { repo } = await setup();
  await assert.rejects(repo.shelve('../x', 'x', ['a.txt']), /Invalid shelf id/);
  await assert.rejects(repo.shelve('s1', 'x', ['../a.txt']), /Invalid path/);
  await assert.rejects(repo.dropShelf('-d'), /Invalid shelf id/);
});
