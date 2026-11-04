// 提交視窗：勾選提交、逐段提交、跨 repo、Amend、捨棄、.gitignore、Changelist、分組、儲藏分頁、擱置（對應 docs/TESTING.md「提交視窗」「儲藏」「擱置」）
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
  const commitProgress = () => app.calls.progress.filter((l) => l?.viewId === 'wright.commit').length;
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
  const shelfRefs = (dir) => h.git(dir, 'for-each-ref', '--format=%(refname)', 'refs/wright/shelf/').split('\n').filter(Boolean);
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
  const shelfRefs = (dir) => h.git(dir, 'for-each-ref', '--format=%(refname)', 'refs/wright/shelf/').split('\n').filter(Boolean);
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
  assert.equal(await cv.locator('.context-menu .menu-item:not(.disabled)', { hasText: 'Unshelve 2 Entries…' }).count(), 1, '多選時可依序取回');
  await h.menu(cv, 'Delete 2 Entries…');
  await cv.waitForSelector('.confirm-dialog');
  await cv.locator('.confirm-dialog .button.danger').click();
  await h.until(async () => (await cv.locator('.shelf-list .tree-row').count()) === 0, '全部刪除');
  assert.equal(shelfRefs(api).length, 0);
  for (const f of [path.join(api, 'shelf-a.txt'), path.join(api, 'shelf-c.txt'), path.join(web, 'shelf-b.txt')]) fs.rmSync(f, { force: true });
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
});

test('擱置匯出／匯入 patch：跨 repo 匯出成各 repo 一個檔；匯入後判斷 repo 並成為一筆擱置', async () => {
  const shelfRefs = (dir) => h.git(dir, 'for-each-ref', '--format=%(refname)', 'refs/wright/shelf/').split('\n').filter(Boolean);
  const shelfRow = (name) => cv.locator('.shelf-list .tree-row', { hasText: name });
  const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gwb-patch-'));
  fs.writeFileSync(path.join(api, 'patch-a.txt'), 'pa\n');
  fs.writeFileSync(path.join(web, 'patch-b.txt'), 'pb\n');
  await reload();
  await fileRow('patch-a.txt').click();
  await fileRow('patch-b.txt').click({ modifiers: ['Control'] });
  app.calls.inputs.push('patch me');
  await fileRow('patch-b.txt').click({ button: 'right' });
  await h.menu(cv, 'Shelve Changes…');
  await h.until(() => shelfRefs(api).length === 1 && shelfRefs(web).length === 1, '擱置');

  // 匯出：兩個 repo，選資料夾，每個 repo 一個檔
  await cv.locator('.commit-tab', { hasText: /^Shelf$/ }).click();
  await h.until(async () => (await shelfRow('patch me').count()) === 1, '清單');
  app.calls.dialogs.push(out);
  await shelfRow('patch me').click({ button: 'right' });
  await h.menu(cv, 'Export Patch…');
  const files = ['patch me-api-server.patch', 'patch me-web-app.patch'].map((f) => path.join(out, f));
  await h.until(() => files.every((f) => fs.existsSync(f)), '匯出兩個檔');
  assert.match(fs.readFileSync(files[0], 'utf8'), /patch-a\.txt/);

  // 刪除擱置後再匯入：依檔名判斷 repo，成為一筆跨兩個 repo 的擱置，不動工作區
  await shelfRow('patch me').click({ button: 'right' });
  await h.menu(cv, 'Delete…');
  await cv.waitForSelector('.confirm-dialog');
  await cv.locator('.confirm-dialog .button.danger').click();
  await h.until(() => shelfRefs(api).length === 0 && shelfRefs(web).length === 0, '刪除');
  app.calls.dialogs.push(files);
  app.calls.inputs.push('imported');
  await cv.locator('.shelf-pane [title="Import Patches…"]').click();
  await h.until(async () => (await shelfRow('imported').count()) === 1, '匯入');
  assert.match(await shelfRow('imported').innerText(), /2 repositories/);
  assert.ok(!fs.existsSync(path.join(api, 'patch-a.txt')), '匯入不動工作區');
  assert.equal(shelfRefs(api).length, 1);
  assert.equal(shelfRefs(web).length, 1);

  await shelfRow('imported').click({ button: 'right' });
  await h.menu(cv, 'Delete…');
  await cv.waitForSelector('.confirm-dialog');
  await cv.locator('.confirm-dialog .button.danger').click();
  await h.until(() => shelfRefs(api).length === 0, '清除');
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
});

