// 在 VS Code 裡面執行的小型測試執行器：依序執行、單一測試逾時、失敗時印出診斷資訊
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { TestApi } from '../../../src/testApi';

type TestFn = () => Promise<void> | void;
const tests: { name: string; fn: TestFn; timeout: number }[] = [];

export function test(name: string, fn: TestFn, timeout = 60000): void {
  tests.push({ name, fn, timeout });
}

export const PLAYGROUND = process.env.GWB_PLAYGROUND ?? '';
export const repoPath = (name: string) => path.join(PLAYGROUND, ...name.split('/'));

/** 在 repo 中執行 git（固定英文輸出） */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' } }).trim();
}

let apiPromise: Promise<TestApi> | undefined;
export function api(): Promise<TestApi> {
  apiPromise ??= (async () => {
    const ext = vscode.extensions.getExtension<TestApi>('xjin9612.wright-for-git');
    if (!ext) throw new Error('找不到擴充功能 xjin9612.wright-for-git');
    return ext.isActive ? ext.exports : await ext.activate();
  })();
  return apiPromise;
}

/** 目前畫面上的狀態：失敗時印出，判斷卡在哪一步 */
async function diagnose(): Promise<string> {
  const out: string[] = [];
  for (const name of ['api-server', 'web-app']) {
    try {
      out.push(`  git status（${name}）：${git(repoPath(name), 'status', '--porcelain', '-b').split('\n').join(' | ')}`);
    } catch (e) {
      out.push(`  git status（${name}）失敗：${String(e).split('\n')[0]}`);
    }
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  out.push(`  使用中的分頁：${tab ? `${tab.label}（${tab.input?.constructor?.name ?? '無'}）` : '無'}`);
  try {
    const a = await api();
    const f = a.logFilter();
    out.push(`  Log 篩選：roots=${JSON.stringify(f.roots)} paths=${JSON.stringify(f.paths)}`);
    const log = a.recentGitLog().slice(-8);
    if (log.length) out.push(`  最近的 git 指令：\n${log.map((l) => `    ${l}`).join('\n')}`);
  } catch (e) {
    out.push(`  無法取得擴充功能狀態：${String(e)}`);
  }
  return `診斷：\n${out.join('\n')}`;
}

/** 等條件成立（輪詢）；逾時時附上診斷資訊 */
export async function until<T>(fn: () => T | Promise<T>, what: string, timeout = 30000, interval = 200): Promise<Exclude<T, false | null | undefined | 0 | ''>> {
  const end = Date.now() + timeout;
  let lastError: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as Exclude<T, false | null | undefined | 0 | ''>;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() > end) throw new Error(`等待逾時（${timeout / 1000} 秒）：${what}${lastError ? `\n  最後的錯誤：${String(lastError)}` : ''}\n${await diagnose()}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAll(): Promise<void> {
  const grep = process.env.GWB_GREP ?? '';
  const list = tests.filter((x) => !grep || x.name.includes(grep));
  let failed = 0;
  const failures: string[] = [];
  const started = Date.now();
  for (const x of list) {
    const t0 = Date.now();
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.resolve().then(x.fn),
        new Promise((_, reject) => {
          timer = setTimeout(() => void diagnose().then((d) => reject(new Error(`測試逾時（${x.timeout / 1000} 秒）\n${d}`))), x.timeout);
        }),
      ]).finally(() => clearTimeout(timer));
      console.log(`✔ ${x.name} (${Date.now() - t0}ms)`);
    } catch (e) {
      failed++;
      const text = `✖ ${x.name} (${Date.now() - t0}ms)\n  ${(e instanceof Error ? (e.stack ?? e.message) : String(e)).split('\n').join('\n  ')}`;
      failures.push(text);
      console.log(text);
    }
  }
  // 失敗的測試在最後再列一次，不用往上捲找
  if (failures.length > 0) console.log(`\n✖ failing tests:\n\n${failures.join('\n\n')}\n`);
  console.log(`ℹ tests ${list.length}\nℹ pass ${list.length - failed}\nℹ fail ${failed}\nℹ duration_ms ${Date.now() - started}`);
  if (failed > 0) throw new Error(`${failed} 個測試失敗`);
}
