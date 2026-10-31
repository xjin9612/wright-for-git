// DOM 小工具與 SVG 圖示（不使用前端框架）

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
      /** 子選單（滑鼠移過去時展開） */
      submenu?: MenuItem[];
      action?: (e: MouseEvent) => void | boolean;
    }
  | '-';

/** 關閉所有彈出選單 */
export function closeMenus(): void {
  document.querySelectorAll('.context-menu').forEach((m) => m.remove());
}

let menuCleanup: (() => void) | undefined;

/** 彈出選單（右鍵選單、下拉選單共用）；支援子選單、星號與不關閉的勾選項；點外面或 Esc 關閉 */
export function showMenu(x: number, y: number, items: MenuItem[]): void {
  menuCleanup?.();
  closeMenus();
  const root = openLevel(x, y, items, 0);
  if (!root) return;
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent) {
      if (e.key !== 'Escape') return;
    } else if ((e.target as Element | null)?.closest?.('.context-menu')) {
      return;
    }
    cleanup();
  };
  const cleanup = () => {
    closeMenus();
    document.removeEventListener('mousedown', close, true);
    document.removeEventListener('keydown', close, true);
    menuCleanup = undefined;
  };
  menuCleanup = cleanup;
  setTimeout(() => {
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', close, true);
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
      check.title = star.on ? 'Remove from favorites' : 'Add to favorites';
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
      row.addEventListener('mouseenter', open);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        open();
      });
    } else {
      row.addEventListener('mouseenter', () => {
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
