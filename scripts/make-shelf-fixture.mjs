#!/usr/bin/env node
// 擱置（Shelf）手動測試用的兩個 repo：每個情境先把兩個 repo 還原成同一個起點（含清掉擱置、儲藏），再做出該情境需要的修改。
//
//   node scripts/make-shelf-fixture.mjs <情境> [目標資料夾]
//       目標資料夾預設為 ../vscode-git-workbench-test/shelf（見 sandbox.mjs），用 VS Code 開這個資料夾
//
//   init             建立 api、web 兩個 repo（--force 先刪除舊的）
//   basic            兩個 repo 各一個修改、一個新檔
//   staged           api 另一個檔案已暫存
//   hunks            api 一個檔案有相隔很遠的兩段修改
//   conflict         api 一個已追蹤檔的修改；擱置後執行 conflict-commit
//   conflict-commit  把同一個檔案改成別的內容並提交
//   exists           api 兩個新檔；擱置後執行 exists-create
//   exists-create    建立同名檔（內容不同）
//   seq              api 三個新檔＋一個已追蹤檔的修改；需要時執行 seq-commit
//   seq-commit       把那個已追蹤檔改成別的內容並提交
//   patch            在 <目標資料夾>/patches 產生檔名對不上 repo 的 patch
//   stash            api 一筆儲藏（兩個檔案）＋兩個修改
//   status           顯示兩個 repo 的工作區、暫存區、儲藏筆數與擱置
//
// 只還原 git 的內容；changelist 是 VS Code 端的狀態，不會被清掉。
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { SANDBOX } from './sandbox.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [cmd, target] = args.filter((a) => !a.startsWith('--'));
const ROOT = path.resolve(target ?? path.join(SANDBOX, 'shelf'));
const A = path.join(ROOT, 'api');
const B = path.join(ROOT, 'web');
const PATCHES = path.join(ROOT, 'patches');

