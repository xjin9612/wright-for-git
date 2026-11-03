// Webview 進入點：組合三欄、管理篩選與資料流
import { applyCollapse, findLinearRuns, type LinearRun } from '../shared/collapse';
import { MultiGraph } from '../shared/multiGraph';
import { EMPTY_FILTER, type BranchesEvent, type BranchesSync, type BranchPrefs, type CommitAction, type CommitInfo, type LogFilter, type RepoState, type SyncAction, type ToWebview, type UserInfo } from '../shared/protocol';
import { mergeRefs, type MergedRef } from '../shared/refs';
import { refMenuItems, runBranchToolbar, type BranchHost } from './branchActions';
import { BranchesPane, type BranchOptions } from './branchesPane';
import { DetailsPane, type FileGrouping } from './detailsPane';
import { clear, closeMenus, debounce, el, icon, iconButton, makeSplitter, MOD_KEY, showMenu, type MenuItem } from './dom';
import { LogTable, type ColumnWidths, type Columns, type Highlights, type LogRow } from './logTable';
import { showConfirm } from './confirmDialog';
import { setIssueLinkRules } from './issueLinks';
import { openPathsDialog, refreshPathsDialog } from './pathsDialog';
import { closePicker, openPicker, type PickerOption } from './valuePicker';
import { plural, t } from './l10n';
import { handleSettings } from './settingsPanel';
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
  /** 舊版設定：變更檔案以平鋪清單顯示（改由 fileGrouping 取代） */
  flatFiles?: boolean;
  /** 變更檔案的分組方式 */
  fileGrouping?: Partial<FileGrouping>;
  /** 額外的 Log 分頁（各自保留篩選）；第 0 個為主分頁 */
  tabs?: LogTab[];
  activeTab?: number;
  /** Branches 的分組與顯示選項 */
  branchOptions?: Partial<BranchOptions>;
  /** 多 repo 時左側顯示 repo 名稱欄 */
  repoNames?: boolean;
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
  highlights: { commitType: true, mine: false, merges: true, path: true, ...saved?.highlights },
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
  branchOptions: saved?.branchOptions,
  repoNames: saved?.repoNames,
  tabs: saved?.tabs,
  flatFiles: saved?.flatFiles,
  fileGrouping: saved?.fileGrouping,
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
/** 表格上顯示的列（收合時含收合列）；未收合時與 all 相同 */
let commits: LogRow[] = [];
/** key = `${repo}:${hash}` → commits 的索引 */
let keyIndex = new Map<string, number>();
let graph = new MultiGraph(true);
/** 載入的所有 commit（不含收合列） */
let all: CommitInfo[] = [];
let allKeyIndex = new Map<string, number>();
let graphAll = new MultiGraph(true);
/** 這次載入是否畫完整 graph（文字等篩選時為 false，不收合） */
let graphMode = true;
// 長線性分支折疊：collapseAll 為全部收合的模式；exceptions 為與模式相反的段落（收合模式下展開的、展開模式下收合的）
let collapseAll = false;
const exceptions = new Set<string>();
let runs: LinearRun[] = [];
/** `${repo}:${hash}`（可收的 commit）→ 所屬段落 */
let runByCommit = new Map<string, LinearRun>();
let requestId = 0;
/** extension 端 repos 清單的版本，loadLog 時帶回 */
let generation = 0;
/** 本次載入是否為「狀態更新後的重載」（保留捲動位置） */
let quietReload = false;
/** 開啟後的第一次載入：畫面從最上面開始，選取上次的 commit／HEAD 但不為它捲動（同 IntelliJ） */
let initialLoad = true;
let pendingSelect: string | undefined = ui.selectedHash?.includes('|') ? ui.selectedHash : undefined;
let users: UserInfo[] | undefined;
let usersPicker: { refresh: () => void } | undefined;
const dirsByRoot = new Map<string, string[]>();
const dirsRequested = new Set<string>();
/** 最近一次送給側邊欄 Branches 的內容（相同就不重送） */
let lastBranchesSync = '';
let branchesSyncTimer: ReturnType<typeof setTimeout> | undefined;
/** 沒有 repository 時的說明（側邊欄也顯示） */
let noRepoMessage: string | undefined;

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
/** Branches 的操作：Log 左欄直接處理；側邊欄的 Branches 也轉到這裡 */
const branchHost: BranchHost = {
  showInLog: (ref) => setFilter({ branches: [ref.name] }),
  showInNewTab: (ref) => openTab({ branches: [ref.name], roots: ui.filter.roots }),
  navigate: (ref) => navigateToRef(ref),
  isFavorite: (ref) => branches.isFavorite(ref),
  toggleFavorite: (ref) => branches.toggleFavorite(ref),
  visibleRepos: () => visibleRepos(),
};

