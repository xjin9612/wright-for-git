// 衝突清單分頁（對應 IntelliJ 的 Conflicts 對話框）：各 repo 的衝突檔案，整個採用我的／他們的，或開三方合併
import { isContentConflict, type ConflictFile, type ConflictType, type ToWebview } from '../shared/protocol';
import { clear, el, icon } from './dom';
import { fileIcon } from './fileIcons';
import { plural, t } from './l10n';
import { post } from './vscodeApi';

type Data = Extract<ToWebview, { type: 'conflictsData' }>['repos'];

let data: Data = [];
let loaded = false;
/** 選取的檔案：root\0path */
const selected = new Set<string>();
let anchor: string | undefined;
/** 鍵盤焦點所在的檔案（Shift+方向鍵從 anchor 延伸到這裡） */
let caret: string | undefined;
let preferRoot: string | undefined;

const keyOf = (root: string, p: string) => `${root}\0${p}`;
const list = el('div', { className: 'conflicts-list', attrs: { tabindex: '0', role: 'listbox', 'aria-multiselectable': 'true' } });
const status = el('span', { className: 'muted' });
const yours = el('button', { className: 'button secondary', text: t('Accept Yours'), attrs: { type: 'button' } });
const theirs = el('button', { className: 'button secondary', text: t('Accept Theirs'), attrs: { type: 'button' } });
const merge = el('button', { className: 'button primary', text: t('Merge…'), attrs: { type: 'button' } });
const close = el('button', { className: 'button secondary dialog-cancel', text: t('Close'), attrs: { type: 'button' } });

/** 我的／他們的這一邊是什麼狀態 */
function sideText(c: ConflictType, side: 'ours' | 'theirs'): string {
  const map: Record<ConflictType, [string, string]> = {
    'both-modified': [t('Modified'), t('Modified')],
    'both-added': [t('Added'), t('Added')],
    'deleted-by-us': [t('Deleted'), t('Modified')],
    'deleted-by-them': [t('Modified'), t('Deleted')],
    'added-by-us': [t('Added'), '—'],
    'added-by-them': ['—', t('Added')],
    'both-deleted': [t('Deleted'), t('Deleted')],
  };
  return map[c][side === 'ours' ? 0 : 1];
}

function allFiles(): { root: string; file: ConflictFile }[] {
  return data.flatMap((r) => r.files.map((file) => ({ root: r.root, file })));
}

function selectedFiles(): { root: string; file: ConflictFile }[] {
  return allFiles().filter((f) => selected.has(keyOf(f.root, f.file.path)));
}

function syncButtons(): void {
  const sel = selectedFiles();
  yours.disabled = sel.length === 0;
  theirs.disabled = sel.length === 0;
  merge.disabled = sel.length !== 1 || !isContentConflict(sel[0].file.conflict);
  const total = allFiles().length;
  status.textContent = !loaded ? t('Loading…') : total === 0 ? t('All conflicts are resolved.') : plural(total, '{0} conflict', '{0} conflicts');
}

function render(): void {
  clear(list);
  const multi = data.length > 1;
  for (const r of data) {
    if (multi || r.operation) {
      const head = el('div', { className: 'conflicts-repo' }, icon('repo'), el('span', { className: 'push-repo-name', text: r.name }));
      if (r.operation) {
        const names: Record<string, string> = { rebase: t('Rebase'), merge: t('Merge'), 'cherry-pick': t('Cherry-Pick'), revert: t('Revert') };
        head.append(el('span', { className: 'muted', text: t('{0} in progress', names[r.operation]) }));
        if (r.files.length === 0) {
          // 這個 repo 的衝突都解決了：直接繼續
          const go = el('button', { className: 'button primary conflicts-continue', text: t('Continue {0}', names[r.operation]), attrs: { type: 'button' } });
          go.addEventListener('click', () => post({ type: 'operation', root: r.root, action: 'continue', expected: r.operation }));
          head.append(el('span', { className: 'toolbar-spacer' }), go);
        }
      }
      list.append(head);
    }
    for (const f of r.files) {
      const k = keyOf(r.root, f.path);
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      const row = el(
        'div',
        { className: `conflicts-row${selected.has(k) ? ' selected' : ''}`, attrs: { role: 'option', 'aria-selected': String(selected.has(k)), 'data-key': k } },
        el('span', { className: 'conflicts-name' }, fileIcon(f.path), el('span', { text: name }), dir ? el('span', { className: 'muted', text: dir }) : null),
        el('span', { className: 'conflicts-side', text: sideText(f.conflict, 'ours') }),
        el('span', { className: 'conflicts-side', text: sideText(f.conflict, 'theirs') }),
      );
      row.addEventListener('click', (e) => select(k, e.ctrlKey || e.metaKey, e.shiftKey));
      row.addEventListener('dblclick', () => {
        select(k, false, false);
        if (isContentConflict(f.conflict)) post({ type: 'openMerge', root: r.root, path: f.path });
      });
      list.append(row);
    }
  }
  if (loaded && allFiles().length === 0 && !data.some((r) => r.operation)) list.append(el('div', { className: 'empty-text', text: t('All conflicts are resolved.') }));
  syncButtons();
}

