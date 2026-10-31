// 對真實 git repository 的整合測試
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitRepository } from '../src/git/repository';
import { EMPTY_FILTER, type CommitInfo, type LogFilter } from '../src/shared/protocol';
import { GraphLayout } from '../src/shared/graph';
import { makeRepo } from './helpers';

async function collect(repo: GitRepository, filter: LogFilter): Promise<CommitInfo[]> {
  const out: CommitInfo[] = [];
  await repo.streamLog(filter, 1000, (b) => out.push(...b));
  return out;
}

test('完整流程：state、log、篩選、詳情、變更檔案、containing', async () => {
  const { dir, git, commit } = makeRepo();
  const base = commit('init', { 'src/a.txt': 'a', 'README.md': 'r' });
  git('checkout', '-q', '-b', 'feat/x');
  commit('feat: 新增 x 功能', { 'src/x.txt': 'x' });
  git('mv', 'src/a.txt', 'src/renamed.txt');
  git('commit', '-q', '-m', 'refactor: rename a');
  const renamed = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  commit('fix(ui): 修正按鈕對齊', { 'README.md': 'r2' });
  git('merge', '-q', '--no-ff', '-m', 'Merge feat/x', 'feat/x');
  git('tag', '-a', 'v1.0.0', '-m', 'release');
  git('-c', 'user.name=Other', '-c', 'user.email=o@x', 'commit', '-q', '--allow-empty', '-m', 'chore: other author', '--author=bob.dev <bob@x>');

  const repo = (await GitRepository.open('git', dir))!;
  assert.ok(repo);

  const state = await repo.getState();
  assert.equal(state.head.branch, 'main');
  assert.deepEqual(state.refs.filter((r) => r.type === 'local').map((r) => r.short).sort(), ['feat/x', 'main']);
  const tagRef = state.refs.find((r) => r.type === 'tag')!;
  assert.equal(tagRef.short, 'v1.0.0');
  assert.equal(tagRef.hash, git('rev-parse', 'v1.0.0^{commit}'), 'annotated tag 應 peel 到 commit');

  const all = await collect(repo, EMPTY_FILTER);
  assert.equal(all.length, 6);
  assert.equal(all[0].subject, 'chore: other author');
  assert.equal(all[0].author, 'bob.dev');
  assert.equal(all[0].committer, 'Other');
  assert.equal(all.at(-1)!.hash, base);
  // topo 順序：每個 commit 都在 parent 之前
  const pos = new Map(all.map((c, i) => [c.hash, i]));
  for (const c of all) for (const p of c.parents) assert.ok(pos.get(p)! > pos.get(c.hash)!);

  const g = new GraphLayout();
  g.add(all);
  assert.ok(Math.max(...g.rows.map((r) => r.width)) >= 2, 'merge 應產生兩條 lane');

  // 中文文字篩選
  const byText = await collect(repo, { ...EMPTY_FILTER, text: '按鈕' });
  assert.deepEqual(byText.map((c) => c.subject), ['fix(ui): 修正按鈕對齊']);
  // 特殊字元在非 regex 模式下視為字面
  const literal = await collect(repo, { ...EMPTY_FILTER, text: 'fix(ui)' });
  assert.equal(literal.length, 1);
  // 大小寫
  assert.equal((await collect(repo, { ...EMPTY_FILTER, text: 'FIX(UI)' })).length, 1);
  assert.equal((await collect(repo, { ...EMPTY_FILTER, text: 'FIX(UI)', matchCase: true })).length, 0);
  // regex
  assert.equal((await collect(repo, { ...EMPTY_FILTER, text: '^(feat|fix)', regex: true })).length, 2);
  // 作者（多值 OR）＋文字（AND）
  assert.equal((await collect(repo, { ...EMPTY_FILTER, users: ['bob'] })).length, 1);
  assert.equal((await collect(repo, { ...EMPTY_FILTER, users: ['bob', 'alice'] })).length, 6);
  assert.equal((await collect(repo, { ...EMPTY_FILTER, users: ['alice'], text: 'other' })).length, 0);
  // branch 篩選
  const feat = await collect(repo, { ...EMPTY_FILTER, branches: ['refs/heads/feat/x'] });
  assert.equal(feat.length, 3);
  // paths 篩選：只有動到 src/ 的 commit，且 parent 已改寫（graph 連續）
  const bySrc = await collect(repo, { ...EMPTY_FILTER, paths: ['src'] });
  assert.deepEqual(bySrc.map((c) => c.subject), ['refactor: rename a', 'feat: 新增 x 功能', 'init']);
  const inSet = new Set(bySrc.map((c) => c.hash));
  for (const c of bySrc) for (const p of c.parents) assert.ok(inSet.has(p), `parent ${p} 應在結果中`);
  assert.deepEqual((await repo.listDirectories()).sort(), ['src']);
  // hash 搜尋：放在最前面
  const byHash = await collect(repo, { ...EMPTY_FILTER, text: renamed.slice(0, 8) });
  assert.equal(byHash[0].hash, renamed);

  // 詳情與 rename
  const d = await repo.getDetails(renamed);
  assert.equal(d.message, 'refactor: rename a');
  assert.deepEqual(d.files, [{ status: 'R', path: 'src/renamed.txt', oldPath: 'src/a.txt' }]);
  // root commit
  const root = await repo.getDetails(base);
  assert.deepEqual(root.files.map((f) => f.status + ' ' + f.path), ['A README.md', 'A src/a.txt']);
  // merge commit：對第一個 parent 的差異
  const merge = all.find((c) => c.subject === 'Merge feat/x')!;
  const mergeFiles = await repo.getChangedFiles(merge.hash, merge.parents);
  assert.deepEqual(mergeFiles.map((f) => f.path).sort(), ['src/renamed.txt', 'src/x.txt']);

  assert.deepEqual((await repo.getContainingBranches(renamed)).sort(), ['feat/x', 'main']);
  const users = await repo.getUsers();
  assert.deepEqual(users.map((u) => u.name), ['Alice', 'bob.dev']);

  assert.equal((await repo.showFile(base, 'src/a.txt')).toString('utf8'), 'a');
  assert.equal((await repo.showFile(base, 'nope.txt')).length, 0);

  await repo.checkout('feat/x');
  assert.equal((await repo.getState()).head.branch, 'feat/x');
});

test('非 git 資料夾回傳 undefined', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(require('node:path').join(tmpdir(), 'nogit-'));
  assert.equal(await GitRepository.open('git', dir), undefined);
});

test('simplifiedParents：篩選結果之間以最近的符合祖先相連', async () => {
  const r = makeRepo();
  const a = r.commit('feat: a');
  r.commit('chore: x');
  const b = r.commit('feat: b');
  r.git('checkout', '-q', '-b', 'side', a);
  r.commit('chore: y');
  const c = r.commit('feat: c');
  r.git('checkout', '-q', 'main');
  r.git('merge', '-q', '--no-ff', '-m', 'chore: merge', 'side');
  const d = r.commit('feat: d');
  const repo = (await GitRepository.open('git', r.dir))!;
  const map = (await repo.simplifiedParents(EMPTY_FILTER, new Set([a, b, c, d]), 1000))!;
  assert.deepEqual(map.get(a), []);
  assert.deepEqual(map.get(b), [a]);
  assert.deepEqual(map.get(c), [a]);
  // d 經過 merge commit（不符合）連到 b 與 c
  assert.deepEqual(new Set(map.get(d)), new Set([b, c]));
  assert.equal(await repo.simplifiedParents(EMPTY_FILTER, new Set([a]), 2), undefined, '超過上限時不計算');
});
