// Webview 進入點：組合三欄、管理篩選與資料流
import { MultiGraph } from '../shared/multiGraph';
import { EMPTY_FILTER, type CommitAction, type CommitInfo, type LogFilter, type RepoState, type SyncAction, type ToWebview, type UserInfo } from '../shared/protocol';
import { mergeRefs } from '../shared/refs';
import { BranchesPane } from './branchesPane';
import { DetailsPane } from './detailsPane';
import { debounce, el, icon, iconButton, makeSplitter } from './dom';
import { LogTable, type Columns, type Highlights } from './logTable';
import { closePicker, openPicker, type PickerOption } from './valuePicker';
import { loadState, post, saveState } from './vscodeApi';

interface Persisted {
  filter: LogFilter;
  columns: Columns;
  highlights: Highlights;
  leftWidth: number;
  rightWidth: number;
  leftVisible: boolean;
  rightVisible: boolean;
  expanded?: string[];
  split?: number;
  /** 選取的 commit：`${root}|${hash}` */
  selectedHash?: string;
}

const saved = loadState<Persisted>();
const ui: Persisted = {
  filter: { ...EMPTY_FILTER, ...saved?.filter },
  columns: saved?.columns ?? { author: true, date: true, hash: true },
  highlights: { commitType: true, mine: false, merges: true, ...saved?.highlights },
  leftWidth: saved?.leftWidth ?? 240,
  rightWidth: saved?.rightWidth ?? 340,
  leftVisible: saved?.leftVisible ?? true,
  rightVisible: saved?.rightVisible ?? true,
  expanded: saved?.expanded,
  split: saved?.split,
  selectedHash: saved?.selectedHash,
};
const persist = debounce(() => saveState(ui), 200);

// ---------- 狀態 ----------
/** 所有 repository；commit.repo 為索引 */
let repos: RepoState[] = [];
let commits: CommitInfo[] = [];
/** key = `${repo}:${hash}` */
let keyIndex = new Map<string, number>();
let graph = new MultiGraph(true);
let requestId = 0;
/** extension 端 repos 清單的版本，loadLog 時帶回 */
let generation = 0;
/** 本次載入是否為「狀態更新後的重載」（保留捲動位置） */
let quietReload = false;
let pendingSelect: string | undefined = ui.selectedHash?.includes('|') ? ui.selectedHash : undefined;
let users: UserInfo[] | undefined;
let usersPicker: { refresh: () => void } | undefined;
const dirsByRoot = new Map<string, string[]>();
const dirsRequested = new Set<string>();
let pathsPicker: { refresh: () => void } | undefined;

/** 目前 Paths（repo）篩選下要顯示的 repository */
function visibleRepos(): RepoState[] {
  if (ui.filter.roots.length === 0) return repos;
  const set = new Set(ui.filter.roots);
  const list = repos.filter((r) => set.has(r.root));
  return list.length > 0 ? list : repos;
}

function selectionKey(c: CommitInfo): string {
  return `${repos[c.repo]?.root ?? ''}|${c.hash}`;
}

// ---------- 元件 ----------
const branches = new BranchesPane(
  {
    onSelect: (ref) => setFilter({ branches: [ref] }),
    onCheckout: (ref, roots) => post({ type: 'checkout', ref, roots }),
    onRefresh: () => post({ type: 'refresh' }),
    onCollapsePane: () => setPaneVisible('left', false),
    onExpandedChange: (expanded) => {
      ui.expanded = expanded;
      persist();
    },
  },
  ui.expanded,
);

const table = new LogTable(
  {
    onSelect: (i) => onCommitSelected(i),
    onContextMenu: (i, x, y) => showContextMenu(i, x, y),
  },
  ui.columns,
  ui.highlights,
);

const details = new DetailsPane(
  {
    onOpenDiff: (file, d) => post({ type: 'openDiff', root: d.root, hash: d.hash, parent: d.parents[0], file }),
    onCopy: (text) => post({ type: 'copy', text }),
    onRequestContaining: (root, hash) => post({ type: 'containingBranches', root, hash }),
    onCollapsePane: () => setPaneVisible('right', false),
    onSplitChange: (ratio) => {
      ui.split = ratio;
      persist();
    },
  },
  ui.split,
);

