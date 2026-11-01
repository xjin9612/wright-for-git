// DOM 小工具與 SVG 圖示（不使用前端框架）
import { t } from './l10n';

type Child = Node | string | null | undefined | false;

export interface ElProps {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const ICONS = {
  'chevron-right': '<path d="M6 4l4 4-4 4"/>',
  'chevron-down': '<path d="M4 6l4 4 4-4"/>',
  'chevron-left': '<path d="M10 4L6 8l4 4"/>',
  folder: '<path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z"/>',
  branch: '<circle cx="5" cy="3.5" r="1.5"/><circle cx="5" cy="12.5" r="1.5"/><circle cx="11" cy="5.5" r="1.5"/><path d="M5 5v6M11 7c0 2.6-6 1.8-6 4"/>',
  tag: '<path d="M2 2.5h5.5l6.5 6.5-5 5-6.5-6.5z"/><circle cx="5" cy="5.5" r="1"/>',
  star: '<path d="M8 1.8l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.3l-3.9 2.2.9-4.3-3.2-2.9 4.3-.5z" fill="currentColor"/>',
  'star-outline': '<path d="M8 1.8l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.3l-3.9 2.2.9-4.3-3.2-2.9 4.3-.5z"/>',
  'list-flat': '<path d="M5 4h9M5 8h9M5 12h9"/><circle cx="2.5" cy="4" r=".6" fill="currentColor"/><circle cx="2.5" cy="8" r=".6" fill="currentColor"/><circle cx="2.5" cy="12" r=".6" fill="currentColor"/>',
  add: '<path d="M8 2.5v11M2.5 8h11"/>',
  update: '<path d="M12.5 3.5 4 12M4 6.5V12h5.5"/><path d="M3 14.5h10"/>',
  trash: '<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/><path d="M6.5 6.5v5M9.5 6.5v5"/>',
  compare: '<path d="M2 5h9M8 2l3 3-3 3M14 11H5M8 8l-3 3 3 3"/>',
  'diff-tree': '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4 14 14M5 7h4M7 5v4"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  rollback: '<path d="M4 6.5h6.5a3 3 0 0 1 0 6H6"/><path d="M6.5 4 4 6.5 6.5 9"/>',
  changelist: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/>',
  module: '<path d="M2 4.5 8 2l6 2.5v7L8 14l-6-2.5z"/><path d="M2 4.5 8 7l6-2.5M8 7v7"/>',
  pop: '<path d="M8 13V5M4.5 8.5 8 5l3.5 3.5"/><path d="M3 2.5h10"/>',
  stash: '<path d="M2.5 5.5h11v8h-11z"/><path d="M4 3h8M5.5 8.5h5"/>',
  warning: '<path d="M8 1.8 15 14H1z"/><path d="M8 6v4M8 11.9v.1"/>',
  refresh: '<path d="M13.2 8.5A5.2 5.2 0 1 1 11.6 4.3"/><path d="M12.5 1.8v3h-3"/>',
  'expand-all': '<path d="M4 3l4 3 4-3M4 10l4 3 4-3"/>',
  'collapse-all': '<path d="M4 6l4-3 4 3M4 13l4-3 4 3"/>',
  locate: '<circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15"/>',
  eye: '<path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  file: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/>',
  diff: '<path d="M2 5h9M8 2l3 3-3 3M14 11H5M8 8l-3 3 3 3"/>',
  head: '<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  check: '<path d="M3 8.5l3 3 7-7"/>',
  repo: '<path d="M3 2.5h9.5v11H3z"/><path d="M5.5 2.5v11"/>',
  fetch: '<path d="M4.6 10.5H4a2.7 2.7 0 0 1-.3-5.4A4 4 0 0 1 11.4 4a3.3 3.3 0 0 1 .9 6.5h-.9"/><path d="M8 7.5v7M5.8 12.3 8 14.5l2.2-2.2"/>',
  pull: '<path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2.5 14h11"/>',
  push: '<path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M2.5 14h11"/>',
} as const;

export type IconName = keyof typeof ICONS;

// Windows 的對話框慣例是主要按鈕在左、取消在右（與 VS Code 相同）；macOS／Linux 為取消在左
if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) document.documentElement.classList.add('os-windows');

/** 目前平台的修飾鍵名稱（快捷鍵提示用） */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function icon(name: IconName, className = ''): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `icon ${className}`.trim();
  span.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

