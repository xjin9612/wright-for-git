// Git 記錄面板：篩選、選取、詳情、分頁、欄位（對應 docs/TESTING.md「Commit Log」「多選 commit」「多 repo」）
'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./host');

let pg;
let app;
let page;

before(async () => {
  pg = h.makePlayground();
  app = await h.launch(pg, { config: { 'gitWorkbench.issueLinks': [{ pattern: 'PROJ-(\\d+)', url: 'https://tracker.example.com/browse/PROJ-$1' }] } });
  page = app.page;
});
after(async () => app && (await app.close()));

/** 等 log 重新載入完成 */
async function settle() {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector('.progress.active'));
  await page.waitForTimeout(150);
}
const visibleRows = () => page.locator('.log-row:visible');
const subjects = () => h.texts(page.locator('.log-row:visible .cell-subject-text'));
const row = (text) => h.logRow(page, text);
const chip = (name) => page.locator('.chip', { hasText: name });
const clearChip = async (name) => {
  await chip(name).locator('.chip-clear').click();
  await settle();
};
const search = async (text) => {
  const input = page.locator('.log-search input');
  await input.fill(text);
  await input.press('Enter');
  await settle();
};

/** 每個測試從乾淨的篩選開始（前一個測試失敗時不連帶影響） */
beforeEach(async () => {
  await page.keyboard.press('Escape');
  for (const b of await page.locator('.log-search .toggle-button.on').all()) await b.click();
  const input = page.locator('.log-search input');
  if (await input.inputValue()) {
    await input.fill('');
    await input.press('Escape');
  }
  for (const c of await page.locator('.chip.active .chip-clear').all()) await c.click();
  await settle();
});

test('合併顯示所有 repo 的 commit；同名 local／remote 合併標籤；tag', async () => {
  const all = (await visibleRows().allInnerTexts()).join('\n');
  for (const s of ['feat(auth): add API keys', 'feat(ui): dark mode toggle', 'feat: add formatter']) assert.ok(all.includes(s), s);
  assert.match(all, /origin & release\/1\.x/);
  assert.match(all, /v1\.1\.0/);
});

test('載入提示：開啟時在 Log 面板頂端顯示 VS Code 的進度（找 repo、讀取狀態期間）', async () => {
  assert.ok(app.calls.progress.some((l) => l?.viewId === 'gitWorkbench.log'), JSON.stringify(app.calls.progress));
  // 開啟後畫面從最上面開始（仍選取 HEAD，但不為它捲動）
  assert.equal(await page.locator('.log-viewport').evaluate((e) => e.scrollTop), 0);
  assert.equal(await page.locator('.log-row.selected.is-head:visible').count(), 1, '選取 HEAD');
});

test('前往 HEAD：捲到最下面後按工具列按鈕，選取並捲回 HEAD', async () => {
  // 視窗調矮，確保清單需要捲動
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: 300 });
  try {
    await visibleRows().first().click();
    await page.keyboard.press('End');
    await h.until(async () => (await page.locator('.log-viewport').evaluate((e) => e.scrollTop)) > 0, '捲到最下面');
    await page.locator('[title="Go to HEAD"]').click();
    await h.eventually(async () => assert.equal(await page.locator('.log-row.selected.is-head:visible').count(), 1, '選取 HEAD 並在畫面內'));
  } finally {
    await page.setViewportSize(size);
  }
});

test('文字篩選、hash 前綴、regex', async () => {
  await search('pagination');
  const list = await subjects();
  assert.ok(list.length >= 2 && list.every((s) => /pagination/.test(s)), list.join(' / '));

  await search(h.git(`${pg}/api-server`, 'rev-parse', 'v1.1.0').slice(0, 8));
  assert.deepEqual(await subjects(), ['chore: drop legacy script']);

  const regex = page.locator('.log-search .toggle-button').first();
  await regex.click();
  await search('^fix\\(');
  const fixes = await subjects();
  assert.ok(fixes.length >= 3 && fixes.every((s) => s.startsWith('fix(')), fixes.join(' / '));
  await regex.click();
  await page.locator('.log-search input').press('Escape');
  await settle();
  assert.ok((await subjects()).length > 20);
});

