// 左欄：Branches 樹（HEAD／Local／Remote／Tags，依 '/' 分資料夾）
import type { RepoState } from '../shared/protocol';
import { mergeRefs, naturalCompare, type MergedRef } from '../shared/refs';
import { buildTree, type TreeNode } from '../shared/tree';
import { clear, el, icon, iconButton, showMenu, type IconName } from './dom';
import { plural, t } from './l10n';

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

export interface BranchOptions {
  /** 依 '/' 分資料夾 */
  groupByDirectory: boolean;
  /** 多 repo 時依儲存庫分組（不合併同名分支） */
  groupByRepository: boolean;
  showTags: boolean;
  /** 點選分支時：false 依分支篩選記錄；true 只在記錄中跳到該分支的最新 commit */
  navigateOnSelect: boolean;
}

export const DEFAULT_BRANCH_OPTIONS: BranchOptions = { groupByDirectory: true, groupByRepository: false, showTags: true, navigateOnSelect: false };

/** 工具列上針對選取分支的操作 */
export type BranchToolbarAction = 'newBranch' | 'update' | 'delete' | 'compare' | 'compareWorkingTree' | 'navigate';

export interface BranchesCallbacks {
  /** 選取 ref：值為完整 ref 名稱或 'HEAD' */
  onSelect: (refName: string) => void;
  /** roots：擁有此 ref 的 repository */
  onCheckout: (refName: string, roots: string[]) => void;
  /** ref 右鍵選單 */
  onContextMenu: (ref: MergedRef, x: number, y: number) => void;
  /** Fetch 所有 remote */
  onFetch: () => void;
  onCollapsePane: () => void;
  onExpandedChange: (expanded: string[]) => void;
  /** 工具列操作；ref 為目前選取的分支（新增分支時可為空，表示從 HEAD 建立） */
  onToolbarAction: (action: BranchToolbarAction, ref: MergedRef | undefined) => void;
  onOptionsChange: (options: BranchOptions) => void;
  /** 我的最愛（完整 ref 名稱）或「只顯示我的最愛」變更 */
  onFavoritesChange: (favorites: string[], onlyFavorites: boolean) => void;
}

/** 沒有自訂我的最愛時的預設：main／master（local 與 remote） */
const DEFAULT_FAVORITES = new Set(['main', 'master']);

export class BranchesPane {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private states: RepoState[] = [];
  private refs: MergedRef[] = [];
  private expanded: Set<string>;
  private selectedKey: string | undefined;
  private rows: Row[] = [];
  /** 選取列對應的 ref 名稱：切換分組方式後列的 key 會變，用名稱找回選取 */
  private selectedRefName: string | undefined;
  /** undefined：使用預設（main／master） */
  private favorites: Set<string> | undefined;
  private onlyFavorites: boolean;
  private options: BranchOptions;
  /** 需要選取 ref 才能使用的工具列按鈕 */
  private readonly refButtons: HTMLButtonElement[] = [];
  private readonly favToolButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;

