// 1.1.0：同步與 commit 操作（對真實 git repository 與本機 bare remote）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { parseRefs, parseTrack } from '../src/git/parsers';
import { GitRepository } from '../src/git/repository';
import { makeRepo } from './helpers';

/** 建立 bare remote 與兩個 clone（模擬兩台電腦） */
function remoteSetup() {
  const a = makeRepo();
  a.commit('init', { 'a.txt': '1\n' });
  const bare = mkdtempSync(path.join(tmpdir(), 'bare-'));
  execFileSync('git', ['clone', '-q', '--bare', a.dir, bare]);
  a.git('remote', 'add', 'origin', bare);
  a.git('fetch', '-q', 'origin');
  a.git('branch', '-q', '--set-upstream-to=origin/main', 'main');
  const bDir = mkdtempSync(path.join(tmpdir(), 'clone-'));
  execFileSync('git', ['clone', '-q', bare, bDir]);
  const b = (...args: string[]) => execFileSync('git', args, { cwd: bDir, encoding: 'utf8' }).trim();
  b('config', 'user.name', 'Other');
  b('config', 'user.email', 'o@x');
  return { a, bare, bDir, b };
}

test('parseTrack：ahead／behind／gone', () => {
  assert.deepEqual(parseTrack('[ahead 2, behind 3]'), { ahead: 2, behind: 3 });
  assert.deepEqual(parseTrack('[ahead 1]'), { ahead: 1 });
  assert.deepEqual(parseTrack('[gone]'), { gone: true });
  assert.deepEqual(parseTrack(''), {});
  const refs = parseRefs(['refs/heads/main', 'h', '', 'origin/main', '', '[behind 4]'].join('\0'), ['origin']);
  assert.equal(refs[0].behind, 4);
});

test('fetch／pull／push 與 ahead／behind', async () => {
  const { a, bDir, b } = remoteSetup();
  const repo = (await GitRepository.open('git', a.dir))!;

  // 本機領先 1
  a.commit('local work', { 'b.txt': 'x' });
  let main = (await repo.getState()).refs.find((r) => r.name === 'refs/heads/main')!;
  assert.equal(main.ahead, 1);
  await repo.pushTo('origin', 'refs/heads/main', 'main');
  main = (await repo.getState()).refs.find((r) => r.name === 'refs/heads/main')!;
  assert.equal(main.ahead, undefined);

  // 另一台推了新 commit → fetch 後落後 1 → pull 後同步
  writeFileSync(path.join(bDir, 'c.txt'), 'y');
  b('pull', '-q');
  b('add', '-A');
  b('commit', '-qm', 'from other');
  b('push', '-q');
  await repo.fetch();
  main = (await repo.getState()).refs.find((r) => r.name === 'refs/heads/main')!;
  assert.equal(main.behind, 1);
  await repo.pull();
  main = (await repo.getState()).refs.find((r) => r.name === 'refs/heads/main')!;
  assert.equal(main.behind, undefined);
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: a.dir, encoding: 'utf8' }).trim(), 'from other');
});

test('push 預覽：目標、待推 commit、新 branch、落後與 up to here', async () => {
  const { a, b } = remoteSetup();
  const repo = (await GitRepository.open('git', a.dir))!;

  let plan = await repo.getPushPlan();
  assert.equal(plan.branch, 'main');
  assert.equal(plan.remote, 'origin');
  assert.equal(plan.remoteBranch, 'main');
  assert.equal(plan.hasUpstream, true);
  assert.equal(plan.isNew, false);
  assert.equal(plan.total, 0);

  const c1 = a.commit('one');
  const c2 = a.commit('two');
  plan = await repo.getPushPlan();
  assert.equal(plan.total, 2);
  assert.deepEqual(plan.commits.map((c) => c.subject), ['two', 'one']);
  assert.equal(plan.commits[0].hash, c2);
  assert.deepEqual(plan.commits[0].parents, [c1]);

  // 只推到 c1
  plan = await repo.getPushPlan({ upTo: c1 });
  assert.equal(plan.total, 1);
  assert.equal(plan.commits[0].hash, c1);
  await repo.pushTo('origin', c1, 'main');
  plan = await repo.getPushPlan();
  assert.equal(plan.total, 1);

  // 不在目前 branch 上的 commit
  a.git('branch', '-q', 'side', c1);
  a.git('checkout', '-q', 'side');
  const side = a.commit('side work');
  a.git('checkout', '-q', 'main');
  assert.equal((await repo.getPushPlan({ upTo: side })).problem, 'notAncestor');

  // 遠端有本機沒有的 commit → behind
  b('pull', '-q');
  b('commit', '-q', '--allow-empty', '-m', 'from other');
  b('push', '-q');
  await repo.fetch();
  plan = await repo.getPushPlan();
  assert.equal(plan.behind, 1);

  // 新 branch：沒有 upstream、遠端也沒有
  a.git('checkout', '-q', 'side');
  plan = await repo.getPushPlan();
  assert.equal(plan.hasUpstream, false);
  assert.equal(plan.isNew, true);
  assert.equal(plan.remoteBranch, 'side');
  assert.deepEqual(plan.commits.map((c) => c.subject), ['side work']);
  // 改目標名稱
  plan = await repo.getPushPlan({ remoteBranch: 'feature/renamed' });
  assert.equal(plan.remoteBranch, 'feature/renamed');
  assert.equal((await repo.getPushPlan({ remoteBranch: 'bad..name' })).problem, 'error');

  // detached
  a.git('checkout', '-q', '--detach');
  assert.equal((await repo.getPushPlan()).problem, 'detached');
});