const branches = new BranchesPane(
  {
    onSelect: (ref) => setFilter({ branches: [ref] }),
    onCheckout: (ref, roots) => post({ type: 'checkout', ref, roots }),
    onToolbarAction: (action, ref) => runBranchToolbar(action, ref, branchHost),
    onOptionsChange: (options) => {
      ui.branchOptions = options;
      persist();
      syncBranches();
    },
    onFetch: () => sync('fetch'),
    onContextMenu: (ref, x, y) => showMenu(x, y, refMenuItems(ref, branchHost)),
    onCollapsePane: () => setPaneVisible('left', false),
    onExpandedChange: (expanded) => {
      ui.expanded = expanded;
      persist();
      syncBranches();
    },
    onFavoritesChange: (favorites, onlyFavorites) => {
      ui.favorites = favorites;
      ui.onlyFavorites = onlyFavorites;
      persist();
      syncBranches();
    },
  },
  ui.expanded,
  ui.favorites,
  ui.onlyFavorites,
  ui.branchOptions,
);

const table = new LogTable(
  {
    onSelect: (i) => onCommitSelected(i),
    onMultiSelect: (indices) => onCommitsSelected(indices),
    onToggleCollapse: (i) => onToggleCollapse(i),
    canCollapse: (i) => {
      const c = commits[i];
      return !!c && !c.collapsed && runByCommit.has(`${c.repo}:${c.hash}`);
    },
    onRepoNamesChange: (show) => {
      ui.repoNames = show;
      persist();
    },
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
table.setRepoNames(!!ui.repoNames);

const details = new DetailsPane(
  {
    onOpenDiff: (root, file, hash, parent, files) => post({ type: 'openDiff', root, hash, parent, file, files }),
    onPickCommit: (root, hash) => {
      const idx = indexOf(repos.findIndex((r) => r.root === root), hash);
      if (idx !== undefined) table.select(idx, true, 'center');
    },
    onCopy: (text) => post({ type: 'copy', text }),
    onRequestContaining: (root, hash) => post({ type: 'containingBranches', root, hash }),
    onCollapsePane: () => setPaneVisible('right', false),
    onSplitChange: (ratio) => {
      ui.split = ratio;
      persist();
    },
    onGroupChange: (group) => {
      ui.fileGrouping = group;
      persist();
    },
  },
  ui.split,
  ui.fileGrouping ?? (ui.flatFiles ? { directory: false } : undefined),
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

const branchChip = filterChip('Branch', () => showBranchMenu(), () => setFilter({ branches: [] }));
const userChip = filterChip('User', () => openUserPicker(), () => setFilter({ users: [] }));
const pathsChip = filterChip('Paths', () => showPathsMenu(), () => setFilter({ paths: [], roots: [], pathsByRoot: undefined }));
const dateChip = filterChip('Date', () => openDatePicker(), () => setFilter({ since: undefined, until: undefined }));
const viewButton = iconButton('eye', t('View options'), () => showViewMenu());

/** 同步：作用於目前 Paths 篩選下可見的 repository */
const sync = (action: SyncAction) => post({ type: 'sync', action, roots: visibleRepos().map((r) => r.root) });
/** Push 一律先開對話框確認；upTo 為「Push All up to Here」 */
const openPush = (upTo?: { root: string; hash: string }) => post({ type: 'openPushPanel', roots: upTo ? [upTo.root] : visibleRepos().map((r) => r.root), upTo });
const syncGroup = el(
  'div',
  { className: 'toolbar-group' },
  iconButton('pull', t('Pull (uses your pull.rebase setting)'), () => sync('pull')),
  iconButton('push', t('Push…'), () => openPush()),
);
const progress = el('div', { className: 'progress' });
/** 目前 branch 不在 Branch 篩選中時的提示列（對應 IntelliJ 的「HEAD is not in filter」） */
const headHint = el('div', { className: 'log-hint hidden' });
/** 進行中的 rebase／merge／cherry-pick：繼續、略過、中止 */
const opBar = el('div', { className: 'log-ops hidden' });
const warningBar = el('div', { className: 'log-warning hidden' });

/** 部分 repo 讀取失敗時，在表格上方顯示提示（其餘 repo 照常顯示） */
function setWarnings(list: string[] | undefined): void {
  clear(warningBar);
  if (list && list.length > 0) warningBar.append(icon('warning'), el('span', { className: 'warning-text', text: list.join('  ·  ') }));
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
  iconButton('locate', t('Go to HEAD'), () => goToHead()),
  iconButton('refresh', t('Refresh'), () => post({ type: 'refresh' })),
  viewButton,
);

// ---------- Log 分頁 ----------
const tabStrip = el('div', { className: 'log-tabs hidden', attrs: { role: 'tablist' } });

function tabTitle(f: LogFilter): string {
  const parts: string[] = [];
  if (f.branches.length > 0) parts.push(f.branches.map(shortRefName).join(', '));
  if (f.users.length > 0) parts.push(f.users.join(', '));
  if (f.text.trim()) parts.push(`"${f.text.trim()}"`);
  if (f.paths.length > 0 || f.pathsByRoot || f.roots.length > 0) parts.push(pathsLabel());
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
    tabEl.addEventListener('keydown', (e) => {
      if (e.target !== tabEl) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchTab(i);
      } else if (e.key === 'Delete' && i > 0) {
        e.preventDefault();
        closeTab(i);
      }
    });
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

const logPane = el('div', { className: 'log-pane' }, tabStrip, filterBar, progress, opBar, headHint, warningBar, table.element);

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
const leftRestore = el('div', { className: 'pane-restore' }, iconButton('chevron-right', t('Show Branches'), () => setPaneVisible('left', true)));

/** 側邊欄的 Branches 顯示中：Log 收起自己的 Branches 欄（連同展開按鈕） */
let branchesDocked = false;

const app = document.getElementById('app')!;
app.className = 'workbench';
app.append(leftRestore, branches.element, leftSplitter, logPane, rightSplitter, details.element);
applyLayout();
renderChips();
renderTabs();
window.addEventListener('resize', () => applyLayout());

function applyLayout(): void {
  const cols: string[] = [];
  const leftVisible = ui.leftVisible && !branchesDocked;
  leftRestore.style.display = ui.leftVisible || branchesDocked ? 'none' : '';
  branches.element.style.display = leftVisible ? '' : 'none';
  leftSplitter.style.display = leftVisible ? '' : 'none';
  rightSplitter.style.display = ui.rightVisible ? '' : 'none';
  details.element.style.display = ui.rightVisible ? '' : 'none';
  // 視窗太窄時依比例縮小兩側欄，保留中欄至少 MIN_MIDDLE
  const MIN_MIDDLE = 420;
  let left = leftVisible ? ui.leftWidth : 0;
  let right = ui.rightVisible ? ui.rightWidth : 0;
  const leftChrome = leftVisible ? 4 : branchesDocked ? 0 : 22;
  const avail = window.innerWidth - MIN_MIDDLE - leftChrome - (ui.rightVisible ? 4 : 0);
  if (left + right > avail && left + right > 0) {
    const scale = Math.max(0, avail) / (left + right);
    left = leftVisible ? Math.max(140, Math.floor(left * scale)) : 0;
    right = ui.rightVisible ? Math.max(180, Math.floor(right * scale)) : 0;
  }
  if (leftVisible) cols.push(`${left}px 4px`);
  else if (!branchesDocked) cols.push('22px');
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

/**
 * 把 Branches 狀態送給側邊欄（同一輪的多次變更合併成一次）。
 * 側邊欄沒顯示時不送：大型 repo 的 refs 序列化成本不小；顯示時（branchesDocked）再補送一次完整狀態。
 */
function syncBranches(): void {
  clearTimeout(branchesSyncTimer);
  if (!branchesDocked) return;
  branchesSyncTimer = setTimeout(() => {
    const f = ui.filter;
    const sync: BranchesSync = {
      states: repos.length > 0 ? visibleRepos() : [],
      message: repos.length > 0 ? undefined : noRepoMessage,
      selected: f.branches.length === 1 ? f.branches[0] : undefined,
      prefs: branches.prefs(),
    };
    const json = JSON.stringify(sync);
    if (json === lastBranchesSync) return;
    lastBranchesSync = json;
    post({ type: 'branchesSync', sync });
  });
}

/** 側邊欄 Branches 的操作 */
function onBranchesEvent(ev: BranchesEvent): void {
  switch (ev.kind) {
    case 'select':
      setFilter({ branches: [ev.ref] });
      break;
    case 'newTab':
      openTab({ branches: [ev.ref], roots: ui.filter.roots });
      break;
    case 'navigate': {
      const ref = mergeRefs(visibleRepos()).find((r) => r.name === ev.ref);
      if (ref) navigateToRef(ref);
      break;
    }
    case 'prefs':
      applyBranchPrefs(ev.prefs);
      break;
  }
}

function applyBranchPrefs(p: BranchPrefs): void {
  ui.favorites = p.favorites;
  ui.onlyFavorites = p.onlyFavorites;
  ui.branchOptions = p.options;
  ui.expanded = p.expanded;
  persist();
  branches.setPrefs(p);
  syncBranches();
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
  const map = pathMap(f);
  const roots = f.roots.length > 0 ? f.roots : Object.keys(map);
  return roots
    .map((root) => {
      const name = repoName(root);
      const paths = map[root];
      return paths && paths.length > 0 ? `${name}/${paths.join(',')}` : name;
    })
    .join('|');
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
  syncBranches();
  renderHeadHint();
  renderOperations();
}

/** Log 上方的進行中操作列：rebase／merge 等的繼續、略過、中止，以及衝突數與「解決衝突…」 */
function renderOperations(): void {
  clear(opBar);
  // 進行中的操作，或沒有操作但有衝突（例如套用儲藏時的衝突）
  const active = repos.filter((r) => r.operation || r.conflicts);
  opBar.classList.toggle('hidden', active.length === 0);
  const names: Record<string, string> = { rebase: t('Rebase'), merge: t('Merge'), 'cherry-pick': t('Cherry-Pick'), revert: t('Revert') };
  for (const r of active) {
    const op = r.operation;
    const link = (label: string, onClick: () => void) => {
      const a = el('a', { className: 'link', text: label, attrs: { href: '#' } });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        onClick();
      });
      return a;
    };
    const opLink = (label: string, action: 'continue' | 'skip' | 'abort') => link(label, () => post({ type: 'operation', root: r.root, action, expected: op }));
    const count = r.conflicts ? plural(r.conflicts, '{0} conflict', '{0} conflicts') : '';
    const text = op ? [t('{0}: {1} in progress', r.name, names[op] ?? op), count].filter(Boolean).join(' · ') : `${r.name}: ${count}`;
    opBar.append(
      el(
        'div',
        { className: 'log-op' },
        icon('warning'),
        el('span', { text }),
        r.conflicts ? link(t('Resolve Conflicts…'), () => post({ type: 'openConflicts', root: r.root })) : null,
        op ? opLink(t('Continue'), 'continue') : null,
        op === 'rebase' || op === 'cherry-pick' ? opLink(t('Skip'), 'skip') : null,
        op ? opLink(t('Abort'), 'abort') : null,
      ),
    );
  }
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
  const names = [...new Set(visibleRepos().map((r) => r.head.branch ?? t('detached HEAD')))].join(', ');
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
  const cancel = el('button', { className: 'button secondary dialog-cancel', text: t('Cancel'), attrs: { type: 'button' } });
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
    window.removeEventListener('blur', onBlur);
  };
  const outside = (e: MouseEvent) => {
    if (!box.contains(e.target as Node)) close();
  };
  // 點到 webview 外（編輯器、其他 view）時收不到 mousedown：焦點真的離開 webview 才關閉（取消）。
  // 下一輪再確認 document.hasFocus()：日期欄位的日曆是瀏覽器內建的彈出視窗，開啟時若也觸發 blur，焦點仍在這個頁面，不關閉
  const onBlur = () =>
    setTimeout(() => {
      if (!document.hasFocus()) close();
    });
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
  window.addEventListener('blur', onBlur);
  from.focus();
}

/** Branch 篩選選單（對應 IntelliJ）：Select…、Favorites、我的最愛、本機 ▸、各遠端 ▸、標籤 ▸ */
function showBranchMenu(): void {
  const r = branchChip.element.getBoundingClientRect();
  const merged = mergeRefs(visibleRepos()).sort((a, b) => a.short.localeCompare(b.short, undefined, { numeric: true }));
  const current = new Set(ui.filter.branches);
  const item = (ref: MergedRef, label = ref.short): Exclude<MenuItem, '-'> => ({
    label,
    checked: current.has(ref.name),
    star: ref.type === 'tag' ? undefined : { on: branches.isFavorite(ref), toggle: () => (branches.toggleFavorite(ref), branches.isFavorite(ref)) },
    action: () => setFilter({ branches: [ref.name] }),
  });
  const favorites = merged.filter((x) => x.type !== 'tag' && branches.isFavorite(x));
  const locals = merged.filter((x) => x.type === 'local');
  const remotes = [...new Set(merged.filter((x) => x.type === 'remote').map((x) => x.remote ?? ''))];
  const tags = merged.filter((x) => x.type === 'tag');
  const head: MenuItem = { label: 'HEAD', checked: current.has('HEAD'), star: { on: true, toggle: () => true }, action: () => setFilter({ branches: ['HEAD'] }) };
  const items: MenuItem[] = [
    { label: t('Select…'), action: () => openBranchPicker() },
    { label: t('Favorites'), disabled: favorites.length === 0, action: () => setFilter({ branches: favorites.map((x) => x.name) }) },
    '-',
    head,
    ...favorites.map((x) => item(x)),
    '-',
  ];
  if (locals.length > 0) items.push({ label: t('Local'), submenu: locals.map((x) => item(x)) });
  for (const name of remotes) {
    const list = merged.filter((x) => x.type === 'remote' && x.remote === name);
    items.push({ label: `${name}/…`, submenu: list.map((x) => item(x, x.remoteBranch ?? x.short)) });
  }
  if (tags.length > 0) items.push({ label: t('Tags'), submenu: tags.map((x) => item(x)) });
  // 搜尋時攤平成一張清單：遠端分支顯示完整名稱，右側標示類型
  const search = (q: string): MenuItem[] => [
    ...('head'.includes(q) ? [head] : []),
    ...merged.filter((x) => x.short.toLowerCase().includes(q)).map((x) => ({ ...item(x), detail: t(x.type) })),
  ];
  showMenu(r.left, r.bottom + 2, items, { search: { placeholder: t('Search branches and tags'), items: search } });
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

/** 目前每個 repo 的路徑篩選（相容舊的 paths：單一 repo 時套用在該 repo） */
function pathMap(f: LogFilter = ui.filter): Record<string, string[]> {
  if (f.pathsByRoot) return f.pathsByRoot;
  if (f.paths.length === 0) return {};
  const root = f.roots.length === 1 ? f.roots[0] : repos.length === 1 ? repos[0].root : undefined;
  return root ? { [root]: f.paths } : {};
}

function requestDirs(root: string): string[] | undefined {
  const list = dirsByRoot.get(root);
  if (!list && !dirsRequested.has(root)) {
    dirsRequested.add(root);
    post({ type: 'requestPaths', root });
  }
  return list;
}

/**
 * Paths 篩選（對應 IntelliJ）：Select… 開資料夾樹；下方 Roots 為各儲存庫的勾選，
 * 點一下切換、Ctrl+點選只看這一個。
 */
function showPathsMenu(): void {
  const r = pathsChip.element.getBoundingClientRect();
  const all = repos.map((x) => x.root);
  const shown = () => new Set(ui.filter.roots.length > 0 ? ui.filter.roots : all);
  const applyRoots = (roots: string[]) => {
    const keep = pathMap();
    const next: Record<string, string[]> = {};
    for (const root of roots) if (keep[root]) next[root] = keep[root];
    const allShown = roots.length === all.length;
    setFilter({ roots: allShown ? [] : roots, paths: [], pathsByRoot: Object.keys(next).length > 0 ? next : undefined });
  };
  // 每次都重新產生（搜尋重建清單時勾選狀態才會是最新的）
  const repoItem = (repo: RepoState): MenuItem => ({
    label: repo.name,
    detail: repo.head.branch ?? t('detached'),
    checked: shown().has(repo.root),
    keepOpen: true,
    action: (e) => {
      if (e.ctrlKey || e.metaKey) {
        applyRoots([repo.root]);
        closeMenus();
        return true;
      }
      const set = shown();
      if (set.has(repo.root)) {
        if (set.size === 1) return true; // 至少保留一個
        set.delete(repo.root);
      } else set.add(repo.root);
      applyRoots(all.filter((x) => set.has(x)));
      return set.has(repo.root);
    },
  });
  const items: MenuItem[] = [
    { label: t('Select…'), action: () => openFoldersDialog() },
    { label: t('Show All Repositories'), action: () => applyRoots(all) },
    '-',
    { label: t('Roots'), disabled: true },
    ...repos.map(repoItem),
  ];
  const search = (q: string) => repos.filter((x) => `${x.name}\n${x.head.branch ?? ''}`.toLowerCase().includes(q)).map(repoItem);
  showMenu(r.left, r.bottom + 2, items, { search: { placeholder: t('Search repositories'), items: search }, hint: t('Ctrl+Click to show only that repository') });
}

function openFoldersDialog(): void {
  const map = pathMap();
  openPathsDialog({
    repos,
    initial: { roots: ui.filter.roots.length > 0 ? ui.filter.roots : Object.keys(map), pathsByRoot: map },
    dirsOf: (root) => requestDirs(root),
    onApply: (sel) => {
      const allRoots = sel.roots.length === 0 || (sel.roots.length === repos.length && Object.keys(sel.pathsByRoot).length === 0);
      setFilter({ roots: allRoots ? [] : sel.roots, paths: [], pathsByRoot: Object.keys(sel.pathsByRoot).length > 0 ? sel.pathsByRoot : undefined });
    },
  });
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
    // 焦點在裡面的清除按鈕時，Enter／空白鍵交給清除按鈕
    if (e.target !== element) return;
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
  all = [];
  allKeyIndex = new Map();
  graphAll = new MultiGraph(true);
  commits = all;
  keyIndex = allKeyIndex;
  graph = graphAll;
  runs = [];
  runByCommit = new Map();
  table.clearSelection();
  table.setData(commits, graph);
  branches.setRepos(visibleRepos());
  syncBranches();
  table.setMessage(undefined);
  setLoading(true);
  post({ type: 'loadLog', requestId, generation, filter: ui.filter });
}

function setLoading(v: boolean): void {
  progress.classList.toggle('active', v);
}

function onBatch(m: Extract<ToWebview, { type: 'logBatch' }>): void {
  if (m.requestId !== requestId) return;
  if (all.length === 0 && graphAll.length === 0) {
    graphAll = new MultiGraph(m.graph);
    graphMode = m.graph;
  }
  const fresh = m.commits.filter((c) => !allKeyIndex.has(`${c.repo}:${c.hash}`));
  for (const c of fresh) {
    allKeyIndex.set(`${c.repo}:${c.hash}`, all.length);
    all.push(c);
  }
  graphAll.add(fresh);
  refreshView();

  if (pendingSelect) {
    const [root, hash] = pendingSelect.split('|');
    const repoIdx = repos.findIndex((r) => r.root === root);
    const idx = indexOf(repoIdx, hash);
    if (idx !== undefined) {
      pendingSelect = undefined;
      table.select(idx, true, quietReload || initialLoad ? 'none' : 'center');
    }
  }

  if (m.done) {
    setLoading(false);
    table.releaseScroll();
    setWarnings(m.warnings);
    if (commits.length === 0) {
      table.setMessage(hasActiveFilter() ? t('No commits matching filters') : t('No commits'), hasActiveFilter() ? { label: t('Clear filters'), run: () => clearAllFilters() } : undefined);
      details.renderEmpty(t('No commit selected'));
    } else if (table.selectedIndex < 0) {
      pendingSelect = undefined;
      // 預設選取最上方的 HEAD（多 repo 時為最近有動的 repo）
      table.select(headIndex() ?? 0, true, initialLoad ? 'none' : 'center');
    }
    initialLoad = false;
  }
}

/** 目前顯示的 repo 中，最上方的 HEAD 所在列（多 repo 時為最近有動的 repo） */
function headIndex(): number | undefined {
  let headIdx: number | undefined;
  for (const st of visibleRepos()) {
    const idx = st.head.hash ? indexOf(repos.indexOf(st), st.head.hash) : undefined;
    if (idx !== undefined && (headIdx === undefined || idx < headIdx)) headIdx = idx;
  }
  return headIdx;
}

/** 選取 HEAD 並捲到畫面中間 */
function goToHead(): void {
  const idx = headIndex();
  if (idx === undefined) {
    setWarnings([t('{0} is not in the current log (check the filters).', 'HEAD')]);
    return;
  }
  table.select(idx, true, 'center');
  table.focus();
}

// ---------- 長線性分支折疊 ----------

/** 依收合狀態重算表格上的列；只在畫完整 graph 時收合 */
function refreshView(): void {
  runs = graphMode && all.length > 0 ? findLinearRuns(all, headsOf(), labeledCommits()) : [];
  runByCommit = new Map(runs.flatMap((r) => r.hidden.map((h) => [`${r.repo}:${h}`, r] as const)));
  const isCollapsed = (r: LinearRun) => collapseAll !== exceptions.has(r.key);
  const before = commits[table.selectedIndex];
  if (!runs.some(isCollapsed)) {
    commits = all;
    keyIndex = allKeyIndex;
    graph = graphAll;
    table.setData(commits, graph);
  } else {
    const { view, graphParents } = applyCollapse<LogRow>(all, runs, isCollapsed, (run, first) => ({
      ...first,
      hash: `collapsed:${run.key}`,
      parents: [run.last],
      subject: '',
      collapsed: { key: run.key, count: run.hidden.length, last: run.last },
    }));
    commits = view;
    keyIndex = new Map(view.map((c, i) => [`${c.repo}:${c.hash}`, i]));
    graph = new MultiGraph(true);
    graph.add(view.map((c) => ({ ...c, parents: graphParents.get(`${c.repo}:${c.hash}`) ?? c.parents })));
    table.setData(commits, graph, graphParents);
  }
  // 保留選取：選取的 commit 被收起來時改選它所在的收合列
  if (before && table.selectedIndex >= 0) {
    const idx = keyIndex.get(`${before.repo}:${before.hash}`) ?? collapsedIndexOf(before.repo, before.hash);
    if (idx !== undefined && idx !== table.selectedIndex) table.select(idx, false, 'none');
  }
}

/** 各 repo 的 HEAD（主線不收） */
function headsOf(): Map<number, string | undefined> {
  return new Map(repos.map((r, i) => [i, r.head.hash]));
}

/** 有分支或 tag 標籤的 commit（不收） */
function labeledCommits(): Set<string> {
  return new Set(repos.flatMap((r, i) => r.refs.map((ref) => `${i}:${ref.hash}`)));
}

/** commit 所在的收合列索引（沒有被收起來時為 undefined） */
function collapsedIndexOf(repo: number, hash: string): number | undefined {
  const run = runByCommit.get(`${repo}:${hash}`);
  return run ? keyIndex.get(`${run.repo}:collapsed:${run.key}`) : undefined;
}

/** commit 在表格上的索引；被收起來時展開那一段（搜尋、跳到 commit、還原選取） */
function indexOf(repo: number, hash: string): number | undefined {
  const k = `${repo}:${hash}`;
  const idx = keyIndex.get(k);
  if (idx !== undefined) return idx;
  const run = runByCommit.get(k);
  if (!run || collapsedIndexOf(repo, hash) === undefined) return undefined;
  toggleRun(run.key);
  return keyIndex.get(k);
}

/** 展開或收合一段 */
function toggleRun(key: string): void {
  if (exceptions.has(key)) exceptions.delete(key);
  else exceptions.add(key);
  refreshView();
}

function setCollapseAll(on: boolean): void {
  collapseAll = on;
  exceptions.clear();
  refreshView();
}

/** 點收合列（展開）或點可收合 commit 的分支線（收合） */
function onToggleCollapse(index: number): void {
  const c = commits[index];
  if (!c) return;
  const key = c.collapsed?.key ?? runByCommit.get(`${c.repo}:${c.hash}`)?.key;
  if (!key) return;
  toggleRun(key);
  // 展開後選取那一段原本的第一筆；收合後選取收合列
  const run = runs.find((r) => r.key === key);
  const idx = run && (keyIndex.get(`${run.repo}:${run.hidden[0]}`) ?? keyIndex.get(`${run.repo}:collapsed:${run.key}`));
  if (idx !== undefined) table.select(idx, true, 'nearest');
  table.focus();
}

/** 清除所有篩選（沒有符合的 commit 時的「清除篩選」） */
function clearAllFilters(): void {
  searchInput.value = '';
  applyText.cancel();
  setFilter({ text: '', users: [], branches: [], paths: [], roots: [], pathsByRoot: undefined, since: undefined, until: undefined });
}

function hasActiveFilter(): boolean {
  const f = ui.filter;
  return f.text.trim() !== '' || f.users.length > 0 || f.branches.length > 0 || f.paths.length > 0 || !!f.pathsByRoot || f.roots.length > 0 || !!f.since || !!f.until;
}

const requestDetails = debounce((root: string, hash: string) => post({ type: 'selectCommit', root, hash }), 60);

let multiRequest = 0;

/** 多選：右欄顯示選取 commit 的合併變更 */
function onCommitsSelected(indices: number[]): void {
  requestDetails.cancel();
  const list = indices.map((i) => commits[i]).filter((c): c is LogRow => !!c && !c.collapsed && !!repos[c.repo]);
  details.showMulti(list.map((c) => ({ root: repos[c.repo].root, hash: c.hash, subject: c.subject, author: c.author, authorTime: c.authorTime })));
  multiRequest++;
  post({ type: 'selectCommits', requestId: multiRequest, items: list.map((c) => ({ root: repos[c.repo].root, hash: c.hash, parents: c.parents })) });
}

function onCommitSelected(index: number): void {
  const c = commits[index];
  const root = c && repos[c.repo]?.root;
  if (!c || !root) return;
  if (c.collapsed) {
    requestDetails.cancel();
    details.renderEmpty(plural(c.collapsed.count, '{0} commit is collapsed. Click the row or press Enter to expand it.', '{0} commits are collapsed. Click the row or press Enter to expand them.'));
    return;
  }
  ui.selectedHash = selectionKey(c);
  persist();
  details.showLoading();
  requestDetails(root, c.hash);
}

// ---------- 選單 ----------
function showContextMenu(index: number, x: number, y: number): void {
  const selected = table.selectedIndices.map((i) => commits[i]).filter((c): c is LogRow => !!c && !c.collapsed);
  if (selected.length > 1) {
    showMultiMenu(selected, x, y);
    return;
  }
  const c = commits[index];
  const root = c && repos[c.repo]?.root;
  if (!c || !root) return;
  if (c.collapsed) {
    showMenu(x, y, [{ label: t('Expand Linear Branch'), keybinding: 'Enter', action: () => onToggleCollapse(index) }]);
    return;
  }
  const run = runByCommit.get(`${c.repo}:${c.hash}`);
  const act = (action: CommitAction) => () => post({ type: 'commitAction', action, root, hash: c.hash, parents: c.parents, subject: c.subject });
  showMenu(x, y, [
    { label: t('Copy Revision Number'), keybinding: `${MOD_KEY}C`, action: () => post({ type: 'copy', text: c.hash }) },
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
    { label: t('Interactively Rebase from Here…'), action: () => post({ type: 'openRebase', root, hash: c.hash }) },
    '-',
    { label: t('Compare with Local'), action: act('compareLocal') },
    // 在可收合的段落中：收起這一段分支
    ...(run ? (['-', { label: t('Collapse Linear Branch'), action: () => onToggleCollapse(index) }] as MenuItem[]) : []),
  ]);
}

/** 多選時的右鍵選單：複製、依序 cherry-pick／revert（限同一個 repo） */
function showMultiMenu(selected: CommitInfo[], x: number, y: number): void {
  const sameRepo = selected.every((c) => c.repo === selected[0].repo);
  const root = repos[selected[0].repo]?.root;
  // 依列順序為新到舊；cherry-pick 由舊到新套用，revert 由新到舊
  const items = (order: CommitInfo[]) => order.map((c) => ({ hash: c.hash, parents: c.parents, subject: c.subject }));
  showMenu(x, y, [
    { label: t('Copy {0} Revision Numbers', selected.length), keybinding: `${MOD_KEY}C`, action: () => post({ type: 'copy', text: selected.map((c) => c.hash).join('\n') }) },
    { label: t('Copy Subjects'), action: () => post({ type: 'copy', text: selected.map((c) => c.subject).join('\n') }) },
    '-',
    { label: t('Cherry-Pick {0} Commits', selected.length), disabled: !sameRepo, action: () => void (root && post({ type: 'commitsAction', action: 'cherryPick', root, commits: items([...selected].reverse()) })) },
    { label: t('Revert {0} Commits', selected.length), disabled: !sameRepo, action: () => void (root && post({ type: 'commitsAction', action: 'revert', root, commits: items(selected) })) },
  ]);
}

/** 在記錄中選取分支的最新 commit（不改變篩選）；目前篩選下看不到時提示 */
function navigateToRef(ref: MergedRef): void {
  for (const root of ref.roots) {
    const repoIdx = repos.findIndex((r) => r.root === root);
    const hash = repos[repoIdx]?.refs.find((r) => r.name === ref.name)?.hash;
    const idx = hash ? indexOf(repoIdx, hash) : undefined;
    if (idx !== undefined) {
      table.select(idx, true, 'center');
      table.focus();
      return;
    }
  }
  setWarnings([t('{0} is not in the current log (check the filters).', ref.short)]);
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
    { label: t('Highlight Path of Selected Commit'), checked: !!ui.highlights.path, action: toggleHl('path') },
    '-',
    // 長線性分支折疊（只在畫完整 graph 時有效；文字、作者等篩選時 graph 已簡化）
    { label: t('Collapse Linear Branches'), disabled: !graphMode, action: () => setCollapseAll(true) },
    { label: t('Expand Linear Branches'), disabled: !graphMode, action: () => setCollapseAll(false) },
    '-',
    { label: t('New Log Tab'), action: () => openTab({}) },
    '-',
    // 側邊欄顯示 Branches 時，Log 的 Branches 欄固定收起
    { label: t('Show Branches'), checked: ui.leftVisible && !branchesDocked, disabled: branchesDocked, action: () => setPaneVisible('left', !ui.leftVisible) },
    { label: t('Show Details'), checked: ui.rightVisible, action: () => setPaneVisible('right', !ui.rightVisible) },
  ]);
}

