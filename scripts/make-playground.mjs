#!/usr/bin/env node
// 建立手動測試用的 playground（docs/TESTING.md 的各種情境），全部是虛構的人名與內容。
//
//   node scripts/make-playground.mjs [目標資料夾] [--force]
//       建立 playground（預設為專案的上一層資料夾下的 playground）；--force 會先刪除舊的
//   node scripts/make-playground.mjs remote-push <repo> [目標資料夾]
//       模擬「另一台電腦」對 <repo>（api-server／web-app）推一個新 commit，用來測試 Pull 與 Push 被拒
//
// 產生的結構：
//   playground/                 ← 用 VS Code 開這個資料夾（本身不是 git repo）
//     api-server/               ← repo；main 領先遠端 2 筆、有沒有 upstream 的新 branch、未合併的 branch、tag、
//                                  未提交的變更（Commit 視窗）、packages/sdk 子模組
//       libs/shared/            ← 巢狀 repo
//     web-app/                  ← repo；main 落後遠端 1 筆、2 個 stash、會衝突的 branch、與 api-server 同名的 branch、
//                                  1 個未提交的修改
//     notes/                    ← 一般資料夾（不是 repo）
//   playground-remotes/         ← 遠端（bare repo）與模擬另一台電腦的 clone，不要用 VS Code 開
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((a) => !a.startsWith('--'));

const PEOPLE = {
  alice: ['Alice Chen', 'alice@example.com'],
  bob: ['Bob Lin', 'bob@example.com'],
  carol: ['Carol Wu', 'carol@example.com'],
  dave: ['Dave Lee', 'dave@example.com'],
};
const NOW = Date.now();
/** src/config.ts：20 行，讓兩段修改分成兩個 hunk */
const CONFIG_LINES = Array.from({ length: 20 }, (_, i) =>
  i === 1 ? 'export const port = 3000;' : i === 18 ? 'export const logLevel = "info";' : `export const option${i} = ${i};`,
);

function git(cwd, ...a) {
  return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 以指定作者與「幾天前」的時間 commit；files 為 { 路徑: 內容 }，內容為 null 表示刪除 */
function commit(dir, who, daysAgo, message, files) {
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(dir, f);
    if (content === null) {
      git(dir, 'rm', '-q', f);
      continue;
    }
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
    git(dir, 'add', f);
  }
  const [name, email] = PEOPLE[who];
  const date = new Date(NOW - daysAgo * 86400000).toISOString();
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  return git(dir, 'rev-parse', 'HEAD');
}

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  // 「我」是 Alice：User 篩選的 me、Highlight My Commits 會標出她的 commit
  git(dir, 'config', 'user.name', PEOPLE.alice[0]);
  git(dir, 'config', 'user.email', PEOPLE.alice[1]);
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
}

