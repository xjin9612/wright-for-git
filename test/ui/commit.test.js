// 提交視窗：勾選提交、逐段提交、跨 repo、Amend、捨棄、.gitignore、Changelist、分組、儲藏分頁（對應 docs/TESTING.md「提交視窗」「儲藏」）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./host');

let pg;
let app;
let cv;
let cvView;
let api;
let web;

before(async () => {
  pg = h.makePlayground();
  api = `${pg}/api-server`;
  web = `${pg}/web-app`;
  app = await h.launch(pg);
  cvView = await app.commitView();
  cv = cvView.page;
  await h.until(() => (cvView.posted.commitState ?? 0) > 0);
  await cv.waitForTimeout(300);
});
after(async () => app && (await app.close()));

const rows = () => h.texts(cv.locator('.commit-tree .tree-row'));
const fileRow = (name) => cv.locator('.commit-tree .tree-row', { hasText: new RegExp(`^\\s*\\S*\\s*${name.replace(/\./g, '\\.')}`) }).first();
const box = (name) => fileRow(name).locator('input.commit-check');
/** 按重新整理並等 extension 送回新的狀態（Windows 上 git 較慢，不用固定等待時間） */
async function reload() {
  const n = cvView.posted.commitState ?? 0;
  await cv.locator('.commit-pane:not(.stash-pane) .commit-toolbar [title="Refresh"]').click();
  await h.until(() => (cvView.posted.commitState ?? 0) > n, 30000);
  await cv.waitForTimeout(200);
}
async function commit(message) {
  await cv.locator('.commit-message').fill(message);
  await cv.locator('.commit-actions .button.primary').click();
  await h.until(async () => (await cv.locator('.commit-message').inputValue()) === '', 40000);
  await reload();
}
const headFiles = (repo) => h.git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);

test('載入提示：第一次載入在提交視窗頂端顯示 VS Code 的進度；之後的更新不顯示', async () => {
  const commitProgress = () => app.calls.progress.filter((l) => l?.viewId === 'gitWorkbench.commit').length;
  assert.equal(commitProgress(), 1, JSON.stringify(app.calls.progress));
});

test('列出兩個 repo 的變更、未追蹤檔案；預設勾選變更、不勾未追蹤', async () => {
  const list = (await rows()).join(' / ');
  for (const s of ['Changes', 'api-server', 'web-app', 'config.ts', 'db.yml', 'index.ts', 'Login.tsx', 'Unversioned Files', 'todo.ts']) assert.ok(list.includes(s), `${s}：${list}`);
  assert.ok(await box('config.ts').isChecked());
  assert.ok(!(await box('todo.ts').isChecked()));
  assert.equal(await cv.locator('.commit-actions .button.primary').isDisabled(), true, '沒有訊息時提交停用');
  // 狀態字母：修改 M、刪除 D、未追蹤 U
  const letter = async (name) => fileRow(name).locator('.status-letter').innerText();
  assert.equal(await letter('config.ts'), 'M');
  assert.equal(await letter('db.yml'), 'D');
  assert.equal(await letter('todo.ts'), 'U');
});

test('分組方式：模組讓 packages/sdk 成為獨立一組；平鋪', async () => {
  await cv.locator('.commit-pane:not(.stash-pane) .commit-toolbar [title="View options"]').click();
  await h.menu(cv, 'Module');
  await cv.keyboard.press('Escape');
  await cv.waitForTimeout(200);
  assert.ok((await rows()).some((r) => /^sdk\b.*packages\/sdk/.test(r)), (await rows()).join(' / '));
  await cv.locator('.commit-pane:not(.stash-pane) .commit-toolbar [title="View options"]').click();
  await h.menu(cv, 'Module');
  await h.menu(cv, 'Directory');
  await cv.keyboard.press('Escape');
  await cv.waitForTimeout(200);
  assert.ok(!(await rows()).some((r) => /^src\b/.test(r)), '平鋪時沒有資料夾列');
  await cv.locator('.commit-pane:not(.stash-pane) .commit-toolbar [title="View options"]').click();
  await h.menu(cv, 'Directory');
  await cv.keyboard.press('Escape');
});

