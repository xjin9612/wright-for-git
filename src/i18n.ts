// 介面語言：預設跟隨 VS Code，也可以在設定 gitWorkbench.language 單獨指定（不必切換整個 VS Code 的語言）
// 註：指令名稱、設定說明等 package.json 內的文字由 VS Code 依其顯示語言決定，無法由擴充套件切換。
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type Language = 'auto' | 'en' | 'zh-tw';

let extensionPath = '';
let cached: { language: Language; bundle: Record<string, string> | undefined } | undefined;

export function initI18n(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
  cached = undefined;
}

/** 設定變更時清除快取 */
export function resetI18n(): void {
  cached = undefined;
}

function configuredLanguage(): Language {
  const v = vscode.workspace.getConfiguration('gitWorkbench').get<string>('language', 'auto');
  return v === 'en' || v === 'zh-tw' ? v : 'auto';
}

/** 目前使用的翻譯（英文時為 undefined）；auto 時沿用 VS Code 載入的翻譯 */
export function currentBundle(): Record<string, string> | undefined {
  const language = configuredLanguage();
  if (cached?.language === language) return cached.bundle;
  let bundle: Record<string, string> | undefined;
  if (language === 'auto') {
    bundle = vscode.l10n.bundle;
  } else if (language === 'zh-tw') {
    try {
      bundle = JSON.parse(readFileSync(path.join(extensionPath, 'l10n', 'bundle.l10n.zh-tw.json'), 'utf8')) as Record<string, string>;
    } catch {
      bundle = undefined;
    }
  }
  cached = { language, bundle };
  return bundle;
}

/** 目前介面語言代碼（給 webview 的 lang 屬性） */
export function currentLanguage(): string {
  const language = configuredLanguage();
  return language === 'auto' ? vscode.env.language : language;
}

/** 與 vscode.l10n.t 相同用法：t('Deleted branch {0}', name) */
export function t(message: string, ...args: (string | number | boolean)[]): string {
  const bundle = currentBundle();
  const s = bundle?.[message] ?? message;
  return args.length === 0 ? s : s.replace(/\{(\d+)\}/g, (m, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}
