// 啟用、指令註冊、視圖、repo 偵測
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, test, until } from './harness';

test('啟用：package.json 列出的指令都已註冊', async () => {
  await api();
  const ext = vscode.extensions.getExtension('xjin9612.wright-for-git')!;
  const declared: string[] = ext.packageJSON.contributes.commands.map((c: { command: string }) => c.command);
  const all = new Set(await vscode.commands.getCommands(true));
  assert.deepEqual(
    declared.filter((c) => !all.has(c)),
    [],
  );
});

test('快捷鍵：Alt+9、Alt+0 對應的指令可以執行，並打開記錄與提交視窗', async () => {
  const ext = vscode.extensions.getExtension('xjin9612.wright-for-git')!;
  const keys: { command: string; key: string }[] = ext.packageJSON.contributes.keybindings;
  assert.equal(keys.find((k) => k.key === 'alt+9')?.command, 'wright.show');
  assert.equal(keys.find((k) => k.key === 'alt+0')?.command, 'wright.showCommit');
  // F4：只在變更檔案樹有焦點時作用（使用者可在「鍵盤快速鍵」改鍵）
  const f4 = keys.find((k) => k.command === 'wright.openSelectedFile') as { key: string; when?: string } | undefined;
  assert.equal(f4?.key, 'f4');
  assert.equal(f4?.when, 'wright.fileTreeFocus');
  // 沒有檔案樹焦點時執行不做任何事、不丟錯
  await vscode.commands.executeCommand('wright.openSelectedFile');
  const a = await api();
  await vscode.commands.executeCommand('wright.show');
  // 記錄面板打開後 webview 會請求載入記錄
  await until(() => a.logStats()?.doneMs !== undefined, '記錄載入完成');
  await vscode.commands.executeCommand('wright.showCommit');
  await until(() => a.commitState(), '提交視窗載入變更');
});

test('活動列「Git 歷程」：側邊欄 Branches 打開後收到 Log 的分支資料', async () => {
  const a = await api();
  await vscode.commands.executeCommand('wright.branches.focus');
  const sync = await until(() => {
    const s = a.branchesState();
    return s && s.states.length > 0 ? s : undefined;
  }, '側邊欄 Branches 收到分支資料');
  assert.ok(sync.states.every((st) => st.refs.length > 0));
  // 記錄面板跟著打開並完成載入
  await until(() => a.logStats()?.doneMs !== undefined, '記錄載入完成');
});

test('偵測 repo：api-server、巢狀的 api-server/libs/shared、web-app，不含一般資料夾 notes', async () => {
  const a = await api();
  const names = await until(async () => {
    const list = (await a.repositories()).map((r) => r.name.replace(/\\/g, '/')).sort();
    return list.length >= 3 ? list : undefined;
  }, '偵測到 3 個 repo');
  assert.deepEqual(names, ['api-server', 'api-server/libs/shared', 'web-app']);
});