test('逐段提交：只提交 config.ts 的第一段；第二段留在工作區；內建暫存區不受影響', async () => {
  fs.writeFileSync(path.join(api, 'staged-by-me.txt'), 'x\n');
  h.git(api, 'add', 'staged-by-me.txt');
  await reload();
  await fileRow('config.ts').click({ button: 'right' });
  const n = app.calls.panels.length;
  await h.menu(cv, 'Select Changes to Commit');
  await h.until(() => app.calls.panels.length > n);
  const d = await app.lastPanel();
  await d.page.waitForSelector('.hunk');
  assert.equal(await d.page.locator('.hunk').count(), 2);
  await d.page.locator('.hunk input').nth(1).uncheck();
  await d.page.locator('.button.primary').click();
  await cv.waitForTimeout(1000);
  assert.deepEqual(await h.texts(cv.locator('.commit-partial')), ['1/2 changes']);
  // 只勾 config.ts（取消其他）
  for (const name of ['db.yml', 'index.ts', 'Login.tsx', 'staged-by-me.txt']) if (await box(name).isChecked()) await box(name).click();
  await commit('feat: port 8080');
  assert.deepEqual(headFiles(api), ['src/config.ts']);
  const committed = h.git(api, 'show', 'HEAD:src/config.ts');
  assert.match(committed, /port = 8080/);
  assert.doesNotMatch(committed, /debug/);
  assert.match(h.git(api, 'diff', 'HEAD', '--', 'src/config.ts'), /debug/);
  assert.match(h.git(api, 'diff', '--cached', '--name-only'), /staged-by-me\.txt/, '使用者自己暫存的檔案仍在暫存區');
  await d.page.close();
});

test('跨 repo 提交：各產生一個相同訊息的 commit', async () => {
  await reload();
  for (const name of ['config.ts', 'db.yml', 'index.ts', 'staged-by-me.txt']) if (await box(name).isChecked()) await box(name).click();
  if (!(await box('Login.tsx').isChecked())) await box('Login.tsx').click();
  if (!(await box('todo.ts').isChecked())) await box('todo.ts').click();
  await commit('chore: two repos');
  assert.equal(h.git(api, 'log', '-1', '--format=%s'), 'chore: two repos');
  assert.equal(h.git(web, 'log', '-1', '--format=%s'), 'chore: two repos');
  assert.deepEqual(headFiles(api), ['src/todo.ts']);
  assert.deepEqual(headFiles(web), ['src/pages/Login.tsx']);
});

test('Amend：帶入上一個訊息；只改訊息也會生效', async () => {
  await reload();
  for (let i = 0; i < 20 && (await cv.locator('.commit-tree input.commit-check:checked').count()) > 0; i++) {
    await cv.locator('.commit-tree input.commit-check:checked').first().click();
    await cv.waitForTimeout(100);
  }
  // 只留 api-server：取消所有勾選後，Amend 作用在第一個 repo
  await cv.locator('#commit-amend').check();
  await h.until(async () => (await cv.locator('.commit-message').inputValue()) === 'chore: two repos');
  const count = h.git(api, 'rev-list', '--count', 'HEAD');
  await commit('chore: two repos (amended)');
  assert.equal(h.git(api, 'log', '-1', '--format=%s'), 'chore: two repos (amended)');
  assert.equal(h.git(api, 'rev-list', '--count', 'HEAD'), count);
});

test('捨棄變更需確認；修改還原、新增檔案變回未追蹤', async () => {
  fs.writeFileSync(path.join(api, 'added.txt'), 'new\n');
  h.git(api, 'add', 'added.txt');
  await reload();
  await fileRow('db.yml').click();
  await fileRow('added.txt').click({ modifiers: ['Control'] });
  await fileRow('added.txt').click({ button: 'right' });
  await h.menu(cv, 'Rollback');
  await cv.waitForSelector('.confirm-dialog');
  await cv.locator('.confirm-dialog .button.danger').click();
  await h.until(() => fs.existsSync(path.join(api, 'config/db.yml')));
  assert.ok(fs.existsSync(path.join(api, 'added.txt')), '新增的檔案保留');
  assert.match(h.git(api, 'status', '--porcelain', '--', 'added.txt'), /^\?\?/);
});