test('多筆擱置依序取回：由舊到新逐筆開對話框；中途取消時剩下的保留並提示', async () => {
  const shelfRefs = (dir) => h.git(dir, 'for-each-ref', '--format=%(refname)', 'refs/wright/shelf/').split('\n').filter(Boolean);
  const shelfRow = (name) => cv.locator('.shelf-list .tree-row', { hasText: name });
  const shelveFile = async (file, name) => {
    fs.writeFileSync(path.join(api, file), `${file}\n`);
    await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
    await reload();
    app.calls.inputs.push(name);
    await fileRow(file).click({ button: 'right' });
    await h.menu(cv, 'Shelve Changes…');
    await h.until(() => !fs.existsSync(path.join(api, file)), `擱置 ${file}`);
  };
  const header = () => cv.locator('.unshelve-dialog .push-header').innerText();
  const pickBoth = async (a, b) => {
    await cv.locator('.commit-tab', { hasText: /^Shelf$/ }).click();
    await h.until(async () => (await shelfRow(a).count()) === 1 && (await shelfRow(b).count()) === 1, '清單');
    await shelfRow(a).click();
    await shelfRow(b).click({ modifiers: ['Control'] });
    await shelfRow(b).click({ button: 'right' });
    await h.menu(cv, 'Unshelve 2 Entries…');
    await cv.waitForSelector('.unshelve-dialog');
  };

  await shelveFile('seq-1.txt', 'first');
  await shelveFile('seq-2.txt', 'second');
  await pickBoth('first', 'second');
  assert.match(await header(), /first.*\(1\/2\)/, '由舊到新');
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(async () => (await cv.locator('.unshelve-dialog').count()) === 1 && /second.*\(2\/2\)/.test(await header()), '接著開第二筆');
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => fs.existsSync(path.join(api, 'seq-1.txt')) && fs.existsSync(path.join(api, 'seq-2.txt')), '兩筆都取回');
  await h.until(() => shelfRefs(api).length === 0, '兩筆都移除');

  // 中途取消：第一筆就取消 → 兩筆都保留，提示沒有取回
  fs.rmSync(path.join(api, 'seq-1.txt'));
  fs.rmSync(path.join(api, 'seq-2.txt'));
  await shelveFile('seq-3.txt', 'third');
  await shelveFile('seq-4.txt', 'fourth');
  await pickBoth('third', 'fourth');
  const warnings = app.calls.warnings.length;
  await cv.locator('.unshelve-dialog .dialog-cancel').click();
  await h.until(() => app.calls.warnings.slice(warnings).some((w) => /2 shelved entries were not unshelved/.test(w)), '提示沒有取回');
  assert.equal(await cv.locator('.unshelve-dialog').count(), 0, '不再開下一筆');
  assert.equal(shelfRefs(api).length, 2);
  // 清理：直接刪掉這兩筆擱置
  for (const ref of shelfRefs(api)) h.git(api, 'update-ref', '-d', ref);
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
});

// ---------- 擱置：部分段落、暫存區、changelist、已存在、衝突、匯入選 repo ----------

