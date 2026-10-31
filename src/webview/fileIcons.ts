// 依副檔名顯示的檔案圖示（webview 無法使用 VS Code 的檔案圖示主題，這裡以小型彩色標記代替）
import { el, icon } from './dom';

interface FileType {
  text: string;
  color: string;
}

const T = (text: string, color: string): FileType => ({ text, color });

const BY_EXT: Record<string, FileType> = {
  ts: T('TS', '#3178c6'),
  tsx: T('TSX', '#3178c6'),
  mts: T('TS', '#3178c6'),
  cts: T('TS', '#3178c6'),
  js: T('JS', '#d4b830'),
  jsx: T('JSX', '#d4b830'),
  mjs: T('JS', '#d4b830'),
  cjs: T('JS', '#d4b830'),
  json: T('{}', '#cbcb41'),
  jsonc: T('{}', '#cbcb41'),
  md: T('M↓', '#519aba'),
  css: T('#', '#42a5f5'),
  scss: T('#', '#cd6799'),
  less: T('#', '#5a7fbf'),
  html: T('<>', '#e37933'),
  vue: T('V', '#41b883'),
  svelte: T('S', '#ff3e00'),
  py: T('PY', '#3c78aa'),
  java: T('J', '#cc3e44'),
  kt: T('KT', '#a97bff'),
  go: T('GO', '#00add8'),
  rs: T('RS', '#dea584'),
  rb: T('RB', '#cc342d'),
  php: T('PHP', '#8892bf'),
  cs: T('C#', '#68217a'),
  c: T('C', '#5c6bc0'),
  h: T('H', '#8e7cc3'),
  cpp: T('C++', '#5c6bc0'),
  swift: T('SW', '#f05138'),
  sql: T('SQL', '#dad8d8'),
  sh: T('$', '#89e051'),
  bash: T('$', '#89e051'),
  ps1: T('PS', '#5391fe'),
  yml: T('YML', '#cb171e'),
  yaml: T('YML', '#cb171e'),
  toml: T('TML', '#9c4221'),
  xml: T('XML', '#e37933'),
  svg: T('SVG', '#ffb13b'),
  png: T('IMG', '#a074c4'),
  jpg: T('IMG', '#a074c4'),
  jpeg: T('IMG', '#a074c4'),
  gif: T('IMG', '#a074c4'),
  webp: T('IMG', '#a074c4'),
  ico: T('IMG', '#a074c4'),
  lock: T('LCK', '#8a8a8a'),
  txt: T('TXT', '#8a8a8a'),
  env: T('ENV', '#e5c07b'),
};

const BY_NAME: Record<string, FileType> = {
  dockerfile: T('DKR', '#2496ed'),
  makefile: T('MK', '#e37933'),
  license: T('§', '#cbcb41'),
  '.gitignore': T('GIT', '#f14e32'),
  '.gitattributes': T('GIT', '#f14e32'),
  '.editorconfig': T('EC', '#8a8a8a'),
};

export function fileTypeOf(path: string): FileType | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith('.env')) return BY_EXT.env;
  const dot = name.lastIndexOf('.');
  return dot > 0 || (dot === 0 && name.length > 1) ? BY_EXT[name.slice(dot + 1)] : undefined;
}

/** 檔案圖示：已知類型顯示彩色縮寫，其餘為一般檔案圖示 */
export function fileIcon(path: string): HTMLElement {
  const t = fileTypeOf(path);
  if (!t) return icon('file');
  const span = el('span', { className: `icon ftype${t.text.length > 2 ? ' small' : ''}`, text: t.text });
  span.style.color = t.color;
  return span;
}
