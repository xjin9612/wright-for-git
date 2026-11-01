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
  await d.page.waitForFunction(() => !document.querySelector('.push-main')?.disabled || document.querySelector('.push-warning'));
  return d;
}

test('Push 對話框：列出各 repo 的目標與待推 commit；點 commit 列出檔案', async () => {
  const d = await openPush();
  await h.eventually(async () => {
    const repos = await h.texts(d.page.locator('.push-repo'));
    const apiRow = repos.find((r) => r.includes('api-server') && !r.includes('shared'));
    assert.match(apiRow ?? '', /main → origin/);
    const subjects = await h.texts(d.page.locator('.push-commit-subject'));
    assert.ok(subjects.includes('feat(auth): rotate API keys') && subjects.includes('docs: describe key rotation'), subjects.join(' / '));
    // web-app 落後遠端：有警告
    assert.ok(await d.page.locator('.push-warning').count(), '遠端有本機沒有的 commit 時顯示警告');
  });
  // 預設選取 repo 的全部 commit：右側是合併後的所有改動
  const fileTexts = async () => (await h.texts(d.page.locator('.push-files .tree-row'))).join(' ');
  await h.eventually(async () => {
    assert.equal(await d.page.locator('.push-files-title').innerText(), 'All 2 commits to push');
    assert.match(await fileTexts(), /auth\.md[\s\S]*rotate\.ts|rotate\.ts[\s\S]*auth\.md/);
  });
  // Ctrl+點選取消其中一筆 → 只剩另一筆的檔案；點 repo 列又回到全部
  await d.page.locator('.push-commit', { hasText: 'feat(auth): rotate API keys' }).click({ modifiers: ['Control'] });
  await h.eventually(async () => assert.doesNotMatch(await fileTexts(), /rotate\.ts/));
  await d.page.locator('.push-repo', { hasText: 'api-server' }).first().click({ position: { x: 300, y: 8 } });
  await h.eventually(async () => assert.match(await fileTexts(), /rotate\.ts/));
  await d.page.locator('.push-commit', { hasText: 'docs: describe key rotation' }).click();
  await h.eventually(async () => assert.match((await h.texts(d.page.locator('.push-files .tree-row'))).join(' '), /auth\.md/));
  // 檔案依目錄分組（與記錄右欄相同）；取消分組後變平鋪，並記住設定（下次開啟沿用）
  assert.ok((await h.texts(d.page.locator('.push-files .tree-row'))).some((r) => /^docs\b/.test(r)), '有 docs 資料夾列');
  await d.page.locator('.push-files-toolbar [title="Group By"]').click();
  await h.menu(d.page, 'Directory');
  await h.eventually(async () => assert.ok((await h.texts(d.page.locator('.push-files .tree-row'))).every((r) => !/^docs\b/.test(r))));
  await h.until(() => app.ctx.globalState.get('gitWorkbench.dialogPrefs')?.['fileGrouping.push']?.directory === false);
  await d.page.locator('.button.secondary', { hasText: 'Cancel' }).click();
  await h.until(() => d.panel.disposed);
  await d.page.close();
});

test('Push：web-app 被拒（遠端較新），api-server 推送成功；錯誤通知可開啟主控台', async () => {
  const before = remoteHead('api-server');
  const d = await openPush();
  // 失敗通知上按「Show Git Console」
  app.calls.consoleShown = false;
  app.calls.errorAnswers.push('Show Git Console');
  await d.page.locator('.push-main').click();
  await h.until(() => remoteHead('api-server') !== before, 40000);
  assert.equal(remoteHead('api-server'), h.git(api, 'rev-parse', 'main'));
  await h.until(() => app.calls.errors.length > 0, 40000);
  assert.match(app.calls.errors.join('\n'), /web-app/);
  await h.until(() => app.calls.consoleShown, 5000);
  await d.page.close();
  await refresh();
});