// ---------- 全域鍵盤 ----------
table.element.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    // 多選時複製全部選取列的 hash（依列順序，與右鍵「Copy N Revision Numbers」相同）
    const hashes = table.selectedIndices.map((i) => commits[i]).filter((c): c is LogRow => !!c && !c.collapsed).map((c) => c.hash);
    if (hashes.length > 0) post({ type: 'copy', text: hashes.join('\n') });
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
    case 'settings':
      handleSettings(m);
      break;
    case 'repos': {
      const before = repos.map((r) => r.root).join('\n');
      repos = m.states;
      generation = m.generation;
      setIssueLinkRules(m.issueLinks);
      noRepoMessage = m.message ?? t('No repository');
      if (repos.length === 0) {
        // 讓還在路上的 logBatch 失效（它的 repo 索引已不存在）
        requestId++;
        commits = [];
        all = [];
        allKeyIndex = new Map();
        keyIndex = allKeyIndex;
        graphAll = new MultiGraph(true);
        graph = graphAll;
        runs = [];
        runByCommit = new Map();
        table.setData([], new MultiGraph(true));
        table.setMessage(m.message ?? t('No repository'));
        branches.setRepos([]);
        syncBranches();
        details.renderEmpty('');
        setLoading(false);
        return;
      }
      if (before !== repos.map((r) => r.root).join('\n')) users = undefined;
      dirsByRoot.clear();
      dirsRequested.clear();
      // 移除已不存在的 repo 篩選（每個 Log 分頁都要清，切換分頁或重新載入後才不會帶回來）
      const roots = new Set(repos.map((r) => r.root));
      const prune = (f: LogFilter): LogFilter => {
        let next = f;
        if (next.roots.some((r) => !roots.has(r))) next = { ...next, roots: next.roots.filter((r) => roots.has(r)) };
        if (next.pathsByRoot && Object.keys(next.pathsByRoot).some((r) => !roots.has(r))) {
          const kept = Object.fromEntries(Object.entries(next.pathsByRoot).filter(([r]) => roots.has(r)));
          next = { ...next, pathsByRoot: Object.keys(kept).length > 0 ? kept : undefined };
        }
        return next;
      };
      const pruned = ui.tabs!.map((tab) => ({ filter: prune(tab.filter) }));
      if (pruned.some((tab, i) => tab.filter !== ui.tabs![i].filter)) {
        ui.tabs = pruned;
        ui.filter = pruned[ui.activeTab!].filter;
        persist();
      }
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
    case 'logGraph':
      if (m.requestId === requestId) {
        // 以簡化後的 parent 重建 graph；commit 本身的 parents 保留（右鍵操作與 diff 需要真正的 parent）
        const map = new Map(m.parents.map(([repo, hash, ps]) => [`${repo}:${hash}`, ps]));
        graph = new MultiGraph(true);
        graph.add(commits.map((c) => ({ ...c, parents: map.get(`${c.repo}:${c.hash}`) ?? [] })));
        graphAll = graph;
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
      refreshPathsDialog();
      break;
    case 'confirm':
      showConfirm(m);
      break;
    case 'branchesEvent':
      onBranchesEvent(m.event);
      break;
    case 'branchesDocked':
      branchesDocked = m.docked;
      applyLayout();
      if (m.docked) {
        // 沒顯示期間的變更都沒送：清掉比對基準，強制補送一次
        lastBranchesSync = '';
        syncBranches();
      }
      break;
    case 'applyFilter':
      if (m.filter.text !== undefined) searchInput.value = m.filter.text;
      // 由 extension 指定 roots／paths（側邊欄、顯示 Git 歷史）時，取代 Select… 的跨 repo 路徑
      setFilter('paths' in m.filter || 'roots' in m.filter ? { pathsByRoot: undefined, ...m.filter } : m.filter);
      break;
  }
});

// 找 repo、讀取各 repo 狀態期間（收到第一個 repos 之前）顯示提示文字，大型工作區可能要好幾秒。
// 這段期間的進度條由 extension 以 VS Code 的 view 進度顯示（面板分頁上也有轉圈），這裡不再顯示自己的進度條以免兩條重疊
table.setMessage(t('Loading repositories…'));
post({ type: 'ready' });