function select(k: string, add: boolean, range: boolean): void {
  const keys = allFiles().map((f) => keyOf(f.root, f.file.path));
  if (range && anchor && keys.includes(anchor)) {
    const a = keys.indexOf(anchor);
    const b = keys.indexOf(k);
    if (!add) selected.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selected.add(keys[i]);
  } else if (add) {
    if (selected.has(k)) selected.delete(k);
    else selected.add(k);
    anchor = k;
  } else {
    selected.clear();
    selected.add(k);
    anchor = k;
  }
  caret = k;
  render();
  list.focus();
}

function act(action: 'ours' | 'theirs'): void {
  const items = selectedFiles().map((f) => ({ root: f.root, path: f.file.path }));
  if (items.length > 0) post({ type: 'conflictAction', items, action });
}

export function openConflictsDialog(args: { root?: string }): void {
  preferRoot = args.root;
  yours.addEventListener('click', () => act('ours'));
  theirs.addEventListener('click', () => act('theirs'));
  merge.addEventListener('click', () => {
    const f = selectedFiles()[0];
    if (f && isContentConflict(f.file.conflict)) post({ type: 'openMerge', root: f.root, path: f.file.path });
  });
  close.addEventListener('click', () => post({ type: 'closeDialog' }));
  list.addEventListener('keydown', (e) => {
    const keys = allFiles().map((f) => keyOf(f.root, f.file.path));
    const from = caret ?? anchor;
    const i = from ? keys.indexOf(from) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = keys[Math.max(0, Math.min(keys.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) select(next, false, e.shiftKey);
    } else if (e.key === 'Enter') {
      merge.click();
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      for (const k of keys) selected.add(k);
      render();
    } else {
      return;
    }
    e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.confirm-dialog')) post({ type: 'closeDialog' });
  });
  const dialog = el(
    'div',
    { className: 'push-dialog', attrs: { role: 'dialog', 'aria-label': t('Conflicts') } },
    el('div', { className: 'push-header' }, t('Conflicts')),
    el(
      'div',
      { className: 'conflicts-body' },
      el(
        'div',
        { className: 'conflicts-table' },
        el('div', { className: 'conflicts-head' }, el('span', { text: t('Name') }), el('span', { text: t('Yours') }), el('span', { text: t('Theirs') })),
        list,
      ),
      el('div', { className: 'conflicts-actions' }, yours, theirs, merge),
    ),
    el('div', { className: 'push-footer' }, status, el('div', { className: 'toolbar-spacer' }), close),
  );
  document.body.append(el('div', { className: 'modal-overlay embedded' }, dialog));
  syncButtons();
  post({ type: 'conflictsLoad' });
}

export function handleConflictsMessage(m: Extract<ToWebview, { type: 'conflictsData' }>): void {
  const first = !loaded;
  data = m.repos;
  loaded = true;
  const keys = new Set(allFiles().map((f) => keyOf(f.root, f.file.path)));
  for (const k of [...selected]) if (!keys.has(k)) selected.delete(k);
  // 第一次載入、或選取的檔案都解決了：選第一個（優先開啟時指定的 repo）
  if (selected.size === 0) {
    const files = allFiles();
    const pick = (first && preferRoot ? files.find((f) => f.root === preferRoot) : undefined) ?? files[0];
    if (pick) {
      selected.add(keyOf(pick.root, pick.file.path));
      anchor = keyOf(pick.root, pick.file.path);
      caret = anchor;
    }
  }
  render();
  if (first) list.focus();
}
