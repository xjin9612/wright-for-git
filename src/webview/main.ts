// Webview 進入點：組合三欄、管理篩選與資料流
import { MultiGraph } from '../shared/multiGraph';
import { EMPTY_FILTER, type CommitAction, type CommitInfo, type LogFilter, type RefAction, type RepoState, type SyncAction, type ToWebview, type UserInfo } from '../shared/protocol';
import { mergeRefs, type MergedRef } from '../shared/refs';
import { BranchesPane } from './branchesPane';
import { DetailsPane } from './detailsPane';
import { clear, debounce, el, icon, iconButton, makeSplitter, showMenu, type MenuItem } from './dom';
import { LogTable, type ColumnWidths, type Columns, type Highlights } from './logTable';
import { showConfirm } from './confirmDialog';
import { handlePushMessage, openPushDialog } from './pushDialog';
import { closePicker, openPicker, type PickerOption } from './valuePicker';
import { t } from './l10n';
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
  /** Branches 的我的最愛（完整 ref 名稱）；未設定時預設為 main／master */
  favorites?: string[];
  onlyFavorites?: boolean;
  /** Author／Date／Hash 欄寬 */
  widths?: Partial<ColumnWidths>;
  /** 變更檔案以平鋪清單顯示 */
  flatFiles?: boolean;
  /** 額外的 Log 分頁（各自保留篩選）；第 0 個為主分頁 */
  tabs?: LogTab[];
  activeTab?: number;
  /** 選取的 commit：`${root}|${hash}` */
  selectedHash?: string;
}

interface LogTab {
  filter: LogFilter;
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
  favorites: saved?.favorites,
  onlyFavorites: saved?.onlyFavorites,
  widths: saved?.widths,
  tabs: saved?.tabs,
  flatFiles: saved?.flatFiles,
  activeTab: saved?.activeTab,
};
// 分頁：第 0 個為主分頁，ui.filter 永遠是目前分頁的篩選
if (!ui.tabs || ui.tabs.length === 0) ui.tabs = [{ filter: ui.filter }];
ui.activeTab = Math.min(Math.max(0, ui.activeTab ?? 0), ui.tabs.length - 1);
ui.tabs = ui.tabs.map((tab) => ({ filter: { ...EMPTY_FILTER, ...tab.filter } }));
ui.filter = ui.tabs[ui.activeTab].filter;
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
let openPushWhenReady = false;

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
    onFetch: () => sync('fetch'),
    onContextMenu: (ref, x, y) => showRefMenu(ref, x, y),
    onCollapsePane: () => setPaneVisible('left', false),
    onExpandedChange: (expanded) => {
      ui.expanded = expanded;
      persist();
    },
    onFavoritesChange: (favorites, onlyFavorites) => {
      ui.favorites = favorites;
      ui.onlyFavorites = onlyFavorites;
      persist();
    },
  },
  ui.expanded,
  ui.favorites,
  ui.onlyFavorites,
);

const table = new LogTable(
  {
    onSelect: (i) => onCommitSelected(i),
    onMultiSelect: (indices) => onCommitsSelected(indices),
    onColumnWidths: (w) => {
      ui.widths = w;
      persist();
    },
    onContextMenu: (i, x, y) => showContextMenu(i, x, y),
  },
  ui.columns,
  ui.highlights,
);

table.setColumnWidths(ui.widths);

const details = new DetailsPane(
  {
    onOpenDiff: (root, file, hash, parent, files) => post({ type: 'openDiff', root, hash, parent, file, files }),
    onPickCommit: (root, hash) => {
      const idx = keyIndex.get(`${repos.findIndex((r) => r.root === root)}:${hash}`);
      if (idx !== undefined) table.select(idx, true, 'center');
    },
    onCopy: (text) => post({ type: 'copy', text }),
    onRequestContaining: (root, hash) => post({ type: 'containingBranches', root, hash }),
    onCollapsePane: () => setPaneVisible('right', false),
    onSplitChange: (ratio) => {
      ui.split = ratio;
      persist();
    },
    onFlatChange: (flat) => {
      ui.flatFiles = flat;
      persist();
    },
  },
  ui.split,
  ui.flatFiles,
);

