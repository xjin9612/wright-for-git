// 面板內的確認框（取代 VS Code 的 modal 對話框，外觀與 Push 對話框一致）
import type { ToWebview } from '../shared/protocol';
import { el } from './dom';
import { post } from './vscodeApi';

type ConfirmMessage = Extract<ToWebview, { type: 'confirm' }>;

const queue: ConfirmMessage[] = [];
let showing = false;

const ICONS = {
  info: '<circle cx="8" cy="8" r="6.5"/><path d="M8 7v4.5M8 4.6v.1"/>',
  warning: '<path d="M8 1.8 15 14H1z"/><path d="M8 6v4M8 11.9v.1"/>',
  danger: '<path d="M8 1.8 15 14H1z"/><path d="M8 6v4M8 11.9v.1"/>',
};

export function showConfirm(m: ConfirmMessage): void {
  queue.push(m);
  if (!showing) next();
}

function next(): void {
  const m = queue.shift();
  if (!m) {
    showing = false;
    return;
  }
  showing = true;
  // 其他浮動選單先關閉
  document.querySelector('.context-menu')?.remove();

  const iconBox = el('span', { className: `confirm-icon ${m.kind}` });
  iconBox.innerHTML = `<svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[m.kind]}</svg>`;
  const ok = el('button', { className: `button ${m.kind === 'danger' ? 'danger' : 'primary'}`, text: m.ok, attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button secondary dialog-cancel', text: m.cancel, attrs: { type: 'button' } });
  const dialog = el(
    'div',
    { className: 'confirm-dialog', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': m.message } },
    el('div', { className: 'confirm-body' }, iconBox, el('div', { className: 'confirm-text' }, el('div', { className: 'confirm-message', text: m.message }), m.detail ? el('div', { className: 'confirm-detail', text: m.detail }) : null)),
    el('div', { className: 'confirm-actions' }, cancel, ok),
  );
  const overlay = el('div', { className: 'modal-overlay confirm-overlay' }, dialog);

  const finish = (result: boolean) => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    post({ type: 'confirmResult', id: m.id, ok: result });
    next();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    } else if (e.key === 'Tab') {
      // 焦點只在兩個按鈕之間切換
      e.preventDefault();
      (document.activeElement === ok ? cancel : ok).focus();
    }
  };
  ok.addEventListener('click', () => finish(true));
  cancel.addEventListener('click', () => finish(false));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  // 破壞性操作預設停在「取消」，避免直接按 Enter 誤觸
  (m.kind === 'danger' ? cancel : ok).focus();
}
