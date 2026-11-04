// 建立大型測試 repo（效能量測、長線性分支折疊）：以 git fast-import 快速產生大量 commit、合併、分支與 tag。
// 用法：node scripts/make-large-repo.mjs [資料夾] [commit 數] [--force]
//   資料夾預設為 ../wright-for-git-test/large-repo（見 sandbox.mjs）；commit 數預設 100000
//   例：node scripts/make-large-repo.mjs 3000          （3000 筆，看分支折疊）
//       node scripts/make-large-repo.mjs --force       （刪除舊的再重建）
// 內容全部是虛構的（作者、訊息、檔案），可安全分享；main 每 100 筆合併一條 5 筆的 feature 分支。
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { SANDBOX } from './sandbox.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((a) => !a.startsWith('--'));
// 只給一個數字時是 commit 數
const [dirArg, countArg] = positional.length === 1 && /^\d+$/.test(positional[0]) ? [undefined, positional[0]] : positional;
const dir = path.resolve(dirArg ?? path.join(SANDBOX, 'large-repo'));
const total = Number(countArg ?? 100000);
if (!Number.isFinite(total) || total < 10) {
  console.error('用法：node scripts/make-large-repo.mjs [資料夾] [commit 數] [--force]');
  process.exit(1);
}
if (existsSync(dir)) {
  if (!force) {
    console.error(`${dir} 已存在。加上 --force 會先刪除再重建。`);
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(dir, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-q', '-b', 'main');
git('config', 'core.autocrlf', 'false');

const PEOPLE = [
  ['Alice Chen', 'alice@example.com'],
  ['Bob Lin', 'bob@example.com'],
  ['Carol Wu', 'carol@example.com'],
  ['Dave Lee', 'dave@example.com'],
  ['Eve Huang', 'eve@example.com'],
  ['Frank Ho', 'frank@example.com'],
  ['Grace Tsai', 'grace@example.com'],
  ['Henry Ko', 'henry@example.com'],
];
const TYPES = ['feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'perf'];
const MODULES = Array.from({ length: 20 }, (_, i) => `mod${String(i).padStart(2, '0')}`);
const FILES_PER_MODULE = 15;

// 固定的亂數種子：每次產生的 repo 都一樣，量測結果可以比較
let seed = 20261102;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor((seed / 2147483648) * n);
};

const child = spawn('git', ['fast-import', '--quiet', '--done'], { cwd: dir, stdio: ['pipe', 'inherit', 'inherit'] });
let buffer = [];
let size = 0;
async function write(s) {
  buffer.push(s);
  size += s.length;
  if (size > 1 << 20) await flush();
}
async function flush() {
  const chunk = buffer.join('');
  buffer = [];
  size = 0;
  if (!child.stdin.write(chunk)) await new Promise((r) => child.stdin.once('drain', r));
}
const data = (s) => `data ${Buffer.byteLength(s)}\n${s}\n`;

let mark = 0;
let time = Math.floor(Date.UTC(2016, 0, 1) / 1000);
const versions = new Map();

/** 一筆 commit：改 1～3 個檔案 */
async function commit(ref, message, { from, merge } = {}) {
  mark++;
  time += 300 + rand(3000);
  const [name, email] = PEOPLE[rand(PEOPLE.length)];
  let s = `commit ${ref}\nmark :${mark}\nauthor ${name} <${email}> ${time} +0800\ncommitter ${name} <${email}> ${time} +0800\n${data(message)}`;
  if (from) s += `from :${from}\n`;
  if (merge) s += `merge :${merge}\n`;
  const count = 1 + rand(3);
  for (let i = 0; i < count; i++) {
    const mod = MODULES[rand(MODULES.length)];
    const file = `src/${mod}/file${String(rand(FILES_PER_MODULE)).padStart(2, '0')}.ts`;
    const v = (versions.get(file) ?? 0) + 1;
    versions.set(file, v);
    s += `M 100644 inline ${file}\n${data(`// ${file}\nexport const version = ${v};\nexport const updatedBy = ${JSON.stringify(name)};\n`)}`;
  }
  await write(s + '\n');
  return mark;
}

const subject = () => {
  const type = TYPES[rand(TYPES.length)];
  return `${type}(${MODULES[rand(MODULES.length)]}): change ${mark + 1}`;
};

let main = 0;
let made = 0;
let branchNo = 0;
const started = Date.now();
while (made < total) {
  // 每 100 筆從 main 分出一條 5 筆的 feature 分支再合併回來（graph 有分岔與合併）
  if (made > 0 && made % 100 === 0 && made + 7 <= total) {
    branchNo++;
    const ref = `refs/heads/feature/f${String(branchNo).padStart(4, '0')}`;
    let tip = main;
    for (let i = 0; i < 5; i++) tip = await commit(ref, subject(), i === 0 ? { from: main } : {});
    main = await commit('refs/heads/main', `Merge branch 'feature/f${String(branchNo).padStart(4, '0')}'`, { from: main, merge: tip });
    made += 6;
    continue;
  }
  main = await commit('refs/heads/main', subject(), main ? { from: main } : {});
  made++;
  if (made % 2000 === 0) await write(`tag v${made / 2000}.0.0\nfrom :${main}\ntagger Alice Chen <alice@example.com> ${time} +0800\n${data(`Release ${made / 2000}.0.0`)}`);
  if (made % 10000 === 0) process.stdout.write(`  ${made} / ${total}\n`);
}
await write('done\n');
await flush();
child.stdin.end();
await new Promise((resolve, reject) => child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git fast-import exited with ${code}`)))));
// 只保留最近 30 條 feature 分支，其餘刪除（與真實 repo 相近）
const stale = git('for-each-ref', '--format=%(refname)', 'refs/heads/feature/').split('\n').filter(Boolean).slice(0, -30);
if (stale.length > 0) execFileSync('git', ['update-ref', '--stdin'], { cwd: dir, input: stale.map((r) => `delete ${r}\n`).join('') });
git('symbolic-ref', 'HEAD', 'refs/heads/main');
git('reset', '-q', '--hard');
const count = git('rev-list', '--count', '--all');
console.log(`已建立 ${dir}：${count} 筆 commit、${git('branch', '--list').split('\n').filter(Boolean).length} 個分支、${git('tag').split('\n').filter(Boolean).length} 個 tag（${((Date.now() - started) / 1000).toFixed(1)} 秒）`);
