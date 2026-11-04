// Git 主控台（對應 IntelliJ 的 Git Console）：在「輸出」面板的「Wright」頻道記錄每個 git 指令。
// 會改變狀態的指令（fetch、push、commit、checkout…）以 info 顯示，失敗以 error 顯示並附上 git 的錯誤輸出；
// 只讀取的指令（log、status…）以 trace 記錄（失敗為 debug），需要時用「開發人員: 設定記錄層級」把 Wright 調成「追蹤」就能看到。
import * as path from 'node:path';
import * as vscode from 'vscode';
import { setGitLogger, type GitCommandRecord } from './git/gitRunner';
import { t } from './i18n';

let channel: vscode.LogOutputChannel | undefined;
/** 最近的寫入指令與失敗（自動化測試失敗時印出，方便判斷卡在哪一步） */
const recent: string[] = [];
const remember = (line: string) => {
  recent.push(line);
  if (recent.length > 40) recent.shift();
};
export const recentGitLog = (): readonly string[] => recent;

/** 指令列顯示：含空白的參數加引號；參數很多（如一次加入數百個路徑）時截短 */
export function formatCommand(args: readonly string[]): string {
  const MAX = 24;
  const shown = args.slice(0, MAX).map((a) => (a === '' ? '""' : /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  if (args.length > MAX) shown.push(`… (+${args.length - MAX})`);
  return `git ${shown.join(' ')}`;
}

const repoName = (cwd: string) => path.basename(cwd) || cwd;
const indent = (text: string) =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => `    ${l}`)
    .join('\n');

function onEnd(r: GitCommandRecord): void {
  if (!channel) return;
  const head = `[${repoName(r.cwd)}]`;
  const time = `${r.durationMs} ms`;
  if (r.cancelled) {
    channel.trace(`${head} ${t('cancelled')}: ${formatCommand(r.args)} (${time})`);
    return;
  }
  if (r.exitCode !== 0) {
    const out = indent(r.stderr);
    // 只讀取的指令失敗多半是預期中的查詢（例如檢查 MERGE_HEAD 是否存在），只在除錯層級顯示
    const log = r.readOnly ? channel.debug.bind(channel) : channel.error.bind(channel);
    if (!r.readOnly) remember(`error ${head} ${formatCommand(r.args)}: ${r.stderr.trim().split('\n')[0] ?? ''}`);
    log(`${head} ${formatCommand(r.args)}\n    ${t('exit code {0}', String(r.exitCode))} · ${time} · ${r.cwd}${out ? `\n${out}` : ''}`);
    return;
  }
  if (r.readOnly) {
    channel.trace(`${head} ✓ ${formatCommand(r.args)} (${time})`);
    return;
  }
  // push／fetch 等把結果寫到 stderr（如「To origin … main -> main」），一併顯示
  const out = indent(r.stderr);
  remember(`ok ${head} ${formatCommand(r.args)}`);
  channel.info(`${head} ✓ ${r.args.find((a) => !a.startsWith('-')) ?? ''} (${time})${out ? `\n${out}` : ''}`);
}

export function registerGitConsole(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Wright', { log: true });
  context.subscriptions.push(channel);
  setGitLogger(
    (r) => {
      if (r.readOnly) channel?.trace(`[${repoName(r.cwd)}] ${formatCommand(r.args)}`);
      else channel?.info(`[${repoName(r.cwd)}] ${formatCommand(r.args)}`);
    },
    onEnd,
  );
  context.subscriptions.push(
    { dispose: () => setGitLogger(undefined, undefined) },
    vscode.commands.registerCommand('wright.showConsole', () => channel?.show(true)),
  );
}

/** 錯誤通知：多一個「顯示 Git 主控台」按鈕，可查看完整的指令與輸出 */
export async function showGitError(message: string, ...rest: (string | vscode.MessageOptions)[]): Promise<string | undefined> {
  const options = typeof rest[0] === 'object' ? (rest.shift() as vscode.MessageOptions) : undefined;
  const items = rest as string[];
  const open = t('Show Git Console');
  const answer = options ? await vscode.window.showErrorMessage(message, options, ...items, open) : await vscode.window.showErrorMessage(message, ...items, open);
  if (answer === open) {
    channel?.show(true);
    return undefined;
  }
  return answer;
}