const shelfRefsOf = (dir) => h.git(dir, 'for-each-ref', '--format=%(refname)', 'refs/wright/shelf/').split('\n').filter(Boolean);
const shelfRowOf = (name) => cv.locator('.shelf-list .tree-row', { hasText: name });
/** 在 api-server 建立並提交一個檔案（只提交這個路徑，不動其他暫存） */
function commitFile(file, content) {
  fs.writeFileSync(path.join(api, file), content);
  h.git(api, 'add', '--', file);
  h.git(api, 'commit', '-q', '-m', `add ${file}`, '--', file);
}
async function shelveRows(files, name, keep = false) {
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
  await reload();
  await fileRow(files[0]).click();
  for (const f of files.slice(1)) await fileRow(f).click({ modifiers: ['Control'] });
  const n = shelfRefsOf(api).length;
  app.calls.inputs.push(name);
  await fileRow(files[files.length - 1]).click({ button: 'right' });
  await h.menu(cv, keep ? 'Shelve Changes, Keep in Working Tree…' : 'Shelve Changes…');
  await h.until(() => shelfRefsOf(api).length > n, `擱置 ${name}`);
}
async function openUnshelve(name) {
  await cv.locator('.commit-tab', { hasText: /^Shelf$/ }).click();
  await h.until(async () => (await shelfRowOf(name).count()) === 1, `清單有 ${name}`);
  await shelfRowOf(name).dblclick();
  await cv.waitForSelector('.unshelve-dialog');
}
const dropAllShelves = () => {
  for (const ref of shelfRefsOf(api)) h.git(api, 'update-ref', '-d', ref);
  for (const ref of shelfRefsOf(web)) h.git(web, 'update-ref', '-d', ref);
};

