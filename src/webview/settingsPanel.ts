// 面板內的設定框（Log 面板與提交視窗共用）：由 VS Code 標題列的齒輪打開，顯示在面板右上角；下拉選單與勾選框，變更立即生效
import type { SettingsValues } from '../shared/protocol';
import { el } from './dom';
import { t } from './l10n';
import { post } from './vscodeApi';

let popover: HTMLElement | undefined;
let values: SettingsValues | undefined;

const MAX_COMMITS = [10000, 25000, 50000, 100000, 200000];

/** extension 回傳設定值；open 為 true 時（標題列齒輪、切換語言後重新載入）打開設定框 */
export function handleSettings(m: { values: SettingsValues; open?: boolean }): void {
  values = m.values;
  if (m.open && !popover) open();
  else if (popover) render();
}

function open(): void {
  close();
  popover = el('div', { className: 'settings-popover', attrs: { role: 'dialog', 'aria-label': t('Settings') } });
  document.body.append(popover);
  // 齒輪在 VS Code 的標題列（webview 外），設定框貼齊面板右上角
  popover.style.top = '8px';
  popover.style.right = '8px';
  render();
  if (!values) post({ type: 'getSettings' });
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
  popover.querySelector<HTMLElement>('select, input')?.focus();
}

function close(): void {
  popover?.remove();
  popover = undefined;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
}

function onOutside(e: Event): void {
  const target = e.target as Node | null;
  if (popover && target && !popover.contains(target)) close();
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  close();
}

const set = (key: keyof SettingsValues, value: unknown) => post({ type: 'setSetting', key, value });

function select<T extends string | number>(id: string, current: T, options: { value: T; label: string }[], onChange: (v: T) => void): HTMLSelectElement {
  const s = el('select', { className: 'settings-select', attrs: { id } });
  for (const o of options) {
    const opt = el('option', { text: o.label, attrs: { value: String(o.value) } });
    opt.selected = o.value === current;
    s.append(opt);
  }
  s.addEventListener('change', () => {
    const picked = options.find((o) => String(o.value) === s.value);
    if (picked) onChange(picked.value);
  });
  return s;
}

const row = (label: string, id: string, control: HTMLElement, hint?: string) =>
  el('div', { className: 'settings-row' }, el('label', { className: 'settings-label', text: label, title: hint, attrs: { for: id } }), control);

function link(text: string, onClick: () => void, title?: string): HTMLAnchorElement {
  const a = el('a', { className: 'link', text, attrs: { href: '#', ...(title ? { title } : {}) } });
  a.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  return a;
}

function render(): void {
  if (!popover) return;
  // 重繪會換掉所有控制項：記下焦點所在的控制項，重繪後還原（鍵盤操作下拉選單時焦點才不會跳走）
  const focusedId = popover.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
  popover.replaceChildren();
  queueMicrotask(() => {
    if (focusedId) document.getElementById(focusedId)?.focus();
  });
  popover.append(el('div', { className: 'settings-title', text: t('Git Workbench Settings') }));
  if (!values) {
    popover.append(el('div', { className: 'empty-text', text: t('Loading…') }));
    return;
  }
  const v = values;
  // 語言名稱用該語言本身書寫，切錯語言時也找得到
  const language = select('gwb-language', v.language, [
    { value: 'auto', label: t('Follow VS Code') },
    { value: 'en', label: 'English' },
    { value: 'zh-tw', label: '繁體中文' },
  ], (x) => set('language', x));
  const maxOptions = MAX_COMMITS.includes(v.maxCommits) ? MAX_COMMITS : [...MAX_COMMITS, v.maxCommits].sort((a, b) => a - b);
  const max = select('gwb-max', v.maxCommits, maxOptions.map((n) => ({ value: n, label: n.toLocaleString() })), (x) => set('maxCommits', x));
  const depth = select('gwb-depth', v.scanDepth, Array.from({ length: 11 }, (_, i) => ({ value: i, label: String(i) })), (x) => set('scanDepth', x));
  const auto = el('input', { attrs: { type: 'checkbox', id: 'gwb-auto' } });
  auto.checked = v.autoRefresh;
  auto.addEventListener('change', () => set('autoRefresh', auto.checked));

  popover.append(
    row(t('Language'), 'gwb-language', language),
    row(t('Max commits'), 'gwb-max', max, t('Maximum number of commits loaded (total across repositories)')),
    row(t('Repository scan depth'), 'gwb-depth', depth, t('How many folder levels below each workspace folder are scanned for repositories')),
    el('label', { className: 'settings-check', attrs: { for: 'gwb-auto' } }, auto, t('Refresh automatically when branches, tags or HEAD change')),
    el('div', { className: 'settings-sep' }),
    // 連結都是直接打開頁面，不加「…」（與 VS Code 管理選單的「設定」「鍵盤快速鍵」一致；設定框窄，加了看起來像被截斷）
    el('div', { className: 'settings-links' },
      link(
        v.issueLinks > 0 ? t('Issue numbers to links ({0})', v.issueLinks) : t('Issue numbers to links'),
        () => post({ type: 'editIssueLinks' }),
        t('Turn issue numbers in commit messages (such as PROJ-42 or #123) into links. Click to edit the rules.'),
      ),
      link(t('Keyboard shortcuts'), () => {
        close();
        post({ type: 'openKeybindingsPage' });
      }),
      link(t('All settings'), () => {
        close();
        post({ type: 'openSettingsPage' });
      }),
    ),
  );
}
