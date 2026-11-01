// 面板內的「設定」彈出框（Log 面板與提交視窗共用）：讀取／寫入 gitWorkbench 的設定，變更立即生效。
// 切換語言會重新載入 webview，載入完成後自動重新打開彈出框，讓使用者看到結果。
import * as vscode from 'vscode';
import type { SettingsValues, ToWebview } from './shared/protocol';

type ViewId = 'log' | 'commit';

/** 語言切換後要重新打開設定框的 webview */
const reopen = new Set<ViewId>();

export function readSettings(): SettingsValues {
  const c = vscode.workspace.getConfiguration('gitWorkbench');
  return {
    language: c.get<SettingsValues['language']>('language', 'auto'),
    autoRefresh: c.get<boolean>('autoRefresh', true),
    maxCommits: c.get<number>('maxCommits', 50000),
    scanDepth: c.get<number>('scanDepth', 3),
    issueLinks: c.get<unknown[]>('issueLinks', []).length,
  };
}

/** 驗證後寫入使用者設定；不在清單中的 key 或不合法的值一律忽略（webview 傳來的資料不可信） */
async function write(key: string, value: unknown): Promise<boolean> {
  const ok =
    (key === 'language' && (value === 'auto' || value === 'en' || value === 'zh-tw')) ||
    (key === 'autoRefresh' && typeof value === 'boolean') ||
    (key === 'maxCommits' && typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 200000) ||
    (key === 'scanDepth' && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10);
  if (!ok) return false;
  await vscode.workspace.getConfiguration('gitWorkbench').update(key, value, vscode.ConfigurationTarget.Global);
  return true;
}

/** 處理設定相關訊息；回傳 true 表示已處理 */
export async function handleSettingsMessage(m: { type: string; key?: string; value?: unknown }, view: ViewId, post: (msg: ToWebview) => void): Promise<boolean> {
  switch (m.type) {
    case 'getSettings':
      post({ type: 'settings', values: readSettings() });
      return true;
    case 'setSetting':
      if (m.key === 'language') reopen.add(view);
      if (await write(m.key ?? '', m.value)) post({ type: 'settings', values: readSettings() });
      else reopen.delete(view);
      return true;
    case 'openSettingsPage':
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:xjin9612.vscode-git-workbench');
      return true;
    case 'editIssueLinks':
      await vscode.commands.executeCommand('workbench.action.openSettingsJson', { revealSetting: { key: 'gitWorkbench.issueLinks', edit: true } });
      return true;
  }
  return false;
}

/** webview 載入完成時呼叫：剛切換過語言的話，重新打開設定框 */
export function settingsAfterReady(view: ViewId, post: (msg: ToWebview) => void): void {
  if (!reopen.delete(view)) return;
  post({ type: 'settings', values: readSettings(), open: true });
}

/** 標題列齒輪：打開面板內的設定框 */
export function openSettingsIn(post: (msg: ToWebview) => void): void {
  post({ type: 'settings', values: readSettings(), open: true });
}
