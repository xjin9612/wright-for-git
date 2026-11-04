// Branches 欄：樹、工具列、我的最愛、右鍵操作、合併衝突與進行中的操作（對應 docs/TESTING.md「Branches」「我的最愛」「進行中的操作」）
'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./host');

let pg;
let app;
let page;
let api;
let web;

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
/** extension 操作後重新整理（真實 VS Code 由檔案監看觸發） */
async function refresh() {
  app.fireWatchers();
  await page.waitForTimeout(900);
  await settle();
}
const tree = () => page.locator('.branch-tree .tree-row');
const branch = (label) => page.locator('.branch-tree .tree-row', { hasText: new RegExp(`^\\s*${label.replace(/[/.]/g, '\\$&')}\\b`) }).first();
const tool = (title) => page.locator(`.vertical-toolbar .icon-button[title="${title}"]`);
const confirmPanel = async (accept = true) => {
  await page.waitForSelector('.confirm-dialog');
  await page.locator(accept ? '.confirm-dialog .button.danger, .confirm-dialog .button.primary' : '.confirm-dialog .button.secondary').first().click();
};

beforeEach(async () => {
  await page.keyboard.press('Escape');
});

test('Local／Remote／Tags；依 / 分資料夾；main 預設為我的最愛並置頂', async () => {
  await tool('Expand all').click();
  const rows = await h.texts(tree());
  for (const s of ['Local', 'Remote', 'Tags', 'feature', 'release']) assert.ok(rows.some((r) => r.startsWith(s)), `${s}：${rows.join(' / ')}`);
  const localIdx = rows.findIndex((r) => r.startsWith('Local'));
  assert.match(rows[localIdx + 1], /^main/, '置頂的 main');
  assert.ok(await page.locator('.branch-tree .tree-row').nth(localIdx + 1).locator('.favorite').count());
  // 同名 branch 合併並顯示所屬 repo
  assert.ok(rows.some((r) => /^checkout\b.*api-server.*web-app/.test(r) || /^feature\/checkout.*api-server.*web-app/.test(r)), rows.join(' / '));
});

test('設定 defaultFavoriteBranches：設為 [] 時 main 不是我的最愛；改成 release/1.x 時它置頂；移除設定後回到 main', async () => {
  const key = 'gitWorkbench.defaultFavoriteBranches';
  const setConfig = async (v) => {
    if (v === undefined) delete app.calls.config[key];
    else app.calls.config[key] = v;
    for (const l of app.calls.configListeners) await l({ affectsConfiguration: (s) => key === s || key.startsWith(`${s}.`) });
    await settle();
  };
  const isFav = async (label) => (await branch(label).locator('.favorite').count()) > 0;
  await tool('Expand all').click();

  await setConfig([]);
  await h.until(async () => !(await isFav('main')), 'main 不是我的最愛');
  assert.equal(await page.locator('.branch-tree .tree-row .favorite').count(), 0, '沒有任何我的最愛');

  await setConfig(['release/1.x']);
  await h.until(async () => {
    const rows = await h.texts(tree());
    const local = rows.findIndex((r) => r.startsWith('Local'));
    return /^(release\/)?1\.x/.test(rows[local + 1] ?? '');
  }, 'release/1.x 置頂');
  assert.ok(!(await isFav('main')));

  await setConfig(undefined);
  await h.until(async () => isFav('main'), '回到預設 main');
});

test('搜尋框過濾分支', async () => {
  const input = page.locator('.branch-search input, .branches-pane input[type="text"]').first();
  await input.fill('cache');
  await page.waitForTimeout(200);
  const rows = await h.texts(tree());
  assert.ok(rows.some((r) => r.includes('cache')) && !rows.some((r) => /^rate-limit/.test(r)), rows.join(' / '));
  await input.fill('');
  await page.waitForTimeout(200);
});