// ---------- 篩選列 ----------
const searchInput = el('input', { className: 'text-input', attrs: { type: 'text', placeholder: t('Text or hash'), spellcheck: 'false', 'aria-label': t('Text or hash') } });
searchInput.value = ui.filter.text;
const regexToggle = toggleButton('.*', t('Regex'), () => ui.filter.regex, (v) => setFilter({ regex: v }));
const caseToggle = toggleButton('Cc', t('Match case'), () => ui.filter.matchCase, (v) => setFilter({ matchCase: v }));
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
const dateChip = filterChip('Date', () => openDatePicker(), () => setFilter({ since: undefined, until: undefined }));
const viewButton = iconButton('eye', t('View options'), () => showViewMenu());

/** 同步：作用於目前 Paths 篩選下可見的 repository */
const sync = (action: SyncAction) => post({ type: 'sync', action, roots: visibleRepos().map((r) => r.root) });
/** Push 一律先開對話框確認；upTo 為「Push All up to Here」 */
const openPush = (upTo?: { root: string; hash: string }, branch?: { name: string; roots: string[] }) =>
  openPushDialog({
    roots: upTo ? [upTo.root] : (branch?.roots ?? visibleRepos().map((r) => r.root)),
    branch: branch?.name,
    upTo,
    onOpenDiff: (root, hash, parent, file) => post({ type: 'openDiff', root, hash, parent, file }),
  });
const syncGroup = el(
  'div',
  { className: 'toolbar-group' },
  iconButton('pull', t('Pull (uses your pull.rebase setting)'), () => sync('pull')),
  iconButton('push', t('Push…'), () => openPush()),
);
const progress = el('div', { className: 'progress' });
/** 目前 branch 不在 Branch 篩選中時的提示列（對應 IntelliJ 的「HEAD is not in filter」） */
const headHint = el('div', { className: 'log-hint hidden' });
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
  dateChip.element,
  el('div', { className: 'toolbar-spacer' }),
  syncGroup,
  el('div', { className: 'toolbar-divider' }),
  iconButton('refresh', 'Refresh', () => post({ type: 'refresh' })),
  viewButton,
);

// ---------- Log 分頁 ----------
const tabStrip = el('div', { className: 'log-tabs hidden', attrs: { role: 'tablist' } });

function tabTitle(f: LogFilter): string {
  const parts: string[] = [];
  if (f.branches.length > 0) parts.push(f.branches.map(shortRefName).join(', '));
  if (f.users.length > 0) parts.push(f.users.join(', '));
  if (f.text.trim()) parts.push(`"${f.text.trim()}"`);
  if (f.paths.length > 0 || f.roots.length > 0) parts.push(pathsLabel());
  if (f.since || f.until) parts.push(dateLabel());
  return parts.join(' · ') || t('All');
}

function renderTabs(): void {
  const tabs = ui.tabs!;
  tabStrip.classList.toggle('hidden', tabs.length <= 1);
  clear(tabStrip);
  if (tabs.length <= 1) return;
  tabs.forEach((tab, i) => {
    const title = i === 0 ? t('Log') : `${t('Log')}: ${tabTitle(tab.filter)}`;
    const tabEl = el('div', { className: `log-tab${i === ui.activeTab ? ' active' : ''}`, title, attrs: { role: 'tab', 'aria-selected': String(i === ui.activeTab), tabindex: '0' } }, el('span', { className: 'log-tab-title', text: title }));
    if (i > 0) tabEl.append(iconButton('close', t('Close tab'), () => closeTab(i), 'tab-close'));
    tabEl.addEventListener('click', () => switchTab(i));
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1 && i > 0) closeTab(i);
    });
    tabStrip.append(tabEl);
  });
}

