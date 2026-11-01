// 逐段選取要提交的變更（對應 IntelliJ diff 中的勾選框）：每一段 hunk 一個勾選框
import type { DiffHunk } from '../shared/protocol';
import { el } from './dom';
import { plural, t } from './l10n';
import { post } from './vscodeApi';

export function openHunksDialog(args: { root: string; path: string; hunks: DiffHunk[]; selected: number[] }): void {
  const chosen = new Set(args.selected);
  const list = el('div', { className: 'hunks-list' });
  const summary = el('span', { className: 'muted' });
  const apply = el('button', { className: 'button primary', text: t('Apply'), attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button secondary dialog-cancel', text: t('Cancel'), attrs: { type: 'button' } });
  const all = el('button', { className: 'button secondary', text: t('Select All'), attrs: { type: 'button' } });
  const none = el('button', { className: 'button secondary', text: t('Select None'), attrs: { type: 'button' } });
  const boxes: HTMLInputElement[] = [];

  const sync = () => {
    summary.textContent = t('{0} of {1} changes will be committed', chosen.size, args.hunks.length);
    apply.disabled = chosen.size === 0;
    args.hunks.forEach((h, i) => {
      boxes[i].checked = chosen.has(h.index);
      boxes[i].closest('.hunk')?.classList.toggle('excluded', !chosen.has(h.index));
    });
  };

  for (const h of args.hunks) {
    const box = el('input', { attrs: { type: 'checkbox', 'aria-label': h.header } });
    box.addEventListener('change', () => {
      if (box.checked) chosen.add(h.index);
      else chosen.delete(h.index);
      sync();
    });
    boxes.push(box);
    const body = el('pre', { className: 'hunk-body' });
    for (const line of h.lines) {
      const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('\\') ? 'meta' : 'ctx';
      body.append(el('div', { className: `hunk-line ${cls}`, text: line || ' ' }));
    }
    const added = h.lines.filter((l) => l.startsWith('+')).length;
    const removed = h.lines.filter((l) => l.startsWith('-')).length;
    const head = el(
      'label',
      { className: 'hunk-head' },
      box,
      el('span', { className: 'hunk-range', text: h.header.replace(/^(@@[^@]*@@).*$/, '$1') }),
      el('span', { className: 'hunk-ctx muted', text: h.header.replace(/^@@[^@]*@@\s?/, '') }),
      el('span', { className: 'toolbar-spacer' }),
      el('span', { className: 'hunk-stat add', text: `+${added}` }),
      el('span', { className: 'hunk-stat del', text: `−${removed}` }),
    );
    list.append(el('div', { className: 'hunk' }, head, body));
  }

  all.addEventListener('click', () => {
    for (const h of args.hunks) chosen.add(h.index);
    sync();
  });
  none.addEventListener('click', () => {
    chosen.clear();
    sync();
  });
  apply.addEventListener('click', () => {
    post({ type: 'hunksSelect', root: args.root, path: args.path, selected: [...chosen] });
    post({ type: 'closeDialog' });
  });
  cancel.addEventListener('click', () => post({ type: 'closeDialog' }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') post({ type: 'closeDialog' });
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply.click();
  });

  const dialog = el(
    'div',
    { className: 'push-dialog', attrs: { role: 'dialog', 'aria-label': t('Select Changes to Commit') } },
    el('div', { className: 'push-header' }, `${t('Select Changes to Commit')}: ${args.path}`, el('span', { className: 'muted hunk-total', text: ` · ${plural(args.hunks.length, '{0} change', '{0} changes')}` })),
    list,
    el('div', { className: 'push-footer' }, all, none, summary, el('div', { className: 'toolbar-spacer' }), cancel, apply),
  );
  document.body.append(el('div', { className: 'modal-overlay embedded' }, dialog));
  sync();
}
