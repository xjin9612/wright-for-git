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
  // auto 時依 VS Code 的顯示語言自行讀取翻譯檔（不依賴 vscode.l10n.bundle，面板與通知用同一份）
  const effective = language === 'auto' ? fromVscodeLanguage(vscode.env.language) : language;
  let bundle: Record<string, string> | undefined;
  if (effective === 'zh-tw') {
    try {
      bundle = JSON.parse(readFileSync(path.join(extensionPath, 'l10n', 'bundle.l10n.zh-tw.json'), 'utf8')) as Record<string, string>;
    } catch {
      bundle = vscode.l10n.bundle;
    }
  }
  cached = { language, bundle };
  return bundle;
}

/** VS Code 顯示語言 → 支援的介面語言（目前只有繁中翻譯） */
function fromVscodeLanguage(lang: string | undefined): 'en' | 'zh-tw' {
  const l = (lang ?? 'en').toLowerCase();
  return l === 'zh-tw' || l === 'zh-hant' || l.startsWith('zh-hant') || l === 'zh-hk' || l === 'zh-mo' ? 'zh-tw' : 'en';
}

/** 目前介面語言代碼（給 webview 的 lang 屬性） */
export function currentLanguage(): string {
  const language = configuredLanguage();
  return language === 'auto' ? fromVscodeLanguage(vscode.env.language) : language;
}

/** 與 vscode.l10n.t 相同用法：t('Deleted branch {0}', name) */
export function t(message: string, ...args: (string | number | boolean)[]): string {
  const bundle = currentBundle();
  const s = bundle?.[message] ?? message;
  return args.length === 0 ? s : s.replace(/\{(\d+)\}/g, (m, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}