function switchTab(i: number): void {
  if (i === ui.activeTab || !ui.tabs![i]) return;
  ui.activeTab = i;
  ui.filter = ui.tabs![i].filter;
  searchInput.value = ui.filter.text;
  persist();
  renderTabs();
  renderChips();
  loadLog();
}

/** 新分頁：預設沿用 patch 套在空白篩選上（例如從 Branches 開啟某個 branch） */
function openTab(filter: Partial<LogFilter>): void {
  ui.tabs!.push({ filter: { ...EMPTY_FILTER, ...filter } });
  switchTab(ui.tabs!.length - 1);
}

function closeTab(i: number): void {
  if (i === 0) return;
  const wasActive = ui.activeTab === i;
  ui.tabs!.splice(i, 1);
  if (wasActive) {
    // 關閉目前分頁：切到左邊的分頁（強制重新載入）
    ui.activeTab = -1;
    switchTab(i - 1);
    return;
  }
  if (ui.activeTab! > i) ui.activeTab!--;
  persist();
  renderTabs();
}

const logPane = el('div', { className: 'log-pane' }, tabStrip, filterBar, progress, headHint, warningBar, table.element);

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
renderTabs();
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
  ui.tabs![ui.activeTab!] = { filter: next };
  renderTabs();
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
  dateChip.set(dateLabel());
  regexToggle.sync();
  caseToggle.sync();
  branches.setSelectedRef(f.branches.length === 1 ? f.branches[0] : undefined);
  renderHeadHint();
}

/** Branch 篩選有值、但沒有包含 HEAD 或任一可見 repo 的目前 branch 時，提示並提供一鍵加入 */
function renderHeadHint(): void {
  const f = ui.filter;
  const current = visibleRepos()
    .map((r) => r.head.branch)
    .filter((b): b is string => !!b)
    .map((b) => `refs/heads/${b}`);
  const missing = f.branches.length > 0 && !f.branches.includes('HEAD') && !current.some((c) => f.branches.includes(c));
  clear(headHint);
  headHint.classList.toggle('hidden', !missing);
  if (!missing) return;
  const names = [...new Set(visibleRepos().map((r) => r.head.branch ?? 'detached HEAD'))].join(', ');
  const add = el('a', { className: 'link', text: t('Show HEAD'), attrs: { href: '#' } });
  add.addEventListener('click', (e) => {
    e.preventDefault();
    setFilter({ branches: [...f.branches, 'HEAD'] });
  });
  const all = el('a', { className: 'link', text: t('Show all branches'), attrs: { href: '#' } });
  all.addEventListener('click', (e) => {
    e.preventDefault();
    setFilter({ branches: [] });
  });
  headHint.append(icon('head'), el('span', { text: t('The current branch ({0}) is not in the filter.', names) }), add, all);
}

const DATE_PRESETS: { label: string; since: string }[] = [
  { label: 'Last 24 hours', since: '1.day.ago' },
  { label: 'Last 7 days', since: '7.days.ago' },
  { label: 'Last 30 days', since: '30.days.ago' },
  { label: 'Last 90 days', since: '90.days.ago' },
  { label: 'Last year', since: '1.year.ago' },
];

/** 自訂區間的值：since 為當天 00:00，until 為當天 23:59:59 */
const dayOf = (v: string | undefined) => v?.slice(0, 10) ?? '';

function dateLabel(): string {
  const { since, until } = ui.filter;
  if (!since && !until) return '';
  const preset = !until && DATE_PRESETS.find((p) => p.since === since);
  if (preset) return t(preset.label);
  if (since && until) return `${dayOf(since)} – ${dayOf(until)}`;
  return since ? t('since {0}', dayOf(since)) : t('until {0}', dayOf(until));
}

function openDatePicker(): void {
  const r = dateChip.element.getBoundingClientRect();
  const { since, until } = ui.filter;
  showMenu(r.left, r.bottom + 2, [
    ...DATE_PRESETS.map((p) => ({ label: t(p.label), checked: !until && since === p.since, action: () => setFilter({ since: p.since, until: undefined }) })),
    '-',
    { label: t('Select Period…'), checked: !!until || (!!since && !DATE_PRESETS.some((p) => p.since === since)), action: () => openDateRange() },
  ]);
}

