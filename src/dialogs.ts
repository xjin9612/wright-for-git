// 確認對話框：Log 面板開著時顯示在面板內（與 Push 對話框同風格），否則退回 VS Code 的 modal 對話框
import * as vscode from 'vscode';

export interface ConfirmOptions {
  /** 補充說明（可多行） */
  detail?: string;
  /** 確認按鈕文字 */
  ok: string;
  /** warning：警告圖示；danger：破壞性操作（確認按鈕為紅色） */
  kind?: 'info' | 'warning' | 'danger';
}

export type WebviewConfirm = (message: string, opts: ConfirmOptions) => Promise<boolean | undefined>;

let webviewConfirm: WebviewConfirm | undefined;

/** 由 Log 面板註冊；面板不可見時回傳 undefined 表示改用 VS Code 對話框 */
export function setWebviewConfirm(fn: WebviewConfirm | undefined): void {
  webviewConfirm = fn;
}

/**
 * 在某個 webview 內顯示確認框的宿主：送出 confirm 訊息，等 webview 回傳 confirmResult。
 * Log 面板與編輯器分頁的對話框（Push 等）各有一個。
 */
export class ConfirmHost {
  private seq = 0;
  private readonly pending = new Map<number, (ok: boolean) => void>();

  constructor(
    private readonly post: (msg: { type: 'confirm'; id: number; message: string; detail?: string; ok: string; cancel: string; kind: 'info' | 'warning' | 'danger' }) => void,
    private readonly cancelLabel: () => string,
  ) {}

  request(message: string, opts: ConfirmOptions): Promise<boolean> {
    const id = ++this.seq;
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'confirm', id, message, detail: opts.detail, ok: opts.ok, cancel: this.cancelLabel(), kind: opts.kind ?? 'warning' });
    });
  }

  resolve(id: number, ok: boolean): void {
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    resolve?.(ok);
  }

  /** webview 關閉或重新載入：尚未回覆的視為取消 */
  cancelAll(): void {
    for (const resolve of this.pending.values()) resolve(false);
    this.pending.clear();
  }
}

/** 顯示確認框；使用者確認時回傳 true。host 指定時顯示在該 webview 內 */
export async function confirm(message: string, opts: ConfirmOptions, host?: ConfirmHost): Promise<boolean> {
  if (host) return host.request(message, opts);
  const inPanel = await webviewConfirm?.(message, opts);
  if (inPanel !== undefined) return inPanel;
  const answer =
    opts.kind === 'info'
      ? await vscode.window.showInformationMessage(message, { modal: true, detail: opts.detail }, opts.ok)
      : await vscode.window.showWarningMessage(message, { modal: true, detail: opts.detail }, opts.ok);
  return answer === opts.ok;
}