test('User 篩選：me 代表 Alice', async () => {
  await chip('User').click();
  await page.locator('.picker-input').fill('me');
  await page.locator('.picker-input').press('Control+Enter');
  await settle();
  assert.deepEqual([...new Set(await h.texts(page.locator('.log-row:visible .cell-author')))], ['Alice Chen']);
  await clearChip('User');
  assert.ok(new Set(await h.texts(page.locator('.log-row:visible .cell-author'))).size > 1);
});

test('彈出框內容放不下時，輸入框與選單項目維持原本高度，只讓清單捲動', async () => {
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: 120 });
  try {
    await chip('User').click();
    const input = page.locator('.picker .picker-input');
    await input.waitFor();
    const list = page.locator('.picker .picker-list');
    assert.ok(await list.evaluate((e) => e.scrollHeight > e.clientHeight), '清單要放不下（才測得到壓縮）');
    const inputHeight = await input.evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(inputHeight >= 20, `User 輸入框高度 ${inputHeight}`);
    await page.keyboard.press('Escape');

    await chip('Branch').click();
    const menu = page.locator('.context-menu[data-level="0"]');
    await menu.waitFor();
    assert.ok(await menu.evaluate((e) => e.scrollHeight > e.clientHeight), '選單要放不下');
    const heights = await menu.locator('.menu-item').evaluateAll((items) => items.map((e) => Math.round(e.getBoundingClientRect().height)));
    assert.ok(heights.every((x) => x === 24), `選單項目高度 ${heights.join(', ')}`);
    await page.keyboard.press('Escape');
  } finally {
    await page.setViewportSize(size);
  }
});

test('從按鈕展開的選單放不下時在按鈕下方捲動，不往上移蓋住按鈕（Paths）', async () => {
  const size = page.viewportSize();
  const chipBottom = await chip('Paths').evaluate((e) => e.getBoundingClientRect().bottom);
  // 下方留約 170px：放不下整個選單，但足夠在下方捲動
  await page.setViewportSize({ width: size.width, height: Math.round(chipBottom + 176) });
  try {
    await chip('Paths').click();
    const menu = page.locator('.context-menu[data-level="0"]');
    await menu.waitFor();
    assert.ok(await menu.evaluate((e) => e.scrollHeight > e.clientHeight), '選單要放不下（才測得到）');
    const top = await menu.evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(top >= chipBottom, `選單頂端 ${top} 蓋到按鈕（底部 ${chipBottom}）`);
    assert.equal(await menu.locator('.menu-hint').count(), 1, '說明在選單內');
    // 說明在頂端搜尋框正下方（與作者選擇框一致）：沒捲動時就看得到，捲到中間也一樣
    const hintVisible = () =>
      menu.evaluate((m) => {
        const box = m.getBoundingClientRect();
        const hint = m.querySelector('.menu-hint').getBoundingClientRect();
        const input = m.querySelector('.menu-search input').getBoundingClientRect();
        return hint.top >= input.bottom && hint.top >= box.top && hint.bottom <= box.bottom + 1;
      });
    assert.ok(await hintVisible(), '一打開就看得到說明');
    await menu.evaluate((m) => (m.scrollTop = (m.scrollHeight - m.clientHeight) / 2));
    assert.ok(await hintVisible(), '捲到中間仍看得到說明');
    await page.keyboard.press('Escape');
  } finally {
    await page.setViewportSize(size);
  }
});

