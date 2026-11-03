// 取回擱置的對話框（對應 IntelliJ 的 Unshelve Changes）：勾選要取回的 repo 與檔案、放進哪個 changelist、取回後是否從擱置移除
import type { ChangedFile } from '../shared/protocol';
import { el, icon } from './dom';
import { fileIcon, statusLetter } from './fileIcons';
import { plural, t } from './l10n';

export type ShelfFile = ChangedFile & { untracked?: boolean; exists?: boolean };

export interface UnshelveDialogInput {
  name: string;
  repos: { root: string; name: string; files: ShelfFile[] }[];
  /** 預先勾選的檔案（`${root}\0${path}`）；沒給時全部勾選。工作區已存在的未追蹤檔案預設不勾（勾選即覆蓋） */
  preselect?: ReadonlySet<string>;
  /** 既有 changelist 的名稱（輸入框的建議） */
  changelists: string[];
  /** 依序取回多筆時目前是第幾筆（標題顯示 1/3） */
  step?: { index: number; total: number };
}

export interface UnshelveDialogResult {
  /** 各 repo 要取回的路徑（rename 含新舊路徑） */
  paths: { root: string; paths: string[] }[];
  remove: boolean;
  overwrite: boolean;
  changelist: string;
}

const keyOf = (root: string, p: string) => `${root}\0${p}`;

export function openUnshelveDialog(input: UnshelveDialogInput, onDone: (result: UnshelveDialogResult) => void, onCancel?: () => void): void {
  document.querySelector('.unshelve-overlay')?.remove();
  const checked = new Set<string>();
  for (const r of input.repos) {
    for (const f of r.files) {
      const k = keyOf(r.root, f.path);
      if (input.preselect ? input.preselect.has(k) : !f.exists) checked.add(k);
    }
  }

  const list = el('div', { className: 'paths-tree unshelve-tree', attrs: { role: 'tree', 'aria-label': t('Files to unshelve') } });
  const summary = el('div', { className: 'muted unshelve-summary' });
  const listInput = el('input', { className: 'text-input unshelve-changelist', attrs: { type: 'text', spellcheck: 'false', list: 'unshelve-changelists', 'aria-label': t('Changelist') } });
  listInput.value = input.name;
  const datalist = el('datalist', { attrs: { id: 'unshelve-changelists' } }, ...input.changelists.map((n) => el('option', { attrs: { value: n } })));
  const removeBox = el('input', { attrs: { type: 'checkbox', id: 'unshelve-remove' } });
  removeBox.checked = true;
  const ok = el('button', { className: 'button primary', text: t('Unshelve'), attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button secondary dialog-cancel', text: t('Cancel'), attrs: { type: 'button' } });

  const box = (on: boolean, partial = false) => {
    const b = el('input', { attrs: { type: 'checkbox' } });
    b.checked = on;
    b.indeterminate = partial;
    return b;
  };

  function render(): void {
    const scroll = list.scrollTop;
    list.replaceChildren();
    for (const r of input.repos) {
      const keys = r.files.map((f) => keyOf(r.root, f.path));
      const n = keys.filter((k) => checked.has(k)).length;
      const repoBox = box(n === keys.length && n > 0, n > 0 && n < keys.length);
      repoBox.setAttribute('aria-label', r.name);
      repoBox.addEventListener('change', () => {
        for (const k of keys) {
          if (repoBox.checked) checked.add(k);
          else checked.delete(k);
        }
        render();
      });
      list.append(el('label', { className: 'tree-row unshelve-repo' }, repoBox, icon('repo'), el('span', { className: 'tree-label', text: r.name }), el('span', { className: 'tree-count', text: plural(keys.length, '{0} file', '{0} files') })));
      for (const f of r.files) {
        const k = keyOf(r.root, f.path);
        const b = box(checked.has(k));
        b.setAttribute('aria-label', f.path);
        b.addEventListener('change', () => {
          if (b.checked) checked.add(k);
          else checked.delete(k);
          render();
        });
        const row = el(
          'label',
          { className: 'tree-row unshelve-file', title: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path },
          b,
          fileIcon(f.path),
          el('span', { className: 'tree-label', text: f.path }),
          f.exists ? el('span', { className: 'tree-count unshelve-exists', text: t('already exists; check to overwrite') }) : null,
          statusLetter(f.untracked ? 'untracked' : f.status),
        );
        row.style.paddingLeft = '26px';
        list.append(row);
      }
    }
    list.scrollTop = scroll;
    const count = checked.size;
    summary.textContent = count > 0 ? plural(count, '{0} file selected', '{0} files selected') : t('No files selected');
    ok.disabled = count === 0;
  }

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const cancelDialog = () => {
    close();
    onCancel?.();
  };
  const finish = () => {
    if (checked.size === 0) return;
    const paths: { root: string; paths: string[] }[] = [];
    let overwrite = false;
    for (const r of input.repos) {
      const files = r.files.filter((f) => checked.has(keyOf(r.root, f.path)));
      if (files.length === 0) continue;
      if (files.some((f) => f.exists)) overwrite = true;
      paths.push({ root: r.root, paths: [...new Set(files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))] });
    }
    close();
    onDone({ paths, remove: removeBox.checked, overwrite, changelist: listInput.value.trim() });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelDialog();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish();
    }
  };
  ok.addEventListener('click', finish);
  cancel.addEventListener('click', cancelDialog);

  const dialog = el(
    'div',
    { className: 'push-dialog paths-dialog unshelve-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Unshelve Changes') } },
    el('div', { className: 'push-header', text: input.step ? `${t('Unshelve "{0}"', input.name)} (${input.step.index}/${input.step.total})` : t('Unshelve "{0}"', input.name) }),
    list,
    el(
      'div',
      { className: 'unshelve-options' },
      el('label', { className: 'unshelve-option' }, el('span', { text: t('Changelist') }), listInput, datalist),
      el('label', { className: 'unshelve-option settings-check', attrs: { for: 'unshelve-remove' } }, removeBox, t('Remove unshelved files from the Shelf')),
    ),
    el('div', { className: 'push-footer' }, summary, el('div', { className: 'toolbar-spacer' }), cancel, ok),
  );
  const overlay = el('div', { className: 'modal-overlay unshelve-overlay' }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  render();
  ok.focus();
}
