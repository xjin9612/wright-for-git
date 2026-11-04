// 檔案監看：在 VS Code 外面用 git 操作，記錄與提交視窗自動更新
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { api, git, repoPath, test, until } from './harness';

const API = repoPath('api-server');

test('終端機建立分支、commit：記錄自動讀到新的分支與 HEAD', async () => {
  const a = await api();
  await vscode.commands.executeCommand('wright.show');
  git(API, 'branch', 'tmp/watch');
  await until(() => a.repoSnapshot(API)?.refs.some((r) => r.endsWith('tmp/watch')), '記錄讀到新分支 tmp/watch', 20000);
  git(API, 'commit', '-q', '--allow-empty', '-m', 'watch test');
  const head = git(API, 'rev-parse', 'HEAD');
  await until(() => a.repoSnapshot(API)?.head === head, '記錄讀到新的 HEAD', 20000);
  git(API, 'reset', '-q', '--soft', 'HEAD~1');
  git(API, 'branch', '-D', 'tmp/watch');
});

test('存檔：提交視窗自動出現這個檔案，還原後消失', async () => {
  const a = await api();
  await vscode.commands.executeCommand('wright.commit.focus');
  const file = path.join(API, 'src', 'index.ts');
  const listed = () => a.commitState()?.repos.some((r) => r.name === 'api-server' && r.changes.some((c) => c.path === 'src/index.ts'));
  const doc = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(doc);
  await editor.edit((e) => e.insert(new vscode.Position(0, 0), '// edited in test\n'));
  await doc.save();
  try {
    await until(listed, '提交視窗列出 src/index.ts', 15000);
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    git(API, 'checkout', '-q', '--', 'src/index.ts');
  }
  await until(() => !listed(), '還原後清單更新', 15000);
});

test('stash：外部儲藏後，提交視窗不再列出被儲藏的檔案', async () => {
  const a = await api();
  const listed = () => a.commitState()?.repos.some((r) => r.name === 'api-server' && r.changes.some((c) => c.path === 'src/index.ts'));
  writeFileSync(path.join(API, 'src', 'index.ts'), 'export const app = "stash test";\n');
  // 先等提交視窗看到修改，之後的「不再列出」才有意義
  await until(listed, '提交視窗列出修改', 15000);
  git(API, 'stash', 'push', '-q', '-m', 'watch stash', '--', 'src/index.ts');
  try {
    await until(() => !listed(), '儲藏後提交視窗更新', 15000);
  } finally {
    git(API, 'stash', 'drop', '-q');
  }
});