test('焦點離開 webview（點到編輯器等）時，選單與作者選擇框關閉', async (t) => {
  const blur = () => page.evaluate(() => window.dispatchEvent(new Event('blur')));
  // 模擬焦點回到 webview，避免影響後面的測試
  t.after(() => page.evaluate(() => window.dispatchEvent(new Event('focus'))));
  await chip('Paths').click();
  await page.waitForSelector('.context-menu');
  await blur();
  assert.equal(await page.locator('.context-menu').count(), 0, '選單關閉');
  await chip('User').click();
  await page.waitForSelector('.picker');
  await blur();
  assert.equal(await page.locator('.picker').count(), 0, '作者選擇框關閉');

  // 自訂日期區間：焦點仍在頁面（日期欄位的日曆彈出時）不關閉；真的離開才關閉
  await chip('Date').click();
  await h.menu(page, 'Select Period…');
  await page.waitForSelector('.date-range');
  await blur();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.date-range').count(), 1, '焦點還在頁面時不關閉');
  await page.evaluate(() => {
    window.__hasFocus = document.hasFocus;
    document.hasFocus = () => false;
  });
  try {
    await blur();
    await h.until(async () => (await page.locator('.date-range').count()) === 0, '日期區間關閉');
  } finally {
    await page.evaluate(() => (document.hasFocus = window.__hasFocus));
  }
});

test('Branch 篩選：串接選單只顯示該 branch；HEAD 不在篩選中時提示', async () => {
  await chip('Branch').click();
  const top = await h.texts(page.locator('.context-menu[data-level="0"] .menu-item'));
  assert.ok(top[0].startsWith('Select…') && top.some((x) => x.startsWith('Local')) && top.some((x) => x.startsWith('Tags')), top.join(' / '));
  await page.locator('.context-menu[data-level="0"] .menu-item', { hasText: 'Local' }).hover();
  await page.locator('.context-menu[data-level="1"] .menu-item', { hasText: 'release/1.x' }).first().dispatchEvent('mousedown');
  await settle();
  const list = await subjects();
  assert.ok(list.includes('fix(release): hotfix order total rounding'), list.join(' / '));
  assert.ok(!list.includes('feat(auth): rotate API keys'));
  assert.ok(await page.locator('.log-hint:not(.hidden)').isVisible(), 'HEAD 提示');
  await page.locator('.log-hint .link', { hasText: 'Show all branches' }).click();
  await settle();
  assert.equal(await page.locator('.log-hint:not(.hidden)').count(), 0);
  assert.ok((await subjects()).includes('feat(auth): rotate API keys'));
});

test('Date 篩選：最近 7 天', async () => {
  await chip('Date').click();
  await h.menu(page, '7 days');
  await settle();
  const dates = await h.texts(page.locator('.log-row:visible .cell-date'));
  const limit = Date.now() - 8 * 86400000;
  assert.ok(dates.length > 0 && dates.every((d) => { const [y, m, day] = d.split(/[/ ]/).map(Number); return new Date(y, m - 1, day).getTime() > limit; }), dates.join(' / '));
  await clearChip('Date');
});

