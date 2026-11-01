// 長線性分支折疊：👁 選單全部收合／展開、點收合列展開、點分支線收合、右鍵選單、Enter、篩選時停用（對應 docs/TESTING.md）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const h = require('./host');

let app;
let page;
let repo;
let branch;
let dir;

before(async () => {
  // 400 筆 commit：main 每 100 筆合併一條 5 筆的 feature 分支（分支最新一筆有標籤）
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-collapse-'));
  repo = path.join(dir, 'demo');
  execFileSync(process.execPath, [path.join(h.ROOT, 'scripts', 'make-large-repo.mjs'), repo, '400'], { stdio: 'ignore' });
  // 最新的一條 feature 分支：由新到舊 5 筆
  const name = h.git(repo, 'for-each-ref', '--sort=-refname', '--format=%(refname:short)', '--count=1', 'refs/heads/feature/');
  branch = h.git(repo, 'log', '--format=%s', '-5', name).split('\n');
  app = await h.launch(dir, { height: 600 });
  page = app.page;
});
after(async () => {
  if (app) await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const viewMenu = async (label) => {
  await page.locator('[title="View options"]').first().click();
  await h.menu(page, label);
};
const row = (text) => page.locator('.log-row:visible', { hasText: text }).first();
/** 往下捲直到看到符合的列（列是虛擬捲動，畫面外的不存在） */
async function scrollTo(locator) {
  await page.evaluate(() => (document.querySelector('.log-viewport').scrollTop = 0));
  for (let i = 0; i < 40; i++) {
    if (await locator.count()) return locator;
    await page.evaluate(() => (document.querySelector('.log-viewport').scrollTop += 300));
    await page.waitForTimeout(60);
  }
  throw new Error('捲到底都沒有找到');
}

test('全部收合：分支最新與第一筆保留，中間 3 筆收成「⋯ 3 commits」', async () => {
  await viewMenu('Collapse Linear Branches');
  const collapsed = await scrollTo(page.locator('.log-row.is-collapsed:visible').first());
  assert.equal((await collapsed.innerText()).trim(), '⋯ 3 commits');
  // 這條分支：最新（branch[0]）與第一筆（branch[4]）還在，中間三筆不在
  await scrollTo(row(branch[0]));
  assert.ok(await row(branch[4]).count(), '分支第一筆保留');
  const shown = await h.texts(page.locator('.log-row:visible .cell-subject-text'));
  for (const s of branch.slice(1, 4)) assert.ok(!shown.includes(s), `${s} 被收起`);
});

test('點收合列展開，並選取原本被收起的第一筆', async () => {
  const collapsed = page.locator('.log-row.is-collapsed:visible').first();
  await collapsed.click({ position: { x: 300, y: 10 } });
  await h.eventually(async () => assert.ok(await row(branch[1]).count(), '展開後中間的 commit 出現'));
  assert.ok((await page.locator('.log-row.selected').innerText()).includes(branch[1]));
});

test('右鍵「收合這段線性分支」；收合列的右鍵「展開」與 Enter', async () => {
  await row(branch[2]).click({ button: 'right', position: { x: 300, y: 10 } });
  await h.menu(page, 'Collapse Linear Branch');
  const collapsed = page.locator('.log-row.is-collapsed:visible').first();
  await h.eventually(async () => assert.ok(await collapsed.count()));
  await collapsed.click({ button: 'right', position: { x: 300, y: 10 } });
  const items = await h.texts(page.locator('.context-menu .menu-item'));
  assert.deepEqual(items.map((x) => x.replace(/\s*Enter$/, '')), ['Expand Linear Branch']);
  // 選到收合列：右欄說明怎麼展開
  await h.eventually(async () => assert.match(await page.locator('.details-pane, .details').first().innerText(), /3 commits are collapsed/));
  await page.keyboard.press('Escape');
  // 鍵盤：選到收合列按 Enter 展開
  await page.locator('.log-viewport').focus();
  await page.keyboard.press('Enter');
  await h.eventually(async () => assert.ok(await row(branch[2]).count()));
});

test('點分支線（中間 commit 的節點位置）收合那一段；其他地方點照常選取', async () => {
  const target = row(branch[2]);
  // 分支在第二條 lane：x = 6（邊距）+ 14 + 7
  await target.click({ position: { x: 27, y: 11 } });
  await h.eventually(async () => assert.ok(await page.locator('.log-row.is-collapsed:visible').count()));
  await page.locator('.log-row.is-collapsed:visible').first().click({ position: { x: 300, y: 10 } });
  await h.eventually(async () => assert.ok(await row(branch[2]).count()));
  // 點標題文字只是選取
  await row(branch[2]).click({ position: { x: 300, y: 10 } });
  assert.equal(await page.locator('.log-row.is-collapsed:visible').count(), 0);
});

test('全部展開；文字篩選時選單項目停用', async () => {
  await viewMenu('Expand Linear Branches');
  assert.equal(await page.locator('.log-row.is-collapsed').count(), 0);
  await page.locator('.log-search input').fill('change 1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.locator('[title="View options"]').first().click();
  const item = page.locator('.context-menu .menu-item', { hasText: 'Collapse Linear Branches' });
  assert.ok(await item.evaluate((e) => e.classList.contains('disabled') || e.getAttribute('aria-disabled') === 'true'));
  await page.keyboard.press('Escape');
});

test('沒有 webview 錯誤', () => {
  assert.deepEqual(h.pageErrors(app.log), []);
});
