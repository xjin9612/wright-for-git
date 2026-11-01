// 指令：顯示 Git 歷史、切換 Git Blame、顯示 Git 主控台（對應手動清單第 2 節的右鍵選單與主控台）
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { api, repoPath, test, until } from './harness';

const API = repoPath('api-server');
const same = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();

test('顯示 Git 歷史：記錄切到檔案所屬的 repo，並以路徑篩選', async () => {
  const a = await api();
  await vscode.commands.executeCommand('gitWorkbench.showHistory', vscode.Uri.file(path.join(API, 'src', 'orders', 'pricing.ts')));
  await until(() => {
    const f = a.logFilter();
    return f.roots.length === 1 && same(f.roots[0], API) && f.paths.join() === 'src/orders/pricing.ts';
  }, '記錄套用 api-server 與 src/orders/pricing.ts 的篩選');
  // 還原：顯示全部 repo
  await a.setRepositoriesVisible([]);
  await until(() => a.logFilter().roots.length === 0 && a.logFilter().paths.length === 0, '篩選還原');
});

test('切換 Git Blame：1.96 以上切換內建的 git.blame.editorDecoration.enabled；舊版只提示、不出錯', async () => {
  const cfg = () => vscode.workspace.getConfiguration('git');
  const supported = cfg().inspect('blame.editorDecoration.enabled')?.defaultValue !== undefined;
  const [major, minor] = vscode.version.split('.').map(Number);
  assert.equal(supported, major > 1 || minor >= 96, `VS Code ${vscode.version} 的內建 blame 設定`);
  if (!supported) {
    await vscode.commands.executeCommand('gitWorkbench.toggleBlame');
    return;
  }
  const get = () => cfg().get<boolean>('blame.editorDecoration.enabled', false);
  const before = get();
  await vscode.commands.executeCommand('gitWorkbench.toggleBlame');
  await until(() => get() !== before, '設定被切換');
  await vscode.commands.executeCommand('gitWorkbench.toggleBlame');
  await until(() => get() === before, '設定切回原值');
});

test('顯示 Git 主控台：指令可執行', async () => {
  await vscode.commands.executeCommand('gitWorkbench.showConsole');
});
