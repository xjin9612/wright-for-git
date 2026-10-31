// Paths → Select…：跨 repo 勾選要篩選的資料夾（對應 IntelliJ 的 Select Folders 對話框）
import type { RepoState } from '../shared/protocol';
import { clear, el, icon } from './dom';
import { t } from './l10n';

export interface PathsSelection {
  /** 勾選的 repo（整個 repo 或其中的資料夾） */
  roots: string[];
  /** 各 repo 勾選的資料夾；整個 repo 被勾選時不列入 */
  pathsByRoot: Record<string, string[]>;
}

export interface PathsDialogOptions {
  repos: RepoState[];
  /** 目前的選取 */
  initial: PathsSelection;
  /** 取得 repo 的資料夾清單；尚未載入時回傳 undefined 並自行請求 */
  dirsOf: (root: string) => string[] | undefined;
  onApply: (sel: PathsSelection) => void;
}

let current: { refresh: () => void } | undefined;

interface DirNode {
  name: string;
  path: string;
  children: DirNode[];
}

/** 資料夾清單 → 樹（資料夾本身既可勾選也可展開） */
function dirTree(paths: string[]): DirNode[] {
  const top: DirNode[] = [];
  const map = new Map<string, DirNode>();
  for (const p of [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    let list = top;
    let acc = '';
    for (const part of p.split('/')) {
      acc = acc ? `${acc}/${part}` : part;
      let node = map.get(acc);
      if (!node) {
        node = { name: part, path: acc, children: [] };
        map.set(acc, node);
        list.push(node);
      }
      list = node.children;
    }
  }
  return top;
}

/** extension 回傳資料夾清單後呼叫，重新繪製 */
export function refreshPathsDialog(): void {
  current?.refresh();
}

export function openPathsDialog(opts: PathsDialogOptions): void {
  document.querySelector('.paths-overlay')?.remove();
  /** 勾選：key 為 `${root}\0${path}`，path 空字串表示整個 repo */
  const checked = new Set<string>();
  for (const root of opts.initial.roots) {
    const paths = opts.initial.pathsByRoot[root];
    if (paths && paths.length > 0) for (const p of paths) checked.add(`${root}\0${p}`);
    else checked.add(`${root}\0`);
  }
  const expanded = new Set<string>(opts.initial.roots.map((r) => `${r}\0`));
  const filterInput = el('input', { className: 'text-input', attrs: { type: 'text', placeholder: t('Filter folders'), spellcheck: 'false' } });
  const list = el('div', { className: 'tree paths-tree', attrs: { tabindex: '0' } });
  const ok = el('button', { className: 'button primary', text: t('OK'), attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button secondary', text: t('Cancel'), attrs: { type: 'button' } });
  const clearBtn = el('button', { className: 'button secondary', text: t('Clear'), attrs: { type: 'button' } });

  /** 祖先（含 repo 本身）是否已勾選：子資料夾顯示為已勾選且不可單獨取消 */
  const coveredBy = (root: string, path: string): boolean => {
    if (checked.has(`${root}\0`)) return true;
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) if (checked.has(`${root}\0${parts.slice(0, i).join('/')}`)) return true;
    return false;
  };

  const render = () => {
    clear(list);
    const q = filterInput.value.trim().toLowerCase();
    for (const repo of opts.repos) {
      const repoKey = `${repo.root}\0`;
      const dirs = opts.dirsOf(repo.root);
      const open = expanded.has(repoKey) || q !== '';
      list.append(row(repo.root, '', repo.name, 0, true, open, 'repo'));
      if (!open) continue;
      if (!dirs) {
        list.append(el('div', { className: 'empty-text', text: t('Loading…') }));
        continue;
      }
      const matched = q ? dirs.filter((d) => d.toLowerCase().includes(q)) : dirs;
      // 篩選時顯示符合的資料夾與其上層
      const visible = new Set<string>();
      for (const d of matched) {
        const parts = d.split('/');
        for (let i = 1; i <= parts.length; i++) visible.add(parts.slice(0, i).join('/'));
      }
      walk(repo.root, dirTree([...visible]), 1, q !== '');
    }
  };

  const walk = (root: string, nodes: DirNode[], depth: number, forceOpen: boolean) => {
    for (const n of nodes) {
      const path = n.path;
      const hasChildren = n.children.length > 0;
      const key = `${root}\0${path}`;
      const open = forceOpen || expanded.has(key);
      list.append(row(root, path, n.name, depth, hasChildren, open, 'folder'));
      if (hasChildren && open) walk(root, n.children, depth + 1, forceOpen);
    }
  };

  const row = (root: string, path: string, label: string, depth: number, expandable: boolean, open: boolean, kind: 'repo' | 'folder') => {
    const key = `${root}\0${path}`;
    const covered = path !== '' && coveredBy(root, path);
    const box = el('input', { attrs: { type: 'checkbox', 'aria-label': label } });
    box.checked = checked.has(key) || covered;
    box.disabled = covered && !checked.has(key);
    box.addEventListener('change', () => {
      if (box.checked) {
        checked.add(key);
        // 勾選上層時，移除底下個別勾選的資料夾
        for (const k of [...checked]) if (k !== key && k.startsWith(`${root}\0`) && (path === '' || k.slice(root.length + 1).startsWith(`${path}/`))) checked.delete(k);
      } else {
        checked.delete(key);
      }
      render();
    });
    const twisty = expandable ? icon(open ? 'chevron-down' : 'chevron-right', 'twisty') : el('span', { className: 'twisty' });
    const r = el('div', { className: 'tree-row' }, twisty, box, icon(kind), el('span', { className: 'tree-label', text: label }));
    r.style.paddingLeft = `${4 + depth * 16}px`;
    twisty.addEventListener('click', () => {
      if (!expandable) return;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      render();
    });
    return r;
  };

  const finish = (apply: boolean) => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    current = undefined;
    if (!apply) return;
    const roots: string[] = [];
    const pathsByRoot: Record<string, string[]> = {};
    for (const repo of opts.repos) {
      const own = [...checked].filter((k) => k.startsWith(`${repo.root}\0`)).map((k) => k.slice(repo.root.length + 1));
      if (own.length === 0) continue;
      roots.push(repo.root);
      if (!own.includes('')) pathsByRoot[repo.root] = own.sort();
    }
    opts.onApply({ roots, pathsByRoot });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish(true);
    }
  };
  ok.addEventListener('click', () => finish(true));
  cancel.addEventListener('click', () => finish(false));
  clearBtn.addEventListener('click', () => {
    checked.clear();
    render();
  });
  filterInput.addEventListener('input', render);

  const dialog = el(
    'div',
    { className: 'push-dialog paths-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Select Folders') } },
    el('div', { className: 'push-header', text: t('Select Folders') }),
    el('div', { className: 'paths-search search-box' }, icon('search'), filterInput),
    list,
    el('div', { className: 'push-footer' }, clearBtn, el('div', { className: 'toolbar-spacer' }), cancel, ok),
  );
  const overlay = el('div', { className: 'modal-overlay paths-overlay' }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  current = { refresh: render };
  render();
  filterInput.focus();
}
