// 互動式 rebase 對話框（對應 IntelliJ 的 Interactively Rebase from Here）
import type { RebaseAction, RebaseCommit } from '../shared/protocol';
import { clear, el, formatDate, icon } from './dom';
import { t } from './l10n';
import { post } from './vscodeApi';

interface Item {
  commit: RebaseCommit;
  action: RebaseAction;
  message: string;
}

const ACTIONS: { action: RebaseAction; key: string }[] = [
  { action: 'pick', key: 'p' },
  { action: 'edit', key: 'e' },
  { action: 'reword', key: 'r' },
  { action: 'squash', key: 's' },
  { action: 'fixup', key: 'f' },
  { action: 'drop', key: 'd' },
];

const LABEL: Record<RebaseAction, () => string> = {
  pick: () => t('Pick'),
  edit: () => t('Stop to Edit'),
  reword: () => t('Reword'),
  squash: () => t('Squash'),
  fixup: () => t('Fixup'),
  drop: () => t('Drop'),
};

export function openRebaseDialog(args: { root: string; base: string; branch?: string; commits: RebaseCommit[] }): void {
  // 顯示順序與記錄相同：新的在上面
  const initial = (): Item[] => [...args.commits].reverse().map((commit) => ({ commit, action: 'pick', message: commit.message }));
  let items = initial();
  let current = 0;
  let editing: number | undefined;

  const list = el('div', { className: 'rebase-list', attrs: { tabindex: '0', role: 'listbox' } });
  const msgBox = el('textarea', { className: 'commit-message rebase-message', attrs: { spellcheck: 'true', 'aria-label': t('Commit Message') } });
  const msgPane = el('div', { className: 'rebase-message-pane hidden' }, el('div', { className: 'muted', text: t('New commit message') }), msgBox);
  const warn = el('div', { className: 'push-warning rebase-warning' });
  const start = el('button', { className: 'button primary', text: t('Start Rebasing'), attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button secondary dialog-cancel', text: t('Cancel'), attrs: { type: 'button' } });
  const reset = el('button', { className: 'button secondary', text: t('Reset'), attrs: { type: 'button' } });
  const actionButtons = ACTIONS.map(({ action, key }) => {
    const b = el('button', { className: 'button secondary rebase-action', text: LABEL[action](), title: `${LABEL[action]()} (${key.toUpperCase()})`, attrs: { type: 'button' } });
    b.addEventListener('click', () => setAction(current, action));
    return b;
  });
  const up = el('button', { className: 'button secondary', text: '↑', title: t('Move Up (Alt+↑)'), attrs: { type: 'button' } });
  const down = el('button', { className: 'button secondary', text: '↓', title: t('Move Down (Alt+↓)'), attrs: { type: 'button' } });
  up.addEventListener('click', () => move(-1));
  down.addEventListener('click', () => move(1));

  const setAction = (i: number, action: RebaseAction) => {
    const it = items[i];
    if (!it) return;
    it.action = action;
    editing = action === 'reword' ? i : undefined;
    render();
    if (action === 'reword') msgBox.focus();
  };
  const move = (delta: number) => {
    const j = current + delta;
    if (j < 0 || j >= items.length) return;
    [items[current], items[j]] = [items[j], items[current]];
    current = j;
    render();
  };

  msgBox.addEventListener('input', () => {
    if (editing !== undefined) items[editing].message = msgBox.value;
  });

  const validate = (): string | undefined => {
    // 最舊的一筆（畫面最下面、且不是 drop 的第一筆）不能 squash／fixup
    const kept = [...items].reverse().filter((x) => x.action !== 'drop');
    if (kept.length > 0 && (kept[0].action === 'squash' || kept[0].action === 'fixup')) return t('The oldest commit cannot be squashed or fixed up: there is no earlier commit to combine with.');
    if (items.some((x) => x.action === 'reword' && !x.message.trim())) return t('A reworded commit needs a message.');
    return undefined;
  };

  const render = () => {
    clear(list);
    items.forEach((it, i) => {
      const select = el('select', { className: 'push-remote rebase-select', attrs: { 'aria-label': t('Action') } });
      for (const { action } of ACTIONS) select.append(el('option', { text: LABEL[action](), attrs: { value: action } }));
      select.value = it.action;
      select.addEventListener('change', () => setAction(i, select.value as RebaseAction));
      const subject = it.action === 'reword' ? it.message.split('\n')[0] : it.commit.subject;
      const row = el(
        'div',
        { className: `rebase-row action-${it.action}${i === current ? ' selected' : ''}`, attrs: { role: 'option', draggable: 'true' } },
        el('span', { className: 'rebase-grip', text: '⋮⋮' }),
        select,
        el('span', { className: 'hash', text: it.commit.hash.slice(0, 8) }),
        el('span', { className: 'push-commit-subject', text: subject }),
        el('span', { className: 'muted push-commit-meta', text: `${it.commit.author} · ${formatDate(it.commit.authorTime)}` }),
      );
      row.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).tagName === 'SELECT') return;
        current = i;
        editing = it.action === 'reword' ? i : undefined;
        render();
        list.focus();
      });
      // 拖曳調整順序
      row.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', String(i)));
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData('text/plain'));
        if (!Number.isFinite(from) || from === i) return;
        const [moved] = items.splice(from, 1);
        items.splice(i, 0, moved);
        current = i;
        render();
      });
      list.append(row);
    });
    const it = editing !== undefined ? items[editing] : undefined;
    msgPane.classList.toggle('hidden', !it);
    if (it && msgBox.value !== it.message) msgBox.value = it.message;
    const problem = validate();
    clear(warn);
    if (problem) warn.append(icon('warning'), el('span', { text: problem }));
    warn.classList.toggle('hidden', !problem);
    start.disabled = !!problem;
    up.disabled = current <= 0;
    down.disabled = current >= items.length - 1;
  };

  list.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      current = Math.max(0, Math.min(items.length - 1, current + (e.key === 'ArrowUp' ? -1 : 1)));
      editing = items[current].action === 'reword' ? current : undefined;
      render();
    } else {
      const hit = ACTIONS.find((a) => a.key === e.key.toLowerCase());
      if (hit && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setAction(current, hit.action);
      }
    }
  });
  reset.addEventListener('click', () => {
    items = initial();
    current = 0;
    editing = undefined;
    render();
  });
  cancel.addEventListener('click', () => post({ type: 'closeDialog' }));
  start.addEventListener('click', () => {
    if (validate()) return;
    start.disabled = true;
    start.textContent = t('Rebasing…');
    // 送出時改回由舊到新（git todo 的順序）
    const entries = [...items].reverse().map((x) => ({ hash: x.commit.hash, action: x.action, message: x.action === 'reword' ? x.message : undefined }));
    post({ type: 'rebaseStart', root: args.root, base: args.base, entries });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement !== msgBox) post({ type: 'closeDialog' });
  });

  const dialog = el(
    'div',
    { className: 'push-dialog', attrs: { role: 'dialog', 'aria-label': t('Interactive Rebase') } },
    el('div', { className: 'push-header' }, t('Rebasing {0} commits of {1}', items.length, args.branch ?? 'HEAD')),
    el('div', { className: 'rebase-toolbar' }, ...actionButtons, el('div', { className: 'toolbar-spacer' }), up, down),
    list,
    msgPane,
    warn,
    el('div', { className: 'push-footer' }, el('span', { className: 'muted', text: t('Uncommitted changes are stashed and restored automatically (--autostash).') }), el('div', { className: 'toolbar-spacer' }), reset, cancel, start),
  );
  document.body.append(el('div', { className: 'modal-overlay embedded' }, dialog));
  render();
  list.focus();
}
