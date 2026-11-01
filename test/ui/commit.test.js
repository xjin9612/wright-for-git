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
  assert.equal(h.git(web, 'stash', 'list').split('\n').length, 1);
});

test('儲藏變更：從工具列儲藏 web-app 的修改', async () => {
  fs.appendFileSync(path.join(web, 'src/theme.ts'), '// tweak\n');
  app.calls.picks.push((x) => x.label === 'web-app', (x) => /Tracked/.test(x.label));
  app.calls.inputs.push('from ui test');
  await cv.locator('.stash-pane [title="Stash Changes…"]').click();
  await h.until(() => h.git(web, 'stash', 'list').includes('from ui test'));
  await h.until(async () => (await h.texts(cv.locator('.stash-list .tree-row'))).some((s) => s.startsWith('from ui test')));
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

test('沒有 webview 錯誤', () => {
  assert.deepEqual(h.pageErrors(app.log), []);
});
