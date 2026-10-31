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