function git(cwd, ...a) {
  return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const write = (dir, f, content) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), content);
};
const append = (dir, f, content) => appendFileSync(path.join(dir, f), content);
const lines = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix} line ${i + 1}\n`).join('');
const commitFile = (dir, f, content, message) => {
  write(dir, f, content);
  git(dir, 'commit', '-q', '-m', message, '--', f);
};
const say = (s) => console.log(s);

function init() {
  if (existsSync(ROOT)) {
    if (!force) {
      console.error(`${ROOT} 已存在；要重建請加 --force`);
      process.exit(1);
    }
    rmSync(ROOT, { recursive: true, force: true });
  }
  for (const r of [A, B]) {
    mkdirSync(r, { recursive: true });
    git(r, 'init', '-q', '-b', 'main');
    git(r, 'config', 'user.name', 'Manual Test');
    git(r, 'config', 'user.email', 'manual@example.com');
  }
  write(A, 'src/service.txt', lines(5, 'service'));
  write(A, 'src/other.txt', lines(5, 'other'));
  write(A, 'src/hunks.txt', lines(30, 'hunks'));
  write(A, 'src/clash.txt', 'base\n');
  write(A, 'src/seq-clash.txt', 'seq base\n');
  write(A, 'src/stash-a.txt', lines(3, 'stash'));
  write(B, 'src/app.txt', lines(5, 'app'));
  for (const r of [A, B]) {
    git(r, 'add', '-A');
    git(r, 'commit', '-q', '-m', 'init');
    git(r, 'tag', 'fixture-base');
  }
  mkdirSync(PATCHES, { recursive: true });
  say(`已建立 ${A}、${B}。用 VS Code 開啟 ${ROOT}（兩個 repo 會一起出現）。`);
}

function reset() {
  for (const r of [A, B]) {
    if (!existsSync(path.join(r, '.git'))) {
      console.error(`找不到 ${r}；先執行 init`);
      process.exit(1);
    }
    try {
      git(r, 'merge', '--abort');
    } catch {
      // 沒有進行中的合併
    }
    git(r, 'reset', '-q', '--hard', 'fixture-base');
    git(r, 'clean', '-fdq');
    git(r, 'stash', 'clear');
    for (const ref of git(r, 'for-each-ref', '--format=%(refname)', 'refs/git-workbench/shelf/').split('\n').filter(Boolean)) git(r, 'update-ref', '-d', ref);
    rmSync(path.join(r, '.git', 'gitworkbench-unshelve'), { force: true });
  }
  rmSync(PATCHES, { recursive: true, force: true });
  mkdirSync(PATCHES, { recursive: true });
}

const scenarios = {
  init,
  basic() {
    reset();
    append(A, 'src/service.txt', 'api changed\n');
    write(A, 'api-new.txt', 'api new\n');
    append(B, 'src/app.txt', 'web changed\n');
    write(B, 'web-new.txt', 'web new\n');
    say('api：src/service.txt（M）、api-new.txt（U）；web：src/app.txt（M）、web-new.txt（U）');
  },
  staged() {
    reset();
    append(A, 'src/service.txt', 'api changed\n');
    append(A, 'src/other.txt', 'staged change\n');
    git(A, 'add', 'src/other.txt');
    say('api：src/service.txt（M，未暫存）、src/other.txt（M，已暫存）');
  },
  hunks() {
    reset();
    const text = readFileSync(path.join(A, 'src/hunks.txt'), 'utf8').replace(/^hunks line 2$/m, 'FIRST CHANGE').replace(/^hunks line 29$/m, 'SECOND CHANGE');
    write(A, 'src/hunks.txt', text);
    say('api：src/hunks.txt 第 2 行改成 FIRST CHANGE、第 29 行改成 SECOND CHANGE（兩段）');
  },
  conflict() {
    reset();
    write(A, 'src/clash.txt', 'shelved\n');
    say('api：src/clash.txt 內容 base → shelved');
  },
  'conflict-commit'() {
    commitFile(A, 'src/clash.txt', 'committed\n', 'change clash');
    say('api：已提交 src/clash.txt = committed');
  },
  exists() {
    reset();
    write(A, 'exists.txt', 'from shelf\n');
    write(A, 'exists-other.txt', 'other\n');
    say('api：exists.txt、exists-other.txt（都是新檔）');
  },
  'exists-create'() {
    write(A, 'exists.txt', 'mine\n');
    say('api：建立 exists.txt = mine');
  },
  seq() {
    reset();
    for (const n of [1, 2, 3]) write(A, `seq-${n}.txt`, `seq ${n}\n`);
    write(A, 'src/seq-clash.txt', 'shelved\n');
    say('api：seq-1.txt、seq-2.txt、seq-3.txt（新檔）、src/seq-clash.txt（M）');
  },
  'seq-commit'() {
    commitFile(A, 'src/seq-clash.txt', 'committed\n', 'change seq-clash');
    say('api：已提交 src/seq-clash.txt = committed');
  },
  patch() {
    reset();
    append(B, 'src/app.txt', 'patched\n');
    writeFileSync(path.join(PATCHES, 'whatever.patch'), git(B, 'diff'));
    git(B, 'checkout', '-q', '--', 'src/app.txt');
    writeFileSync(path.join(PATCHES, 'nowhere.patch'), ['diff --git a/missing.txt b/missing.txt', '--- a/missing.txt', '+++ b/missing.txt', '@@ -1 +1 @@', '-nope', '+yes', ''].join('\n'));
    say(`產生 ${path.join(PATCHES, 'whatever.patch')}（只套得上 web）、nowhere.patch（哪裡都套不上）`);
  },
  stash() {
    reset();
    append(A, 'src/stash-a.txt', 'stashed\n');
    append(A, 'src/service.txt', 'stashed\n');
    git(A, 'stash', 'push', '-q', '-m', 'manual stash');
    append(A, 'src/service.txt', 'api changed\n');
    append(A, 'src/other.txt', 'other changed\n');
    say('api：一筆儲藏 manual stash（stash-a.txt、service.txt）；工作區 service.txt、other.txt（M）');
  },
  status() {
    for (const r of [A, B]) {
      say(`== ${path.basename(r)} ==`);
      const st = git(r, 'status', '--short').trimEnd();
      if (st) say(st);
      say(`-- 暫存區：${git(r, 'diff', '--cached', '--name-only').trim().split('\n').join(' ')}`);
      say(`-- stash：${git(r, 'stash', 'list').split('\n').filter(Boolean).length} 筆`);
      const shelves = git(r, 'for-each-ref', '--format=-- 擱置 %(refname:lstrip=3)  %(subject)', 'refs/git-workbench/shelf/').trimEnd();
      if (shelves) say(shelves);
    }
  },
};

const run = scenarios[cmd ?? ''];
if (!run) {
  console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 21).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(1);
}
run();
