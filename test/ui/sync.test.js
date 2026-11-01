// 同步：Fetch、Pull、Push 對話框（編輯器分頁）、Force Push、Push 到這裡為止、新分支（對應 docs/TESTING.md「同步」「Push 分頁」）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./host');

let pg;
let app;
let page;
let api;
let web;
const remotes = () => `${pg}-remotes`;

before(async () => {
  pg = h.makePlayground();
  api = `${pg}/api-server`;
  web = `${pg}/web-app`;
  app = await h.launch(pg);
  page = app.page;
});
after(async () => app && (await app.close()));

async function settle() {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => !document.querySelector('.progress.active'));
  await page.waitForTimeout(200);
}
async function refresh() {
  app.fireWatchers();
  await page.waitForTimeout(900);
  await settle();
}
const remoteHead = (repo, branch = 'main') => h.git(`${remotes()}/${repo}.git`, 'rev-parse', branch);

/** 按 Log 工具列的 Push…，回傳對話框分頁 */
async function openPush() {
  for (const p of app.calls.panels) if (!p.disposed) p.dispose();
  const n = app.calls.panels.length;
  await page.locator('.toolbar-group [title="Push…"]').click();
  await h.until(() => app.calls.panels.length > n);
  const d = await app.lastPanel();
  await d.page.waitForSelector('.push-repo');
  await d.page.waitForTimeout(400);
  return d;
}

test('Push 對話框：列出各 repo 的目標與待推 commit；點 commit 列出檔案', async () => {
  const d = await openPush();
  const repos = await h.texts(d.page.locator('.push-repo'));
  const apiRow = repos.find((r) => r.includes('api-server') && !r.includes('shared'));
  assert.match(apiRow, /main → origin/);
  const subjects = await h.texts(d.page.locator('.push-commit-subject'));
  assert.ok(subjects.includes('feat(auth): rotate API keys') && subjects.includes('docs: describe key rotation'), subjects.join(' / '));
  await d.page.locator('.push-commit', { hasText: 'docs: describe key rotation' }).click();
  await d.page.waitForTimeout(400);
  assert.match((await h.texts(d.page.locator('.push-files .tree-row'))).join(' '), /auth\.md/);
  // web-app 落後遠端：有警告
  assert.ok(await d.page.locator('.push-warning').count(), '遠端有本機沒有的 commit 時顯示警告');
  await d.page.locator('.button.secondary', { hasText: 'Cancel' }).click();
  await h.until(() => d.panel.disposed);
  await d.page.close();
});

test('Push：web-app 被拒（遠端較新），api-server 推送成功', async () => {
  const before = remoteHead('api-server');
  const d = await openPush();
  await d.page.locator('.push-main').click();
  await h.until(() => remoteHead('api-server') !== before, 15000);
  assert.equal(remoteHead('api-server'), h.git(api, 'rev-parse', 'main'));
  await h.until(() => app.calls.errors.length + app.calls.warnings.length > 0, 15000);
  assert.match([...app.calls.errors, ...app.calls.warnings].join('\n'), /web-app/);
  await d.page.close();
  await refresh();
});

test('Pull：落後的 web-app 拉到最新', async () => {
  app.calls.errors.length = 0;
  h.git(web, 'stash', '-q');
  await page.locator('.toolbar-group [title*="Pull"]').click();
  await h.until(() => h.git(web, 'rev-parse', 'main') === remoteHead('web-app'), 15000);
  h.git(web, 'stash', 'pop', '-q');
  await refresh();
});

test('Force Push（with lease）需確認，覆蓋遠端', async () => {
  // 遠端被別人推了新 commit，本機另有一筆
  h.remotePush(pg, 'api-server');
  h.git(api, 'fetch', '-q');
  h.git(api, 'commit', '-q', '--allow-empty', '-m', 'local only');
  await refresh();
  const d = await openPush();
  await d.page.locator('.push-caret').click();
  await d.page.locator('.menu-item', { hasText: 'Force Push' }).dispatchEvent('mousedown');
  await d.page.waitForSelector('.confirm-dialog');
  await d.page.locator('.confirm-dialog .button.danger').click();
  await h.until(() => h.git(`${remotes()}/api-server.git`, 'log', '-1', '--format=%s', 'main') === 'local only', 15000);
  await d.page.close();
  await refresh();
});

test('新分支：顯示 New 並在推送後設定 upstream；可改遠端分支名稱', async () => {
  h.git(api, 'stash', '-q', '-u');
  h.git(api, 'checkout', '-q', 'feature/rate-limit');
  await refresh();
  const d = await openPush();
  const apiRepo = d.page.locator('.push-repo', { hasText: 'rate-limit' }).first();
  assert.match(await apiRepo.innerText(), /New/);
  const input = apiRepo.locator('.push-branch');
  await input.fill('feature/rate-limit-v2');
  await input.press('Enter');
  await d.page.waitForTimeout(800);
  await d.page.locator('.push-main').click();
  await h.until(() => h.git(`${remotes()}/api-server.git`, 'branch', '--list', 'feature/rate-limit-v2') !== '', 15000);
  await h.until(() => h.git(api, 'rev-parse', '--abbrev-ref', 'feature/rate-limit@{upstream}') === 'origin/feature/rate-limit-v2');
  await d.page.close();
  h.git(api, 'checkout', '-q', 'main');
  h.git(api, 'stash', 'pop', '-q');
  await refresh();
});

test('Push 到這裡為止：只推到選取的 commit', async () => {
  h.git(api, 'commit', '-q', '--allow-empty', '-m', 'second local');
  h.git(api, 'commit', '-q', '--allow-empty', '-m', 'third local');
  await refresh();
  const target = h.git(api, 'rev-parse', 'HEAD~1');
  for (const p of app.calls.panels) if (!p.disposed) p.dispose();
  await page.locator('.log-row:visible', { hasText: 'second local' }).first().click({ button: 'right' });
  const n = app.calls.panels.length;
  await h.menu(page, 'Push All up to Here');
  await h.until(() => app.calls.panels.length > n);
  const d = await app.lastPanel();
  await d.page.waitForSelector('.push-commit');
  await d.page.waitForTimeout(400);
  assert.deepEqual(await h.texts(d.page.locator('.push-commit-subject')), ['second local']);
  await d.page.locator('.push-main').click();
  await h.until(() => remoteHead('api-server') === target, 15000);
  await d.page.close();
});

test('Fetch：取得遠端新 commit', async () => {
  h.remotePush(pg, 'web-app');
  const remote = remoteHead('web-app');
  await page.locator('.vertical-toolbar [title="Fetch all remotes"]').click();
  await h.until(() => h.git(web, 'rev-parse', 'origin/main') === remote, 15000);
});

test('沒有 webview 錯誤', () => {
  assert.deepEqual(h.pageErrors(app.log), []);
});
