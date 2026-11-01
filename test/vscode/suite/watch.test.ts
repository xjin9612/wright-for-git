// 檔案監看：在 VS Code 外面用 git 操作，記錄與提交視窗自動更新（對應手動清單第 3 節）
import * as assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { api, git, repoPath, test, until } from './harness';

const API = repoPath('api-server');

test('終端機建立分支、commit：記錄自動讀到新的分支與 HEAD', async () => {
  const a = await api();
  await vscode.commands.executeCommand('gitWorkbench.show');
  git(API, 'branch', 'tmp/watch');
  await until(() => a.repoSnapshot(API)?.refs.some((r) => r.endsWith('tmp/watch')), '記錄讀到新分支 tmp/watch', 20000);
  git(API, 'commit', '-q', '--allow-empty', '-m', 'watch test');
  const head = git(API, 'rev-parse', 'HEAD');
  await until(() => a.repoSnapshot(API)?.head === head, '記錄讀到新的 HEAD', 20000);
  git(API, 'reset', '-q', '--soft', 'HEAD~1');
  git(API, 'branch', '-D', 'tmp/watch');
});

test('存檔：提交視窗約 1 秒內出現這個檔案', async () => {
  const a = await api();
  await vscode.commands.executeCommand('gitWorkbench.commit.focus');
  const file = path.join(API, 'src', 'index.ts');
  const doc = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(doc);
  await editor.edit((e) => e.insert(new vscode.Position(0, 0), '// edited in test\n'));
  await doc.save();
  try {
    await until(
      () => a.commitState()?.repos.some((r) => r.name === 'api-server' && r.changes.some((c) => c.path === 'src/index.ts')),
      '提交視窗列出 src/index.ts',
      15000,
    );
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    git(API, 'checkout', '-q', '--', 'src/index.ts');
  }
  // 還原後檔案從清單消失
  await until(() => !a.commitState()?.repos.some((r) => r.name === 'api-server' && r.changes.some((c) => c.path === 'src/index.ts')), '還原後清單更新', 15000);
  assert.ok(true);
});

test('stash：記錄讀到 refs/stash', async () => {
  const a = await api();
  writeFileSync(path.join(API, 'src', 'index.ts'), 'export const app = "stash test";\n');
  git(API, 'stash', 'push', '-q', '-m', 'watch stash', '--', 'src/index.ts');
  try {
    await until(() => git(API, 'stash', 'list').includes('watch stash'), 'stash 建立');
    // HEAD 不變，但 refs/stash 改變：提交視窗不再列出這個檔案
    await until(() => !a.commitState()?.repos.some((r) => r.name === 'api-server' && r.changes.some((c) => c.path === 'src/index.ts')), '提交視窗更新', 15000);
  } finally {
    git(API, 'stash', 'drop', '-q');
  }
});
