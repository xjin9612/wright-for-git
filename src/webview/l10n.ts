// Webview 介面文字翻譯：extension 把 vscode.l10n.bundle（目前語系的翻譯）放進 HTML，這裡依英文原文取用
let bundle: Record<string, string> = {};
try {
  const node = document.getElementById('l10n-bundle');
  if (node?.textContent) bundle = JSON.parse(node.textContent) as Record<string, string>;
} catch {
  bundle = {};
}

/** 與 vscode.l10n.t 相同的用法：t('Push {0} commits', n) */
export function t(message: string, ...args: (string | number)[]): string {
  const s = bundle[message] ?? message;
  return args.length === 0 ? s : s.replace(/\{(\d+)\}/g, (m, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}

/** 單複數：plural(n, '{0} file', '{0} files') */
export function plural(n: number, one: string, other: string): string {
  return t(n === 1 ? one : other, n);
}