test('Pull：落後的 web-app 拉到最新', async () => {
  app.calls.errors.length = 0;
  h.git(web, 'stash', '-q');
  await page.locator('.toolbar-group [title*="Pull"]').click();
  await h.until(() => h.git(web, 'rev-parse', 'main') === remoteHead('web-app'), 40000);
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
  await h.until(() => h.git(`${remotes()}/api-server.git`, 'log', '-1', '--format=%s', 'main') === 'local only', 40000);
  await d.page.close();
  await refresh();
});

test('新分支：顯示 New 並在推送後設定 upstream；可改遠端分支名稱', async () => {
  h.git(api, 'stash', '-q', '-u');
  h.git(api, 'checkout', '-q', 'feature/rate-limit');
  await refresh();
  try {
    const d = await openPush();
    const apiRepo = d.page.locator('.push-repo', { hasText: 'rate-limit' }).first();
    assert.match(await apiRepo.innerText(), /New/);
    const input = apiRepo.locator('.push-branch');
    await input.fill('feature/rate-limit-v2');
    await input.press('Enter');
    // 新的預覽回來前 Push 停用
    await d.page.waitForFunction(() => !document.querySelector('.push-main').disabled);
    assert.equal(await d.page.locator('.push-branch').first().inputValue(), 'feature/rate-limit-v2');
    await d.page.locator('.push-main').click();
    await h.until(() => h.git(`${remotes()}/api-server.git`, 'branch', '--list', 'feature/rate-limit-v2') !== '', 40000);
    await h.until(() => h.git(api, 'rev-parse', '--abbrev-ref', 'feature/rate-limit@{upstream}') === 'origin/feature/rate-limit-v2');
    await d.page.close();
  } finally {
    // 失敗時也還原，避免影響後面的測試
    h.git(api, 'checkout', '-q', 'main');
    h.git(api, 'stash', 'pop', '-q');
    await refresh();
  }
});

test('Push 到這裡為止：只推到選取的 commit', async () => {
  h.git(api, 'commit', '-q', '--allow-empty', '-m', 'second local');
  h.git(api, 'commit', '-q', '--allow-empty', '-m', 'third local');
  await refresh();
  const target = h.git(api, 'rev-parse', 'HEAD~1');
  for (const p of app.calls.panels) if (!p.disposed) p.dispose();
  await (await h.logRow(page, 'second local')).click({ button: 'right' });
  const n = app.calls.panels.length;
  await h.menu(page, 'Push All up to Here');
  await h.until(() => app.calls.panels.length > n);
  const d = await app.lastPanel();
  await h.eventually(async () => assert.deepEqual(await h.texts(d.page.locator('.push-commit-subject')), ['second local']));
  await d.page.locator('.push-main').click();
  await h.until(() => remoteHead('api-server') === target, 40000);
  await d.page.close();
});

test('Fetch：取得遠端新 commit', async () => {
  h.remotePush(pg, 'web-app');
  const remote = remoteHead('web-app');
  await page.locator('.vertical-toolbar [title="Fetch all remotes"]').click();
  await h.until(() => h.git(web, 'rev-parse', 'origin/main') === remote, 40000);
});

test('Git 主控台：記錄會改變狀態的指令與失敗原因；指令可開啟主控台', async () => {
  const lines = app.calls.console.filter(([level]) => level === 'info' || level === 'error').map(([level, text]) => `${level} ${text}`);
  const all = lines.join('\n');
  assert.match(all, /info \[api-server\] git push/);
  assert.match(all, /info \[web-app\] git fetch/);
  // web-app 被拒的 push：error，含 git 的錯誤輸出
  assert.match(all, /error \[web-app\] git push[\s\S]*rejected/);
  // 只讀取的指令不出現在一般層級
  assert.doesNotMatch(all, /git log /);
  assert.ok(app.calls.console.some(([level, text]) => level === 'trace' && /git (log|status|for-each-ref)/.test(text)));
  app.calls.consoleShown = false;
  await app.run('gitWorkbench.showConsole');
  assert.ok(app.calls.consoleShown);
});

test('沒有 webview 錯誤（Log、提交視窗、對話框分頁）', () => {
  assert.deepEqual(app.pageErrors(), []);
});