/** 自訂日期區間的小視窗（兩個日期欄位） */
function openDateRange(): void {
  document.querySelector('.date-range')?.remove();
  const r = dateChip.element.getBoundingClientRect();
  const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}/.test(v);
  const from = el('input', { className: 'text-input', attrs: { type: 'date', 'aria-label': t('From') } });
  const to = el('input', { className: 'text-input', attrs: { type: 'date', 'aria-label': t('To') } });
  if (isDay(ui.filter.since)) from.value = dayOf(ui.filter.since);
  if (isDay(ui.filter.until)) to.value = dayOf(ui.filter.until);
  const apply = el('button', { className: 'button primary', text: t('Apply'), attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button secondary', text: t('Cancel'), attrs: { type: 'button' } });
  const box = el(
    'div',
    { className: 'date-range context-menu', attrs: { role: 'dialog', 'aria-label': t('Select period') } },
    el('label', { className: 'date-field' }, el('span', { text: t('From') }), from),
    el('label', { className: 'date-field' }, el('span', { text: t('To') }), to),
    el('div', { className: 'date-actions' }, cancel, apply),
  );
  const close = () => {
    box.remove();
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = (e: MouseEvent) => {
    if (!box.contains(e.target as Node)) close();
  };
  apply.addEventListener('click', () => {
    let [a, b] = [from.value, to.value];
    if (a && b && a > b) [a, b] = [b, a];
    close();
    setFilter({ since: a ? `${a} 00:00:00` : undefined, until: b ? `${b} 23:59:59` : undefined });
  });
  cancel.addEventListener('click', close);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') apply.click();
  });
  document.body.append(box);
  box.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - box.offsetWidth - 4))}px`;
  box.style.top = `${r.bottom + 2}px`;
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  from.focus();
}

function openBranchPicker(): void {
  openPicker({
    anchor: branchChip.element,
    values: ui.filter.branches.map(shortRefName),
    options: () => {
      const vis = visibleRepos();
      const opts: PickerOption[] = [{ value: 'HEAD', detail: vis.length === 1 ? (vis[0].head.branch ?? t('detached')) : t('current branch') }];
      const merged = mergeRefs(vis);
      for (const type of ['local', 'remote', 'tag'] as const) {
        for (const r of merged) if (r.type === type) opts.push({ value: r.short, detail: vis.length > 1 ? `${t(type)} · ${r.roots.length}/${vis.length}` : t(type) });
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
        opts.push({ value: r.name, icon: 'repo', detail: r.head.branch ?? t('detached') });
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

function filterChip(key: string, onOpen: () => void, onClear: () => void) {
  const name = t(key);
  const label = el('span', { className: 'chip-label' });
  const value = el('span', { className: 'chip-value' });
  const caret = icon('chevron-down', 'chip-caret');
  const clearBtn = iconButton('close', t('Clear {0} filter', name), onClear, 'chip-clear');
  const element = el('div', { className: 'chip', attrs: { role: 'button', tabindex: '0', title: t('Filter by {0}', name) } }, label, value, caret, clearBtn);
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
      element.title = v ? `${name}: ${v}` : t('Filter by {0}', name);
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
      table.setMessage(hasActiveFilter() ? t('No commits matching filters') : t('No commits'));
      details.renderEmpty(t('No commit selected'));
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
  return f.text.trim() !== '' || f.users.length > 0 || f.branches.length > 0 || f.paths.length > 0 || f.roots.length > 0 || !!f.since || !!f.until;
}

const requestDetails = debounce((root: string, hash: string) => post({ type: 'selectCommit', root, hash }), 60);

let multiRequest = 0;

/** 多選：右欄顯示選取 commit 的合併變更 */
function onCommitsSelected(indices: number[]): void {
  requestDetails.cancel();
  const list = indices.map((i) => commits[i]).filter((c): c is CommitInfo => !!c && !!repos[c.repo]);
  details.showMulti(list.map((c) => ({ root: repos[c.repo].root, hash: c.hash, subject: c.subject, author: c.author, authorTime: c.authorTime })));
  multiRequest++;
  post({ type: 'selectCommits', requestId: multiRequest, items: list.map((c) => ({ root: repos[c.repo].root, hash: c.hash, parents: c.parents })) });
}

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
function showContextMenu(index: number, x: number, y: number): void {
  const selected = table.selectedIndices.map((i) => commits[i]).filter((c): c is CommitInfo => !!c);
  if (selected.length > 1) {
    showMultiMenu(selected, x, y);
    return;
  }
  const c = commits[index];
  const root = c && repos[c.repo]?.root;
  if (!c || !root) return;
  const act = (action: CommitAction) => () => post({ type: 'commitAction', action, root, hash: c.hash, parents: c.parents, subject: c.subject });
  showMenu(x, y, [
    { label: t('Copy Revision Number'), action: () => post({ type: 'copy', text: c.hash }) },
    { label: t('Copy Subject'), action: () => post({ type: 'copy', text: c.subject }) },
    '-',
    { label: t('Checkout Revision…'), action: () => post({ type: 'checkoutRevision', root, hash: c.hash }) },
    { label: t('New Branch…'), action: act('newBranch') },
    { label: t('New Tag…'), action: act('newTag') },
    '-',
    { label: t('Cherry-Pick'), action: act('cherryPick') },
    { label: t('Revert Commit'), action: act('revert') },
    { label: t('Reset Current Branch to Here…'), action: act('reset') },
    { label: t('Push All up to Here…'), action: () => openPush({ root, hash: c.hash }) },
    '-',
    { label: t('Compare with Local'), action: act('compareLocal') },
  ]);
}

/** 多選時的右鍵選單：複製、依序 cherry-pick／revert（限同一個 repo） */
function showMultiMenu(selected: CommitInfo[], x: number, y: number): void {
  const sameRepo = selected.every((c) => c.repo === selected[0].repo);
  const root = repos[selected[0].repo]?.root;
  // 依列順序為新到舊；cherry-pick 由舊到新套用，revert 由新到舊
  const items = (order: CommitInfo[]) => order.map((c) => ({ hash: c.hash, parents: c.parents, subject: c.subject }));
  showMenu(x, y, [
    { label: t('Copy {0} Revision Numbers', selected.length), action: () => post({ type: 'copy', text: selected.map((c) => c.hash).join('\n') }) },
    { label: t('Copy Subjects'), action: () => post({ type: 'copy', text: selected.map((c) => c.subject).join('\n') }) },
    '-',
    { label: t('Cherry-Pick {0} Commits', selected.length), disabled: !sameRepo, action: () => root && post({ type: 'commitsAction', action: 'cherryPick', root, commits: items([...selected].reverse()) }) },
    { label: t('Revert {0} Commits', selected.length), disabled: !sameRepo, action: () => root && post({ type: 'commitsAction', action: 'revert', root, commits: items(selected) }) },
  ]);
}

/** Branches 右鍵選單（對應 IntelliJ 的 branch 選單；同名 branch 跨 repo 一次處理） */
function showRefMenu(ref: MergedRef, x: number, y: number): void {
  const act = (action: RefAction) => () => post({ type: 'refAction', action, ref: ref.name, roots: ref.roots });
  const name = ref.short;
  const q = `'${name.length > 40 ? `${name.slice(0, 39)}…` : name}'`;
  const isLocal = ref.type === 'local';
  const current = isLocal && ref.current;
  const items: MenuItem[] = [
    { label: t('Checkout'), disabled: current, action: () => post({ type: 'checkout', ref: ref.name, roots: ref.roots }) },
    { label: t('New Branch from {0}…', q), action: act('newBranch') },
    { label: t('Compare with Current'), disabled: current, action: act('compare') },
    { label: t('Show in Log'), action: () => setFilter({ branches: [ref.name] }) },
    { label: t('Show in New Tab'), action: () => openTab({ branches: [ref.name], roots: ui.filter.roots }) },
    '-',
    { label: t('Merge {0} into Current', q), disabled: current, action: act('merge') },
  ];
  if (ref.type !== 'tag') items.push({ label: t('Rebase Current onto {0}', q), disabled: current, action: act('rebase') });
  if (ref.type !== 'tag') {
    const fav = branches.isFavorite(ref);
    items.push('-', { label: fav ? t('Remove from Favorites') : t('Add to Favorites'), action: () => branches.toggleFavorite(ref) });
  }
  if (isLocal) {
    items.push(
      '-',
      { label: t('Update'), disabled: !ref.upstream, action: act('update') },
      { label: t('Push…'), action: () => openPush(undefined, { name: ref.short, roots: ref.roots }) },
      '-',
      { label: t('Rename…'), action: act('rename') },
      { label: t('Delete'), disabled: current, action: act('delete') },
    );
  } else if (ref.type === 'remote') {
    items.push('-', { label: t('Delete'), action: act('delete') });
  } else {
    items.push('-', { label: t('Push Tag…'), action: act('pushTag') }, { label: t('Delete'), action: act('delete') });
  }
  showMenu(x, y, items);
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
    { label: t('Show Author'), checked: ui.columns.author, action: toggleCol('author') },
    { label: t('Show Date'), checked: ui.columns.date, action: toggleCol('date') },
    { label: t('Show Hash'), checked: ui.columns.hash, action: toggleCol('hash') },
    '-',
    { label: t('Highlight Commit Type'), checked: ui.highlights.commitType, action: toggleHl('commitType') },
    { label: t('Highlight My Commits'), checked: ui.highlights.mine, action: toggleHl('mine') },
    { label: t('Dim Merge Commits'), checked: ui.highlights.merges, action: toggleHl('merges') },
    '-',
    { label: t('New Log Tab'), action: () => openTab({}) },
    '-',
    { label: t('Show Branches'), checked: ui.leftVisible, action: () => setPaneVisible('left', !ui.leftVisible) },
    { label: t('Show Details'), checked: ui.rightVisible, action: () => setPaneVisible('right', !ui.rightVisible) },
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
        table.setMessage(m.message ?? t('No repository'));
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
      if (openPushWhenReady) {
        openPushWhenReady = false;
        openPush();
      }
      // repo 清單沒變（只是 refs／HEAD 更新）時保留捲動位置
      loadLog(before === repos.map((r) => r.root).join('\n') && commits.length > 0);
      break;
    }
    case 'logBatch':
      onBatch(m);
      break;
    case 'logGraph':
      if (m.requestId === requestId) {
        // 以簡化後的 parent 重建 graph；commit 本身的 parents 保留（右鍵操作與 diff 需要真正的 parent）
        const map = new Map(m.parents.map(([repo, hash, ps]) => [`${repo}:${hash}`, ps]));
        graph = new MultiGraph(true);
        graph.add(commits.map((c) => ({ ...c, parents: map.get(`${c.repo}:${c.hash}`) ?? [] })));
        table.setData(commits, graph);
      }
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
    case 'multiDetails':
      if (m.requestId === multiRequest) details.setMultiFiles(m.groups);
      break;
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
    case 'pushPreview':
    case 'pushCommitFiles':
    case 'pushStatus':
      handlePushMessage(m);
      break;
    case 'confirm':
      showConfirm(m);
      break;
    case 'openPush':
      // repos 還沒到（webview 剛建立）時，等 repos 訊息後再開
      if (repos.length > 0) openPush();
      else openPushWhenReady = true;
      break;
    case 'applyFilter':
      if (m.filter.text !== undefined) searchInput.value = m.filter.text;
      setFilter(m.filter);
      break;
  }
});

post({ type: 'ready' });
