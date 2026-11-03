// 變更檔案樹的焦點與選取檔案（由 webview 回報）：讓 F4 這類使用者可自訂的快速鍵知道目前選了哪個檔案
// 快速鍵在 package.json 以 context key `gitWorkbench.fileTreeFocus` 限定，只在檔案樹有焦點時作用
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from './i18n';
import type { FocusedFile } from './shared/protocol';

export const FILE_TREE_FOCUS_CONTEXT = 'gitWorkbench.fileTreeFocus';

/** 有焦點的檔案樹（來源：log、commit）→ 其選取的檔案；Log 與提交視窗的焦點事件可能交錯，所以分開記 */
const focused = new Map<string, FocusedFile | undefined>();
let last: string | undefined;
let contextValue = false;

export function setFileTreeFocus(source: string, hasFocus: boolean, file?: FocusedFile): void {
  if (hasFocus) {
    focused.set(source, file);
    last = source;
  } else {
    focused.delete(source);
    if (last === source) last = [...focused.keys()].pop();
  }
  const value = focused.size > 0;
  if (value !== contextValue) {
    contextValue = value;
    void vscode.commands.executeCommand('setContext', FILE_TREE_FOCUS_CONTEXT, value);
  }
}

/** 開啟檔案樹選取檔案的工作目錄版本（IntelliJ 的 Jump to Source） */
export async function openFocusedFile(): Promise<void> {
  const file = last ? focused.get(last) : undefined;
  if (file) await openWorkingFile(file.root, file.path);
}

/** 開啟工作目錄中的檔案（一般分頁，不用預覽：接連開啟時不會互相取代）；已刪除或改名時只在狀態列提示 */
export async function openWorkingFile(root: string, relPath: string): Promise<void> {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) {
    vscode.window.setStatusBarMessage(t('File does not exist in the working tree: {0}', relPath), 3000);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(full), { preview: false });
}