test('加入 .gitignore：未追蹤檔案移到已忽略', async () => {
  await reload();
  await fileRow('added.txt').click({ button: 'right' });
  await h.menu(cv, 'Add to .gitignore');
  await h.until(() => fs.readFileSync(path.join(api, '.gitignore'), 'utf8').includes('/added.txt'));
  await reload();
  assert.ok(!(await rows()).some((r) => r.includes('added.txt')));
});

test('Changelist：新增並把檔案移過去', async () => {
  await reload();
  app.calls.inputs.push('UI work');
  await fileRow('index.ts').click({ button: 'right' });
  await cv.locator('.context-menu .menu-item', { hasText: 'Move to Another Changelist' }).hover();
  await cv.locator('.context-menu[data-level="1"] .menu-item', { hasText: 'New Changelist' }).dispatchEvent('mousedown');
  await h.until(async () => (await rows()).some((r) => r.startsWith('UI work')));
  const list = await rows();
  const idx = list.findIndex((r) => r.startsWith('UI work'));
  assert.ok(list.slice(idx).some((r) => r.includes('index.ts')), list.join(' / '));
});

test('儲藏分頁：列出 stash、檔案依分組顯示、未追蹤另列；刪除需確認且清單立即更新', async () => {
  await cv.locator('.commit-tab', { hasText: 'Stash' }).click();
  await cv.waitForTimeout(1000);
  const stashes = await h.texts(cv.locator('.stash-list .tree-row'));
  assert.ok(stashes.some((s) => s.startsWith('draft: new page')) && stashes.some((s) => s.startsWith('wip: refactor')), stashes.join(' / '));
  const files = await h.texts(cv.locator('.stash-files .tree-row'));
  assert.ok(files.some((f) => f.startsWith('Untracked files')) && files.some((f) => f.includes('Draft.tsx')), files.join(' / '));
  await cv.locator('.stash-files .tree-row', { hasText: 'App.css' }).dblclick();
  await h.until(() => app.calls.executed.some((c) => c[0] === 'vscode.diff'));

  await cv.locator('.stash-list .tree-row', { hasText: 'wip: refactor' }).click({ button: 'right' });
  await h.menu(cv, 'Drop…');
  await cv.waitForSelector('.confirm-dialog');
  await cv.locator('.confirm-dialog .button.danger').click();
  await h.until(async () => (await cv.locator('.stash-list .tree-row').count()) === stashes.length - 1);
  const left = h.git(web, 'stash', 'list').split('\n').filter(Boolean);
  assert.equal(left.length, 1);
  assert.match(left[0], /draft: new page/);
});

test('儲藏變更：從工具列儲藏 web-app 的修改', async () => {
  fs.appendFileSync(path.join(web, 'src/theme.ts'), '// tweak\n');
  app.calls.picks.push((x) => x.label === 'web-app', (x) => /Tracked/.test(x.label));
  app.calls.inputs.push('from ui test');
  await cv.locator('.stash-pane [title="Stash Changes…"]').click();
  await h.until(() => h.git(web, 'stash', 'list').includes('from ui test'));
  await h.until(async () => (await h.texts(cv.locator('.stash-list .tree-row'))).some((s) => s.startsWith('from ui test')));
});

