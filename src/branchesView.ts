// 側邊欄 Branches（活動列「Git 歷程」）：分支樹放在側邊欄，同時打開底部的 Log。
// 分支樹的資料與偏好以 Log 為準：Log 送來的狀態轉給這裡，這裡的操作再轉回 Log。
import * as vscode from 'vscode';
import type { WorkbenchViewProvider } from './provider';
import type { ToExtension, ToWebview } from './shared/protocol';

export class BranchesViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'gitWorkbench.branches';
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** 目前這個 view 的監聽；view 重新 resolve（例如被拖到別的容器）或 dispose 時釋放，避免越積越多 */
  private viewDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: WorkbenchViewProvider,
  ) {
    this.disposables.push(provider.onBranchesSync((sync) => this.post({ type: 'branchesSync', sync })));
  }

  dispose(): void {
    this.disposeView();
    this.disposables.forEach((d) => d.dispose());
  }

  private disposeView(): void {
    this.viewDisposables.forEach((d) => d.dispose());
    this.viewDisposables = [];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeView();
    this.view = view;
    const root = this.context.extensionUri;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(root, 'dist'), vscode.Uri.joinPath(root, 'media')] };
    view.webview.html = this.provider.pageHtml(view.webview, 'branches.js', null);
    view.webview.onDidReceiveMessage((m: ToExtension) => void this.onMessage(m), undefined, this.viewDisposables);
    view.onDidChangeVisibility(() => void this.visibilityChanged(), undefined, this.viewDisposables);
    view.onDidDispose(
      () => {
        // 已被新的 view 取代時，不要動到新 view 的狀態
        if (this.view !== view) return;
        this.view = undefined;
        this.disposeView();
        this.provider.setBranchesDocked(false);
      },
      undefined,
      this.viewDisposables,
    );
    void this.visibilityChanged();
  }

  /** 介面語言變更：重新產生 webview */
  reload(): void {
    if (this.view) this.view.webview.html = this.provider.pageHtml(this.view.webview, 'branches.js', null);
  }

  private post(msg: ToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  /** 顯示時打開 Log 並收起 Log 自己的 Branches 欄；隱藏時還原 */
  private async visibilityChanged(): Promise<void> {
    const visible = !!this.view?.visible;
    this.provider.setBranchesDocked(visible);
    if (!visible) return;
    const created = this.provider.logResolved;
    await this.provider.revealLog();
    // 第一次建立 Log 面板時焦點會被移過去，拉回側邊欄
    if (!created) await vscode.commands.executeCommand(`${BranchesViewProvider.viewId}.focus`);
  }

  private async onMessage(m: ToExtension): Promise<void> {
    if (m.type === 'ready') {
      const state = this.provider.branchesState;
      if (state) this.post({ type: 'branchesSync', sync: state });
    } else if (m.type === 'branchesEvent') {
      this.provider.forwardBranchesEvent(m.event);
    } else {
      await this.provider.handleBranchAction(m);
    }
  }
}
