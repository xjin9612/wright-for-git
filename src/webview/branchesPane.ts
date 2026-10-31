// 左欄：Branches 樹（HEAD／Local／Remote／Tags，依 '/' 分資料夾）
import type { RepoState } from '../shared/protocol';
import { mergeRefs, naturalCompare, type MergedRef } from '../shared/refs';
import { buildTree, type TreeNode } from '../shared/tree';
import { clear, el, icon, iconButton, type IconName } from './dom';

interface Row {
  key: string;
  label: string;
  depth: number;
  kind: 'group' | 'folder' | 'ref' | 'head';
  ref?: MergedRef;
  /** 名稱後方的淡色說明（多 repo 時顯示所屬 repo） */
  extra?: string;
  /** 相對 upstream 的領先／落後（↑2 ↓3） */
  track?: string;
  extraTitle?: string;
  expandable: boolean;
  expanded: boolean;
  current: boolean;
  favorite: boolean;
}

export interface BranchesCallbacks {
  /** 選取 ref：值為完整 ref 名稱或 'HEAD' */
  onSelect: (refName: string) => void;
  /** roots：擁有此 ref 的 repository */
  onCheckout: (refName: string, roots: string[]) => void;
  onRefresh: () => void;
  /** Fetch 所有 remote */
  onFetch: () => void;
  onCollapsePane: () => void;
  onExpandedChange: (expanded: string[]) => void;
}

const FAVORITES = new Set(['main', 'master']);

export class BranchesPane {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private states: RepoState[] = [];
  private refs: MergedRef[] = [];
  private expanded: Set<string>;
  private selectedKey: string | undefined;
  private rows: Row[] = [];