test('工具列：新增分支（名稱驗證）', async () => {
  app.calls.inputs.push('bad name..', 'feature/from-ui');
  await tool('New Branch…').click();
  await h.until(() => app.calls.inputErrors.length > 0);
  await tool('New Branch…').click();
  await h.until(() => h.git(api, 'branch', '--list', 'feature/from-ui') !== '');
  assert.equal(h.git(api, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/from-ui', '新分支已簽出');
  h.git(api, 'checkout', '-q', 'main');
  h.git(web, 'checkout', '-q', 'main');
  await refresh();
});

test('刪除已合併的分支直接刪；未合併的先確認', async () => {
  await tool('Expand all').click();
  await branch('merged-work').click();
  await tool('Delete').click();
  await h.until(() => h.git(api, 'branch', '--list', 'old/merged-work') === '');

  await branch('cache').click();
  await tool('Delete').click();
  await confirmPanel(false);
  await page.waitForTimeout(500);
  assert.notEqual(h.git(api, 'branch', '--list', 'experiment/cache'), '', '取消後保留');
  await tool('Delete').click();
  await confirmPanel(true);
  await h.until(() => h.git(api, 'branch', '--list', 'experiment/cache') === '');
  await refresh();
});

test('重新命名：已存在的名稱不能送出', async () => {
  await tool('Expand all').click();
  await branch('rate-limit').click({ button: 'right' });
  app.calls.inputs.push('main');
  await h.menu(page, 'Rename…');
  await h.until(() => app.calls.inputErrors.some((e) => /already exists/.test(e)));
  await branch('rate-limit').click({ button: 'right' });
  app.calls.inputs.push('feature/rate-limiter');
  await h.menu(page, 'Rename…');
  await h.until(() => h.git(api, 'branch', '--list', 'feature/rate-limiter') !== '');
  await refresh();
});

test('分支右鍵選單項目；目前分支的 Checkout／刪除停用', async () => {
  await tool('Expand all').click();
  await branch('main').click({ button: 'right' });
  const items = await page.locator('.context-menu[data-level="0"] .menu-item').evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), disabled: e.classList.contains('disabled') || e.getAttribute('aria-disabled') === 'true' })));
  const find = (s) => items.find((i) => i.text.startsWith(s));
  for (const s of ['Checkout', 'New Branch from', 'Compare with Current', 'Show in Log', 'Show in New Tab', 'Merge', 'Rebase Current onto', 'Update', 'Push…', 'Rename…', 'Delete']) assert.ok(find(s), `${s}：${items.map((i) => i.text).join(' / ')}`);
  assert.ok(find('Checkout').disabled && find('Delete').disabled);
  await page.keyboard.press('Escape');
});

test('我的最愛：工具列 ★ 標記選取的分支；設定選單「只顯示我的最愛」', async () => {
  await tool('Expand all').click();
  await branch('rate-limiter').click();
  await tool('Mark as Favorite').click();
  await page.waitForTimeout(200);
  const rows = await h.texts(tree());
  const local = rows.findIndex((r) => r.startsWith('Local'));
  assert.ok(rows.slice(local + 1, local + 4).some((r) => /^feature\/rate-limiter|^rate-limiter/.test(r)), `置頂：${rows.join(' / ')}`);
  await tool('View options').click();
  await h.menu(page, 'Show Only Favorites');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const favs = await h.texts(tree());
  assert.ok(favs.some((r) => r.startsWith('main')) && !favs.some((r) => r.startsWith('release')), favs.join(' / '));
  await tool('View options').click();
  await h.menu(page, 'Show Only Favorites');
  await page.keyboard.press('Escape');
});

test('雙擊遠端分支：有衝突的本機修改時顯示錯誤；乾淨時建立追蹤分支並簽出', async () => {
  h.git(api, 'branch', '-D', 'release/1.x');
  await refresh();
  await tool('Expand all').click();
  const remote = () => page.locator('.branch-tree .tree-row', { hasText: /^\s*1\.x\b/ }).last();
  await remote().dblclick();
  await h.until(() => app.calls.errors.some((e) => /Checkout failed/.test(e)));
  app.calls.errors.length = 0;
  h.git(api, 'stash', '-q', '-u');
  await remote().dblclick();
  await h.until(() => h.git(api, 'rev-parse', '--abbrev-ref', 'HEAD') === 'release/1.x');
  assert.equal(h.git(api, 'rev-parse', '--abbrev-ref', 'release/1.x@{upstream}'), 'origin/release/1.x');
  h.git(api, 'checkout', '-q', 'main');
  h.git(api, 'stash', 'pop', '-q');
  await refresh();
});

