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

/** 顯示確認框；使用者確認時回傳 true */
export async function confirm(message: string, opts: ConfirmOptions): Promise<boolean> {
  const inPanel = await webviewConfirm?.(message, opts);
  if (inPanel !== undefined) return inPanel;
  const answer =
    opts.kind === 'info'
      ? await vscode.window.showInformationMessage(message, { modal: true, detail: opts.detail }, opts.ok)
      : await vscode.window.showWarningMessage(message, { modal: true, detail: opts.detail }, opts.ok);
  return answer === opts.ok;
}