// ---------- 篩選列 ----------
const searchInput = el('input', { className: 'text-input', attrs: { type: 'text', placeholder: 'Text or hash', spellcheck: 'false', 'aria-label': 'Text or hash' } });
searchInput.value = ui.filter.text;
const regexToggle = toggleButton('.*', 'Regex', () => ui.filter.regex, (v) => setFilter({ regex: v }));
const caseToggle = toggleButton('Cc', 'Match case', () => ui.filter.matchCase, (v) => setFilter({ matchCase: v }));
const applyText = debounce(() => setFilter({ text: searchInput.value }), 350);
searchInput.addEventListener('input', () => applyText());
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyText.flush();
  else if (e.key === 'Escape') {
    searchInput.value = '';
    applyText.cancel();
    setFilter({ text: '' });
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    table.focus();
  }
});

const branchChip = filterChip('Branch', () => openBranchPicker(), () => setFilter({ branches: [] }));
const userChip = filterChip('User', () => openUserPicker(), () => setFilter({ users: [] }));
const pathsChip = filterChip('Paths', () => openPathsPicker(), () => setFilter({ paths: [], roots: [] }));
const viewButton = iconButton('eye', 'View options', () => showViewMenu());

/** 同步：作用於目前 Paths 篩選下可見的 repository */
const sync = (action: SyncAction) => post({ type: 'sync', action, roots: visibleRepos().map((r) => r.root) });
const pushMenuButton = iconButton('chevron-down', 'More push options', () => {
  const r = pushMenuButton.getBoundingClientRect();
  showMenu(r.left - 120, r.bottom + 2, [
    { label: 'Push', action: () => sync('push') },
    { label: 'Force Push (with lease)…', action: () => sync('forcePush') },
  ]);
}, 'split-caret');
const syncGroup = el(
  'div',
  { className: 'toolbar-group' },
  iconButton('fetch', 'Fetch all remotes', () => sync('fetch')),
  iconButton('pull', 'Pull (uses your pull.rebase setting)', () => sync('pull')),
  iconButton('push', 'Push', () => sync('push')),
  pushMenuButton,
);
const progress = el('div', { className: 'progress' });
const warningBar = el('div', { className: 'log-warning hidden' });

/** 部分 repo 讀取失敗時，在表格上方顯示提示（其餘 repo 照常顯示） */
function setWarnings(list: string[] | undefined): void {
  warningBar.textContent = list && list.length > 0 ? `⚠ ${list.join('  ·  ')}` : '';
  warningBar.title = list?.join('\n') ?? '';
  warningBar.classList.toggle('hidden', !list || list.length === 0);
}

const filterBar = el(
  'div',
  { className: 'filter-bar' },
  el('div', { className: 'search-box log-search' }, icon('search'), searchInput, regexToggle, caseToggle),
  branchChip.element,
  userChip.element,
  pathsChip.element,
  el('div', { className: 'toolbar-spacer' }),
  syncGroup,
  el('div', { className: 'toolbar-divider' }),
  iconButton('refresh', 'Refresh', () => post({ type: 'refresh' })),
  viewButton,
);

const logPane = el('div', { className: 'log-pane' }, filterBar, progress, warningBar, table.element);

// ---------- 版面 ----------
const leftSplitter = makeSplitter(
  'vertical',
  () => (dragStart = ui.leftWidth),
  (d) => {
    ui.leftWidth = clamp(dragStart + d, 140, 600);
    applyLayout();
  },
  () => persist(),
);
const rightSplitter = makeSplitter(
  'vertical',
  () => (dragStart = ui.rightWidth),
  (d) => {
    ui.rightWidth = clamp(dragStart - d, 200, 800);
    applyLayout();
  },
  () => persist(),
);
let dragStart = 0;
const leftRestore = el('div', { className: 'pane-restore' }, iconButton('chevron-right', 'Show branches', () => setPaneVisible('left', true)));

const app = document.getElementById('app')!;
app.className = 'workbench';
app.append(leftRestore, branches.element, leftSplitter, logPane, rightSplitter, details.element);
applyLayout();
renderChips();
window.addEventListener('resize', () => applyLayout());

