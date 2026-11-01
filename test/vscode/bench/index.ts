// 大型 repo 效能量測（npm run bench:vscode）：在真實 VS Code 裡開啟 scripts/make-large-repo.mjs 產生的 repo，
// 量測 Log 各種篩選的載入時間；先量沒有 commit-graph 的情況，再寫入 commit-graph 後重量一次。
// 時間從 extension 收到 webview 的載入請求起算：第一批送出（首屏）、全部送完。
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LogFilter } from '../../../src/shared/protocol';
import { api, git, sleep, test, until, runAll } from '../suite/harness';

const REPO = process.env.GWB_PLAYGROUND ?? '';
const ROUNDS = 3;

interface Row {
  scenario: string;
  commitGraph: boolean;
  firstBatchMs: number[];
  doneMs: number[];
  count: number;
}
const rows: Row[] = [];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** 套用篩選並等這次載入完成，回傳耗時 */
async function measure(filter: Partial<LogFilter>): Promise<{ firstBatchMs: number; doneMs: number; count: number }> {
  const a = await api();
  const before = a.logStats()?.requestId ?? -1;
  await a.applyLogFilter(filter);
  const s = await until(() => {
    const st = a.logStats();
    return st && st.requestId !== before && st.doneMs !== undefined && st;
  }, `載入完成：${JSON.stringify(filter)}`, 180000, 50);
  return { firstBatchMs: s.firstBatchMs ?? s.doneMs!, doneMs: s.doneMs!, count: s.count };
}

const EMPTY: Partial<LogFilter> = { text: '', users: [], paths: [], branches: [] };

async function scenarios(): Promise<[string, Partial<LogFilter>][]> {
  const someHash = git(REPO, 'rev-list', '-n1', '--skip=54321', 'HEAD').slice(0, 10);
  const feature = git(REPO, 'for-each-ref', '--format=%(refname)', '--count=1', 'refs/heads/feature/');
  return [
    ['無篩選', { ...EMPTY }],
    ['文字：change 4242', { ...EMPTY, text: 'change 4242' }],
    ['作者：Grace', { ...EMPTY, users: ['Grace'] }],
    ['路徑：一個檔案', { ...EMPTY, paths: ['src/mod07/file03.ts'] }],
    ['路徑：一個資料夾', { ...EMPTY, paths: ['src/mod07'] }],
    ['hash 前綴', { ...EMPTY, text: someHash }],
    ['Branch：一條 feature 分支', { ...EMPTY, branches: [feature] }],
  ];
}

async function round(commitGraph: boolean): Promise<void> {
  const list = await scenarios();
  for (let r = 0; r < ROUNDS; r++) {
    for (const [name, filter] of list) {
      // 每次先換成另一個篩選，確保下一次真的重新載入
      if (name === '無篩選') await measure({ ...EMPTY, text: '__reset__' });
      const m = await measure(filter);
      let row = rows.find((x) => x.scenario === name && x.commitGraph === commitGraph);
      if (!row) rows.push((row = { scenario: name, commitGraph, firstBatchMs: [], doneMs: [], count: m.count }));
      row.firstBatchMs.push(m.firstBatchMs);
      row.doneMs.push(m.doneMs);
    }
  }
}

test('大型 repo：各種篩選的載入時間（沒有 commit-graph，再寫入 commit-graph 後）', async () => {
  const a = await api();
  await vscode.commands.executeCommand('gitWorkbench.show');
  await until(async () => (await a.repositories()).length === 1, '偵測到 repo', 60000);
  // 第一次載入（開啟面板時）
  const first = await until(() => a.logStats()?.doneMs !== undefined && a.logStats(), '第一次載入完成', 180000, 50);
  rows.push({ scenario: '開啟面板（第一次載入）', commitGraph: false, firstBatchMs: [first.firstBatchMs ?? first.doneMs!], doneMs: [first.doneMs!], count: first.count });

  // 先量沒有 commit-graph 的情況（產生的 repo 沒有），再寫入後重量
  const { existsSync, rmSync } = await import('node:fs');
  const graphFile = path.join(REPO, '.git', 'objects', 'info', 'commit-graph');
  if (existsSync(graphFile)) rmSync(graphFile);
  await round(false);
  // 用非同步執行：測試跑在 extension host 裡，同步執行好幾秒會讓 VS Code 回報 extension host 沒有回應
  await new Promise<void>((resolve, reject) =>
    execFile('git', ['commit-graph', 'write', '--reachable', '--changed-paths', '--no-progress'], { cwd: REPO }, (e) => (e ? reject(e) : resolve())),
  );
  await sleep(500);
  await round(true);

  const commits = git(REPO, 'rev-list', '--count', '--all');
  const lines = [
    `大型 repo：${commits} 筆 commit；每項 ${ROUNDS} 次取中位數（毫秒）；VS Code ${vscode.version}`,
    '',
    '| 情境 | commit-graph | 首屏 | 全部載入 | 筆數 |',
    '|---|---|---:|---:|---:|',
    ...rows.map((r) => `| ${r.scenario} | ${r.commitGraph ? '有' : '無'} | ${median(r.firstBatchMs)} | ${median(r.doneMs)} | ${r.count} |`),
  ];
  console.log(`\n${lines.join('\n')}\n`);
  const out = path.join(process.env.GWB_ROOT ?? '.', 'out', 'bench');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'results.md'), `${lines.join('\n')}\n`);
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ commits: Number(commits), vscode: vscode.version, platform: process.platform, rows }, null, 2));
}, 1800000);

export function run(): Promise<void> {
  return runAll();
}
