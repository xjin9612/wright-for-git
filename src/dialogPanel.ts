// 開在編輯器分頁的對話框（Push 等）：比底部面板大，可拖到其他編輯器群組或用「移到新視窗」變成浮動視窗
import * as vscode from 'vscode';
import { ConfirmHost } from './dialogs';
import { t } from './i18n';
import type { WorkbenchViewProvider } from './provider';
import type { ToExtension, ToWebview } from './shared/protocol';

export interface PushDialogArgs {
  roots: string[];
  branch?: string;
  upTo?: { root: string; hash: string };
}

/** webview 端依 kind 決定要畫哪個對話框 */
export type DialogConfig = { kind: 'push'; args: PushDialogArgs };

export class DialogPanels {
  private push: { panel: vscode.WebviewPanel; host: ConfirmHost } | undefined;

  constructor(private readonly provider: WorkbenchViewProvider) {}

  openPush(args: PushDialogArgs): void {
    const config: DialogConfig = { kind: 'push', args };
    const title = args.upTo ? t('Push Commits up to {0}', args.upTo.hash.slice(0, 8)) : args.branch ? t('Push {0}', args.branch) : t('Push Commits');
    if (this.push) {
      // 已開啟：以新的內容重新載入並移到前面
      this.push.panel.title = title;
      this.push.host.cancelAll();
      this.push.panel.webview.html = this.provider.dialogHtml(this.push.panel.webview, config);
      this.push.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('gitWorkbench.push', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.provider.extensionUri, 'dist'), vscode.Uri.joinPath(this.provider.extensionUri, 'media')],
    });
    panel.iconPath = vscode.Uri.joinPath(this.provider.extensionUri, 'media', 'activity.svg');
    const reply = (msg: ToWebview) => void panel.webview.postMessage(msg);
    const host = new ConfirmHost(reply, () => t('Cancel'));
    this.push = { panel, host };
    panel.webview.onDidReceiveMessage(async (m: ToExtension) => {
      try {
        switch (m.type) {
          case 'pushPreview':
          case 'pushCommitFiles':
          case 'pushConfirm':
            await this.provider.handlePushMessage(m, reply, host);
            break;
          case 'confirmResult':
            host.resolve(m.id, m.ok);
            break;
          case 'openDiff':
            await this.provider.openDiffFromDialog(m.root, m.hash, m.parent, m.file);
            break;
          case 'closeDialog':
            panel.dispose();
            break;
        }
      } catch (e) {
        void vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    });
    panel.onDidDispose(() => {
      host.cancelAll();
      if (this.push?.panel === panel) this.push = undefined;
    });
    panel.webview.html = this.provider.dialogHtml(panel.webview, config);
  }
}