function applyLayout(): void {
  const cols: string[] = [];
  leftRestore.style.display = ui.leftVisible ? 'none' : '';
  branches.element.style.display = ui.leftVisible ? '' : 'none';
  leftSplitter.style.display = ui.leftVisible ? '' : 'none';
  rightSplitter.style.display = ui.rightVisible ? '' : 'none';
  details.element.style.display = ui.rightVisible ? '' : 'none';
  // 視窗太窄時依比例縮小兩側欄，保留中欄至少 MIN_MIDDLE
  const MIN_MIDDLE = 420;
  let left = ui.leftVisible ? ui.leftWidth : 0;
  let right = ui.rightVisible ? ui.rightWidth : 0;
  const avail = window.innerWidth - MIN_MIDDLE - (ui.leftVisible ? 4 : 22) - (ui.rightVisible ? 4 : 0);
  if (left + right > avail && left + right > 0) {
    const scale = Math.max(0, avail) / (left + right);
    left = ui.leftVisible ? Math.max(140, Math.floor(left * scale)) : 0;
    right = ui.rightVisible ? Math.max(180, Math.floor(right * scale)) : 0;
  }
  cols.push(ui.leftVisible ? `${left}px 4px` : '22px');
  cols.push('minmax(160px, 1fr)');
  if (ui.rightVisible) cols.push(`4px ${right}px`);
  app.style.gridTemplateColumns = cols.join(' ');
}