test('pushTo：設定 upstream、tags、force-with-lease 與參數驗證', async () => {
  const { a, bare, b } = remoteSetup();
  const repo = (await GitRepository.open('git', a.dir))!;
  a.git('checkout', '-q', '-b', 'feat/x');
  a.commit('feature', { 'f.txt': '1' });
  a.git('tag', '-a', '-m', 'release', 'v9');
  await repo.pushTo('origin', 'refs/heads/feat/x', 'feat/x', { setUpstream: true, tags: true });
  const feat = (await repo.getState()).refs.find((r) => r.name === 'refs/heads/feat/x')!;
  assert.equal(feat.upstream, 'origin/feat/x');
  assert.match(execFileSync('git', ['tag'], { cwd: bare, encoding: 'utf8' }), /v9/);

  // 改寫歷史：一般 push 被拒，force-with-lease 成功
  a.git('commit', '-q', '--amend', '-m', 'feature (amended)');
  await assert.rejects(repo.pushTo('origin', 'refs/heads/feat/x', 'feat/x'), '一般 push 應被拒絕（non-fast-forward）');
  await repo.pushTo('origin', 'refs/heads/feat/x', 'feat/x', { force: true });

  // 遠端被別人更新（本機沒 fetch）→ force-with-lease 應被拒絕，不覆蓋
  b('fetch', '-q');
  b('checkout', '-q', 'feat/x');
  b('commit', '-q', '--allow-empty', '-m', 'someone else');
  b('push', '-q');
  a.git('commit', '-q', '--amend', '-m', 'feature (amended again)');
  await assert.rejects(repo.pushTo('origin', 'refs/heads/feat/x', 'feat/x', { force: true }));
  assert.match(b('log', '-1', '--format=%s', 'origin/feat/x'), /someone else/);

  // 參數驗證：未知 remote、不合法 branch、選項注入
  await assert.rejects(repo.pushTo('nope', 'refs/heads/feat/x', 'feat/x'), /Unknown remote/);
  await assert.rejects(repo.pushTo('origin', 'refs/heads/feat/x', '--force'), /Invalid branch/);
  await assert.rejects(repo.pushTo('origin', '--mirror', 'feat/x'), /Invalid push source/);
});

test('cherry-pick、衝突偵測與 abort；revert；reset', async () => {
  const { dir, git, commit } = makeRepo();
  commit('base', { 'a.txt': 'base\n' });
  git('checkout', '-q', '-b', 'other');
  const pick = commit('change a', { 'a.txt': 'other\n' });
  const clean = commit('add b', { 'b.txt': 'b\n' });
  git('checkout', '-q', 'main');
  const repo = (await GitRepository.open('git', dir))!;

  await repo.cherryPick(clean);
  assert.equal(git('log', '-1', '--format=%s'), 'add b');

  commit('main change a', { 'a.txt': 'main\n' });
  await assert.rejects(repo.cherryPick(pick));
  assert.equal(await repo.operationInProgress(), 'cherry-pick');
  await repo.abortOperation('cherry-pick');
  assert.equal(await repo.operationInProgress(), undefined);

  const head = git('rev-parse', 'HEAD');
  await repo.revert(head);
  assert.match(git('log', '-1', '--format=%s'), /^Revert "main change a"/);

  // reset：soft 保留 staged、hard 清空
  // HEAD~1 是 revert 之前的狀態：soft reset 後 revert 的變更留在 index
  const target = git('rev-parse', 'HEAD~1');
  await repo.reset(target, 'soft');
  assert.equal(git('rev-parse', 'HEAD'), target);
  assert.equal(await repo.isDirty(), true);
  await repo.reset(target, 'hard');
  assert.equal(await repo.isDirty(), false);
  await assert.rejects(repo.reset('--hard', 'hard'));
});

test('merge commit：revert／cherry-pick 需要 mainline', async () => {
  const { dir, git, commit } = makeRepo();
  commit('base');
  git('checkout', '-q', '-b', 'f');
  commit('f1', { 'f.txt': '1' });
  git('checkout', '-q', 'main');
  commit('m1', { 'm.txt': '1' });
  git('merge', '-q', '--no-ff', '-m', 'merge f', 'f');
  const merge = git('rev-parse', 'HEAD');
  const repo = (await GitRepository.open('git', dir))!;
  await assert.rejects(repo.revert(merge));
  await repo.abortOperation('revert').catch(() => undefined);
  await repo.revert(merge, 1);
  assert.match(git('log', '-1', '--format=%s'), /^Revert "merge f"/);
});

test('建立 branch／tag 與名稱驗證；與工作區比較', async () => {
  const { dir, git, commit } = makeRepo();
  const c1 = commit('one', { 'a.txt': '1' });
  commit('two', { 'a.txt': '2', 'b.txt': 'b' });
  const repo = (await GitRepository.open('git', dir))!;

  assert.equal(await repo.isValidRefName('feat/ok', 'branch'), true);
  assert.equal(await repo.isValidRefName('bad..name', 'branch'), false);
  assert.equal(await repo.isValidRefName('-x', 'branch'), false);
  await assert.rejects(repo.createBranch('bad name', c1, false));

  await repo.createBranch('from-one', c1, false);
  assert.equal(git('rev-parse', 'from-one'), c1);
  assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'main');
  await repo.createBranch('hotfix/x', c1, true);
  assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'hotfix/x');

  await repo.createTag('v0.1', c1);
  await repo.createTag('v0.2', c1, '版本說明');
  assert.equal(git('cat-file', '-t', 'v0.1'), 'commit');
  assert.equal(git('cat-file', '-t', 'v0.2'), 'tag');

  git('checkout', '-q', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'local edit');
  const diff = await repo.diffWithWorkingTree(c1);
  assert.deepEqual(diff.map((f) => `${f.status} ${f.path}`).sort(), ['A b.txt', 'M a.txt']);
});
