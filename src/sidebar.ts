// 狀態列的「Git 記錄」按鈕，以及「顯示全部儲存庫」指令
import * as vscode from 'vscode';
import type { WorkbenchViewProvider } from './provider';
import { t } from './i18n';

export function registerLaunchers(context: vscode.ExtensionContext, provider: WorkbenchViewProvider): void {
  const status = vscode.window.createStatusBarItem('wright.status', vscode.StatusBarAlignment.Left, -100);
  status.name = 'Wright';
  status.text = `$(git-commit) ${t('Git Log')}`;
  status.tooltip = t('Show Git Log (Alt+9)');
  status.command = 'wright.show';
  status.show();

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand('wright.showAllRepositories', () => provider.showRepositories([])),
  );
}