function setPaneVisible(which: 'left' | 'right', visible: boolean): void {
  if (which === 'left') ui.leftVisible = visible;
  else ui.rightVisible = visible;
  applyLayout();
  persist();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ---------- 篩選 ----------
function setFilter(patch: Partial<LogFilter>): void {
  const next = { ...ui.filter, ...patch };
  if (JSON.stringify(next) === JSON.stringify(ui.filter)) {
    renderChips();
    return;
  }
  ui.filter = next;
  persist();
  renderChips();
  loadLog();
}

function shortRefName(name: string): string {
  for (const st of repos) {
    const ref = st.refs.find((r) => r.name === name);
    if (ref) return ref.short;
  }
  return name;
}

function repoName(root: string): string {
  return repos.find((r) => r.root === root)?.name ?? root;
}

/** Paths 篩選框的顯示文字：`repo` 或 `repo / 子路徑` */
function pathsLabel(): string {
  const f = ui.filter;
  const roots = f.roots.length > 0 ? f.roots : f.paths.length > 0 && repos.length === 1 ? [repos[0].root] : [];
  const names = roots.map(repoName);
  if (f.paths.length === 0) return names.join('|');
  return `${names.join('|')} / ${f.paths.join('|')}`;
}

function renderChips(): void {
  const f = ui.filter;
  branchChip.set(f.branches.map(shortRefName).join('|'));
  userChip.set(f.users.join('|'));
  pathsChip.set(pathsLabel());
  regexToggle.sync();
  caseToggle.sync();
  branches.setSelectedRef(f.branches.length === 1 ? f.branches[0] : undefined);
}

function openBranchPicker(): void {
  openPicker({
    anchor: branchChip.element,
    values: ui.filter.branches.map(shortRefName),
    options: () => {
      const vis = visibleRepos();
      const opts: PickerOption[] = [{ value: 'HEAD', detail: vis.length === 1 ? (vis[0].head.branch ?? 'detached') : 'current branch' }];
      const merged = mergeRefs(vis);
      for (const type of ['local', 'remote', 'tag'] as const) {
        for (const r of merged) if (r.type === type) opts.push({ value: r.short, detail: vis.length > 1 ? `${type} · ${r.roots.length}/${vis.length}` : type });
      }
      return opts;
    },
    onApply: (values) => {
      const refs = mergeRefs(visibleRepos());
      const resolved = values
        .filter((v) => !v.startsWith('-'))
        .map((v) => {
          if (v === 'HEAD') return v;
          const ref = refs.find((r) => r.type === 'local' && r.short === v) ?? refs.find((r) => r.type === 'remote' && r.short === v) ?? refs.find((r) => r.type === 'tag' && r.short === v);
          return ref?.name ?? v;
        });
      setFilter({ branches: resolved });
    },
  });
}

function openUserPicker(): void {
  if (!users) post({ type: 'requestUsers' });
  usersPicker = openPicker({
    anchor: userChip.element,
    values: ui.filter.users,
    options: () => {
      const opts: PickerOption[] = [];
      const me = visibleRepos().find((r) => r.userName)?.userName;
      if (me) opts.push({ value: 'me', detail: me });
      for (const u of users ?? []) opts.push({ value: u.name, detail: `${u.email} · ${u.count}` });
      return opts;
    },
    onApply: (values) => {
      usersPicker = undefined;
      const me = visibleRepos().find((r) => r.userName)?.userName;
      setFilter({ users: [...new Set(values.map((v) => (v === 'me' && me ? me : v)))] });
    },
  });
}

/**
 * Paths 篩選（對應 IntelliJ）：第一層一律是 repository；只選一個 repo（或只有一個 repo）時，
 * 下面再列出該 repo 的子資料夾。資料夾的值為 `<repo 名稱>/<路徑>`。
 */
function openPathsPicker(): void {
  const byName = new Map(repos.map((r) => [r.name, r]));
  const folderOptions = (repo: RepoState): PickerOption[] => {
    const list = dirsByRoot.get(repo.root);
    if (!list) {
      if (!dirsRequested.has(repo.root)) {
        dirsRequested.add(repo.root);
        post({ type: 'requestPaths', root: repo.root });
      }
      return [];
    }
    return list.map((d) => ({ value: `${repo.name}/${d}`, label: d.slice(d.lastIndexOf('/') + 1), detail: d, icon: 'folder' as const, indent: d.split('/').length }));
  };
  pathsPicker = openPicker({
    anchor: pathsChip.element,
    values: currentPathValues(),
    options: (current) => {
      const opts: PickerOption[] = [];
      const pickedRepos = current.filter((v) => byName.has(v));
      // 只有一個 repo，或只勾了一個 repo（或勾的資料夾都屬於同一個 repo）時展開資料夾
      const folderRepo =
        repos.length === 1
          ? repos[0]
          : pickedRepos.length === 1
            ? byName.get(pickedRepos[0])
            : pickedRepos.length === 0
              ? repoOfFolderValue(current.find((v) => !byName.has(v)))
              : undefined;
      for (const r of repos) {
        opts.push({ value: r.name, icon: 'repo', detail: r.head.branch ?? 'detached' });
        if (folderRepo === r) opts.push(...folderOptions(r));
      }
      return opts;
    },
    onApply: (values) => {
      pathsPicker = undefined;
      const roots = new Set<string>();
      const paths: string[] = [];
      for (const v of values) {
        const repo = byName.get(v);
        if (repo) {
          roots.add(repo.root);
          continue;
        }
        const owner = repoOfFolderValue(v);
        if (!owner) continue;
        roots.add(owner.root);
        paths.push(v.slice(owner.name.length + 1).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
      }
      // 子資料夾只在單一 repo 時有意義
      const rootList = [...roots];
      const usePaths = rootList.length === 1 ? paths.filter(Boolean) : [];
      setFilter({ roots: rootList.length === repos.length && usePaths.length === 0 ? [] : rootList, paths: usePaths });
    },
  });
}

/** `<repo 名稱>/<路徑>` 對應的 repo（取名稱最長者，處理巢狀 repo 名稱） */
function repoOfFolderValue(v: string | undefined): RepoState | undefined {
  if (!v) return undefined;
  return repos.filter((r) => v.startsWith(`${r.name}/`)).sort((a, b) => b.name.length - a.name.length)[0];
}

/** 目前篩選轉成 Paths 彈出框的值 */
function currentPathValues(): string[] {
  const f = ui.filter;
  const roots = f.roots.length > 0 ? f.roots : f.paths.length > 0 && repos.length === 1 ? [repos[0].root] : [];
  const names = roots.map(repoName);
  if (f.paths.length > 0 && names.length === 1) return f.paths.map((p) => `${names[0]}/${p}`);
  return names;
}

function toggleButton(label: string, title: string, get: () => boolean, set: (v: boolean) => void) {
  const b = el('button', { className: 'toggle-button', text: label, title, attrs: { type: 'button', 'aria-label': title } }) as HTMLButtonElement & { sync: () => void };
  b.sync = () => {
    b.classList.toggle('on', get());
    b.setAttribute('aria-pressed', String(get()));
  };
  b.addEventListener('click', () => set(!get()));
  return b;
}

function filterChip(name: string, onOpen: () => void, onClear: () => void) {
  const label = el('span', { className: 'chip-label' });
  const value = el('span', { className: 'chip-value' });
  const caret = icon('chevron-down', 'chip-caret');
  const clearBtn = iconButton('close', `Clear ${name} filter`, onClear, 'chip-clear');
  const element = el('div', { className: 'chip', attrs: { role: 'button', tabindex: '0', title: `Filter by ${name.toLowerCase()}` } }, label, value, caret, clearBtn);
  element.addEventListener('click', onOpen);
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  });
  return {
    element,
    set(v: string) {
      element.classList.toggle('active', v !== '');
      label.textContent = v ? `${name}: ` : name;
      value.textContent = v;
      element.title = v ? `${name}: ${v}` : `Filter by ${name.toLowerCase()}`;
    },
  };
}

