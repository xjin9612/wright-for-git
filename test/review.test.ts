// 程式碼審查修正項目的回歸測試
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildLogArgs, looksLikeHash } from '../src/git/parsers';
import { GitRepository } from '../src/git/repository';
import { EMPTY_FILTER, type CommitInfo } from '../src/shared/protocol';
import { mapLimit } from '../src/util';
import { makeRepo } from './helpers';

test('#5 unborn HEAD：不把 HEAD 當 revision，其他 branch 照常讀取', async () => {
  assert.ok(!buildLogArgs(EMPTY_FILTER, 10, { hasHead: false }).includes('HEAD'));
  assert.ok(buildLogArgs(EMPTY_FILTER, 10).includes('HEAD'));
  const { dir, git, commit } = makeRepo();
  commit('first');
  git('checkout', '-q', '--orphan', 'empty');
  const repo = (await GitRepository.open('git', dir))!;
  const state = await repo.getState();
  assert.equal(state.head.hash, undefined);
  const out: CommitInfo[] = [];
  await repo.streamLog(EMPTY_FILTER, 100, (b) => out.push(...b), undefined, false);
  assert.deepEqual(out.map((c) => c.subject), ['first']);
});

test('#3 diff 內容：非 hash 的 ref 一律回傳空內容，不會執行 --output', async () => {
  const { dir, commit } = makeRepo();
  const h = commit('c', { 'a.txt': 'hello' });
  const repo = (await GitRepository.open('git', dir))!;
  assert.equal((await repo.showFile(h, 'a.txt')).toString('utf8'), 'hello');
  const target = path.join(dir, 'pwned');
  const before = readdirSync(dir).length;
  assert.equal((await repo.showFile(`--output=${target}`, 'a.txt')).length, 0);
  assert.equal((await repo.showFile('HEAD', 'a.txt')).length, 0, '只接受 hash');
  assert.equal(existsSync(target), false);
  assert.equal(readdirSync(dir).length, before);
  await assert.rejects(repo.checkout('--orphan=x'));
});

test('#4 i18n.logOutputEncoding=big5 時 log 中文仍正確', async () => {
  const { dir, git, commit } = makeRepo();
  commit('修正中文顯示');
  git('config', 'i18n.logOutputEncoding', 'big5');
  const repo = (await GitRepository.open('git', dir))!;
  const out: CommitInfo[] = [];
  await repo.streamLog(EMPTY_FILTER, 10, (b) => out.push(...b));
  assert.equal(out[0].subject, '修正中文顯示');
  assert.equal((await repo.getDetails(out[0].hash)).message, '修正中文顯示');
});

test('#7 locate：子資料夾 prefix 與經過 symlink 的路徑', async (t) => {
  const { dir, commit } = makeRepo();
  commit('c', { 'src/main/a.txt': '1' });
  const loc = (await GitRepository.locate('git', path.join(dir, 'src', 'main')))!;
  assert.equal(loc.prefix, 'src/main/');
  const link = path.join(mkdtempSync(path.join(tmpdir(), 'lnk-')), 'link');
  try {
    // Windows 用 junction，不需要系統管理員權限
    symlinkSync(dir, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('無法建立連結，略過經過連結的路徑');
    return;
  }
  const viaLink = (await GitRepository.locate('git', path.join(link, 'src')))!;
  assert.equal(viaLink.prefix, 'src/');
});

test('#14 git-common-dir 以執行目錄為基準解析', async () => {
  const { dir, commit } = makeRepo();
  commit('c', { 'deep/er/a.txt': '1' });
  const repo = (await GitRepository.open('git', path.join(dir, 'deep', 'er')))!;
  const real = (p: string) => realpathSync.native(path.resolve(p));
  assert.equal(real(repo.commonDir), real(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir }).toString().trim()));
});

test('#17 hash 搜尋：至少 7 碼，且必須真的是 commit 前綴', async () => {
  assert.equal(looksLikeHash('cafe'), false);
  assert.equal(looksLikeHash('abcdef1'), true);
  const { dir, git, commit } = makeRepo();
  const h = commit('target');
  commit('other');
  git('tag', 'deadbeef', h); // 與 hash 長得像的 tag 名稱
  const repo = (await GitRepository.open('git', dir))!;
  const out: CommitInfo[] = [];
  await repo.streamLog({ ...EMPTY_FILTER, text: 'deadbeef' }, 10, (b) => out.push(...b));
  assert.equal(out.length, 0, 'tag 名稱不應被當成 hash 釘在最上面');
  const hit: CommitInfo[] = [];
  await repo.streamLog({ ...EMPTY_FILTER, text: h.slice(0, 8) }, 10, (b) => hit.push(...b));
  assert.equal(hit[0].hash, h);
});

test('mapLimit：結果順序正確且並行數受限', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n * 3));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
});