  constructor(
    private readonly cb: BranchesCallbacks,
    expanded: string[] | undefined,
  ) {
    this.expanded = new Set(expanded ?? ['local', 'remote', 'remote:origin']);

    const toolbar = el(
      'div',
      { className: 'vertical-toolbar' },
      iconButton('chevron-left', 'Hide branches', () => cb.onCollapsePane()),
      el('div', { className: 'toolbar-sep' }),
      iconButton('refresh', 'Refresh', () => cb.onRefresh()),
      iconButton('fetch', 'Fetch all remotes', () => cb.onFetch()),
      iconButton('locate', 'Navigate to current branch', () => this.locateCurrent()),
      iconButton('expand-all', 'Expand all', () => this.expandAll()),
      iconButton('collapse-all', 'Collapse all', () => this.collapseAll()),
    );

    this.search = el('input', { className: 'text-input', attrs: { type: 'text', placeholder: 'Branch or tag', spellcheck: 'false' } });
    this.search.addEventListener('input', () => this.render());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.search.value = '';
        this.render();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.list.focus();
        this.move(1);
      }
    });

    this.list = el('div', { className: 'tree branch-tree', attrs: { tabindex: '0', role: 'tree' } });
    this.list.addEventListener('keydown', (e) => this.onKey(e));

    const main = el('div', { className: 'branches-main' }, el('div', { className: 'search-box' }, icon('search'), this.search), this.list);
    this.element = el('div', { className: 'branches-pane' }, toolbar, main);
  }

  /** 顯示這些 repository 的 branch；同名 branch 合併為一筆 */
  setRepos(states: RepoState[]): void {
    this.states = states;
    this.refs = mergeRefs(states);
    this.render();
  }

  /** 目前 branch（多 repo 時取第一個有 branch 的 repo） */
  private get currentBranch(): string | undefined {
    return this.states.find((s) => s.head.branch)?.head.branch;
  }

  /** 依目前的 branch 篩選同步選取狀態 */
  setSelectedRef(refName: string | undefined): void {
    this.selectedKey = refName ? (refName === 'HEAD' ? 'head' : `ref:${refName}`) : undefined;
    this.render();
  }

  private buildRows(): Row[] {
    if (this.states.length === 0) return [];
    const multi = this.states.length > 1;
    const nameOf = new Map(this.states.map((st) => [st.root, st.name]));
    const q = this.search.value.trim().toLowerCase();
    const filtering = q !== '';
    const match = (r: MergedRef) => !filtering || r.short.toLowerCase().includes(q);
    const rows: Row[] = [];
    const isOpen = (key: string) => filtering || this.expanded.has(key);

    const pushTree = (nodes: TreeNode<MergedRef>[], depth: number, prefix: string) => {
      for (const n of nodes) {
        if (n.item) {
          const r = n.item;
          const name = r.type === 'remote' ? (r.remoteBranch ?? r.short) : r.short;
          rows.push({
            key: `ref:${r.name}`,
            label: n.name,
            depth,
            kind: 'ref',
            ref: r,
            track: trackText(r),
            extra: !multi ? undefined : r.roots.length === 1 ? nameOf.get(r.roots[0]) : `${r.roots.length} repos`,
            extraTitle: multi ? r.roots.map((x) => nameOf.get(x) ?? x).join('\n') : undefined,
            expandable: false,
            expanded: false,
            current: r.current,
            favorite: r.type !== 'tag' && FAVORITES.has(name),
          });
        } else {
          const key = `${prefix}/${n.path}`;
          const open = isOpen(key);
          rows.push({ key, label: n.name, depth, kind: 'folder', expandable: true, expanded: open, current: false, favorite: false });
          if (open) pushTree(n.children, depth + 1, prefix);
        }
      }
    };

    const group = (key: string, label: string, depth: number, build: () => void, count: number) => {
      if (filtering && count === 0) return;
      const open = isOpen(key);
      rows.push({ key, label, depth, kind: 'group', expandable: true, expanded: open, current: false, favorite: false });
      if (open) build();
    };

    if (!filtering || 'head'.includes(q)) {
      rows.push({ key: 'head', label: 'HEAD (Current Branch)', depth: 0, kind: 'head', expandable: false, expanded: false, current: false, favorite: false });
    }

    const sortRefs = (a: MergedRef, b: MergedRef) => naturalCompare(a.short, b.short);
    const locals = this.refs.filter((r) => r.type === 'local' && match(r)).sort(sortRefs);
    group('local', 'Local', 0, () => pushTree(buildTree(locals, (r) => r.short, { compress: false, sort: true }), 1, 'local'), locals.length);

    const remotes = this.refs.filter((r) => r.type === 'remote' && match(r)).sort(sortRefs);
    const remoteNames = [...new Set(remotes.map((r) => r.remote ?? ''))].sort(naturalCompare);
    group(
      'remote',
      'Remote',
      0,
      () => {
        for (const name of remoteNames) {
          const refs = remotes.filter((r) => r.remote === name);
          group(`remote:${name}`, name, 1, () => pushTree(buildTree(refs, (r) => r.remoteBranch ?? r.short, { compress: false }), 2, `remote:${name}`), refs.length);
        }
      },
      remotes.length,
    );

    const tags = this.refs.filter((r) => r.type === 'tag' && match(r)).sort(sortRefs);
    group('tags', 'Tags', 0, () => pushTree(buildTree(tags, (r) => r.short, { compress: false }), 1, 'tags'), tags.length);

    return rows;
  }

  render(): void {
    this.rows = this.buildRows();
    clear(this.list);
    if (this.states.length === 0) return;
    const frag = document.createDocumentFragment();
    for (const row of this.rows) frag.append(this.renderRow(row));
    this.list.append(frag);
  }

  private renderRow(row: Row): HTMLElement {
    const twisty = row.expandable ? icon(row.expanded ? 'chevron-down' : 'chevron-right', 'twisty') : el('span', { className: 'twisty' });
    let iconName: IconName | undefined;
    let iconClass = '';
    if (row.kind === 'folder') iconName = 'folder';
    else if (row.kind === 'group' && row.key.startsWith('remote:')) iconName = 'folder';
    else if (row.kind === 'ref') {
      if (row.favorite) {
        iconName = 'star';
        iconClass = 'favorite';
      } else if (row.ref?.type === 'tag') iconName = 'tag';
      else if (row.current) {
        iconName = 'tag';
        iconClass = 'current';
      } else iconName = 'branch';
    }
    const label = el('span', { className: 'tree-label', text: row.label });
    const div = el(
      'div',
      {
        className: `tree-row${row.key === this.selectedKey ? ' selected' : ''}${row.current ? ' current' : ''}`,
        title: row.ref?.short ?? row.label,
        attrs: { role: 'treeitem', 'data-key': row.key },
      },
      twisty,
      iconName ? icon(iconName, iconClass) : null,
      label,
      row.track ? el('span', { className: 'tree-track', text: row.track, title: row.ref?.gone ? 'Upstream is gone' : `${row.ref?.ahead ?? 0} ahead, ${row.ref?.behind ?? 0} behind` }) : null,
      row.extra ? el('span', { className: 'tree-count', text: row.extra, title: row.extraTitle }) : null,
    );
    if (row.ref?.upstream && row.ref.type === 'local') div.title = `${row.ref.short} → ${row.ref.upstream}`;
    div.style.paddingLeft = `${4 + row.depth * 14}px`;
    div.addEventListener('click', () => this.activate(row, false));
    div.addEventListener('dblclick', () => {
      if (row.ref) this.cb.onCheckout(row.ref.name, row.ref.roots);
    });
    return div;
  }

  private activate(row: Row, fromKeyboard: boolean): void {
    if (row.expandable && !fromKeyboard) {
      this.toggle(row.key);
      return;
    }
    if (row.kind === 'ref' || row.kind === 'head') {
      this.selectedKey = row.key;
      this.cb.onSelect(row.kind === 'head' ? 'HEAD' : row.ref!.name);
      this.render();
    }
  }

  private toggle(key: string, open?: boolean): void {
    const next = open ?? !this.expanded.has(key);
    if (next) this.expanded.add(key);
    else this.expanded.delete(key);
    this.cb.onExpandedChange([...this.expanded]);
    this.render();
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    const idx = this.rows.findIndex((r) => r.key === this.selectedKey);
    const next = Math.max(0, Math.min(this.rows.length - 1, idx + delta));
    this.selectedKey = this.rows[next].key;
    this.render();
    this.list.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private onKey(e: KeyboardEvent): void {
    const row = this.rows.find((r) => r.key === this.selectedKey);
    switch (e.key) {
      case 'ArrowDown':
        this.move(1);
        break;
      case 'ArrowUp':
        this.move(-1);
        break;
      case 'ArrowRight':
        if (row?.expandable && !row.expanded) this.toggle(row.key, true);
        else this.move(1);
        break;
      case 'ArrowLeft':
        if (row?.expandable && row.expanded) this.toggle(row.key, false);
        break;
      case 'Enter':
        if (row?.expandable) this.toggle(row.key);
        else if (row) this.activate(row, true);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private locateCurrent(): void {
    const branch = this.currentBranch;
    if (!branch) {
      this.selectedKey = 'head';
    } else {
      this.expanded.add('local');
      const parts = branch.split('/');
      for (let i = 1; i < parts.length; i++) this.expanded.add(`local/${parts.slice(0, i).join('/')}`);
      this.selectedKey = `ref:refs/heads/${branch}`;
      this.cb.onExpandedChange([...this.expanded]);
    }
    this.search.value = '';
    this.render();
    this.list.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'center' });
    this.list.focus();
  }

  private expandAll(): void {
    for (const r of this.collectAllKeys()) this.expanded.add(r);
    this.cb.onExpandedChange([...this.expanded]);
    this.render();
  }

  private collapseAll(): void {
    this.expanded.clear();
    this.cb.onExpandedChange([]);
    this.render();
  }

  private collectAllKeys(): string[] {
    const keys = ['local', 'remote', 'tags'];
    if (this.states.length === 0) return keys;
    const addFolders = (prefix: string, names: string[]) => {
      for (const n of names) {
        const parts = n.split('/');
        for (let i = 1; i < parts.length; i++) keys.push(`${prefix}/${parts.slice(0, i).join('/')}`);
      }
    };
    addFolders('local', this.refs.filter((r) => r.type === 'local').map((r) => r.short));
    for (const name of new Set(this.states.flatMap((st) => st.remotes))) {
      keys.push(`remote:${name}`);
      addFolders(`remote:${name}`, this.refs.filter((r) => r.type === 'remote' && r.remote === name).map((r) => r.remoteBranch ?? ''));
    }
    addFolders('tags', this.refs.filter((r) => r.type === 'tag').map((r) => r.short));
    return keys;
  }
}

/** 領先／落後顯示文字：「↑2 ↓3」；upstream 已刪除時顯示「gone」 */
function trackText(r: MergedRef): string | undefined {
  if (r.type !== 'local') return undefined;
  if (r.gone) return 'gone';
  const parts: string[] = [];
  if (r.ahead) parts.push(`↑${r.ahead}`);
  if (r.behind) parts.push(`↓${r.behind}`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}
