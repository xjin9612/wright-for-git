// 左側活動列入口：Repositories 清單（勾選 = Log 的 Paths／repo 篩選）+ 狀態列按鈕
// 打開活動列的 Git Workbench 時自動開啟底部的 Log 面板（對應 IntelliJ 左下角的 Git 工具視窗按鈕）
import * as vscode from 'vscode';
import type { RepositorySummary, WorkbenchViewProvider } from './provider';

class RepoItem extends vscode.TreeItem {
  constructor(readonly repo: RepositorySummary) {
    super(repo.name, vscode.TreeItemCollapsibleState.None);
    this.description = repo.branch;
    this.tooltip = `${repo.root}${repo.branch ? `\n${repo.branch}` : ''}`;
    this.iconPath = new vscode.ThemeIcon('repo');
    this.contextValue = 'repository';
    this.checkboxState = repo.visible ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    // 點名稱：只顯示這個 repo
    this.command = { command: 'gitWorkbench.openRepository', title: 'Show only this repository', arguments: [repo.root] };
  }
}

export class RepositoriesTree implements vscode.TreeDataProvider<RepoItem> {
  static readonly viewId = 'gitWorkbench.repositories';
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  items: RepoItem[] = [];

  constructor(private readonly provider: WorkbenchViewProvider) {
    provider.onDidChange(() => this.emitter.fire());
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(item: RepoItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<RepoItem[]> {
    this.items = (await this.provider.repositories()).map((r) => new RepoItem(r));
    return this.items;
  }
}

export function registerLaunchers(context: vscode.ExtensionContext, provider: WorkbenchViewProvider): void {
  const tree = new RepositoriesTree(provider);
  const view = vscode.window.createTreeView(RepositoriesTree.viewId, { treeDataProvider: tree, manageCheckboxStateManually: true });

  const status = vscode.window.createStatusBarItem('gitWorkbench.status', vscode.StatusBarAlignment.Left, -100);
  status.name = 'Git Workbench';
  status.text = '$(git-commit) Git Log';
  status.tooltip = vscode.l10n.t('Show Git Log (Alt+9)');
  status.command = 'gitWorkbench.show';
  status.show();

  context.subscriptions.push(
    view,
    status,
    view.onDidChangeVisibility((e) => {
      if (e.visible) void vscode.commands.executeCommand('gitWorkbench.log.focus');
    }),
    // 勾選／取消勾選 → 更新 Log 的 repo 篩選（全部取消時視為全部顯示）
    view.onDidChangeCheckboxState((e) => {
      const changed = new Map(e.items.map(([item, state]) => [item.repo.root, state === vscode.TreeItemCheckboxState.Checked]));
      const roots = tree.items.filter((i) => changed.get(i.repo.root) ?? i.repo.visible).map((i) => i.repo.root);
      void provider.showRepositories(roots.length === 0 ? tree.items.map((i) => i.repo.root) : roots, false);
    }),
    vscode.commands.registerCommand('gitWorkbench.openRepository', (root: string) => provider.showRepositories([root])),
    vscode.commands.registerCommand('gitWorkbench.showAllRepositories', () => provider.showRepositories([])),
    vscode.commands.registerCommand('gitWorkbench.refreshRepositories', () => provider.rediscover(true)),
  );
}
