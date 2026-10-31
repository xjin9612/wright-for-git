// 檔案總管右鍵「Git Workbench」子選單：與分支或標籤比較、儲藏變更、取消儲藏（對應 IntelliJ 專案樹的 Git 子選單）
import * as vscode from 'vscode';
import { compareWithWorkingTree } from './actions';
import { t } from './i18n';
import type { WorkbenchViewProvider } from './provider';
import { stashChanges } from './stashView';

export function registerExplorerCommands(context: vscode.ExtensionContext, provider: WorkbenchViewProvider, onStashChanged: () => void): void {
  /** 右鍵的目標；從指令面板執行時用目前編輯中的檔案 */
  const targetUri = (uri?: vscode.Uri) => {
    const u = uri ?? vscode.window.activeTextEditor?.document.uri;
    return u?.scheme === 'file' ? u : undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('gitWorkbench.compareWithRef', async (uri?: vscode.Uri) => {
      const u = targetUri(uri);
      const loc = u && (await provider.locateUri(u));
      if (!loc) return;
      const target = await provider.targetOf(loc.repo.root);
      if (!target?.state) return;
      const icons = { local: '$(git-branch)', remote: '$(cloud)', tag: '$(tag)' } as const;
      const items = target.state.refs.map((r) => ({
        label: `${icons[r.type]} ${r.short}`,
        description: r.type === 'local' && r.short === target.state?.head.branch ? t('current branch') : undefined,
        ref: r,
      }));
      const pick = await vscode.window.showQuickPick(items, {
        title: t('Compare {0} with Branch or Tag', loc.rel || target.name),
        placeHolder: t('Choose a branch or tag'),
        matchOnDescription: true,
      });
      if (!pick) return;
      await compareWithWorkingTree(target, pick.ref.hash, pick.ref.short, loc.rel || undefined);
    }),
    vscode.commands.registerCommand('gitWorkbench.stashChangesIn', async (uri?: vscode.Uri) => {
      const u = targetUri(uri);
      const loc = u && (await provider.locateUri(u));
      if (!loc) return;
      if (await stashChanges(loc.repo)) {
        onStashChanged();
        await provider.refresh(true);
      }
    }),
    vscode.commands.registerCommand('gitWorkbench.unstash', async (uri?: vscode.Uri) => {
      const u = targetUri(uri);
      const loc = u ? await provider.locateUri(u) : undefined;
      provider.dialogs.openUnstash(loc?.repo.root);
    }),
  );
}