test('合併衝突：Log 上方顯示合併進行中；中止需確認', async () => {
  const conflicted = () => {
    try {
      return h.git(web, 'status', '--porcelain').includes('UU');
    } catch {
      return false; // git 暫時鎖住 index（重新整理中）
    }
  };
  // Windows 上檔案監看的重新整理較慢：右鍵選單可能剛打開就因分支樹重繪而關閉，Merge 沒被按到。
  // 每次嘗試後等一段時間，還沒開始合併就重新右鍵再按一次。
  for (let attempt = 1; !conflicted(); attempt++) {
    if (attempt > 4) assert.fail(`嘗試 ${attempt - 1} 次都沒有進入合併衝突`);
    await page.keyboard.press('Escape');
    await settle();
    await tool('Expand all').click();
    await settle();
    const row = page.locator('.branch-tree .tree-row', { hasText: /^\s*theme\b/ }).first();
    await row.click({ button: 'right' });
    const item = page.locator('.context-menu .menu-item', { hasText: /^Merge .* into Current/ }).first();
    if (!(await item.isVisible().catch(() => false))) continue;
    if (!app.calls.picks.length) app.calls.picks.push((x) => /web-app/.test(typeof x === 'string' ? x : x.label));
    await item.dispatchEvent('mousedown');
    // 合併前可能先跳確認框：出現就按確認
    await h.until(async () => {
      if (await page.locator('.confirm-dialog').count()) await confirmPanel(true);
      return conflicted();
    }, 15000).catch(() => undefined);
  }
  app.calls.picks.length = 0;
  await app.waitOps(true);
  assert.match(await page.locator('.log-ops').innerText(), /web-app.*Merge/);
  await page.locator('.log-ops .link', { hasText: 'Abort' }).click();
  await confirmPanel(false);
  await page.waitForTimeout(500);
  assert.ok(h.git(web, 'status', '--porcelain').includes('UU'), '取消後仍在合併');
  await page.locator('.log-ops .link', { hasText: 'Abort' }).click();
  await confirmPanel(true);
  await h.until(() => !h.git(web, 'status', '--porcelain').includes('UU'));
  await app.waitOps(false);
  // 中止後原本未提交的修改還在
  assert.match(h.git(web, 'status', '--porcelain'), /Login\.tsx/);
});

test('確認框：破壞性操作預設焦點在取消、Tab 切換、Esc 取消', async () => {
  await tool('Expand all').click();
  // 建一個未合併、也沒有 upstream 的分支：刪除時以紅色按鈕確認
  const sha = h.git(api, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'unmerged work');
  h.git(api, 'update-ref', 'refs/heads/tmp/unmerged', sha);
  // 新分支要等重新整理後才出現（Windows 上較慢）：持續觸發重新整理直到出現
  const row = page.locator('.branch-tree .tree-row', { hasText: /^\s*unmerged\b/ }).first();
  await h.until(async () => {
    await refresh();
    await tool('Expand all').click();
    return (await row.count()) > 0;
  }, 40000, 0);
  await row.click();
  await tool('Delete').click();
  await page.waitForSelector('.confirm-dialog');
  assert.ok(await page.locator('.confirm-dialog .button.danger').count(), '紅色按鈕');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cancel');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('danger')), true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.confirm-dialog').count(), 0);
  assert.notEqual(h.git(api, 'branch', '--list', 'tmp/unmerged'), '', 'Esc 不刪除');
});

test('沒有 webview 錯誤（Log、提交視窗、對話框分頁）', () => {
  assert.deepEqual(app.pageErrors(), []);
});
