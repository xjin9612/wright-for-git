// 原生 diff：從記錄開 diff、新增／刪除檔案、中文檔名、← → 切換、分頁標題的位置、提交視窗的可編輯 diff（對應手動清單第 2 節）
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, git, repoPath, test, until } from './harness';

const API = repoPath('api-server');
const hashOf = (subject: string) => git(API, 'log', '--all', '--format=%H', '--fixed-strings', `--grep=${subject}`, '-n1');

/** 目前使用中的 diff 分頁 */
function activeDiff(): { label: string; original: vscode.Uri; modified: vscode.Uri } | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return tab && tab.input instanceof vscode.TabInputTextDiff ? { label: tab.label, original: tab.input.original, modified: tab.input.modified } : undefined;
}
const text = async (uri: vscode.Uri) => (await vscode.workspace.openTextDocument(uri)).getText().replace(/\r\n/g, '\n');

test('記錄開 diff：新增的檔案左邊是空的；中文檔名的內容正確；標題有「位置/總數」', async () => {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const a = await api();
  await a.openCommitDiff(API, hashOf('docs: API reference for orders'), 'docs/中文說明.md');
  const d = await until(() => activeDiff()?.modified.path.endsWith('中文說明.md') && activeDiff(), '開啟 中文說明.md 的 diff');
  assert.equal(await text(d.original), '');
  assert.equal(await text(d.modified), '# 訂單說明\n');
  assert.match(d.label, /· [12]\/2$/);
});

test('diff 的 → 切換到同一個 commit 的下一個檔案，標題的位置跟著變；← 回來', async () => {
  const before = activeDiff()!;
  await vscode.commands.executeCommand('gitWorkbench.diff.nextFile');
  const after = await until(() => activeDiff()?.modified.toString() !== before.modified.toString() && activeDiff(), '切換到下一個檔案');
  assert.notEqual(after.label, before.label);
  assert.match(after.label, /· [12]\/2$/);
  await vscode.commands.executeCommand('gitWorkbench.diff.previousFile');
  await until(() => activeDiff()?.modified.toString() === before.modified.toString(), '切回原本的檔案');
});

test('刪除的檔案：右邊是空的、左邊是刪除前的內容', async () => {
  const a = await api();
  await a.openCommitDiff(API, hashOf('chore: drop legacy script'), 'scripts/legacy.sh');
  const d = await until(() => activeDiff()?.original.path.endsWith('legacy.sh') && activeDiff(), '開啟 legacy.sh 的 diff');
  assert.equal(await text(d.modified), '');
  assert.match(await text(d.original), /echo legacy/);
});

test('提交視窗開的 diff：右邊是工作區的實際檔案（可直接編輯）', async () => {
  const a = await api();
  await a.openWorkingDiff(API, 'src/config.ts');
  const d = await until(() => activeDiff()?.modified.path.endsWith('config.ts') && activeDiff(), '開啟 config.ts 的 diff');
  assert.equal(d.modified.scheme, 'file');
  assert.match(d.label, /HEAD ↔ Working Tree/);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});
