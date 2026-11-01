// 合併衝突：VS Code 內建合併編輯器、採用一邊、繼續合併（對應手動清單第 5 節）
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { api, git, repoPath, test, until } from './harness';

const WEB = repoPath('web-app');
const same = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();

test('合併後：衝突清單列出 legacy.ts（他們刪除）與 theme.ts（雙方修改）', async () => {
  git(WEB, 'stash', '-q');
  assert.throws(() => git(WEB, 'merge', 'conflict/theme'));
  const a = await api();
  const repo = await until(async () => (await a.conflicts()).find((r) => same(r.root, WEB) && r.files.length === 2), 'web-app 有 2 個衝突');
  assert.deepEqual(
    repo.files.map((f) => `${f.path}:${f.conflict}`).sort(),
    ['src/legacy.ts:deleted-by-them', 'src/theme.ts:both-modified'],
  );
});

test('「在 VS Code 合併編輯器開啟」：打開內建的合併編輯器', async () => {
  const a = await api();
  // 內建 Git 擴充要先偵測到 web-app，合併編輯器才開得起來
  const gitApi = (await vscode.extensions.getExtension('vscode.git')!.activate()).getAPI(1);
  await until(() => gitApi.repositories.some((r: { rootUri: vscode.Uri }) => same(r.rootUri.fsPath, WEB)), '內建 Git 偵測到 web-app', 30000);
  const root = (await a.conflicts()).find((r) => same(r.root, WEB))!.root;
  await a.openInMergeEditor(root, 'src/theme.ts');
  // 合併編輯器的分頁輸入有 base、input1、input2、result（TabInputTextMerge；1.90 的型別定義還沒有這個類別）
  const isMerge = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { base?: unknown; input1?: unknown; input2?: unknown; result?: vscode.Uri } | undefined;
    return !!input?.base && !!input.input1 && !!input.input2 && !!input.result && input.result.path.endsWith('theme.ts');
  };
  await until(isMerge, '使用中的分頁是 theme.ts 的合併編輯器', 20000);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
});

test('採用我的／他們的後衝突清空，繼續合併產生 merge commit', async () => {
  const a = await api();
  const root = (await a.conflicts()).find((r) => same(r.root, WEB))!.root;
  await a.resolveConflicts([{ root, path: 'src/legacy.ts' }], 'ours');
  await a.resolveConflicts([{ root, path: 'src/theme.ts' }], 'theirs');
  await until(() => git(WEB, 'diff', '--name-only', '--diff-filter=U') === '', '衝突都解決了');
  await a.runOperation(root, 'continue');
  await until(() => git(WEB, 'log', '-1', '--format=%P').split(' ').length === 2, '產生 merge commit');
  assert.match(git(WEB, 'show', 'HEAD:src/theme.ts'), /theme = "dark"/);
});