export function iconButton(name: IconName, title: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', { className: `icon-button ${className}`.trim(), title, attrs: { type: 'button', 'aria-label': title } }, icon(name));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export type MenuItem =
  | {
      label: string;
      checked?: boolean;
      disabled?: boolean;
      /** 名稱後方的淡色說明 */
      detail?: string;
      /** 左側星號（我的最愛）；點星號切換、選單不關閉 */
      star?: { on: boolean; toggle: () => boolean };
      /** 點選後不關閉選單；action 回傳 boolean 時更新勾選狀態 */
      keepOpen?: boolean;
      /** 子選單（滑鼠移過去或按 → 時展開） */
      submenu?: MenuItem[];
      /** 右側的快捷鍵提示（如 Ctrl+C） */
      keybinding?: string;
      action?: (e: MouseEvent) => void | boolean;
    }
  | '-';

/** 關閉所有彈出選單 */
export function closeMenus(): void {
  document.querySelectorAll('.context-menu').forEach((m) => m.remove());
}

let menuCleanup: (() => void) | undefined;
let keyboardOpen = false;

/** 以鍵盤（選單鍵、Shift+F10）開啟選單：第一個項目直接取得焦點 */
export function openMenuByKeyboard(open: () => void): void {
  keyboardOpen = true;
  try {
    open();
  } finally {
    keyboardOpen = false;
  }
}

/** 是否為開啟右鍵選單的按鍵（選單鍵或 Shift+F10） */
export function isContextMenuKey(e: KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
}

/** 鍵盤開啟某列的右鍵選單：在該列左下方送出 contextmenu 事件 */
export function openContextMenuFor(row: Element | null): void {
  if (!row) return;
  const r = row.getBoundingClientRect();
  openMenuByKeyboard(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.bottom })));
}

const levelMenu = (level: number) => document.querySelector<HTMLElement>(`.context-menu[data-level="${level}"]`);
const enabledItems = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>(':scope > .menu-item:not(.disabled)')];

/** 標記選單中目前的項目（滑鼠移入或方向鍵） */
function setActive(menu: HTMLElement, item: HTMLElement | undefined): void {
  menu.querySelectorAll('.menu-item.active').forEach((n) => n.classList.remove('active'));
  if (!item) return;
  item.classList.add('active');
  item.scrollIntoView({ block: 'nearest' });
}

/** 最深一層有作用中項目的選單 */
function currentLevel(): number {
  let level = 0;
  document.querySelectorAll<HTMLElement>('.context-menu').forEach((m) => {
    if (m.querySelector('.menu-item.active')) level = Math.max(level, Number(m.dataset.level));
  });
  return level;
}

/**
 * 彈出選單（右鍵選單、下拉選單共用）；支援子選單、星號與不關閉的勾選項。
 * 鍵盤：↑↓ Home End 移動、→ 開子選單、← 回上層、Enter／空白鍵執行、Esc 關閉；點外面關閉。
 */
