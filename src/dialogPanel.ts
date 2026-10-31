// 開在編輯器分頁的對話框（Push、取消儲藏）：比底部面板大，可拖到其他編輯器群組或用「移到新視窗」變成浮動視窗
import * as vscode from 'vscode';
import { ConfirmHost, confirm } from './dialogs';
import { t } from './i18n';
import type { WorkbenchViewProvider } from './provider';
import type { DiffHunk, ToExtension, ToWebview } from './shared/protocol';
import { openStashFile } from './stashView';

export interface PushDialogArgs {
  roots: string[];
  branch?: string;
  upTo?: { root: string; hash: string };
}

/** webview 端依 kind 決定要畫哪個對話框 */
export type DialogConfig =
  | { kind: 'push'; args: PushDialogArgs }
  | { kind: 'unstash'; args: { root?: string } }
  | { kind: 'hunks'; args: { root: string; path: string; hunks: DiffHunk[]; selected: number[] } };

type Reply = (msg: ToWebview) => void;
type Handler = (m: ToExtension, reply: Reply, host: ConfirmHost, close: () => void) => Promise<void>;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class DialogPanels {
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; host: ConfirmHost }>();

  constructor(private readonly provider: WorkbenchViewProvider) {}

  openPush(args: PushDialogArgs): void {
    const title = args.upTo ? t('Push Commits up to {0}', args.upTo.hash.slice(0, 8)) : args.branch ? t('Push {0}', args.branch) : t('Push Commits');
    this.open('push', title, { kind: 'push', args }, async (m, reply, host) => {
      if (m.type === 'pushPreview' || m.type === 'pushCommitFiles' || m.type === 'pushConfirm') await this.provider.handlePushMessage(m, reply, host);
      else if (m.type === 'openDiff') await this.provider.openDiffFromDialog(m.root, m.hash, m.parent, m.file);
    });
  }

  /** 逐段選取要提交的 hunk（提交視窗開啟）；onApply 收到選取的段落序號 */
  openHunks(root: string, filePath: string, hunks: DiffHunk[], selected: number[], onApply: (indices: number[]) => Promise<void>): void {
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    this.open('hunks', t('Select Changes: {0}', name), { kind: 'hunks', args: { root, path: filePath, hunks, selected } }, async (m) => {
      if (m.type === 'hunksSelect') await onApply(m.selected);
    });
  }

  openUnstash(root?: string): void {
    this.open('unstash', t('Unstash Changes'), { kind: 'unstash', args: { root } }, (m, reply, host, close) => this.handleUnstash(m, reply, host, close));
  }

  async handleUnstash(m: ToExtension, reply: Reply, host: ConfirmHost, close: () => void): Promise<void> {
    const repoOf = (root: string) => this.provider.getRepository(root);
    const findStash = async (root: string, hash: string) => (await repoOf(root)?.listStashes())?.find((s) => s.hash === hash);
    switch (m.type) {
      case 'unstashLoad': {
        const list = await this.provider.repositories();
        const repos = await Promise.all(
          list.map(async (r) => ({ root: r.root, name: r.name, stashes: (await repoOf(r.root)?.listStashes().catch(() => [])) ?? [] })),
        );
        reply({ type: 'unstashData', requestId: m.requestId, repos });
        return;
      }
      case 'unstashFiles': {
        const stash = await findStash(m.root, m.hash);
        const files = stash ? ((await repoOf(m.root)?.getStashFiles(stash)) ?? []) : [];
        reply({ type: 'unstashFiles', requestId: m.requestId, root: m.root, hash: m.hash, files });
        return;
      }
      case 'openStashDiff': {
        const stash = await findStash(m.root, m.hash);
        if (stash) await openStashFile(m.root, stash, m.file, vscode.ViewColumn.Beside);
        return;
      }
      case 'unstashApply': {
        const repo = repoOf(m.root);
        const stash = await findStash(m.root, m.hash);
        if (!repo || !stash) {
          void vscode.window.showWarningMessage(t('This stash no longer exists.'));
          return;
        }
        try {
          if (m.branch) {
            if (!(await repo.isValidRefName(m.branch, 'branch'))) {
              void vscode.window.showErrorMessage(t('Not a valid branch name.'));
              return;
            }
            await repo.stashBranch(m.branch, stash.ref);
          } else {
            await repo.stashApply(stash.ref, { pop: m.pop, index: m.index });
          }
          vscode.window.setStatusBarMessage(`$(check) ${m.branch ? t('Created and checked out {0}', m.branch) : m.pop ? t('Popped {0}', stash.ref) : t('Applied {0}', stash.ref)}`, 4000);
          close();
        } catch (e) {
          const msg = errorMessage(e);
          if (/conflict/i.test(msg)) {
            void vscode.window.showWarningMessage(t('The stash was applied with conflicts. Resolve them in Source Control; the stash was kept.'), t('Open Source Control')).then((a) => {
              if (a) void vscode.commands.executeCommand('workbench.view.scm');
            });
            close();
          } else {
            void vscode.window.showErrorMessage(msg);
          }
        }
        await this.provider.refresh(true);
        return;
      }
      case 'unstashDrop': {
        const stash = await findStash(m.root, m.hash);
        if (!stash) return;
        if (await confirm(t('Drop {0}? Its changes will be lost.', stash.ref), { detail: stash.message, ok: t('Drop'), kind: 'danger' }, host)) {
          await repoOf(m.root)?.stashDrop(stash.ref);
        }
        return;
      }
      case 'unstashClear': {
        const repo = repoOf(m.root);
        const count = (await repo?.listStashes())?.length ?? 0;
        if (!repo || count === 0) return;
        if (await confirm(t('Drop all {0} stashes? Their changes will be lost.', count), { ok: t('Clear'), kind: 'danger' }, host)) {
          await repo.stashClear();
        }
        return;
      }
    }
  }

  private open(key: string, title: string, config: DialogConfig, handler: Handler): void {
    const existing = this.panels.get(key);
    if (existing) {
      // 已開啟：以新的內容重新載入並移到前面
      existing.panel.title = title;
      existing.host.cancelAll();
      existing.panel.webview.html = this.provider.dialogHtml(existing.panel.webview, config);
      existing.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(`gitWorkbench.${key}`, title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.provider.extensionUri, 'dist'), vscode.Uri.joinPath(this.provider.extensionUri, 'media')],
    });
    panel.iconPath = vscode.Uri.joinPath(this.provider.extensionUri, 'media', 'activity.svg');
    const reply: Reply = (msg) => void panel.webview.postMessage(msg);
    const host = new ConfirmHost(reply, () => t('Cancel'));
    this.panels.set(key, { panel, host });
    panel.webview.onDidReceiveMessage(async (m: ToExtension) => {
      try {
        if (m.type === 'confirmResult') host.resolve(m.id, m.ok);
        else if (m.type === 'closeDialog') panel.dispose();
        else await handler(m, reply, host, () => panel.dispose());
      } catch (e) {
        void vscode.window.showErrorMessage(errorMessage(e));
      }
    });
    panel.onDidDispose(() => {
      host.cancelAll();
      if (this.panels.get(key)?.panel === panel) this.panels.delete(key);
    });
    panel.webview.html = this.provider.dialogHtml(panel.webview, config);
  }
}
