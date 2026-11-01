// 儲藏的顯示名稱（extension 與 webview 共用）

/** 「On main: msg」→「msg」；「WIP on main: abc123 subject」→「WIP: subject」 */
export function stashLabel(message: string): string {
  const wip = /^WIP on [^:]+: [0-9a-f]+ (.*)$/.exec(message);
  if (wip) return `WIP: ${wip[1]}`;
  const on = /^On [^:]+: (.*)$/.exec(message);
  return on ? on[1] : message;
}
