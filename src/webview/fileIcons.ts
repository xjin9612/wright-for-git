// 檔案圖示與變更狀態字母。
// webview 無法使用 VS Code 的檔案圖示主題，這裡依類別顯示單色線條圖示（顏色跟隨文字），
// 變更狀態另以字母標示（與 VS Code 原始檔控制相同），不只靠顏色區分。
import { el, icon } from './dom';
import { t } from './l10n';

type Kind = 'code' | 'config' | 'doc' | 'style' | 'image' | 'shell' | 'data';

const PATHS: Record<Kind, string> = {
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  config:
    '<path d="M6 2.5c-1.4 0-2 .6-2 2v1.5c0 1-.5 1.5-1.5 2 1 .5 1.5 1 1.5 2v1.5c0 1.4.6 2 2 2M10 2.5c1.4 0 2 .6 2 2v1.5c0 1 .5 1.5 1.5 2-1 .5-1.5 1-1.5 2v1.5c0 1.4-.6 2-2 2"/>',
  doc: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 13h3"/>',
  style: '<path d="M6.5 2 5 14M11 2 9.5 14M2.5 5.5h11M2 10.5h11"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.2"/><path d="m2.5 12 4-4 3 3 1.5-1.5 2.5 2.5"/>',
  shell: '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="m4 6 2.5 2L4 10M8 10.5h4"/>',
  data: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
};

const BY_EXT: Record<string, Kind> = {};
const add = (kind: Kind, exts: string) => exts.split(' ').forEach((x) => (BY_EXT[x] = kind));
add('code', 'ts tsx mts cts js jsx mjs cjs vue svelte py java kt kts go rs rb php cs fs vb c h cpp cc hpp swift scala dart lua pl r html htm xml');
add('config', 'json jsonc json5 yml yaml toml ini cfg conf properties env lock gradle');
add('doc', 'md markdown mdx txt rst adoc pdf');
add('style', 'css scss sass less styl');
add('image', 'png jpg jpeg gif webp ico bmp svg');
add('shell', 'sh bash zsh fish ps1 psm1 bat cmd');
add('data', 'sql csv tsv db sqlite');

const BY_NAME: Record<string, Kind> = {
  dockerfile: 'shell',
  makefile: 'shell',
  license: 'doc',
  readme: 'doc',
  '.gitignore': 'config',
  '.gitattributes': 'config',
  '.editorconfig': 'config',
  '.npmrc': 'config',
};

function kindOf(path: string): Kind | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith('.env')) return 'config';
  const dot = name.lastIndexOf('.');
  return dot > 0 || (dot === 0 && name.length > 1) ? BY_EXT[name.slice(dot + 1)] : undefined;
}

/** 檔案圖示：依類別的單色線條圖示，未知類型為一般檔案圖示 */
export function fileIcon(path: string): HTMLElement {
  const kind = kindOf(path);
  if (!kind) return icon('file');
  const span = el('span', { className: 'icon' });
  span.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${PATHS[kind]}</svg>`;
  return span;
}

/** 變更狀態 → 字母（與 VS Code 原始檔控制相同）與 CSS 類別 */
const LETTERS: Record<string, { letter: string; cls: string; title: string }> = {
  A: { letter: 'A', cls: 'status-A', title: t('Added') },
  M: { letter: 'M', cls: 'status-M', title: t('Modified') },
  D: { letter: 'D', cls: 'status-D', title: t('Deleted') },
  R: { letter: 'R', cls: 'status-R', title: t('Renamed') },
  C: { letter: 'C', cls: 'status-C', title: t('Copied') },
  T: { letter: 'T', cls: 'status-T', title: t('Type changed') },
  U: { letter: '!', cls: 'status-U', title: t('Unmerged') },
  untracked: { letter: 'U', cls: 'status-untracked', title: t('Untracked') },
  ignored: { letter: 'I', cls: 'status-ignored', title: t('Ignored') },
  conflict: { letter: '!', cls: 'status-U', title: t('Unmerged') },
};

/** 狀態對應的 CSS 類別（檔名上色用） */
export function statusClass(status: string): string {
  return LETTERS[status]?.cls ?? '';
}

/**
 * 列尾的狀態字母（滑鼠提示與螢幕閱讀器讀出狀態名稱）。
 * @param status 檔案狀態（A／M／D／R／C／T／U）或提交視窗的種類（untracked／ignored／conflict）
 */
export function statusLetter(status: string): HTMLElement {
  const s = LETTERS[status] ?? { letter: status, cls: '', title: status };
  return el('span', { className: `status-letter ${s.cls}`, text: s.letter, title: s.title, attrs: { 'aria-label': s.title } });
}