  constructor(
    private readonly cb: BranchesCallbacks,
    expanded: string[] | undefined,
    favorites?: string[],
    onlyFavorites = false,
    options?: Partial<BranchOptions>,
  ) {
    this.expanded = new Set(expanded ?? ['local', 'remote', 'remote:origin']);
    this.favorites = favorites ? new Set(favorites) : undefined;
    this.onlyFavorites = onlyFavorites;
    this.options = { ...DEFAULT_BRANCH_OPTIONS, ...options };

    // 順序與 IntelliJ 的 Branches 工具列相同
    const refButton = (name: IconName, title: string, action: BranchToolbarAction) => {
      const b = iconButton(name, title, () => {
        const ref = this.selectedRef;
        if (ref) cb.onToolbarAction(action, ref);
      });
      this.refButtons.push(b);
      return b;
    };
    this.favToolButton = iconButton('star', t('Mark as Favorite'), () => {
      const ref = this.selectedRef;
      if (ref && ref.type !== 'tag') this.toggleFavorite(ref);
    });
    this.settingsButton = iconButton('gear', t('Branch options'), () => this.showOptions());
    const toolbar = el(
      'div',
      { className: 'vertical-toolbar' },
      iconButton('chevron-left', t('Hide branches'), () => cb.onCollapsePane()),
      el('div', { className: 'toolbar-sep' }),
      iconButton('add', t('New Branch…'), () => cb.onToolbarAction('newBranch', this.selectedRef)),
      refButton('update', t('Update Selected'), 'update'),
      refButton('trash', t('Delete'), 'delete'),
      refButton('compare', t('Compare with Current'), 'compare'),
      refButton('diff-tree', t('Show Diff with Working Tree'), 'compareWorkingTree'),
      iconButton('fetch', t('Fetch all remotes'), () => cb.onFetch()),
      this.favToolButton,
      refButton('locate', t('Navigate Log to Selected Branch Head'), 'navigate'),
      el('div', { className: 'toolbar-sep' }),
      this.settingsButton,
      iconButton('expand-all', t('Expand all'), () => this.expandAll()),
      iconButton('collapse-all', t('Collapse all'), () => this.collapseAll()),
    );

    this.search = el('input', { className: 'text-input', attrs: { type: 'text', placeholder: t('Branch or tag'), spellcheck: 'false' } });
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

  /** 目前選取的 ref（HEAD 列對應目前分支） */
  get selectedRef(): MergedRef | undefined {
    const row = this.rows.find((r) => r.key === this.selectedKey);
    if (row?.ref) return row.ref;
    if (row?.kind === 'head') {
      const branch = this.currentBranch;
      return branch ? this.refs.find((r) => r.type === 'local' && r.short === branch) : undefined;
    }
    return undefined;
  }

  /** 依選取狀態啟用／停用工具列按鈕 */
  private syncToolbar(): void {
    const ref = this.selectedRef;
    for (const b of this.refButtons) b.disabled = !ref;
    this.favToolButton.disabled = !ref || ref.type === 'tag';
    const fav = !!ref && this.isFavorite(ref);
    this.favToolButton.classList.toggle('on', fav);
    this.favToolButton.title = fav ? t('Remove from Favorites') : t('Mark as Favorite');
  }

  /** ⚙ 選單：分組方式、只顯示我的最愛、顯示標籤 */
  private showOptions(): void {
    const r = this.settingsButton.getBoundingClientRect();
    const toggle = (k: keyof BranchOptions) => () => {
      this.options = { ...this.options, [k]: !this.options[k] };
      // 開啟依儲存庫分組時，各儲存庫的群組預設展開
      if (k === 'groupByRepository' && this.options.groupByRepository) {
        for (const st of this.states) for (const g of ['local', 'remote', 'tags']) this.expanded.add(`${g}@${st.root}`);
        for (const st of this.states) for (const name of st.remotes) this.expanded.add(`remote:${name}@${st.root}`);
        this.cb.onExpandedChange([...this.expanded]);
      }
      this.cb.onOptionsChange(this.options);
      this.render();
    };
    showMenu(r.right + 2, r.top, [
      { label: t('Group by Directory'), checked: this.options.groupByDirectory, action: toggle('groupByDirectory') },
      { label: t('Group by Repository'), checked: this.options.groupByRepository, disabled: this.states.length < 2, action: toggle('groupByRepository') },
      '-',
      {
        label: t('Show Only Favorites'),
        checked: this.onlyFavorites,
        action: () => {
          this.onlyFavorites = !this.onlyFavorites;
          this.cb.onFavoritesChange(this.favoriteList(), this.onlyFavorites);
          this.render();
        },
      },
      { label: t('Show Tags'), checked: this.options.showTags, action: toggle('showTags') },
      '-',
      { label: t('Filter Log on Selection'), checked: !this.options.navigateOnSelect, action: () => this.setNavigate(false) },
      { label: t('Navigate Log on Selection'), checked: this.options.navigateOnSelect, action: () => this.setNavigate(true) },
    ]);
  }

  private setNavigate(v: boolean): void {
    this.options = { ...this.options, navigateOnSelect: v };
    this.cb.onOptionsChange(this.options);
  }

  isFavorite(ref: Pick<MergedRef, 'name' | 'type' | 'short' | 'remoteBranch'>): boolean {
    if (ref.type === 'tag') return false;
    if (this.favorites) return this.favorites.has(ref.name);
    return DEFAULT_FAVORITES.has(ref.type === 'remote' ? (ref.remoteBranch ?? ref.short) : ref.short);
  }

  /** 目前的我的最愛清單（預設值展開成實際的 ref） */
  private favoriteList(): string[] {
    if (this.favorites) return [...this.favorites];
    return this.refs.filter((r) => this.isFavorite(r)).map((r) => r.name);
  }

  toggleFavorite(ref: MergedRef): void {
    const set = new Set(this.favoriteList());
    if (set.has(ref.name)) set.delete(ref.name);
    else set.add(ref.name);
    this.favorites = set;
    this.cb.onFavoritesChange([...set], this.onlyFavorites);
    this.render();
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
    this.selectedRefName = refName && refName !== 'HEAD' ? refName : undefined;
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
    const { groupByDirectory, groupByRepository, showTags } = this.options;
    const byRepo = multi && groupByRepository;

    /** 所屬 repo：3 個以內直接列名稱（與 IntelliJ 相同），超過顯示數量 */
    const repoText = (r: MergedRef): string | undefined => {
      if (!multi || byRepo) return undefined;
      const names = r.roots.map((x) => nameOf.get(x) ?? x);
      return names.length <= 3 ? `(${names.join(', ')})` : plural(names.length, '{0} repo', '{0} repos');
    };
    const refRow = (r: MergedRef, label: string, depth: number, scope: string): Row => ({
      key: `ref:${r.name}${scope ? `@${scope}` : ''}`,
      label,
      depth,
      kind: 'ref',
      ref: r,
      track: trackText(r),
      extra: repoText(r),
      extraTitle: multi ? r.roots.map((x) => nameOf.get(x) ?? x).join('\n') : undefined,
      expandable: false,
      expanded: false,
      current: r.current,
      favorite: this.isFavorite(r),
    });

    const pushTree = (nodes: TreeNode<MergedRef>[], depth: number, prefix: string, scope: string) => {
      for (const n of nodes) {
        if (n.item) {
          rows.push(refRow(n.item, n.name, depth, scope));
        } else {
          const key = `${prefix}/${n.path}`;
          const open = isOpen(key);
          rows.push({ key, label: n.name, depth, kind: 'folder', expandable: true, expanded: open, current: false, favorite: false });
          if (open) pushTree(n.children, depth + 1, prefix, scope);
        }
      }
    };
    /** 我的最愛置頂；其餘依設定以 '/' 分資料夾或平鋪 */
    const pushRefs = (refs: MergedRef[], depth: number, prefix: string, nameOfRef: (r: MergedRef) => string, scope: string) => {
      const favs = refs.filter((r) => this.isFavorite(r));
      for (const r of favs) rows.push(refRow(r, nameOfRef(r), depth, scope));
      if (this.onlyFavorites) return;
      const rest = refs.filter((r) => !this.isFavorite(r));
      if (groupByDirectory) pushTree(buildTree(rest, nameOfRef, { compress: false, sort: true }), depth, prefix, scope);
      else for (const r of rest) rows.push(refRow(r, nameOfRef(r), depth, scope));
    };

    const group = (key: string, label: string, depth: number, build: () => void, count: number) => {
      if ((filtering || this.onlyFavorites) && count === 0) return;
      const open = isOpen(key);
      rows.push({ key, label, depth, kind: 'group', expandable: true, expanded: open, current: false, favorite: false });
      if (open) build();
    };

    if (!filtering || 'head'.includes(q)) {
      rows.push({ key: 'head', label: t('HEAD (Current Branch)'), depth: 0, kind: 'head', expandable: false, expanded: false, current: false, favorite: false });
    }

    const sortRefs = (a: MergedRef, b: MergedRef) => naturalCompare(a.short, b.short);
    const favOk = (r: MergedRef) => !this.onlyFavorites || this.isFavorite(r);
    /** 依儲存庫分組時，每個 repo 各自一份 ref（不合併同名） */
    const sources: { scope: string; label?: string; refs: MergedRef[] }[] = byRepo
      ? this.states.map((st) => ({ scope: st.root, label: st.name, refs: mergeRefs([st]) }))
      : [{ scope: '', refs: this.refs }];

    const localOf = (refs: MergedRef[]) => refs.filter((r) => r.type === 'local' && match(r) && favOk(r)).sort(sortRefs);
    const remoteOf = (refs: MergedRef[]) => refs.filter((r) => r.type === 'remote' && match(r) && favOk(r)).sort(sortRefs);
    const tagOf = (refs: MergedRef[]) => (this.onlyFavorites || !showTags ? [] : refs.filter((r) => r.type === 'tag' && match(r)).sort(sortRefs));

    const buildLocal = (src: (typeof sources)[number], depth: number) => pushRefs(localOf(src.refs), depth, `local${src.scope ? `@${src.scope}` : ''}`, (r) => r.short, src.scope);
    const buildRemote = (src: (typeof sources)[number], depth: number) => {
      const remotes = remoteOf(src.refs);
      for (const name of [...new Set(remotes.map((r) => r.remote ?? ''))].sort(naturalCompare)) {
        const refs = remotes.filter((r) => r.remote === name);
        const key = `remote:${name}${src.scope ? `@${src.scope}` : ''}`;
        group(key, name, depth, () => pushRefs(refs, depth + 1, key, (r) => r.remoteBranch ?? r.short, src.scope), refs.length);
      }
    };
    const buildTags = (src: (typeof sources)[number], depth: number) => {
      const key = `tags${src.scope ? `@${src.scope}` : ''}`;
      const tags = tagOf(src.refs);
      if (groupByDirectory) pushTree(buildTree(tags, (r) => r.short, { compress: false }), depth, key, src.scope);
      else for (const r of tags) rows.push(refRow(r, r.short, depth, src.scope));
    };
    const total = (fn: (refs: MergedRef[]) => MergedRef[]) => sources.reduce((n, src) => n + fn(src.refs).length, 0);

    const section = (key: string, label: string, count: number, build: (src: (typeof sources)[number], depth: number) => void, countOf: (refs: MergedRef[]) => MergedRef[]) => {
      group(
        key,
        label,
        0,
        () => {
          if (!byRepo) return build(sources[0], 1);
          for (const src of sources) if (countOf(src.refs).length > 0) group(`${key}@${src.scope}`, src.label ?? src.scope, 1, () => build(src, 2), countOf(src.refs).length);
        },
        count,
      );
    };

    section('local', t('Local'), total(localOf), buildLocal, localOf);
    section('remote', t('Remote'), total(remoteOf), buildRemote, remoteOf);
    if (showTags && !this.onlyFavorites) section('tags', t('Tags'), total(tagOf), buildTags, tagOf);
    return rows;
  }

  render(): void {
    this.rows = this.buildRows();
    // 依 ref 名稱選取時，對應到第一個符合的列（依儲存庫分組時同名分支會有多列）
    if (this.selectedRefName && !this.rows.some((r) => r.key === this.selectedKey && r.ref?.name === this.selectedRefName)) {
      const row = this.rows.find((r) => r.ref?.name === this.selectedRefName);
      if (row) this.selectedKey = row.key;
    }
    this.syncToolbar();
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
      row.track ? el('span', { className: 'tree-track', text: row.track, title: row.ref?.gone ? t('Upstream is gone') : t('{0} ahead, {1} behind', row.ref?.ahead ?? 0, row.ref?.behind ?? 0) }) : null,
      row.extra ? el('span', { className: 'tree-count', text: row.extra, title: row.extraTitle }) : null,
      row.ref && row.ref.type !== 'tag' ? this.favButton(row.ref, row.favorite) : null,
    );
    if (row.ref?.upstream && row.ref.type === 'local') div.title = `${row.ref.short} → ${row.ref.upstream}`;
    div.style.paddingLeft = `${4 + row.depth * 14}px`;
    div.addEventListener('click', () => this.activate(row, false));
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!row.ref) return;
      this.selectedRefName = row.ref?.name;
      this.selectedKey = row.key;
      this.list.querySelector('.tree-row.selected')?.classList.remove('selected');
      div.classList.add('selected');
      this.cb.onContextMenu(row.ref, e.clientX, e.clientY);
    });
    div.addEventListener('dblclick', () => {
      if (row.ref) this.cb.onCheckout(row.ref.name, row.ref.roots);
    });
    return div;
  }

  /** 列尾的星號：滑過時出現，點一下加入／移出我的最愛 */
  private favButton(ref: MergedRef, favorite: boolean): HTMLElement {
    const title = favorite ? t('Remove from Favorites') : t('Add to Favorites');
    const b = el('span', { className: `fav-toggle${favorite ? ' on' : ''}`, title, attrs: { role: 'button', 'aria-label': title } }, icon(favorite ? 'star' : 'star-outline'));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFavorite(ref);
    });
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    return b;
  }

  private activate(row: Row, fromKeyboard: boolean): void {
    if (row.expandable && !fromKeyboard) {
      this.toggle(row.key);
      return;
    }
    if (row.kind === 'ref' || row.kind === 'head') {
      this.selectedRefName = row.ref?.name;
      this.selectedKey = row.key;
      if (this.options.navigateOnSelect) {
        const ref = this.selectedRef;
        if (ref) this.cb.onToolbarAction('navigate', ref);
      } else {
        this.cb.onSelect(row.kind === 'head' ? 'HEAD' : row.ref!.name);
      }
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
    this.selectedRefName = this.rows[next].ref?.name;
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
  if (r.gone) return t('gone');
  const parts: string[] = [];
  if (r.ahead) parts.push(`↑${r.ahead}`);
  if (r.behind) parts.push(`↓${r.behind}`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}
