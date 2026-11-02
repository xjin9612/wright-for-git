// 側邊欄 Branches（活動列「Git 歷程」）與 Branch／Paths 選單的搜尋（對應 docs/TESTING.md「活動列的兩個圖示」「Branch／Paths 選單的搜尋」）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./host');

let pg;
let app;
let page;

before(async () => {
  pg = h.makePlayground();
  app = await h.launch(pg);
  page = app.page;
});
after(async () => app && (await app.close()));

async function settle() {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector('.progress.active'));
  await page.waitForTimeout(150);
}
const chip = (name) => page.locator('.chip', { hasText: name });
const clearChip = async (name) => {
  await chip(name).locator('.chip-clear').click();
  await settle();
};
const menuItems = (p = page) => h.texts(p.locator('.context-menu[data-level="0"] .menu-item'));
/** Log 自己的 Branches 欄是否顯示 */
const logPaneShown = () => page.locator('.workbench > .branches-pane').evaluate((e) => getComputedStyle(e).display !== 'none');

test('Branch 選單搜尋：焦點在搜尋框，只列出符合的分支並標示類型，Enter 套用第一個', async () => {
  await chip('Branch').click();
  const input = page.locator('.context-menu .menu-search input');
  await input.waitFor();
  assert.ok(await input.evaluate((e) => e === document.activeElement), '焦點在搜尋框');
  await page.keyboard.type('rate');
  const items = await menuItems();
  assert.ok(items.length > 0 && items.every((x) => x.includes('rate')), items.join(' / '));
  assert.ok(items.some((x) => /local$/.test(x)), `類型說明：${items.join(' / ')}`);
  await page.keyboard.press('Enter');
  await settle();
  assert.equal(await page.locator('.context-menu').count(), 0);
  assert.match(await chip('Branch').innerText(), /feature\/rate-limit/);
  await clearChip('Branch');
});

test('Paths 選單搜尋：Enter 切換勾選且選單不關閉；Esc 先清除關鍵字，再按一次關閉', async () => {
  await chip('Paths').click();
  await page.locator('.context-menu .menu-search input').waitFor();
  await page.keyboard.type('web');
  const items = await menuItems();
  assert.equal(items.length, 1, items.join(' / '));
  assert.match(items[0], /web-app/);
  await page.keyboard.press('Enter');
  await settle();
  assert.equal(await page.locator('.context-menu').count(), 1, '選單還開著');
  assert.equal(await page.locator('.context-menu .menu-item[aria-checked="false"]', { hasText: 'web-app' }).count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.context-menu .menu-search input').inputValue(), '');
  assert.ok((await menuItems()).some((x) => x.startsWith('Show All Repositories')));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.context-menu').count(), 0);
  assert.doesNotMatch(await chip('Paths').innerText(), /web-app/);
  // 「顯示全部儲存庫」清除 repo 篩選
  await chip('Paths').click();
  await h.menu(page, 'Show All Repositories');
  await settle();
  assert.equal(await chip('Paths').evaluate((e) => e.classList.contains('active')), false);
});

test('側邊欄 Branches：顯示時 Log 收起自己的 Branches 欄；點分支篩選 Log，Log 的篩選也反映到側邊欄', async () => {
  assert.ok(await logPaneShown(), '一開始 Log 有 Branches 欄');
  const side = await app.branchesView();
  const sp = side.page;
  await h.until(async () => !(await logPaneShown()), 'Log 收起 Branches 欄');
  assert.equal(await page.locator('.pane-restore').isVisible(), false, '也沒有展開條');
  assert.equal(await sp.locator('[title="Hide branches"]').count(), 0, '側邊欄沒有「隱藏」按鈕');

  // 點分支 → Log 依它篩選
  await sp.locator('.branches-main input').fill('rate');
  await sp.locator('.branch-tree .tree-row', { hasText: 'rate-limit' }).first().click();
  await settle();
  assert.match(await chip('Branch').innerText(), /feature\/rate-limit/);
  assert.deepEqual(app.api.logFilter().branches, ['refs/heads/feature/rate-limit']);
  await sp.locator('.branches-main input').fill('');

  // Log 改篩選 → 側邊欄的選取跟著移動
  await chip('Branch').click();
  await h.menu(page, 'HEAD', 0);
  await settle();
  await sp.waitForSelector('.tree-row.selected[data-key="head"]');

  // 右鍵 → 在新分頁顯示
  await sp.locator('.branch-tree .tree-row', { hasText: /^\s*main\b/ }).first().click({ button: 'right' });
  await h.menu(sp, 'Show in New Tab');
  await page.waitForSelector('.log-tabs:not(.hidden)');
  await settle();

  // 選項（不顯示標籤）同步到 Log 的 Branches 樹
  await sp.locator('[title="Branch options"]').click();
  await h.menu(sp, 'Show Tags');
  await h.until(async () => (await page.locator('.branch-tree .tree-row', { hasText: /^\s*Tags\s*$/ }).count()) === 0, 'Log 的 Branches 樹不顯示標籤');
  await sp.locator('[title="Branch options"]').click();
  await h.menu(sp, 'Show Tags');
  await h.until(async () => (await page.locator('.branch-tree .tree-row', { hasText: /^\s*Tags\s*$/ }).count()) === 1, 'Log 的 Branches 樹再顯示標籤');

  // 側邊欄切到別的畫面 → Log 的 Branches 欄回來
  side.setVisible(false);
  await h.until(() => logPaneShown(), 'Log 的 Branches 欄回來');

  // 側邊欄沒顯示時 Log 不送分支狀態；再顯示時補送最新的
  const sent = side.posted.branchesSync ?? 0;
  await clearChip('Branch');
  await page.waitForTimeout(300);
  assert.equal(side.posted.branchesSync ?? 0, sent, '隱藏期間不同步');
  side.setVisible(true);
  await h.until(() => (side.posted.branchesSync ?? 0) > sent, '再顯示時補送');
  await h.until(async () => (await sp.locator('.tree-row.selected[data-key="head"]').count()) === 0, '側邊欄反映清除後的篩選');
  side.setVisible(false);
  await h.until(() => logPaneShown(), 'Log 的 Branches 欄回來');
});

test('沒有 webview 錯誤', () => {
  assert.deepEqual(app.pageErrors(), []);
});
