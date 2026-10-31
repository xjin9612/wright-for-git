// Extension 進入點
import * as vscode from 'vscode';
import { resolveGitPath } from './gitExtension';
import { WorkbenchViewProvider } from './provider';
import { RevisionFileSystem, SCHEME } from './diffProvider';
import { registerLaunchers } from './sidebar';
import { registerStash } from './stashView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const gitPath = await resolveGitPath();
  const provider = new WorkbenchViewProvider(context, gitPath);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(WorkbenchViewProvider.viewId, provider, {
      // 切換 panel 分頁時保留 webview 狀態，避免重新載入大量 commit
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.registerFileSystemProvider(SCHEME, new RevisionFileSystem((root) => provider.getRepository(root)), {
      isReadonly: true,
      isCaseSensitive: true,
    }),
    vscode.commands.registerCommand('gitWorkbench.refresh', () => provider.rediscover(true)),
    vscode.commands.registerCommand('gitWorkbench.selectRepository', () => provider.selectRepository()),
    vscode.commands.registerCommand('gitWorkbench.showHistory', (uri?: vscode.Uri) => provider.showHistory(uri)),
    vscode.commands.registerCommand('gitWorkbench.fetch', () => provider.sync('fetch')),
    vscode.commands.registerCommand('gitWorkbench.pull', () => provider.sync('pull')),
    vscode.commands.registerCommand('gitWorkbench.push', () => provider.openPush()),
    vscode.commands.registerCommand('gitWorkbench.diff.nextFile', () => provider.navigateDiff(1)),
    vscode.commands.registerCommand('gitWorkbench.diff.previousFile', () => provider.navigateDiff(-1)),
    vscode.commands.registerCommand('gitWorkbench.show', () => vscode.commands.executeCommand(`${WorkbenchViewProvider.viewId}.focus`)),
    // 設定變更集中處理，避免同一次變更觸發多次重新載入
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitWorkbench.scanDepth') || e.affectsConfiguration('gitWorkbench.scanExclude')) {
        void provider.rediscover(true);
      } else if (e.affectsConfiguration('gitWorkbench.autoRefresh')) {
        provider.rewatch();
      } else if (e.affectsConfiguration('gitWorkbench')) {
        void provider.refresh(true);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.rediscover(true)),
  );
  try {
    registerLaunchers(context, provider);
  } catch (e) {
    // 側邊欄入口失敗（例如更新後尚未重新載入視窗）不應影響 Log 面板本身
    console.error('[Git Workbench] sidebar init failed:', e);
  }
  try {
    registerStash(context, provider);
  } catch (e) {
    console.error('[Git Workbench] stash view init failed:', e);
  }
}

export function deactivate(): void {
  // 資源由 context.subscriptions 釋放
}