function merge(dir, who, daysAgo, branch, message) {
  const [name, email] = PEOPLE[who];
  const date = new Date(NOW - daysAgo * 86400000).toISOString();
  execFileSync('git', ['merge', '-q', '--no-ff', '-m', message, branch], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

/** 建立 bare 遠端並推上去；之後本機與遠端的差異由各情境自行製造 */
function publish(dir, remotes, name) {
  const bare = path.join(remotes, `${name}.git`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '--all', '-u', 'origin');
  git(dir, 'push', '-q', '--tags', 'origin');
  return bare;
}

/** 模擬另一台電腦：clone 遠端、commit、push */
function otherPush(remotes, repo, message, branch = 'main') {
  const other = path.join(remotes, 'other-computer', repo);
  if (!existsSync(other)) {
    mkdirSync(path.dirname(other), { recursive: true });
    execFileSync('git', ['clone', '-q', path.join(remotes, `${repo}.git`), other]);
  }
  git(other, 'fetch', '-q', 'origin');
  git(other, 'checkout', '-q', '-B', branch, `origin/${branch}`);
  const file = path.join(other, 'REMOTE-CHANGES.md');
  appendFileSync(file, `- ${message}\n`);
  git(other, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: other,
    env: { ...process.env, GIT_AUTHOR_NAME: PEOPLE.dave[0], GIT_AUTHOR_EMAIL: PEOPLE.dave[1], GIT_COMMITTER_NAME: PEOPLE.dave[0], GIT_COMMITTER_EMAIL: PEOPLE.dave[1] },
  });
  git(other, 'push', '-q', 'origin', branch);
}

function buildApiServer(root, remotes) {
  const dir = path.join(root, 'api-server');
  initRepo(dir);
  commit(dir, 'alice', 120, 'feat: scaffold api server', {
    'package.json': '{\n  "name": "api-server",\n  "version": "0.1.0"\n}\n',
    'src/index.ts': 'export const app = "api";\n',
    'README.md': '# api-server\n',
    '.gitignore': 'node_modules/\nlibs/\n',
  });
  commit(dir, 'bob', 110, 'feat(orders): create order API', { 'src/orders/create.ts': 'export function create() {}\n', 'src/orders/list.ts': 'export function list() {}\n' });
  commit(dir, 'carol', 100, 'docs: API reference for orders', { 'docs/orders.md': '# Orders\n', 'docs/中文說明.md': '# 訂單說明\n' });
  commit(dir, 'dave', 95, 'chore(deps): bump typescript to 5.6', { 'package.json': '{\n  "name": "api-server",\n  "version": "0.1.0",\n  "devDependencies": { "typescript": "5.6.0" }\n}\n' });
  git(dir, 'tag', '-a', 'v1.0.0', '-m', 'First release');

  // 已合併的 feature branch（graph 分支線）
  git(dir, 'checkout', '-q', '-b', 'feature/orders-pagination');
  commit(dir, 'bob', 80, 'feat(orders): add pagination', { 'src/orders/list.ts': 'export function list(page = 1) { return page; }\n' });
  commit(dir, 'bob', 78, 'test(orders): cover pagination', { 'test/orders.test.ts': 'test("page", () => {});\n' });
  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'alice', 79, 'fix(api): return Retry-After header (#12)', { 'src/index.ts': 'export const app = "api";\nexport const retryAfter = 30;\n' });
  merge(dir, 'alice', 75, 'feature/orders-pagination', "Merge branch 'feature/orders-pagination'");

  // rename、刪除、多種檔案類型
  commit(dir, 'carol', 60, 'refactor(orders): extract pricing service', {
    'src/orders/pricing.ts': 'export const price = (n: number) => n * 1.05;\n',
    'src/orders/create.ts': 'import { price } from "./pricing";\nexport function create() { return price(1); }\n',
  });
  git(dir, 'mv', 'docs/orders.md', 'docs/orders-api.md');
  commit(dir, 'carol', 55, 'docs: rename orders guide', {});
  commit(dir, 'dave', 40, 'perf(db): add index on orders.created_at', { 'migrations/002_index.sql': 'CREATE INDEX idx_created ON orders(created_at);\n', 'config/db.yml': 'pool: 10\n' });
  commit(dir, 'alice', 30, 'chore: remove legacy script', { 'scripts/legacy.sh': '#!/bin/sh\necho legacy\n' });
  commit(dir, 'alice', 29, 'chore: drop legacy script', { 'scripts/legacy.sh': null });
  git(dir, 'tag', 'v1.1.0');

  // 與 web-app 同名的 branch（Branches 樹合併為一筆「2 repos」）
  git(dir, 'branch', 'feature/checkout');
  // release branch（Branch 篩選、Show in New Tab）
  git(dir, 'checkout', '-q', '-b', 'release/1.x');
  commit(dir, 'dave', 20, 'fix(release): hotfix order total rounding', { 'src/orders/pricing.ts': 'export const price = (n: number) => Math.round(n * 1.05);\n' });
  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'bob', 10, 'feat(auth): add API keys\n\nCloses #31, see PROJ-42 for the design.', { 'src/auth/keys.ts': 'export const keys = new Map<string, string>();\n' });
  // 子模組（變更檔案依「模組」分組）與多行設定檔（部分提交：兩段相隔很遠的修改）
  commit(dir, 'carol', 9, 'feat(sdk): add client package', {
    'packages/sdk/package.json': '{\n  "name": "@example/sdk"\n}\n',
    'packages/sdk/index.ts': 'export const client = {};\n',
    'src/config.ts': CONFIG_LINES.join('\n') + '\n',
  });

  publish(dir, remotes, 'api-server');

  // main 領先遠端 2 筆（Push 對話框）
  commit(dir, 'alice', 2, 'feat(auth): rotate API keys', { 'src/auth/rotate.ts': 'export function rotate() {}\n' });
  commit(dir, 'alice', 1, 'docs: describe key rotation', { 'docs/auth.md': '# Key rotation\n' });

  // 沒有 upstream 的新 branch（Push 對話框顯示 New／set upstream）
  git(dir, 'checkout', '-q', '-b', 'feature/rate-limit');
  commit(dir, 'alice', 3, 'feat(api): add rate limiter', { 'src/middleware/rate.ts': 'export const limit = 100;\n' });
  git(dir, 'checkout', '-q', 'main');

  // 未合併、沒有推送的 branch（刪除時應先詢問）
  git(dir, 'checkout', '-q', '-b', 'experiment/cache');
  commit(dir, 'carol', 5, 'feat(cache): try in-memory cache', { 'src/cache.ts': 'export const cache = new Map();\n' });
  git(dir, 'checkout', '-q', 'main');

  // 已合併、可直接刪除的 branch
  git(dir, 'branch', 'old/merged-work', 'v1.0.0');

  // 未提交的變更（Commit 視窗）：同一檔案兩段修改、刪除、新增未追蹤、已忽略、子模組內的修改
  const lines = [...CONFIG_LINES];
  lines[1] = 'export const port = 8080;';
  lines[18] = 'export const logLevel = "debug";';
  writeFileSync(path.join(dir, 'src/config.ts'), lines.join('\n') + '\n');
  rmSync(path.join(dir, 'config/db.yml'));
  writeFileSync(path.join(dir, 'src/todo.ts'), '// TODO: rate limit per key\n');
  mkdirSync(path.join(dir, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = (s) => s;\n');
  writeFileSync(path.join(dir, 'packages/sdk/index.ts'), 'export const client = { version: 1 };\n');

  // 巢狀 repo（api-server 內的 libs/shared，父 repo 以 .gitignore 排除）
  const nested = path.join(dir, 'libs', 'shared');
  initRepo(nested);
  commit(nested, 'carol', 50, 'feat: shared utils', { 'index.ts': 'export const noop = () => {};\n' });
  commit(nested, 'carol', 12, 'feat: add formatter', { 'format.ts': 'export const fmt = String;\n' });
}

function buildWebApp(root, remotes) {
  const dir = path.join(root, 'web-app');
  initRepo(dir);
  commit(dir, 'alice', 115, 'feat: scaffold web app', { 'package.json': '{\n  "name": "web-app"\n}\n', 'src/main.tsx': 'export {};\n', 'src/App.css': 'body { margin: 0; }\n' });
  commit(dir, 'bob', 90, 'feat(ui): add login page', { 'src/pages/Login.tsx': 'export const Login = () => null;\n' });
  commit(dir, 'dave', 85, 'fix(ui): button alignment on mobile', { 'src/App.css': 'body { margin: 0; }\nbutton { display: block; }\n' });
  git(dir, 'tag', '-a', 'v2.3.0', '-m', 'Release 2.3.0');

  git(dir, 'checkout', '-q', '-b', 'feature/checkout');
  commit(dir, 'bob', 70, 'feat(checkout): cart summary panel', { 'src/pages/Cart.tsx': 'export const Cart = () => null;\n' });
  commit(dir, 'bob', 65, 'feat(checkout): payment form', { 'src/pages/Payment.tsx': 'export const Payment = () => null;\n' });
  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'carol', 66, 'docs: update deployment guide', { 'docs/deploy.md': '# Deploy\n' });
  merge(dir, 'alice', 60, 'feature/checkout', "Merge branch 'feature/checkout'");
  commit(dir, 'carol', 45, 'fix(checkout): handle declined cards', { 'src/pages/Payment.tsx': 'export const Payment = () => "declined";\n' });

  git(dir, 'checkout', '-q', '-b', 'release/2.4');
  commit(dir, 'carol', 35, 'feat(i18n): add Traditional Chinese locale', { 'src/locales/zh-TW.json': '{ "hello": "你好" }\n' });
  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'alice', 15, 'feat(ui): dark mode toggle', { 'src/theme.ts': 'export const theme = "light";\n', 'src/App.css': 'body { margin: 0; }\nbutton { display: block; }\n:root { color-scheme: light dark; }\n' });

  // 會衝突的 branch：與 main 修改同一行（Merge／Rebase／Cherry-Pick 衝突）
  git(dir, 'checkout', '-q', '-b', 'conflict/theme');
  commit(dir, 'bob', 8, 'feat(ui): default to dark theme', { 'src/theme.ts': 'export const theme = "dark";\n' });
  git(dir, 'checkout', '-q', 'main');
  commit(dir, 'alice', 7, 'feat(ui): follow system theme', { 'src/theme.ts': 'export const theme = "system";\n' });

  publish(dir, remotes, 'web-app');

  // 遠端比本機多 1 筆（Pull、Push 被拒）
  otherPush(remotes, 'web-app', 'chore: update CI badge');
  git(dir, 'fetch', '-q', 'origin');

  // 2 個 stash：一個只有追蹤中的檔案，一個含未追蹤檔案
  appendFileSync(path.join(dir, 'src/main.tsx'), '// work in progress\n');
  git(dir, 'stash', 'push', '-q', '-m', 'wip: refactor entry point');
  appendFileSync(path.join(dir, 'src/App.css'), '.draft { color: red; }\n');
  writeFileSync(path.join(dir, 'src/Draft.tsx'), 'export const Draft = () => null;\n');
  git(dir, 'stash', 'push', '-q', '--include-untracked', '-m', 'draft: new page with untracked file');

  // 未提交的修改（Commit 視窗跨 repo 提交）；不碰 src/theme.ts，避免影響衝突測試
  appendFileSync(path.join(dir, 'src/pages/Login.tsx'), 'export const title = "Sign in";\n');
}