// ---------- Log 載入 ----------
function loadLog(keepScroll = false): void {
  if (repos.length === 0) return;
  closePicker();
  requestId++;
  quietReload = keepScroll;
  if (keepScroll) table.holdScroll();
  setWarnings(undefined);
  const selected = commits[table.selectedIndex];
  if (selected) pendingSelect = selectionKey(selected);
  commits = [];
  keyIndex = new Map();
  graph = new MultiGraph(true);
  table.clearSelection();
  table.setData(commits, graph);
  branches.setRepos(visibleRepos());
  table.setMessage(undefined);
  setLoading(true);
  post({ type: 'loadLog', requestId, generation, filter: ui.filter });
}

function setLoading(v: boolean): void {
  progress.classList.toggle('active', v);
}

function onBatch(m: Extract<ToWebview, { type: 'logBatch' }>): void {
  if (m.requestId !== requestId) return;
  if (commits.length === 0 && graph.length === 0) graph = new MultiGraph(m.graph);
  const fresh = m.commits.filter((c) => !keyIndex.has(`${c.repo}:${c.hash}`));
  for (const c of fresh) {
    keyIndex.set(`${c.repo}:${c.hash}`, commits.length);
    commits.push(c);
  }
  graph.add(fresh);
  table.setData(commits, graph);

  if (pendingSelect) {
    const [root, hash] = pendingSelect.split('|');
    const repoIdx = repos.findIndex((r) => r.root === root);
    const idx = keyIndex.get(`${repoIdx}:${hash}`);
    if (idx !== undefined) {
      pendingSelect = undefined;
      table.select(idx, true, quietReload ? 'none' : 'center');
    }
  }

  if (m.done) {
    setLoading(false);
    table.releaseScroll();
    setWarnings(m.warnings);
    if (commits.length === 0) {
      table.setMessage(hasActiveFilter() ? 'No commits matching filters' : 'No commits');
      details.renderEmpty('No commit selected');
    } else if (table.selectedIndex < 0) {
      pendingSelect = undefined;
      // 預設選取最上方的 HEAD（多 repo 時為最近有動的 repo）
      let headIdx: number | undefined;
      for (const st of visibleRepos()) {
        const idx = st.head.hash ? keyIndex.get(`${repos.indexOf(st)}:${st.head.hash}`) : undefined;
        if (idx !== undefined && (headIdx === undefined || idx < headIdx)) headIdx = idx;
      }
      table.select(headIdx ?? 0, true, 'center');
    }
  }
}

function hasActiveFilter(): boolean {
  const f = ui.filter;
  return f.text.trim() !== '' || f.users.length > 0 || f.branches.length > 0 || f.paths.length > 0 || f.roots.length > 0;
}

const requestDetails = debounce((root: string, hash: string) => post({ type: 'selectCommit', root, hash }), 60);

function onCommitSelected(index: number): void {
  const c = commits[index];
  const root = c && repos[c.repo]?.root;
  if (!c || !root) return;
  ui.selectedHash = selectionKey(c);
  persist();
  details.showLoading();
  requestDetails(root, c.hash);
}

// ---------- 選單 ----------
function showMenu(x: number, y: number, items: ({ label: string; checked?: boolean; action: () => void } | '-')[]): void {
  document.querySelector('.context-menu')?.remove();
  const menu = el('div', { className: 'context-menu', attrs: { role: 'menu' } });
  for (const it of items) {
    if (it === '-') {
      menu.append(el('div', { className: 'menu-sep' }));
      continue;
    }
    const row = el('div', { className: 'menu-item', attrs: { role: 'menuitem' } }, el('span', { className: 'menu-check' }, it.checked ? icon('check') : null), el('span', { text: it.label }));
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
      it.action();
    });
    menu.append(row);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
    document.removeEventListener('keydown', close, true);
  };
  setTimeout(() => {
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', close, true);
  });
}

function showContextMenu(index: number, x: number, y: number): void {
  const c = commits[index];
  const root = c && repos[c.repo]?.root;
  if (!c || !root) return;
  const act = (action: CommitAction) => () => post({ type: 'commitAction', action, root, hash: c.hash, parents: c.parents, subject: c.subject });
  showMenu(x, y, [
    { label: 'Copy Revision Number', action: () => post({ type: 'copy', text: c.hash }) },
    { label: 'Copy Subject', action: () => post({ type: 'copy', text: c.subject }) },
    '-',
    { label: 'Checkout Revision…', action: () => post({ type: 'checkoutRevision', root, hash: c.hash }) },
    { label: 'New Branch…', action: act('newBranch') },
    { label: 'New Tag…', action: act('newTag') },
    '-',
    { label: 'Cherry-Pick', action: act('cherryPick') },
    { label: 'Revert Commit', action: act('revert') },
    { label: 'Reset Current Branch to Here…', action: act('reset') },
    '-',
    { label: 'Compare with Local', action: act('compareLocal') },
  ]);
}

