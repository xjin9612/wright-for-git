// 多值選擇彈出框（Branch／User 篩選）：
// 上方輸入框可直接輸入多個值（以 | 或換行分隔，Ctrl+Enter 完成），下方清單點選切換。
import { el, icon, type IconName } from './dom';
import { t } from './l10n';

export interface PickerOption {
  value: string;
  /** 次要說明（如 email） */
  detail?: string;
  /** 前置圖示（如 repo、資料夾） */
  icon?: IconName;
  /** 顯示文字（預設同 value） */
  label?: string;
  /** 縮排層級 */
  indent?: number;
}

export interface PickerConfig {
  anchor: HTMLElement;
  values: string[];
  /** 依目前已輸入／勾選的值產生候選清單 */
  options: (current: string[]) => PickerOption[];
  onApply: (values: string[]) => void;
}

let current: { close: () => void } | undefined;

function parseValues(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[|\n]/)) {
    const v = raw.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function closePicker(): void {
  current?.close();
}

export function openPicker(cfg: PickerConfig): { refresh: () => void } {
  closePicker();

  const input = el('textarea', {
    className: 'picker-input',
    attrs: { rows: '1', spellcheck: 'false', 'aria-label': t('Values') },
  });
  input.value = cfg.values.length > 0 ? `${cfg.values.join('|')}|` : '';
  const hint = el('div', { className: 'picker-hint', text: t('Select one or more values separated with | or new lines, Enter to pick, Ctrl+Enter to finish') });
  const list = el('div', { className: 'picker-list', attrs: { role: 'listbox' } });
  const popup = el('div', { className: 'picker' }, input, hint, list);
  let active = -1;
  let autoActive = false;

  const lastToken = () => {
    const parts = input.value.split(/[|\n]/);
    return (parts[parts.length - 1] ?? '').trim().toLowerCase();
  };

  const toggle = (value: string) => {
    const raw = input.value;
    const values = parseValues(raw);
    // 最後一段沒有以分隔符結尾 → 視為正在輸入的關鍵字，選取時以候選值取代它（補完）
    const typing = !/[|\n]\s*$/.test(raw) && values.length > 0 ? values.pop() : undefined;
    if (typing !== undefined) {
      if (!values.includes(value)) values.push(value);
    } else {
      const idx = values.indexOf(value);
      if (idx !== -1) values.splice(idx, 1);
      else values.push(value);
    }
    input.value = values.join('|') + (values.length > 0 ? '|' : '');
    input.focus();
    render();
  };

  const render = () => {
    const selected = new Set(parseValues(input.value));
    const q = lastToken();
    const matches = (o: PickerOption) => o.value.toLowerCase().includes(q) || !!o.detail?.toLowerCase().includes(q);
    const options = cfg.options([...selected]).filter((o) => !q || selected.has(o.value) || matches(o));
    // 剛輸入關鍵字時，預設選中第一個「符合關鍵字」的候選（略過只因已勾選而列出的項目）
    if (autoActive) {
      active = q ? options.findIndex((o) => o.value.toLowerCase().includes(q)) : -1;
      autoActive = false;
    }
    list.replaceChildren(
      ...options.slice(0, 300).map((o, i) => {
        const row = el(
          'div',
          { className: `picker-item${i === active ? ' active' : ''}${selected.has(o.value) ? ' selected' : ''}`, attrs: { role: 'option' } },
          el('span', { className: 'picker-check' }, selected.has(o.value) ? icon('check') : null),
          o.icon ? icon(o.icon, 'picker-icon') : null,
          el('span', { className: 'picker-value', text: o.label ?? o.value }),
          o.detail ? el('span', { className: 'picker-detail', text: o.detail }) : null,
        );
        if (o.indent) row.style.paddingLeft = `${6 + o.indent * 16}px`;
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          toggle(o.value);
        });
        return row;
      }),
    );
    if (options.length === 0) list.append(el('div', { className: 'picker-empty', text: t('No matches') }));
  };

  const apply = () => {
    cfg.onApply(parseValues(input.value));
    close();
  };

  const onKey = (e: KeyboardEvent) => {
    const items = list.querySelectorAll<HTMLElement>('.picker-item');
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      apply();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
      list.querySelectorAll<HTMLElement>('.picker-item')[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0 && items[active]) {
      e.preventDefault();
      items[active].dispatchEvent(new MouseEvent('mousedown'));
    }
  };

  input.addEventListener('input', () => {
    // 有輸入關鍵字時預設選中第一個候選，Enter 即可補完
    autoActive = true;
    input.rows = Math.min(5, input.value.split('\n').length);
    render();
  });
  input.addEventListener('keydown', onKey);

  const onOutside = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node) && !cfg.anchor.contains(e.target as Node)) apply();
  };

  // 點到 webview 外（編輯器、其他 view）時收不到 mousedown：焦點離開 webview 視同點在外面（套用輸入的值）
  const onBlur = () => apply();

  const close = () => {
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('blur', onBlur);
    popup.remove();
    cfg.anchor.classList.remove('open');
    current = undefined;
  };

  document.body.append(popup);
  const r = cfg.anchor.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 16);
  popup.style.width = `${width}px`;
  popup.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
  popup.style.top = `${r.bottom + 2}px`;
  popup.style.maxHeight = `${Math.max(120, window.innerHeight - r.bottom - 10)}px`;
  cfg.anchor.classList.add('open');
  document.addEventListener('mousedown', onOutside, true);
  window.addEventListener('blur', onBlur);
  render();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  current = { close };
  return { refresh: render };
}