function main() {
  if (positional[0] === 'remote-push') {
    const repo = positional[1];
    const root = path.resolve(positional[2] ?? path.join(here, '..', '..', 'playground'));
    const remotes = `${root}-remotes`;
    if (!repo || !existsSync(path.join(remotes, `${repo}.git`))) {
      console.error('用法：node scripts/make-playground.mjs remote-push <api-server|web-app> [playground 資料夾]');
      process.exit(1);
    }
    otherPush(remotes, repo, `chore: change from another computer (${new Date().toLocaleTimeString()})`);
    console.log(`已從另一台電腦推送一筆 commit 到 ${repo}；在 Git Workbench 按 Fetch 後就會看到 ↓1`);
    return;
  }

  const root = path.resolve(positional[0] ?? path.join(here, '..', '..', 'playground'));
  const remotes = `${root}-remotes`;
  if (existsSync(root) || existsSync(remotes)) {
    if (!force) {
      console.error(`${root} 已存在。加上 --force 會先刪除再重建。`);
      process.exit(1);
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(remotes, { recursive: true, force: true });
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(remotes, { recursive: true });

  buildApiServer(root, remotes);
  buildWebApp(root, remotes);
  mkdirSync(path.join(root, 'notes'), { recursive: true });
  writeFileSync(path.join(root, 'notes', 'todo.txt'), '這個資料夾不是 git repo，Repositories 不應該列出它。\n');

  console.log(`playground 已建立：${root}`);
  console.log(`遠端與模擬的另一台電腦：${remotes}`);
  console.log('用 VS Code 開啟 playground 資料夾後，照 docs/TESTING.md 測試。');
}

main();