function showViewMenu(): void {
  const r = viewButton.getBoundingClientRect();
  const toggleCol = (k: keyof Columns) => () => {
    ui.columns = { ...ui.columns, [k]: !ui.columns[k] };
    table.setColumns(ui.columns);
    persist();
  };
  const toggleHl = (k: keyof Highlights) => () => {
    ui.highlights = { ...ui.highlights, [k]: !ui.highlights[k] };
    table.setHighlights(ui.highlights);
    persist();
  };
  // 選單靠按鈕右緣對齊，showMenu 會再夾在視窗內
  showMenu(r.right - 220, r.bottom + 2, [
    { label: 'Show Author', checked: ui.columns.author, action: toggleCol('author') },
    { label: 'Show Date', checked: ui.columns.date, action: toggleCol('date') },
    { label: 'Show Hash', checked: ui.columns.hash, action: toggleCol('hash') },
    '-',
    { label: 'Highlight Commit Type', checked: ui.highlights.commitType, action: toggleHl('commitType') },
    { label: 'Highlight My Commits', checked: ui.highlights.mine, action: toggleHl('mine') },
    { label: 'Dim Merge Commits', checked: ui.highlights.merges, action: toggleHl('merges') },
    '-',
    { label: 'Show Branches', checked: ui.leftVisible, action: () => setPaneVisible('left', !ui.leftVisible) },
    { label: 'Show Details', checked: ui.rightVisible, action: () => setPaneVisible('right', !ui.rightVisible) },
  ]);
}

// ---------- 全域鍵盤 ----------
table.element.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    const c = commits[table.selectedIndex];
    if (c) post({ type: 'copy', text: c.hash });
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

// ---------- 訊息 ----------
window.addEventListener('message', (ev: MessageEvent<ToWebview>) => {
  const m = ev.data;
  switch (m.type) {
    case 'repos': {
      const before = repos.map((r) => r.root).join('\n');
      repos = m.states;
      generation = m.generation;
      if (repos.length === 0) {
        commits = [];
        table.setData([], new MultiGraph(true));
        table.setMessage(m.message ?? 'No repository');
        branches.setRepos([]);
        details.renderEmpty('');
        setLoading(false);
        return;
      }
      if (before !== repos.map((r) => r.root).join('\n')) users = undefined;
      dirsByRoot.clear();
      dirsRequested.clear();
      // 移除已不存在的 repo 篩選
      const roots = new Set(repos.map((r) => r.root));
      if (ui.filter.roots.some((r) => !roots.has(r))) ui.filter = { ...ui.filter, roots: ui.filter.roots.filter((r) => roots.has(r)) };
      table.setRepos(repos);
      details.setRepos(repos);
      renderChips();
      // repo 清單沒變（只是 refs／HEAD 更新）時保留捲動位置
      loadLog(before === repos.map((r) => r.root).join('\n') && commits.length > 0);
      break;
    }
    case 'logBatch':
      onBatch(m);
      break;
    case 'logError':
      if (m.requestId === requestId) {
        setLoading(false);
        table.setMessage(m.message);
      }
      break;
    case 'details':
      {
        const c = commits[table.selectedIndex];
        if (c && m.details.hash === c.hash && m.details.root === repos[c.repo]?.root) details.setDetails(m.details);
      }
      break;
    case 'detailsError': {
      // 只處理目前選取 commit 的錯誤，避免較早的失敗請求蓋掉新的詳情
      const c = commits[table.selectedIndex];
      if (c && c.hash === m.hash && repos[c.repo]?.root === m.root) details.renderEmpty(m.message);
      break;
    }
    case 'containing':
      details.setContaining(m.root, m.hash, m.branches);
      break;
    case 'users':
      users = m.users;
      usersPicker?.refresh();
      break;
    case 'paths':
      dirsByRoot.set(m.root, m.paths);
      pathsPicker?.refresh();
      break;
    case 'applyFilter':
      if (m.filter.text !== undefined) searchInput.value = m.filter.text;
      setFilter(m.filter);
      break;
  }
});

post({ type: 'ready' });
