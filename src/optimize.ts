// 「Wright: 最佳化儲存庫」：對選取的 repo 寫入 commit-graph。
// 不主動提示；大型 repo 想加快歷史與路徑篩選時由使用者自己執行（說明見 README）。
import * as vscode from 'vscode';
import { showGitError } from './gitConsole';
import { plural, t } from './i18n';
import type { WorkbenchViewProvider } from './provider';

export async function optimizeRepositories(provider: WorkbenchViewProvider, roots?: string[]): Promise<void> {
  const repos = await provider.repositories();
  let targets = roots ? repos.filter((r) => roots.includes(r.root)) : repos;
  if (!roots && repos.length > 1) {
    const picks = await vscode.window.showQuickPick(
      repos.map((r) => ({ label: r.name, description: r.branch, root: r.root, picked: true })),
      { canPickMany: true, placeHolder: t('Optimize which repositories? (writes a commit-graph so history and path filters load faster)') },
    );
    if (!picks || picks.length === 0) return;
    targets = repos.filter((r) => picks.some((p) => p.root === r.root));
  }
  if (targets.length === 0) return;
  const failed: string[] = [];
  let basic = false;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Optimizing repositories…') }, async (progress) => {
    for (const r of targets) {
      progress.report({ message: r.name });
      try {
        const result = await provider.getRepository(r.root)?.writeCommitGraph();
        if (result && !result.changedPaths) basic = true;
      } catch (e) {
        failed.push(`${r.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });
  if (failed.length > 0) {
    void showGitError(t('Could not optimize: {0}', failed.join('\n')));
  } else {
    void vscode.window.showInformationMessage(
      plural(targets.length, 'Optimized {0} repository.', 'Optimized {0} repositories.') + (basic ? ` ${t('Your git is older than 2.27, so path filters are not sped up.')}` : ''),
    );
  }
  await provider.refresh(true);
}