test('擱置：跨兩個 repo 選取的檔案擱置成同一筆（不在 stash 清單）；保留工作目錄的版本檔案留著', async () => {
  const shelfRefs = (dir) => h.git(dir, 'for-each-ref', '--format=%(refname)', 'refs/git-workbench/shelf/').split('\n').filter(Boolean);
  const stashesBefore = h.git(web, 'stash', 'list');
  fs.writeFileSync(path.join(api, 'shelf-a.txt'), 'a\n');
  fs.writeFileSync(path.join(web, 'shelf-b.txt'), 'b\n');
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
  await reload();
  await fileRow('shelf-a.txt').click();
  await fileRow('shelf-b.txt').click({ modifiers: ['Control'] });
  app.calls.inputs.push('ui shelf');
  await fileRow('shelf-b.txt').click({ button: 'right' });
  await h.menu(cv, 'Shelve Changes…');
  await h.until(() => !fs.existsSync(path.join(api, 'shelf-a.txt')) && !fs.existsSync(path.join(web, 'shelf-b.txt')), '兩個 repo 的檔案都被擱置');
  // 檔案先移走、擱置記錄稍後才寫入：等兩個 repo 都有記錄
  await h.until(() => shelfRefs(api).length === 1 && shelfRefs(web).length === 1, '兩個 repo 都有擱置記錄');
  const [refA] = shelfRefs(api);
  assert.ok(refA, 'api-server 有 shelf');
  assert.deepEqual(shelfRefs(web), [refA], '兩個 repo 共用同一個 id');
  assert.match(h.git(api, 'log', '-1', '--format=%s', refA), /shelf:\S+ ui shelf$/);
  assert.equal(h.git(web, 'stash', 'list'), stashesBefore, 'stash 清單不變');

  // 保留工作目錄：檔案還在，多一筆 shelf
  fs.writeFileSync(path.join(api, 'shelf-c.txt'), 'c\n');
  await reload();
  app.calls.inputs.push('keep copy');
  await fileRow('shelf-c.txt').click({ button: 'right' });
  await h.menu(cv, 'Shelve Changes, Keep in Working Tree…');
  await h.until(() => shelfRefs(api).length === 2, '多一筆 shelf');
  assert.ok(fs.existsSync(path.join(api, 'shelf-c.txt')), '檔案保留');
});