test('擱置部分段落：輸入框提示只擱置選取的段落；擱置後只剩另一段；取回後兩段都在；使用者暫存的其他檔案留在暫存區', async () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  commitFile('hunks.txt', `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(api, 'hunks.txt'), `${['FIRST', ...lines.slice(1, 19), 'LAST'].join('\n')}\n`);
  fs.writeFileSync(path.join(api, 'shelf-staged.txt'), 's\n');
  h.git(api, 'add', '--', 'shelf-staged.txt');
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
  await reload();

  // 只勾第一段
  await fileRow('hunks.txt').click({ button: 'right' });
  const n = app.calls.panels.length;
  await h.menu(cv, 'Select Changes to Commit');
  await h.until(() => app.calls.panels.length > n, '開選取段落分頁');
  const d = await app.lastPanel();
  await d.page.waitForSelector('.hunk');
  assert.equal(await d.page.locator('.hunk').count(), 2);
  await d.page.locator('.hunk input').nth(1).uncheck();
  await d.page.locator('.button.primary').click();
  await h.until(async () => (await h.texts(cv.locator('.commit-partial'))).includes('1/2 changes'), '顯示 1/2');
  await d.page.close();

  const prompts = app.calls.inputPrompts.length;
  const refs = shelfRefsOf(api).length;
  app.calls.inputs.push('hunk shelf');
  await fileRow('hunks.txt').click();
  await fileRow('hunks.txt').click({ button: 'right' });
  await h.menu(cv, 'Shelve Changes…');
  await h.until(() => shelfRefsOf(api).length > refs, '擱置');
  assert.match(app.calls.inputPrompts[prompts] ?? '', /Only the selected changes of 1 file/);
  const text = () => fs.readFileSync(path.join(api, 'hunks.txt'), 'utf8');
  await h.until(() => !text().includes('FIRST'), '第一段移走');
  assert.match(text(), /LAST/, '第二段留在工作區');
  const [ref] = shelfRefsOf(api);
  assert.equal(h.git(api, 'diff', '--name-only', `${ref}^1`, ref).trim(), 'hunks.txt', '擱置只有這個檔案');
  const shelved = h.git(api, 'diff', `${ref}^1`, ref);
  assert.match(shelved, /\+FIRST/);
  assert.doesNotMatch(shelved, /LAST/);
  assert.match(h.git(api, 'diff', '--cached', '--name-only'), /shelf-staged\.txt/, '暫存的檔案仍在暫存區');

  await openUnshelve('hunk shelf');
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => text().includes('FIRST') && text().includes('LAST'), '取回後兩段都在');
  await h.until(() => shelfRefsOf(api).length === 0, '擱置移除');
  h.git(api, 'checkout', '--', 'hunks.txt');
  h.git(api, 'reset', '-q', '--', 'shelf-staged.txt');
  fs.rmSync(path.join(api, 'shelf-staged.txt'));
});

test('取回到 changelist：預設為擱置名稱；已追蹤的檔案放進該 changelist', async () => {
  commitFile('cl.txt', 'one\n');
  fs.writeFileSync(path.join(api, 'cl.txt'), 'two\n');
  await shelveRows(['cl.txt'], 'cl shelf');
  await h.until(() => fs.readFileSync(path.join(api, 'cl.txt'), 'utf8') === 'one\n', '擱置');
  await openUnshelve('cl shelf');
  assert.equal(await cv.locator('.unshelve-changelist').inputValue(), 'cl shelf');
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => fs.readFileSync(path.join(api, 'cl.txt'), 'utf8') === 'two\n', '取回');
  await cv.locator('.commit-tab', { hasText: /^Commit$/ }).click();
  await h.until(async () => {
    const list = await rows();
    const idx = list.findIndex((r) => r.startsWith('cl shelf'));
    return idx >= 0 && list.slice(idx + 1).some((r) => r.includes('cl.txt'));
  }, 'changelist 裡有 cl.txt');
  h.git(api, 'checkout', '--', 'cl.txt');
});

test('取回時檔案已存在：標示並預設不勾，只取回其他檔；勾選後才覆蓋', async () => {
  fs.writeFileSync(path.join(api, 'exists.txt'), 'shelved\n');
  fs.writeFileSync(path.join(api, 'exists-other.txt'), 'other\n');
  await shelveRows(['exists.txt', 'exists-other.txt'], 'exists shelf');
  await h.until(() => !fs.existsSync(path.join(api, 'exists.txt')), '擱置');
  fs.writeFileSync(path.join(api, 'exists.txt'), 'mine\n');

  await openUnshelve('exists shelf');
  const row = cv.locator('.unshelve-dialog .unshelve-file', { hasText: 'exists.txt' }).filter({ hasNotText: 'exists-other' });
  assert.match(await row.innerText(), /already exists; check to overwrite/);
  assert.equal(await row.locator('input').isChecked(), false, '已存在的預設不勾');
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => fs.existsSync(path.join(api, 'exists-other.txt')), '其他檔取回');
  assert.equal(fs.readFileSync(path.join(api, 'exists.txt'), 'utf8'), 'mine\n', '不勾不覆蓋');

  await openUnshelve('exists shelf');
  await cv.locator('.unshelve-dialog .unshelve-file input').first().check();
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => fs.readFileSync(path.join(api, 'exists.txt'), 'utf8') === 'shelved\n', '勾選後覆蓋');
  await h.until(() => shelfRefsOf(api).length === 0, '擱置移除');
  fs.rmSync(path.join(api, 'exists.txt'));
  fs.rmSync(path.join(api, 'exists-other.txt'));
});

test('取回有衝突：衝突清單自動打開、「他們的」標示擱置名稱；依序取回在這筆停下並提示', async () => {
  commitFile('clash.txt', 'base\n');
  fs.writeFileSync(path.join(api, 'clash.txt'), 'shelved\n');
  await shelveRows(['clash.txt'], 'clash shelf');
  await h.until(() => fs.readFileSync(path.join(api, 'clash.txt'), 'utf8') === 'base\n', '擱置');
  fs.writeFileSync(path.join(api, 'after.txt'), 'after\n');
  await shelveRows(['after.txt'], 'after shelf');
  commitFile('clash.txt', 'committed\n');

  await cv.locator('.commit-tab', { hasText: /^Shelf$/ }).click();
  await h.until(async () => (await shelfRowOf('clash shelf').count()) === 1 && (await shelfRowOf('after shelf').count()) === 1, '清單');
  await shelfRowOf('clash shelf').click();
  await shelfRowOf('after shelf').click({ modifiers: ['Control'] });
  await shelfRowOf('after shelf').click({ button: 'right' });
  await h.menu(cv, 'Unshelve 2 Entries…');
  await cv.waitForSelector('.unshelve-dialog');
  assert.match(await cv.locator('.unshelve-dialog .push-header').innerText(), /clash shelf.*\(1\/2\)/);
  const warnings = app.calls.warnings.length;
  await cv.locator('.unshelve-dialog .button.primary').click();
  await h.until(() => h.git(api, 'diff', '--name-only', '--diff-filter=U').includes('clash.txt'), 'clash.txt 衝突');
  await h.until(() => app.calls.panels.some((p) => p.viewType === 'wright.conflicts' && !p.disposed), '衝突清單打開');
  assert.match(fs.readFileSync(path.join(api, '.git', 'wright-unshelve'), 'utf8'), /Shelf: clash shelf/, '「他們的」標示擱置名稱');
  await h.until(() => app.calls.warnings.slice(warnings).some((w) => /Stopped after "clash shelf"\. 1 shelved entries were not unshelved/.test(w)), '提示停下');
  assert.equal(await cv.locator('.unshelve-dialog').count(), 0, '不再開下一筆');
  await h.until(async () => (await shelfRowOf('clash shelf').count()) === 0 && (await shelfRowOf('after shelf').count()) === 1, '衝突的檔案已從擱置移除；下一筆保留');

  h.git(api, 'checkout', '-q', 'HEAD', '--', 'clash.txt');
  dropAllShelves();
});

test('匯入 patch：檔名對不上時依能否套用判斷 repo；都套不上時請使用者選，選了仍套不上就顯示錯誤、不匯入', async () => {
  const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gwb-import-'));
  fs.appendFileSync(path.join(web, 'src/App.css'), '/* import */\n');
  const good = path.join(out, 'whatever.patch');
  fs.writeFileSync(good, `${h.git(web, 'diff', '--', 'src/App.css')}\n`);
  h.git(web, 'checkout', '--', 'src/App.css');
  const bad = path.join(out, 'nowhere.patch');
  fs.writeFileSync(bad, ['diff --git a/missing.txt b/missing.txt', '--- a/missing.txt', '+++ b/missing.txt', '@@ -1 +1 @@', '-nope', '+yes', ''].join('\n'));

  await cv.locator('.commit-tab', { hasText: /^Shelf$/ }).click();
  const picks = app.calls.quickPicks.length;
  app.calls.dialogs.push([good]);
  app.calls.inputs.push('auto repo');
  await cv.locator('.shelf-pane [title="Import Patches…"]').click();
  await h.until(() => shelfRefsOf(web).length === 1, '匯入到 web-app');
  assert.equal(app.calls.quickPicks.length, picks, '能判斷時不問');
  assert.equal(shelfRefsOf(api).length, 0);

  const errors = app.calls.errors.length;
  app.calls.dialogs.push([bad]);
  app.calls.picks.push((x) => x.label === 'api-server');
  app.calls.inputs.push('bad import');
  await cv.locator('.shelf-pane [title="Import Patches…"]').click();
  await h.until(() => app.calls.errors.length > errors, '顯示錯誤');
  assert.ok(app.calls.quickPicks.length > picks, '請使用者選 repo');
  assert.match(app.calls.errors.slice(errors).join('\n'), /Could not import into api-server/);
  assert.equal(shelfRefsOf(api).length, 0, '沒有匯入');
  dropAllShelves();
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