test('Paths → Select…：以鍵盤展開資料夾、勾選並套用', async () => {
  await chip('Paths').click();
  await h.menu(page, 'Select…');
  const dialog = page.locator('.paths-dialog');
  await dialog.waitFor();
  await dialog.locator('button', { hasText: 'Clear' }).click();
  const focused = () => dialog.locator('.tree-row.focused');
  const api = dialog.locator('.tree-row', { hasText: 'api-server' }).first();
  // 篩選框按 ↓ 進入清單，焦點在第一列
  await dialog.locator('.paths-search input').focus();
  await page.keyboard.press('ArrowDown');
  assert.ok(await dialog.locator('.paths-tree').evaluate((e) => e === document.activeElement), '焦點在清單');
  assert.equal((await focused().innerText()).trim(), 'api-server');
  // ← 收合、→ 展開、再 → 進入第一個子資料夾
  await page.keyboard.press('ArrowLeft');
  assert.equal(await api.getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('ArrowRight');
  assert.equal(await api.getAttribute('aria-expanded'), 'true');
  await h.until(async () => (await dialog.locator('.tree-row').count()) > 3);
  await page.keyboard.press('ArrowRight');
  const folder = (await focused().innerText()).trim();
  assert.notEqual(folder, 'api-server');
  // 空白鍵勾選；← 回上層
  await page.keyboard.press(' ');
  assert.ok(await focused().locator('input').isChecked(), `${folder} 已勾選`);
  await page.keyboard.press('ArrowLeft');
  assert.equal((await focused().innerText()).trim(), 'api-server');
  // Ctrl+Enter 套用：Paths 篩選只剩這個資料夾
  await page.keyboard.press('Control+Enter');
  await dialog.waitFor({ state: 'detached' });
  await settle();
  assert.match(await chip('Paths').innerText(), new RegExp(`api-server/${folder}`));
  await clearChip('Paths');
});

test('Paths：Ctrl+點選只看一個 repo；點色條顯示 repo 名稱欄', async () => {
  await chip('Paths').click();
  await page.locator('.context-menu .menu-item', { hasText: 'web-app' }).first().dispatchEvent('mousedown', { ctrlKey: true });
  await page.keyboard.press('Escape');
  await settle();
  const all = (await visibleRows().allInnerTexts()).join('\n');
  assert.ok(all.includes('dark mode toggle') && !all.includes('add API keys'), 'only web-app');
  await clearChip('Paths');

  // 點左側色條：加寬為 repo 名稱欄（graph 與標題往右移）
  const pad = () => page.locator('.log-row:visible .cell-subject').first().evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
  const before = await pad();
  const box = await visibleRows().first().boundingBox();
  await page.mouse.click(box.x + 3, box.y + box.height / 2);
  await page.waitForTimeout(300);
  assert.ok((await pad()) > before + 40, '名稱欄出現');
  await page.mouse.click(box.x + 3, box.y + box.height / 2);
  await page.waitForTimeout(300);
  assert.equal(await pad(), before);
});

test('選取 commit：右側列出檔案與詳情；issue 編號轉連結', async () => {
  await (await row('feat(auth): add API keys')).click();
  await h.eventually(async () => {
    assert.deepEqual(await h.texts(page.locator('.file-tree .tree-row .tree-label')), ['api-server', 'src/auth', 'keys.ts']);
    assert.match(await page.locator('.details-info').innerText(), /Bob Lin/);
  });
  await page.locator('.details-info .issue-link', { hasText: 'PROJ-42' }).click();
  await h.until(() => app.calls.opened?.includes('https://tracker.example.com/browse/PROJ-42'));

  // 檔案樹 Ctrl+C：選到檔案時複製檔名；選到資料夾時複製 repo 內的相對路徑；repo 列複製 repo 名稱
  // （資料夾用 ↑ 選取，不用點擊：點資料夾會收合它，影響後面的測試）
  const tree = page.locator('.details-pane .file-tree');
  await tree.locator('.tree-row', { hasText: 'keys.ts' }).click();
  app.calls.clipboard = undefined;
  await page.keyboard.press('Control+c');
  await h.until(() => app.calls.clipboard === 'keys.ts');
  await page.keyboard.press('ArrowUp');
  assert.match(await tree.locator('.tree-row.selected').innerText(), /src\/auth/);
  await page.keyboard.press('Control+c');
  await h.until(() => app.calls.clipboard === 'src/auth', '資料夾複製路徑');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+c');
  await h.until(() => app.calls.clipboard === 'api-server', 'repo 列複製名稱');
});

test('檔案樹 F4（openSelectedFile）：有焦點時開啟工作目錄的檔案；檔案已不存在時提示；失去焦點後不作用', async () => {
  const focusContext = () => app.calls.executed.filter(([c, k]) => c === 'setContext' && k === 'gitWorkbench.fileTreeFocus').map((a) => a[2]);
  const opened = () => app.calls.executed.filter(([c]) => c === 'vscode.open').map((a) => a[1].fsPath.replace(/\\/g, '/'));
  const openSelected = () => app.calls.commands['gitWorkbench.openSelectedFile']();
  const tree = page.locator('.details-pane .file-tree');

  await (await row('feat(auth): add API keys')).click();
  await tree.locator('.tree-row', { hasText: 'keys.ts' }).click();
  await h.until(() => focusContext().at(-1) === true, '檔案樹有焦點時設定 context key');
  const before = opened().length;
  await openSelected();
  await h.until(() => opened().length > before);
  assert.match(opened().at(-1), /\/api-server\/src\/auth\/keys\.ts$/);
  const openArgs = app.calls.executed.filter(([c]) => c === 'vscode.open').at(-1);
  assert.equal(openArgs[2]?.preview, false, '一般分頁：接連開啟不會互相取代');

  // 已刪除的檔案：工作目錄沒有，不開啟，只在狀態列提示
  await (await row('chore: drop legacy script')).click();
  await tree.locator('.tree-row', { hasText: 'legacy.sh' }).click();
  await page.waitForTimeout(200);
  const n = opened().length;
  await openSelected();
  assert.equal(opened().length, n);
  assert.match(app.calls.status.at(-1), /legacy\.sh/);

  // 焦點移回 commit 清單：context key 關閉，指令不作用
  await (await row('feat(auth): add API keys')).click();
  await h.until(() => focusContext().at(-1) === false, '失去焦點時清除 context key');
  await openSelected();
  assert.equal(opened().length, n);
});

test('Select In（Alt+F1、右鍵）：在檔案總管檢視、檔案管理員或終端機中顯示工作目錄的檔案；已刪除的檔案只提示', async () => {
  const tree = page.locator('.details-pane .file-tree');
  const selectIn = () => app.calls.commands['gitWorkbench.selectInSelectedFile']();
  const revealed = (cmd) => app.calls.executed.filter(([c]) => c === cmd).map((a) => a[1].fsPath.replace(/\\/g, '/'));
  await (await row('feat(auth): add API keys')).click();
  await tree.locator('.tree-row', { hasText: 'keys.ts' }).click();
  await page.waitForTimeout(200);

  // 快捷鍵指令：跳出三個選項，選檔案總管檢視
  const picks = app.calls.quickPicks.length;
  app.calls.picks.push((x) => x.label === 'Reveal in Explorer View');
  await selectIn();
  await h.until(() => revealed('revealInExplorer').length > 0, '在檔案總管檢視中顯示');
  assert.deepEqual(app.calls.quickPicks[picks], ['Reveal in Explorer View', process.platform === 'win32' ? 'Reveal in File Explorer' : process.platform === 'darwin' ? 'Reveal in Finder' : 'Open Containing Folder', 'Open in Integrated Terminal']);
  assert.match(revealed('revealInExplorer').at(-1), /\/api-server\/src\/auth\/keys\.ts$/);

  // 右鍵選單：選終端機
  app.calls.picks.push((x) => x.label === 'Open in Integrated Terminal');
  await tree.locator('.tree-row', { hasText: 'keys.ts' }).click({ button: 'right' });
  await h.menu(page, 'Select In…');
  await h.until(() => revealed('openInIntegratedTerminal').length > 0, '在終端機中開啟');

  // 已刪除的檔案：右鍵停用；快捷鍵只在狀態列提示，不跳選單
  await (await row('chore: drop legacy script')).click();
  await tree.locator('.tree-row', { hasText: 'legacy.sh' }).click({ button: 'right' });
  assert.equal(await page.locator('.context-menu .menu-item.disabled', { hasText: 'Select In…' }).count(), 1);
  await page.keyboard.press('Escape');
  await tree.locator('.tree-row', { hasText: 'legacy.sh' }).click();
  await page.waitForTimeout(200);
  const n = app.calls.quickPicks.length;
  await selectIn();
  assert.equal(app.calls.quickPicks.length, n);
  assert.match(app.calls.status.at(-1), /legacy\.sh/);
});

test('檔案樹右鍵選單：顯示差異、開啟檔案、開啟儲存庫版本、Select In、複製檔名與路徑；刪除的檔案停用開啟與 Select In', async () => {
  const opened = () => app.calls.executed.filter(([c]) => c === 'vscode.open').map((a) => a[1]);
  const tree = page.locator('.details-pane .file-tree');
  const keys = 'feat(auth): add API keys';
  await (await row(keys)).click();
  const hash = h.git(`${pg}/api-server`, 'log', '--format=%H', '-1', '-F', '--grep', 'feat(auth): add API keys', 'main');

  const openMenu = async (name) => {
    await tree.locator('.tree-row', { hasText: name }).click({ button: 'right' });
    await page.waitForSelector('.context-menu');
  };
  await openMenu('keys.ts');
  assert.deepEqual(await h.texts(page.locator('.context-menu .menu-item .menu-label')), ['Show Diff', 'Open File', 'Open Repository Version', 'Select In…', 'Copy File Name', 'Copy Path']);
  assert.match(await tree.locator('.tree-row.selected').innerText(), /keys\.ts/, '右鍵同時選取該檔案');

  app.calls.clipboard = undefined;
  await h.menu(page, 'Copy File Name');
  await h.until(() => app.calls.clipboard === 'keys.ts');
  await openMenu('keys.ts');
  await h.menu(page, 'Copy Path');
  await h.until(() => app.calls.clipboard === 'src/auth/keys.ts');

  let n = opened().length;
  await openMenu('keys.ts');
  await h.menu(page, 'Open File');
  await h.until(() => opened().length > n);
  assert.equal(opened().at(-1).scheme, 'file');
  assert.match(opened().at(-1).fsPath.replace(/\\/g, '/'), /\/api-server\/src\/auth\/keys\.ts$/);

  n = opened().length;
  await openMenu('keys.ts');
  await h.menu(page, 'Open Repository Version');
  await h.until(() => opened().length > n);
  assert.equal(opened().at(-1).scheme, 'git-workbench');
  assert.equal(JSON.parse(opened().at(-1).query).ref, hash);

  // Shift+F10 也能開選單
  await tree.locator('.tree-row', { hasText: 'keys.ts' }).click();
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.context-menu .menu-item.active');
  await page.keyboard.press('Escape');

  // 刪除的檔案：開啟檔案、開啟儲存庫版本停用
  await (await row('chore: drop legacy script')).click();
  await openMenu('legacy.sh');
  const disabled = await h.texts(page.locator('.context-menu .menu-item.disabled .menu-label'));
  assert.deepEqual(disabled, ['Open File', 'Open Repository Version', 'Select In…']);
  await page.keyboard.press('Escape');

  // 資料夾列沒有選單
  await page.locator('.details-pane .file-tree .tree-row', { hasText: 'scripts' }).click({ button: 'right' });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.context-menu').count(), 0);
});

test('多選：Shift+點選顯示合併變更；Ctrl+C 與右鍵都複製全部選取的 hash', async () => {
  await (await row('feat(auth): rotate API keys')).click();
  await (await row('docs: describe key rotation')).click({ modifiers: ['Shift'] });
  await h.eventually(async () => {
    const files = (await h.texts(page.locator('.file-tree .tree-row .tree-label'))).join(' ');
    assert.match(files, /rotate\.ts/);
    assert.match(files, /auth\.md/);
  });
  const expected = h.git(`${pg}/api-server`, 'log', '--format=%H', '-2', 'main').split('\n').join('\n');
  // Ctrl+C 與右鍵選單一樣複製全部選取的 hash
  app.calls.clipboard = undefined;
  await page.keyboard.press('Control+c');
  await h.until(() => app.calls.clipboard === expected);
  await (await row('docs: describe key rotation')).click({ button: 'right' });
  app.calls.clipboard = undefined;
  await h.menu(page, 'Copy 2 Revision Numbers');
  await h.until(() => app.calls.clipboard === expected);
});

test('右鍵選單包含 IntelliJ 的 commit 操作', async () => {
  await (await row('feat(cache): try in-memory cache')).click();
  await (await row('feat(cache): try in-memory cache')).click({ button: 'right' });
  const items = (await h.texts(page.locator('.context-menu[data-level="0"] .menu-item'))).join(' / ');
  for (const s of ['Cherry-Pick', 'Revert Commit', 'Reset Current Branch to Here', 'New Branch', 'New Tag', 'Interactively Rebase from Here', 'Push All up to Here']) assert.ok(items.includes(s), `${s} 不在：${items}`);
  await page.keyboard.press('Escape');
});

test('Log 分頁：新增分頁各自保留篩選', async () => {
  await page.locator('.filter-bar [title="View options"]').click();
  await h.menu(page, 'New Log Tab');
  await h.eventually(async () => assert.equal(await page.locator('.log-tab').count(), 2));
  await search('pagination');
  await page.locator('.log-tab').first().click();
  await settle();
  assert.equal(await page.locator('.log-search input').inputValue(), '');
  await page.locator('.log-tab').nth(1).click();
  await settle();
  assert.equal(await page.locator('.log-search input').inputValue(), 'pagination');
  await page.locator('.log-tab').nth(1).locator('.tab-close').click();
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.log-tabs.hidden').count());
});

test('欄位：拖曳 Author 欄左緣調整寬度；👁 隱藏 Hash 欄', async () => {
  const width = () => page.locator('.log-row:visible .cell-author').first().evaluate((e) => e.offsetWidth);
  const before = await width();
  const box = await page.locator('.col-resizer').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + 5, { steps: 4 });
  await page.mouse.up();
  const after = await width();
  assert.ok(after > before + 30, `${before} → ${after}`);
  await page.locator('.filter-bar [title="View options"]').click();
  await h.menu(page, 'Show Hash');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.hide-hash').count());
});