test('擱置分頁：清單、檔案依 repo 分組、diff；取回對話框（預先勾選、移除取回的檔案、保留）、改名、多選刪除', async () => {
  const shelfRefs = (dir) => h.git(dir, 'for-each-ref', '--format=%(refname)', 'refs/git-workbench/shelf/').split('\n').filter(Boolean);
  const shelfRow = (name) => cv.locator('.shelf-list .tree-row', { hasText: name });
  const dialogFiles = () => h.texts(cv.locator('.unshelve-dialog .unshelve-file'));
  const checkedFiles = () => cv.locator('.unshelve-dialog .unshelve-file input:checked').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  await cv.locator('.commit-tab', { hasText: /^Shelf$/ }).click();
  await h.until(async () => (await cv.locator('.shelf-list .tree-row').count()) === 2, '兩筆擱置');
  assert.deepEqual(await h.texts(cv.locator('.shelf-list .tree-row .tree-label')), ['keep copy', 'ui shelf'], '新的在前');
  assert.match(await shelfRow('ui shelf').innerText(), /2 repositories/);

  // 檔案依 repo 分組；雙擊開 diff
  await shelfRow('ui shelf').click();
  await h.eventually(async () => {
    const files = (await h.texts(cv.locator('.shelf-pane .stash-files .tree-row'))).join(' / ');
    for (const x of ['api-server', 'web-app', 'shelf-a.txt', 'shelf-b.txt']) assert.ok(files.includes(x), files);
  });
  const diffs = app.calls.executed.filter((c) => c[0] === 'vscode.diff').length;
  await cv.locator('.shelf-pane .stash-files .tree-row', { hasText: 'shelf-a.txt' }).dblclick();
  await h.until(() => app.calls.executed.filter((c) => c[0] === 'vscode.diff').length > diffs, '開 diff');

  // 從檔案右鍵取回：對話框只預先勾選這個檔案；取回後該檔案從擱置移除（web-app 沒有剩下的檔案，整筆移除）
  await cv.locator('.shelf-pane .stash-files .tree-row', { hasText: 'shelf-b.txt' }).click({ button: 'right' });
  await h.menu(cv, 'Unshelve…');
  await cv.waitForSelector('.unshelve-dialog');
  assert.equal((await dialogFiles()).length, 2, `對話框列出全部檔案：${(await dialogFiles()).join(' / ')}`);
  assert.deepEqual(await checkedFiles(), ['shelf-b.txt'], '只預先勾選右鍵的檔案');
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => fs.existsSync(path.join(web, 'shelf-b.txt')), 'web-app 的檔案取回');
  await h.until(() => shelfRefs(web).length === 0, 'web-app 的部分移除');
  await h.until(async () => !/2 repositories/.test(await shelfRow('ui shelf').innerText()), '清單更新');

  // 雙擊整筆開對話框；取消「從擱置移除」：檔案取回、擱置保留
  await shelfRow('ui shelf').dblclick();
  await cv.waitForSelector('.unshelve-dialog');
  assert.deepEqual(await checkedFiles(), ['shelf-a.txt']);
  await cv.locator('#unshelve-remove').uncheck();
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => fs.existsSync(path.join(api, 'shelf-a.txt')), 'api-server 的檔案取回');
  await cv.waitForTimeout(300);
  assert.equal(shelfRefs(api).length, 2, '保留在擱置中');

  // Esc 關閉對話框，不取回
  await shelfRow('ui shelf').dblclick();
  await cv.waitForSelector('.unshelve-dialog');
  await cv.keyboard.press('Escape');
  assert.equal(await cv.locator('.unshelve-dialog').count(), 0);

  // 改名
  app.calls.inputs.push('renamed shelf');
  await shelfRow('ui shelf').click({ button: 'right' });
  await h.menu(cv, 'Rename…');
  await h.until(async () => (await shelfRow('renamed shelf').count()) === 1, '改名');

  // 多選兩筆一起刪除（需確認）；多選時取回停用
  await shelfRow('keep copy').click();
  await shelfRow('renamed shelf').click({ modifiers: ['Control'] });
  await shelfRow('renamed shelf').click({ button: 'right' });
  assert.equal(await cv.locator('.context-menu .menu-item.disabled', { hasText: 'Unshelve…' }).count(), 1, '多選時取回停用');
  await h.menu(cv, 'Delete 2 Entries…');
  await cv.waitForSelector('.confirm-dialog');
  await cv.locator('.confirm-dialog .button.danger').click();
  await h.until(async () => (await cv.locator('.shelf-list .tree-row').count()) === 0, '全部刪除');
  assert.equal(shelfRefs(api).length, 0);
  for (const f of [path.join(api, 'shelf-a.txt'), path.join(api, 'shelf-c.txt'), path.join(web, 'shelf-b.txt')]) fs.rmSync(f, { force: true });
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
});

test('鍵盤：空白鍵切換勾選；提交訊息中 Ctrl+Enter 提交', async () => {
  await cv.locator('.commit-tab', { hasText: 'Commit' }).click();
  fs.appendFileSync(path.join(web, 'src/App.css'), '/* keyboard */\n');
  await reload();
  await fileRow('App.css').click();
  const before = await box('App.css').isChecked();
  await cv.keyboard.press(' ');
  await h.until(async () => (await box('App.css').isChecked()) !== before);
  if (!(await box('App.css').isChecked())) await cv.keyboard.press(' ');
  for (let i = 0; i < 20; i++) {
    const others = cv.locator('.commit-tree .tree-row').filter({ hasNot: cv.locator('text=App.css') }).locator('input.commit-check:checked');
    if ((await others.count()) === 0) break;
    const row = await others.first().evaluate((el) => el.closest('.tree-row')?.textContent ?? '');
    if (/App\.css|web-app|src|Changes/.test(row)) break;
    await others.first().click();
  }
  await cv.locator('.commit-message').fill('style: keyboard commit');
  await cv.locator('.commit-message').press('Control+Enter');
  await h.until(() => h.git(web, 'log', '-1', '--format=%s') === 'style: keyboard commit');
});

test('沒有 webview 錯誤（Log、提交視窗、對話框分頁）', () => {
  assert.deepEqual(app.pageErrors(), []);
});