export function showMenu(x: number, y: number, items: MenuItem[]): void {
  menuCleanup?.();
  closeMenus();
  const previousFocus = document.activeElement as HTMLElement | null;
  const root = openLevel(x, y, items, 0);
  if (!root) return;
  if (keyboardOpen) setActive(root, enabledItems(root)[0]);
  const press = (item: HTMLElement) => item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  const onMouse = (e: Event) => {
    if (!(e.target as Element | null)?.closest?.('.context-menu')) cleanup();
  };
  const onKey = (e: KeyboardEvent) => {
    const level = currentLevel();
    const menu = levelMenu(level);
    if (!menu) return;
    const list = enabledItems(menu);
    const active = menu.querySelector<HTMLElement>('.menu-item.active') ?? undefined;
    const idx = active ? list.indexOf(active) : -1;
    const openSub = (item: HTMLElement) => {
      press(item);
      const sub = levelMenu(level + 1);
      if (sub) setActive(sub, enabledItems(sub)[0]);
    };
    switch (e.key) {
      case 'ArrowDown':
        setActive(menu, list[(idx + 1) % list.length]);
        break;
      case 'ArrowUp':
        setActive(menu, list[idx <= 0 ? list.length - 1 : idx - 1]);
        break;
      case 'Home':
        setActive(menu, list[0]);
        break;
      case 'End':
        setActive(menu, list[list.length - 1]);
        break;
      case 'ArrowRight':
        if (active?.classList.contains('has-submenu')) openSub(active);
        break;
      case 'ArrowLeft':
        if (level > 0) {
          menu.remove();
          const parent = levelMenu(level - 1);
          const opener = parent?.querySelector<HTMLElement>('.menu-item.open');
          if (parent && opener) {
            opener.classList.remove('open');
            setActive(parent, opener);
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (!active) break;
        if (active.classList.contains('has-submenu')) openSub(active);
        else press(active);
        break;
      case 'Escape':
        if (level > 0) {
          menu.remove();
          const parent = levelMenu(level - 1);
          parent?.querySelector('.menu-item.open')?.classList.remove('open');
        } else {
          cleanup();
          previousFocus?.focus?.();
        }
        break;
      case 'Tab':
        cleanup();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  const cleanup = () => {
    closeMenus();
    document.removeEventListener('mousedown', onMouse, true);
    document.removeEventListener('keydown', onKey, true);
    menuCleanup = undefined;
  };
  menuCleanup = cleanup;
  // 按鍵立即接手（避免選單剛開時按鍵落到底下的清單）；滑鼠延後，以免開啟選單的那一下就把它關掉
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => {
    if (menuCleanup === cleanup) document.addEventListener('mousedown', onMouse, true);
  });
}

function openLevel(x: number, y: number, items: MenuItem[], level: number): HTMLElement | undefined {
  // 同層以下的子選單先關閉
  document.querySelectorAll<HTMLElement>('.context-menu').forEach((m) => {
    if (Number(m.dataset.level) >= level) m.remove();
  });
  const menu = el('div', { className: 'context-menu', attrs: { role: 'menu', 'data-level': String(level) } });
  for (const it of items) {
    if (it === '-') {
      menu.append(el('div', { className: 'menu-sep' }));
      continue;
    }
    const check = el('span', { className: 'menu-check' });
    const setCheck = (on: boolean | undefined) => {
      clear(check);
      if (on) check.append(icon('check'));
    };
    if (it.star) {
      const star = it.star;
      check.classList.add('menu-star');
      check.title = star.on ? t('Remove from Favorites') : t('Add to Favorites');
      const paint = () => {
        clear(check);
        check.append(icon(star.on ? 'star' : 'star-outline', star.on ? 'favorite' : ''));
      };
      paint();
      check.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        star.on = star.toggle();
        paint();
      });
    } else {
      setCheck(it.checked);
    }
    const row = el(
      'div',
      { className: `menu-item${it.disabled ? ' disabled' : ''}${it.submenu ? ' has-submenu' : ''}`, attrs: { role: 'menuitem' } },
      check,
      el('span', { className: 'menu-label', text: it.label }),
      it.detail ? el('span', { className: 'menu-detail', text: it.detail }) : null,
      it.keybinding ? el('span', { className: 'menu-key', text: it.keybinding }) : null,
      it.submenu ? icon('chevron-right', 'menu-arrow') : null,
    );
    if (it.submenu) {
      const sub = it.submenu;
      const open = () => {
        if (it.disabled) return;
        const r = row.getBoundingClientRect();
        openLevel(r.right - 2, r.top - 4, sub, level + 1);
        menu.querySelectorAll('.menu-item.open').forEach((n) => n.classList.remove('open'));
        row.classList.add('open');
      };
      row.addEventListener('mouseenter', () => {
        setActive(menu, it.disabled ? undefined : row);
        open();
      });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        open();
      });
    } else {
      row.addEventListener('mouseenter', () => {
        setActive(menu, it.disabled ? undefined : row);
        // 移到沒有子選單的項目時，收起更深層的子選單
        document.querySelectorAll<HTMLElement>('.context-menu').forEach((m) => {
          if (Number(m.dataset.level) > level) m.remove();
        });
        menu.querySelectorAll('.menu-item.open').forEach((n) => n.classList.remove('open'));
      });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (it.disabled) return;
        if (it.keepOpen) {
          const result = it.action?.(e);
          if (typeof result === 'boolean') setCheck(result);
          return;
        }
        menuCleanup?.();
        closeMenus();
        it.action?.(e);
      });
    }
    menu.append(row);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  // 子選單放不下右側時改到父選單左側
  let left = x;
  if (level > 0 && x + r.width > window.innerWidth - 4) {
    const parent = document.querySelector<HTMLElement>(`.context-menu[data-level="${level - 1}"]`);
    left = parent ? parent.getBoundingClientRect().left - r.width + 2 : window.innerWidth - r.width - 4;
  }
  menu.style.left = `${Math.max(4, Math.min(left, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  return menu;
}

/** 可拖曳分隔線：onDrag 收到相對按下時的位移 */
export function makeSplitter(orientation: 'vertical' | 'horizontal', onStart: () => void, onDrag: (delta: number) => void, onEnd: () => void): HTMLDivElement {
  const s = el('div', { className: `splitter splitter-${orientation}` });
  s.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    s.setPointerCapture(e.pointerId);
    const start = orientation === 'vertical' ? e.clientX : e.clientY;
    onStart();
    s.classList.add('active');
    const move = (ev: PointerEvent) => onDrag((orientation === 'vertical' ? ev.clientX : ev.clientY) - start);
    const up = () => {
      s.classList.remove('active');
      s.removeEventListener('pointermove', move);
      s.removeEventListener('pointerup', up);
      s.removeEventListener('pointercancel', up);
      onEnd();
    };
    s.addEventListener('pointermove', move);
    s.addEventListener('pointerup', up);
    s.addEventListener('pointercancel', up);
  });
  return s;
}

export function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { flush: () => void; cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  let last: A | undefined;
  const wrapped = (...args: A) => {
    last = args;
    clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
  wrapped.flush = () => {
    if (t !== undefined && last) {
      clearTimeout(t);
      t = undefined;
      fn(...last);
    }
  };
  wrapped.cancel = () => {
    clearTimeout(t);
    t = undefined;
  };
  return wrapped;
}