test('鍵盤：Shift+F10 開右鍵選單，方向鍵移動、Enter 執行、Esc 關閉', async () => {
  const subject = 'feat(auth): add API keys';
  await (await row(subject)).click();
  await page.waitForFunction((t) => [...document.querySelectorAll('.log-row.selected')].some((r) => r.style.display !== 'none' && r.textContent.includes(t)), subject);
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.context-menu .menu-item.active');
  assert.match(await page.locator('.context-menu .menu-item.active').innerText(), /^Copy/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.context-menu').count(), 0);
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('End');
  assert.doesNotMatch(await page.locator('.context-menu .menu-item.active .menu-label').innerText(), /^Copy Revision/);
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.context-menu .menu-item.active .menu-label').innerText(), 'Copy Revision Number');
  assert.equal(await page.locator('.context-menu .menu-item.active .menu-key').innerText(), 'Ctrl+C');
  await page.keyboard.press('Enter');
  const hash = h.git(`${pg}/api-server`, 'log', '-1', '--format=%H', '--grep=add API keys');
  await h.until(() => app.calls.clipboard === hash);
  assert.equal(await page.locator('.context-menu').count(), 0);
});

test('webview 已處理的按鍵不轉給 VS Code（避免 Shift+F10 同時觸發使用者的快速鍵）；未處理的照常轉送', async () => {
  // VS Code 在 webview 的 window 上（冒泡階段）監聽 keydown 並比對快速鍵：這裡模擬那個監聽
  await page.evaluate(() => {
    window.__forwarded = [];
    window.addEventListener('keydown', (e) => window.__forwarded.push(`${e.shiftKey ? 'Shift+' : ''}${e.key}`));
  });
  const forwarded = () => page.evaluate(() => window.__forwarded);
  await (await row('feat(auth): add API keys')).click();
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.context-menu');
  await page.keyboard.press('Escape');
  await page.locator('.details-pane .file-tree .tree-row', { hasText: 'keys.ts' }).click();
  await page.keyboard.press('F4');
  const keys = await forwarded();
  assert.ok(!keys.includes('Shift+F10'), `Shift+F10 不應轉送：${keys.join(', ')}`);
  assert.ok(keys.includes('F4'), `F4 要轉送（自訂快速鍵）：${keys.join(', ')}`);
});

test('沒有符合的 commit：提示並可一鍵清除篩選', async () => {
  await search('no-such-commit-xyz');
  assert.match(await page.locator('.log-overlay').innerText(), /No commits matching filters/);
  await page.locator('.log-overlay-action', { hasText: 'Clear filters' }).click();
  await settle();
  assert.equal(await page.locator('.log-search input').inputValue(), '');
  assert.ok((await subjects()).length > 20);
});

test('變更檔案列尾顯示狀態字母', async () => {
  await (await row('docs: rename orders guide')).click();
  await h.eventually(async () => assert.deepEqual(await h.texts(page.locator('.file-tree .status-letter')), ['R']));
  assert.equal(await page.locator('.file-tree .status-letter').first().getAttribute('aria-label'), 'Renamed');
});

test('鍵盤：↑↓／PageDown／Home／End 移動、Ctrl+C 複製 hash、Ctrl+F 聚焦搜尋、Esc 清除', async () => {
  const selected = () => page.evaluate(() => [...document.querySelectorAll('.log-row.selected')].find((r) => r.style.display !== 'none')?.querySelector('.cell-subject-text')?.textContent ?? '');
  await (await row('feat(auth): add API keys')).click();
  // 畫面上的列依位置排序（列節點會重複使用，DOM 順序不等於畫面順序）
  const ordered = () => page.evaluate(() => [...document.querySelectorAll('.log-row')].filter((r) => r.style.display !== 'none').sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index)).map((r) => r.querySelector('.cell-subject-text')?.textContent ?? ''));
  const list = await ordered();
  const at = list.indexOf('feat(auth): add API keys');
  await page.keyboard.press('ArrowDown');
  await h.until(async () => (await selected()) === list[at + 1]);
  await page.keyboard.press('ArrowUp');
  await h.until(async () => (await selected()) === list[at]);
  await page.keyboard.press('Home');
  await h.until(async () => (await selected()) === (await ordered())[0]);
  await page.keyboard.press('PageDown');
  await h.until(async () => (await selected()) !== (await ordered())[0]);
  await page.keyboard.press('End');
  // 最後一筆：捲到底後畫面上最後一列
  await h.until(async () => (await selected()) === (await ordered()).at(-1));
  await page.keyboard.press('Home');
  await h.until(async () => (await selected()) === (await ordered())[0]);
  // Ctrl+C：複製選取 commit（最上面一筆）的 hash；先清掉前面測試留下的剪貼簿內容
  app.calls.clipboard = undefined;
  await page.keyboard.press('Control+C');
  const topHash = await page.evaluate(() => [...document.querySelectorAll('.log-row.selected')].find((r) => r.style.display !== 'none')?.querySelector('.cell-hash')?.textContent ?? '');
  await h.until(() => typeof app.calls.clipboard === 'string' && app.calls.clipboard.length === 40 && app.calls.clipboard.startsWith(topHash));
  await page.keyboard.press('Control+F');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('.log-search') !== null), true);
  await page.keyboard.type('pagination');
  await page.keyboard.press('Enter');
  await settle();
  await page.keyboard.press('Escape');
  await settle();
  assert.equal(await page.locator('.log-search input').inputValue(), '');
});

test('沒有 webview 錯誤（Log、提交視窗、對話框分頁）', () => {
  assert.deepEqual(app.pageErrors(), []);
  assert.deepEqual(app.calls.errors, []);
});
