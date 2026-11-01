// 儲藏（stash）的共用操作：儲藏變更、開啟儲藏中檔案的 diff（提交視窗的「儲藏」分頁與檔案總管右鍵使用）
import * as path from 'node:path';
import * as vscode from 'vscode';
import { revisionUri } from './diffProvider';
import type { GitRepository } from './git/repository';
import type { ChangedFile, StashInfo } from './shared/protocol';
import { t } from './i18n';
import { showGitError } from './gitConsole';


function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 「On main: msg」→「msg」；「WIP on main: abc123 subject」→「WIP: subject」 */
export function stashLabel(message: string): string {
  const wip = /^WIP on [^:]+: [0-9a-f]+ (.*)$/.exec(message);
  if (wip) return `WIP: ${wip[1]}`;
  const on = /^On [^:]+: (.*)$/.exec(message);
  return on ? on[1] : message;
}

/** 儲藏變更：選擇範圍（已追蹤／含未追蹤／保留暫存）與說明；成功回傳 true */
export async function stashChanges(repo: GitRepository): Promise<boolean> {
  const mode = await vscode.window.showQuickPick(
    [
      { label: t('Tracked files'), description: t('Modified and staged files'), untracked: false, keepIndex: false },
      { label: t('Include untracked files'), description: '--include-untracked', untracked: true, keepIndex: false },
      { label: t('Keep staged changes'), description: t('Stash everything but leave the index as is (--keep-index)'), untracked: false, keepIndex: true },
    ],
    { placeHolder: t('What to stash') },
  );
  if (!mode) return false;
  if (!(await repo.hasChanges(mode.untracked))) {
    void vscode.window.showInformationMessage(t('There are no local changes to stash.'));
    return false;
  }
  const message = await vscode.window.showInputBox({ title: t('Stash Changes'), prompt: t('Message (optional)') });
  if (message === undefined) return false;
  try {
    await repo.stashPush(message, mode.untracked, mode.keepIndex);
    vscode.window.setStatusBarMessage(`$(check) ${t('Changes stashed')}`, 4000);
    return true;
  } catch (e) {
    void showGitError(errorMessage(e));
    return false;
  }
}

/** 開啟儲藏中某個檔案的 diff（儲藏當時的 HEAD ↔ 儲藏內容；未追蹤檔案左側為空） */
export async function openStashFile(root: string, stash: StashInfo, file: ChangedFile & { untracked?: boolean }, viewColumn?: vscode.ViewColumn): Promise<void> {
  const base = stash.parents[0];
  const left = file.untracked || file.status === 'A' ? revisionUri(root, '', file.path) : revisionUri(root, base, file.oldPath ?? file.path);
  const rightRef = file.untracked ? stash.parents[2] : file.status === 'D' ? '' : stash.hash;
  const right = revisionUri(root, rightRef, file.path);
  await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(file.path)} (${stash.ref})`, { preview: true, viewColumn });
}
