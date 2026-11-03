// Extension 進入點
import * as vscode from 'vscode';
import { resolveGitPath } from './gitExtension';
import { WorkbenchViewProvider } from './provider';
import { RevisionFileSystem, SCHEME } from './diffProvider';
import { registerLaunchers } from './sidebar';
import { BranchesViewProvider } from './branchesView';
import { registerCommitView, type CommitViewProvider } from './commitView';
import { stashChanges } from './stashView';
import { initI18n, resetI18n, t } from './i18n';
import { registerGitConsole } from './gitConsole';
import { registerExplorerCommands } from './explorerCommands';
import { createTestApi, type TestApi } from './testApi';
import { optimizeRepositories } from './optimize';
import { openFocusedFile } from './fileTreeFocus';

export async function activate(context: vscode.ExtensionContext): Promise<TestApi> {
  initI18n(context);
  registerGitConsole(context);
  const gitPath = await resolveGitPath();
  let commitView: CommitViewProvider | undefined;
  const provider = new WorkbenchViewProvider(context, gitPath);
  const branchesView = new BranchesViewProvider(context, provider);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(WorkbenchViewProvider.viewId, provider, {
      // 切換 panel 分頁時保留 webview 狀態，避免重新載入大量 commit
      webviewOptions: { retainContextWhenHidden: true },
    }),
    branchesView,
    vscode.window.registerWebviewViewProvider(BranchesViewProvider.viewId, branchesView),
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
    vscode.commands.registerCommand('gitWorkbench.openSelectedFile', () => openFocusedFile()),
    vscode.commands.registerCommand('gitWorkbench.show', () => vscode.commands.executeCommand(`${WorkbenchViewProvider.viewId}.focus`)),
    // 設定變更集中處理，避免同一次變更觸發多次重新載入
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitWorkbench.language')) {
        resetI18n();
        provider.reloadWebview();
        branchesView.reload();
        commitView?.reload();
      } else if (e.affectsConfiguration('gitWorkbench.scanDepth') || e.affectsConfiguration('gitWorkbench.scanExclude')) {
        void provider.rediscover(true);
      } else if (e.affectsConfiguration('gitWorkbench.autoRefresh')) {
        provider.rewatch();
      } else if (e.affectsConfiguration('gitWorkbench')) {
        void provider.refresh(true);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.rediscover(true)),
  );
  registerLaunchers(context, provider);
  try {
    commitView = registerCommitView(context, provider);
  } catch (e) {
    console.error('[Git Workbench] commit view init failed:', e);
  }
  provider.dialogs.onStashChanged = () => commitView?.stashChanged();
  provider.dialogs.conflicts.onChanged = () => void commitView?.refresh();
  registerExplorerCommands(context, provider, () => {
    commitView?.stashChanged();
    void commitView?.refresh();
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('gitWorkbench.stash.save', async () => {
      const repos = await provider.repositories();
      let root = repos[0]?.root;
      if (repos.length > 1) {
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({ label: r.name, description: r.branch, root: r.root })),
          { placeHolder: t('Stash changes in which repository?') },
        );
        root = pick?.root ?? '';
      }
      const repo = root ? provider.getRepository(root) : undefined;
      if (repo && (await stashChanges(repo))) {
        commitView?.stashChanged();
        void commitView?.refresh();
        await provider.refresh(true);
      }
    }),
    // 標題列齒輪：打開面板內的設定框（語言等設定立即生效）
    vscode.commands.registerCommand('gitWorkbench.openSettings', () => provider.openSettingsPanel()),
    vscode.commands.registerCommand('gitWorkbench.commit.openSettings', () => commitView?.openSettingsPanel()),
    vscode.commands.registerCommand('gitWorkbench.unstashChanges', () => provider.dialogs.openUnstash()),
    // 最佳化儲存庫：寫入 commit-graph（大型 repo 的歷史與路徑篩選變快）；roots 給自動化測試略過選擇
    vscode.commands.registerCommand('gitWorkbench.optimizeRepository', (roots?: unknown) => optimizeRepositories(provider, Array.isArray(roots) ? roots.filter((r): r is string => typeof r === 'string') : undefined)),
    // 衝突清單分頁（指令面板、衝突提示的按鈕）；root 為字串時只是預設選取的 repo
    vscode.commands.registerCommand('gitWorkbench.resolveConflicts', (root?: unknown) => provider.dialogs.conflicts.openList(typeof root === 'string' ? root : undefined)),
    // Annotate：VS Code 1.96 起內建 git blame，這裡只切換內建的編輯器標註，不重複實作
    vscode.commands.registerCommand('gitWorkbench.toggleBlame', async () => {
      const cfg = vscode.workspace.getConfiguration('git');
      // 內建的 blame 標註從 VS Code 1.96 開始才有；舊版沒有這個設定，寫入會失敗
      if (cfg.inspect('blame.editorDecoration.enabled')?.defaultValue === undefined) {
        void vscode.window.showInformationMessage(t('Git blame annotations need VS Code 1.96 or later.'));
        return;
      }
      const on = cfg.get<boolean>('blame.editorDecoration.enabled', false);
      await cfg.update('blame.editorDecoration.enabled', !on, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(on ? t('Git blame annotations off') : t('Git blame annotations on'), 2500);
    }),
  );
  // 給自動化測試（test/vscode）讀取狀態用
  return createTestApi(provider, () => commitView);
}

export function deactivate(): void {
  // 資源由 context.subscriptions 釋放
}
