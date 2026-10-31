// 提交視窗（側邊欄）：「提交｜儲藏」兩個分頁，對應 IntelliJ 的 Commit 工具視窗
import type { CommitState, StashInfo, ToWebview, WorkingChange } from '../shared/protocol';
import { showConfirm } from './confirmDialog';
import { clear, el, formatDate, icon, iconButton, showMenu, type MenuItem } from './dom';
import { fileIcon } from './fileIcons';
import { plural, t } from './l10n';
import { loadState, post, saveState } from './vscodeApi';

type Change = WorkingChange & { module?: string };
type Section = 'list' | 'unversioned' | 'ignored' | 'conflicts';

interface Persisted {
  tab: 'commit' | 'stash';
  message: string;
  amend: boolean;
  signOff: boolean;
  noVerify: boolean;
  groupDirectory: boolean;
  groupRepository: boolean;
  groupModule: boolean;
  showIgnored: boolean;
  collapsed: string[];
  /** 使用者明確勾選／取消的檔案 */
  explicit: [string, boolean][];
  split: number;
}

const saved = loadState<Persisted>();
const ui: Persisted = {
  tab: saved?.tab ?? 'commit',
  message: saved?.message ?? '',
  amend: false,
  signOff: saved?.signOff ?? false,
  noVerify: saved?.noVerify ?? false,
  groupDirectory: saved?.groupDirectory ?? true,
  groupRepository: saved?.groupRepository ?? true,
  groupModule: saved?.groupModule ?? false,
  showIgnored: saved?.showIgnored ?? false,
  collapsed: saved?.collapsed ?? [],
  explicit: saved?.explicit ?? [],
  split: saved?.split ?? 0.5,
};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState({ ...ui, explicit: [...explicit] }), 200);
};

let state: CommitState | undefined;
const explicit = new Map<string, boolean>(ui.explicit);
const collapsed = new Set<string>(ui.collapsed);
const selected = new Set<string>();
let focusKey: string | undefined;
/** amend 前的草稿訊息（取消 amend 時還原） */
let draftBeforeAmend: string | undefined;
let commitRequest = 0;
let busy = false;

const keyOf = (root: string, p: string) => `${root}\0${p}`;

// ---------- 結構 ----------
const app = document.getElementById('app')!;
app.className = 'commit-app';
const tabCommit = el('button', { className: 'commit-tab', text: t('Commit'), attrs: { type: 'button', role: 'tab' } });
const tabStash = el('button', { className: 'commit-tab', text: t('Stash'), attrs: { type: 'button', role: 'tab' } });
tabCommit.addEventListener('click', () => setTab('commit'));
tabStash.addEventListener('click', () => setTab('stash'));
const commitPane = el('div', { className: 'commit-pane' });
const stashPane = el('div', { className: 'commit-pane stash-pane' });
app.append(el('div', { className: 'commit-tabs', attrs: { role: 'tablist' } }, tabCommit, tabStash), commitPane, stashPane);

function setTab(tab: 'commit' | 'stash'): void {
  ui.tab = tab;
  persist();
  tabCommit.classList.toggle('active', tab === 'commit');
  tabStash.classList.toggle('active', tab === 'stash');
  commitPane.classList.toggle('hidden', tab !== 'commit');
  stashPane.classList.toggle('hidden', tab !== 'stash');
  if (tab === 'stash') stash.load();
}

// ---------- 提交分頁 ----------
const tree = el('div', { className: 'tree commit-tree', attrs: { tabindex: '0', role: 'tree' } });
const viewButton = iconButton('eye', t('View options'), () => showViewMenu());
const toolbar = el(
  'div',
  { className: 'pane-toolbar commit-toolbar' },
  iconButton('refresh', t('Refresh'), () => post({ type: 'commitRefresh', showIgnored: ui.showIgnored })),
  iconButton('rollback', t('Rollback…'), () => rollback(selectedChanges())),
  iconButton('diff', t('Show Diff'), () => openDiff()),
  iconButton('add', t('New Changelist…'), () => post({ type: 'changelistNew' })),
  viewButton,
  el('div', { className: 'toolbar-spacer' }),
  iconButton('expand-all', t('Expand all'), () => {
    collapsed.clear();
    persistCollapsed();
    render();
  }),
  iconButton('collapse-all', t('Collapse all'), () => {
    for (const r of rows) if (r.expandable) collapsed.add(r.key);
    persistCollapsed();
    render();
  }),
);

const amendBox = el('input', { attrs: { type: 'checkbox', id: 'commit-amend' } });
amendBox.checked = ui.amend;
const message = el('textarea', { className: 'commit-message', attrs: { placeholder: t('Commit Message'), spellcheck: 'true', 'aria-label': t('Commit Message') } });
message.value = ui.message;
const commitButton = el('button', { className: 'button primary', text: t('Commit'), attrs: { type: 'button' } });
const commitPushButton = el('button', { className: 'button secondary', text: t('Commit and Push…'), attrs: { type: 'button' } });
const optionsButton = iconButton('gear', t('Commit options'), () => showCommitOptions());
const summary = el('span', { className: 'commit-summary muted' });
const bottom = el(
  'div',
  { className: 'commit-bottom' },
  el('div', { className: 'commit-amend-row' }, el('label', { className: 'push-option', attrs: { for: 'commit-amend' } }, amendBox, t('Amend last commit')), el('div', { className: 'toolbar-spacer' }), summary),
  message,
  el('div', { className: 'commit-actions' }, commitButton, commitPushButton, el('div', { className: 'toolbar-spacer' }), optionsButton),
);
const splitter = el('div', { className: 'splitter splitter-horizontal' });
commitPane.append(toolbar, tree, splitter, bottom);
applySplit();

splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  splitter.setPointerCapture(e.pointerId);
  const total = commitPane.getBoundingClientRect().height;
  const start = e.clientY;
  const startH = tree.getBoundingClientRect().height;
  const move = (ev: PointerEvent) => {
    ui.split = Math.min(0.85, Math.max(0.2, (startH + ev.clientY - start) / total));
    applySplit();
  };
  const up = () => {
    splitter.removeEventListener('pointermove', move);
    splitter.removeEventListener('pointerup', up);
    persist();
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
});

function applySplit(): void {
  tree.style.flex = `${ui.split} 1 0`;
  bottom.style.flex = `${1 - ui.split} 1 0`;
}

message.addEventListener('input', () => {
  ui.message = message.value;
  persist();
  syncButtons();
});
message.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doCommit(false);
  }
});
amendBox.addEventListener('change', () => {
  ui.amend = amendBox.checked;
  if (ui.amend) {
    draftBeforeAmend = message.value;
    const root = includedByRepo()[0]?.root ?? state?.repos[0]?.root;
    if (root && !message.value.trim()) post({ type: 'commitLastMessage', root });
  } else if (draftBeforeAmend !== undefined) {
    message.value = draftBeforeAmend;
    ui.message = message.value;
    draftBeforeAmend = undefined;
  }
  persist();
  syncButtons();
});
commitButton.addEventListener('click', () => doCommit(false));
commitPushButton.addEventListener('click', () => doCommit(true));

function showViewMenu(): void {
  const r = viewButton.getBoundingClientRect();
  const toggle = (k: 'groupDirectory' | 'groupRepository' | 'groupModule') => ({
    keepOpen: true,
    action: () => {
      ui[k] = !ui[k];
      persist();
      render();
      return ui[k];
    },
  });
  showMenu(r.left, r.bottom + 2, [
    { label: t('Group By'), disabled: true },
    { label: t('Directory'), checked: ui.groupDirectory, ...toggle('groupDirectory') },
    { label: t('Repository'), checked: ui.groupRepository, disabled: (state?.repos.length ?? 0) < 2, ...toggle('groupRepository') },
    { label: t('Module'), checked: ui.groupModule, ...toggle('groupModule') },
    '-',
    { label: t('Show'), disabled: true },
    {
      label: t('Ignored Files'),
      checked: ui.showIgnored,
      keepOpen: true,
      action: () => {
        ui.showIgnored = !ui.showIgnored;
        persist();
        post({ type: 'commitRefresh', showIgnored: ui.showIgnored });
        return ui.showIgnored;
      },
    },
  ]);
}

function showCommitOptions(): void {
  const r = optionsButton.getBoundingClientRect();
  showMenu(r.left - 180, r.top - 70, [
    {
      label: t('Sign-off commit'),
      checked: ui.signOff,
      keepOpen: true,
      action: () => {
        ui.signOff = !ui.signOff;
        persist();
        return ui.signOff;
      },
    },
    {
      label: t('Skip Git hooks (--no-verify)'),
      checked: ui.noVerify,
      keepOpen: true,
      action: () => {
        ui.noVerify = !ui.noVerify;
        persist();
        return ui.noVerify;
      },
    },
  ]);
}

// ---------- 樹 ----------
interface Row {
  key: string;
  label: string;
  depth: number;
  kind: 'section' | 'group' | 'file';
  section: Section;
  /** section／群組底下的所有檔案 */
  files: { root: string; change: Change }[];
  change?: Change;
  root?: string;
  listId?: string;
  expandable: boolean;
  expanded: boolean;
  icon?: 'repo' | 'folder' | 'module';
  detail?: string;
}
let rows: Row[] = [];

function sectionOf(c: Change): Section {
  if (c.kind === 'untracked') return 'unversioned';
  if (c.kind === 'ignored') return 'ignored';
  if (c.kind === 'conflict') return 'conflicts';
  return 'list';
}

function listOf(root: string, c: Change): string {
  return state?.assign[keyOf(root, c.path)] ?? state?.activeList ?? 'default';
}

/** 是否勾選要提交 */
function isIncluded(root: string, c: Change): boolean {
  if (c.kind === 'ignored') return false;
  const k = keyOf(root, c.path);
  const v = explicit.get(k);
  if (v !== undefined) return v;
  // 預設：使用中 changelist 的變更勾選；未追蹤檔案不勾選（與 IntelliJ 相同）
  return c.kind === 'changed' && listOf(root, c) === state?.activeList;
}

function buildRows(): Row[] {
  const out: Row[] = [];
  if (!state) return out;
  const multi = state.repos.length > 1;
  const all = state.repos.flatMap((r) => r.changes.map((change) => ({ root: r.root, change })));
  const isOpen = (key: string) => !collapsed.has(key);

  const addFiles = (files: { root: string; change: Change }[], depth: number, prefix: string, section: Section) => {
    const byRepo = ui.groupRepository && multi;
    const groups = byRepo ? state!.repos.map((r) => ({ root: r.root, name: r.name, files: files.filter((f) => f.root === r.root) })).filter((g) => g.files.length > 0) : [{ root: '', name: '', files }];
    for (const g of groups) {
      let d = depth;
      let p = prefix;
      if (byRepo) {
        const key = `${prefix}/repo:${g.root}`;
        const open = isOpen(key);
        const repo = state!.repos.find((r) => r.root === g.root);
        out.push({ key, label: g.name, depth: d, kind: 'group', section, files: g.files, expandable: true, expanded: open, icon: 'repo', detail: repo?.branch });
        if (!open) continue;
        d++;
        p = key;
      }
      if (ui.groupModule) {
        const modules = new Map<string, { root: string; change: Change }[]>();
        for (const f of g.files) {
          const m = f.change.module === undefined ? '\0none' : `${f.root}\0${f.change.module}`;
          modules.set(m, [...(modules.get(m) ?? []), f]);
        }
        for (const [m, list] of [...modules].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (m === '\0none') {
            addDirs(list, d, `${p}/nomodule`, section);
            continue;
          }
          const modPath = m.slice(m.indexOf('\0') + 1);
          const key = `${p}/module:${m}`;
          const open = isOpen(key);
          const repoName = state!.repos.find((r) => r.root === list[0].root)?.name ?? '';
          out.push({ key, label: modPath ? modPath.slice(modPath.lastIndexOf('/') + 1) : repoName, depth: d, kind: 'group', section, files: list, expandable: true, expanded: open, icon: 'module', detail: modPath || undefined });
          // 模組內的路徑改為相對模組
          if (open) addDirs(list, d + 1, key, section, modPath);
        }
      } else {
        addDirs(g.files, d, p, section);
      }
    }
  };

  /** 依目錄分組（壓縮單一子目錄）或平鋪 */
  const addDirs = (files: { root: string; change: Change }[], depth: number, prefix: string, section: Section, base = '') => {
    const rel = (f: { change: Change }) => (base && f.change.path.startsWith(`${base}/`) ? f.change.path.slice(base.length + 1) : f.change.path);
    const sorted = [...files].sort((a, b) => rel(a).localeCompare(rel(b), undefined, { numeric: true }));
    if (!ui.groupDirectory) {
      for (const f of sorted) out.push(fileRow(f, depth, section, true));
      return;
    }
    interface Dir {
      name: string;
      dirs: Map<string, Dir>;
      files: { root: string; change: Change }[];
    }
    const top: Dir = { name: '', dirs: new Map(), files: [] };
    for (const f of sorted) {
      const parts = rel(f).replace(/\/$/, '').split('/');
      let node = top;
      for (const part of parts.slice(0, -1)) {
        let next = node.dirs.get(part);
        if (!next) {
          next = { name: part, dirs: new Map(), files: [] };
          node.dirs.set(part, next);
        }
        node = next;
      }
      node.files.push(f);
    }
    const allFiles = (d: Dir): { root: string; change: Change }[] => [...d.files, ...[...d.dirs.values()].flatMap(allFiles)];
    const walk = (node: Dir, depth: number, path: string) => {
      for (const child of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
        // 壓縮只有單一子目錄的路徑（a/b/c）
        let d = child;
        let name = child.name;
        while (d.files.length === 0 && d.dirs.size === 1) {
          d = [...d.dirs.values()][0];
          name = `${name}/${d.name}`;
        }
        const key = `${prefix}/dir:${path}${name}`;
        const open = isOpen(key);
        const files = allFiles(d);
        out.push({ key, label: name, depth, kind: 'group', section, files, expandable: true, expanded: open, icon: 'folder' });
        if (open) walk(d, depth + 1, `${path}${name}/`);
      }
      for (const f of node.files) out.push(fileRow(f, depth, section, false));
    };
    walk(top, depth, '');
  };

  const fileRow = (f: { root: string; change: Change }, depth: number, section: Section, showDir: boolean): Row => {
    const p = f.change.path.replace(/\/$/, '');
    const name = p.slice(p.lastIndexOf('/') + 1) + (f.change.path.endsWith('/') ? '/' : '');
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const repoName = multi && !ui.groupRepository ? state!.repos.find((r) => r.root === f.root)?.name : undefined;
    const detail = [showDir ? dir : '', f.change.oldPath ? `← ${f.change.oldPath}` : '', repoName ?? ''].filter(Boolean).join('  ');
    return { key: keyOf(f.root, f.change.path), label: name, depth, kind: 'file', section, files: [f], change: f.change, root: f.root, expandable: false, expanded: false, detail };
  };

  const section = (key: string, label: string, section: Section, files: { root: string; change: Change }[], listId?: string, always = false) => {
    if (files.length === 0 && !always) return;
    const open = isOpen(key);
    out.push({ key, label, depth: 0, kind: 'section', section, files, listId, expandable: true, expanded: open });
    if (open) addFiles(files, 1, key, section);
  };

  for (const list of state.changelists) {
    const files = all.filter((f) => sectionOf(f.change) === 'list' && listOf(f.root, f.change) === list.id);
    const name = list.id === 'default' && list.name === 'Changes' ? t('Changes') : list.name;
    section(`list:${list.id}`, name, 'list', files, list.id, state.changelists.length === 1 || list.id === state.activeList);
  }
  section('conflicts', t('Merge Conflicts'), 'conflicts', all.filter((f) => f.change.kind === 'conflict'));
  section('unversioned', t('Unversioned Files'), 'unversioned', all.filter((f) => f.change.kind === 'untracked'));
  if (state.showIgnored) section('ignored', t('Ignored Files'), 'ignored', all.filter((f) => f.change.kind === 'ignored'));
  return out;
}

function checkState(files: { root: string; change: Change }[]): 'all' | 'some' | 'none' {
  const eligible = files.filter((f) => f.change.kind !== 'ignored');
  if (eligible.length === 0) return 'none';
  let on = 0;
  let partial = false;
  for (const f of eligible) {
    if (isIncluded(f.root, f.change)) {
      on++;
      if (state?.partial[keyOf(f.root, f.change.path)]) partial = true;
    }
  }
  if (on === 0) return 'none';
  return on === eligible.length && !partial ? 'all' : 'some';
}

function setIncluded(files: { root: string; change: Change }[], value: boolean): void {
  const cleared: string[] = [];
  for (const f of files) {
    if (f.change.kind === 'ignored') continue;
    const k = keyOf(f.root, f.change.path);
    explicit.set(k, value);
    if (state?.partial[k]) cleared.push(k);
  }
  // 勾選框直接切換時，取消逐段選取（改回整個檔案）
  if (cleared.length > 0) post({ type: 'commitClearPartial', keys: cleared });
  persist();
  render();
}

function render(): void {
  rows = buildRows();
  const scroll = tree.scrollTop;
  clear(tree);
  if (!state) {
    tree.append(el('div', { className: 'empty-text', text: t('Loading…') }));
    return;
  }
  if (rows.length === 0 || rows.every((r) => r.kind === 'section' && r.files.length === 0)) {
    tree.append(el('div', { className: 'empty-text', text: t('No local changes') }));
  }
  const frag = document.createDocumentFragment();
  for (const r of rows) frag.append(renderRow(r));
  tree.append(frag);
  tree.scrollTop = scroll;
  syncButtons();
}

function renderRow(r: Row): HTMLElement {
  const twisty = r.expandable ? icon(r.expanded ? 'chevron-down' : 'chevron-right', 'twisty') : el('span', { className: 'twisty' });
  let box: HTMLInputElement | null = null;
  if (r.section !== 'ignored') {
    box = el('input', { className: 'commit-check', attrs: { type: 'checkbox', 'aria-label': r.label } });
    const st = r.kind === 'file' ? (isIncluded(r.root!, r.change!) ? (state?.partial[r.key] ? 'some' : 'all') : 'none') : checkState(r.files);
    box.checked = st === 'all';
    box.indeterminate = st === 'some';
    if (r.section === 'conflicts') box.disabled = true;
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      setIncluded(r.files, st !== 'all');
    });
  }
  let iconEl: HTMLElement;
  if (r.kind === 'file') iconEl = fileIcon(r.change!.path);
  else if (r.kind === 'section') iconEl = icon(r.section === 'list' ? 'changelist' : r.section === 'unversioned' ? 'file' : 'folder');
  else iconEl = icon(r.icon === 'module' ? 'module' : r.icon === 'repo' ? 'repo' : 'folder');

  const isActive = r.kind === 'section' && r.listId !== undefined && r.listId === state?.activeList && (state?.changelists.length ?? 0) > 1;
  const label = el('span', { className: `tree-label${r.change ? ` status-${r.change.status}` : ''}${r.kind === 'section' ? ' commit-section' : ''}${isActive ? ' active-list' : ''}`, text: r.label });
  const partial = r.kind === 'file' ? state?.partial[r.key] : undefined;
  const count = r.kind !== 'file' ? el('span', { className: 'tree-count', text: plural(r.files.length, '{0} file', '{0} files') }) : null;
  const div = el(
    'div',
    { className: `tree-row${selected.has(r.key) ? ' selected' : ''}${focusKey === r.key ? ' focused' : ''}`, attrs: { role: 'treeitem', 'data-key': r.key } },
    twisty,
    box,
    iconEl,
    label,
    r.detail ? el('span', { className: 'tree-count', text: r.detail }) : null,
    partial ? el('span', { className: 'commit-partial', text: t('{0}/{1} changes', partial.selected, partial.total) }) : null,
    count,
  );
  div.style.paddingLeft = `${4 + r.depth * 14}px`;
  if (r.change) div.title = `${r.change.path}${r.change.oldPath ? `\n← ${r.change.oldPath}` : ''}`;
  twisty.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(r);
  });
  // 用 click 而非 mousedown 選取：mousedown 時重繪會讓勾選框、展開箭頭收不到 click
  div.addEventListener('click', (e) => select(r, e.ctrlKey || e.metaKey, e.shiftKey));
  div.addEventListener('dblclick', () => {
    if (r.kind === 'file') openDiff(r);
    else toggle(r);
  });
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!selected.has(r.key)) select(r, false, false);
    showRowMenu(r, e.clientX, e.clientY);
  });
  return div;
}

function toggle(r: Row): void {
  if (!r.expandable) return;
  if (collapsed.has(r.key)) collapsed.delete(r.key);
  else collapsed.add(r.key);
  persistCollapsed();
  render();
}

function persistCollapsed(): void {
  ui.collapsed = [...collapsed];
  persist();
}

function select(r: Row, add: boolean, range: boolean): void {
  if (range && focusKey) {
    const a = rows.findIndex((x) => x.key === focusKey);
    const b = rows.findIndex((x) => x.key === r.key);
    if (!add) selected.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selected.add(rows[i].key);
  } else if (add) {
    if (selected.has(r.key)) selected.delete(r.key);
    else selected.add(r.key);
  } else {
    selected.clear();
    selected.add(r.key);
  }
  focusKey = r.key;
  render();
  tree.focus();
}

/** 選取的列對應的檔案（群組列代表底下所有檔案） */
function selectedChanges(): { root: string; change: Change }[] {
  const seen = new Set<string>();
  const out: { root: string; change: Change }[] = [];
  for (const r of rows) {
    if (!selected.has(r.key)) continue;
    for (const f of r.files) {
      const k = keyOf(f.root, f.change.path);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
  }
  return out;
}

function openDiff(r?: Row): void {
  const row = r ?? rows.find((x) => x.key === focusKey && x.kind === 'file');
  if (row?.change && row.root) post({ type: 'commitDiff', root: row.root, change: row.change });
}

function rollback(items: { root: string; change: Change }[]): void {
  if (items.length === 0) return;
  post({ type: 'commitRollback', items });
}

function showRowMenu(r: Row, x: number, y: number): void {
  const items = selectedChanges();
  const keys = items.map((f) => keyOf(f.root, f.change.path));
  const single = items.length === 1 ? items[0] : undefined;
  const tracked = items.filter((f) => f.change.kind === 'changed' || f.change.kind === 'conflict');
  const untracked = items.filter((f) => f.change.kind === 'untracked');
  const lists = state?.changelists ?? [];
  const menu: MenuItem[] = [];
  if (r.kind === 'section' && r.listId) {
    const id = r.listId;
    menu.push(
      { label: t('Set Active Changelist'), disabled: id === state?.activeList, action: () => post({ type: 'changelistActivate', id }) },
      { label: t('Rename Changelist…'), action: () => post({ type: 'changelistRename', id }) },
      { label: t('Delete Changelist'), disabled: lists.length <= 1, action: () => post({ type: 'changelistDelete', id }) },
      { label: t('New Changelist…'), action: () => post({ type: 'changelistNew' }) },
      '-',
    );
  }
  menu.push(
    { label: t('Show Diff'), disabled: !single || single.change.kind === 'ignored', action: () => single && post({ type: 'commitDiff', root: single.root, change: single.change }) },
    { label: t('Open File'), disabled: !single || single.change.status === 'D', action: () => single && post({ type: 'commitOpenFile', root: single.root, path: single.change.path }) },
    {
      label: t('Select Changes to Commit…'),
      disabled: !single || single.change.kind !== 'changed' || single.change.status !== 'M',
      action: () => {
        if (!single) return;
        explicit.set(keyOf(single.root, single.change.path), true);
        persist();
        post({ type: 'commitHunks', root: single.root, path: single.change.path });
      },
    },
    { label: t('Commit Whole File'), disabled: !keys.some((k) => state?.partial[k]), action: () => post({ type: 'commitClearPartial', keys }) },
    '-',
    { label: t('Rollback…'), disabled: tracked.length === 0, action: () => rollback(tracked) },
    {
      label: t('Move to Another Changelist…'),
      disabled: tracked.length === 0,
      submenu: [
        ...lists.map((l): MenuItem => ({ label: l.id === 'default' && l.name === 'Changes' ? t('Changes') : l.name, action: () => post({ type: 'changelistMove', keys: tracked.map((f) => keyOf(f.root, f.change.path)), id: l.id }) })),
        '-',
        { label: t('New Changelist…'), action: () => post({ type: 'changelistNew', keys: tracked.map((f) => keyOf(f.root, f.change.path)) }) },
      ],
    },
    {
      label: t('Add to .gitignore'),
      disabled: untracked.length === 0,
      action: () => {
        const byRoot = new Map<string, string[]>();
        for (const f of untracked) byRoot.set(f.root, [...(byRoot.get(f.root) ?? []), f.change.path]);
        for (const [root, paths] of byRoot) post({ type: 'commitAddIgnore', root, paths });
      },
    },
    '-',
    { label: t('Copy Path'), disabled: items.length === 0, action: () => post({ type: 'copy', text: items.map((f) => f.change.path).join('\n') }) },
  );
  showMenu(x, y, menu);
}

tree.addEventListener('keydown', (e) => {
  const idx = rows.findIndex((r) => r.key === focusKey);
  const row = rows[idx];
  const move = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (r) select(r, false, e.shiftKey);
    tree.querySelector('.tree-row.focused')?.scrollIntoView({ block: 'nearest' });
  };
  switch (e.key) {
    case 'ArrowDown':
      move(idx + 1);
      break;
    case 'ArrowUp':
      move(idx - 1);
      break;
    case 'ArrowRight':
      if (row?.expandable && !row.expanded) toggle(row);
      else move(idx + 1);
      break;
    case 'ArrowLeft':
      if (row?.expandable && row.expanded) toggle(row);
      break;
    case ' ':
      if (row) {
        const files = selectedChanges();
        setIncluded(files.length > 0 ? files : row.files, checkState(files.length > 0 ? files : row.files) !== 'all');
      }
      break;
    case 'Enter':
      if (row?.kind === 'file') openDiff(row);
      else if (row) toggle(row);
      break;
    default:
      return;
  }
  e.preventDefault();
});

/** 各 repo 勾選要提交的變更 */
function includedByRepo(): { root: string; changes: Change[] }[] {
  if (!state) return [];
  return state.repos
    .map((r) => ({ root: r.root, changes: r.changes.filter((c) => c.kind !== 'ignored' && isIncluded(r.root, c)) }))
    .filter((x) => x.changes.length > 0);
}

function syncButtons(): void {
  const items = includedByRepo();
  const files = items.reduce((n, x) => n + x.changes.length, 0);
  summary.textContent = files > 0 ? plural(files, '{0} file selected', '{0} files selected') : '';
  const can = !busy && (files > 0 || ui.amend) && message.value.trim() !== '';
  commitButton.disabled = !can;
  commitPushButton.disabled = !can;
  commitButton.textContent = ui.amend ? t('Amend Commit') : t('Commit');
  commitPushButton.textContent = ui.amend ? t('Amend Commit and Push…') : t('Commit and Push…');
}

function doCommit(push: boolean): void {
  if (commitButton.disabled) return;
  let items = includedByRepo();
  // 只 amend 訊息（沒有勾選檔案）：作用在第一個 repo
  if (items.length === 0 && ui.amend && state?.repos[0]) items = [{ root: state.repos[0].root, changes: [] }];
  busy = true;
  syncButtons();
  commitRequest++;
  post({ type: 'commitRun', requestId: commitRequest, message: message.value, amend: ui.amend, signOff: ui.signOff, noVerify: ui.noVerify, push, items });
}

// ---------- 儲藏分頁 ----------
const stash = (() => {
  let repos: { root: string; name: string; stashes: StashInfo[] }[] = [];
  let sel: { root: string; hash: string } | undefined;
  let loadReq = 0;
  let filesReq = 0;
  let seq = 1;
  const list = el('div', { className: 'tree stash-list', attrs: { tabindex: '0' } });
  const files = el('div', { className: 'tree stash-files' });
  const filesTitle = el('div', { className: 'push-files-title muted', text: t('Changed files') });
  const needSel = (fn: (s: { root: string; hash: string }) => void) => () => {
    if (sel) fn(sel);
  };
  const reloadSoon = () => setTimeout(() => load(), 500);
  const bar = el(
    'div',
    { className: 'pane-toolbar commit-toolbar' },
    iconButton('refresh', t('Refresh'), () => load()),
    iconButton('add', t('Stash Changes…'), () => {
      post({ type: 'stashSave' });
      reloadSoon();
    }),
    el('div', { className: 'toolbar-sep-h' }),
    iconButton('check', t('Apply'), needSel((s) => (post({ type: 'unstashApply', root: s.root, hash: s.hash, pop: false, index: false }), reloadSoon()))),
    iconButton('pop', t('Pop'), needSel((s) => (post({ type: 'unstashApply', root: s.root, hash: s.hash, pop: true, index: false }), reloadSoon()))),
    iconButton('branch', t('Unstash as Branch…'), () => openUnstashDialog()),
    iconButton('trash', t('Drop'), needSel((s) => (post({ type: 'unstashDrop', root: s.root, hash: s.hash }), reloadSoon()))),
  );
  stashPane.append(bar, list, el('div', { className: 'stash-files-pane' }, filesTitle, files));

  /** 建立成分支、還原暫存狀態等進階選項使用「取消儲藏」對話框 */
  function openUnstashDialog(): void {
    post({ type: 'openUnstash', root: sel?.root });
  }

  function load(): void {
    loadReq = seq++;
    post({ type: 'unstashLoad', requestId: loadReq });
  }

  function render(): void {
    clear(list);
    const all = repos.filter((r) => r.stashes.length > 0);
    if (all.length === 0) list.append(el('div', { className: 'empty-text', text: t('No stashes') }));
    const multi = repos.length > 1;
    for (const r of all) {
      if (multi) list.append(el('div', { className: 'tree-row stash-repo' }, icon('repo'), el('span', { className: 'tree-label', text: r.name }), el('span', { className: 'tree-count', text: String(r.stashes.length) })));
      for (const s of r.stashes) {
        const isSel = sel?.root === r.root && sel.hash === s.hash;
        const row = el(
          'div',
          { className: `tree-row${isSel ? ' selected' : ''}`, title: `${s.ref}\n${s.message}\n${formatDate(s.time)}` },
          icon('stash'),
          el('span', { className: 'tree-label', text: stashLabel(s.message) }),
          el('span', { className: 'tree-count', text: [s.branch, formatDate(s.time)].filter(Boolean).join(' · ') }),
        );
        row.style.paddingLeft = multi ? '22px' : '6px';
        row.addEventListener('click', () => {
          sel = { root: r.root, hash: s.hash };
          render();
          requestFiles();
        });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          sel = { root: r.root, hash: s.hash };
          render();
          requestFiles();
          showMenu(e.clientX, e.clientY, [
            { label: t('Apply'), action: () => void (post({ type: 'unstashApply', root: r.root, hash: s.hash, pop: false, index: false }), reloadSoon()) },
            { label: t('Apply with Index'), action: () => void (post({ type: 'unstashApply', root: r.root, hash: s.hash, pop: false, index: true }), reloadSoon()) },
            { label: t('Pop'), action: () => void (post({ type: 'unstashApply', root: r.root, hash: s.hash, pop: true, index: false }), reloadSoon()) },
            '-',
            { label: t('Drop…'), action: () => void (post({ type: 'unstashDrop', root: r.root, hash: s.hash }), reloadSoon()) },
            { label: t('Clear All Stashes…'), action: () => void (post({ type: 'unstashClear', root: r.root }), reloadSoon()) },
          ]);
        });
        list.append(row);
      }
    }
  }

  function requestFiles(): void {
    clear(files);
    if (!sel) return;
    const s = repos.find((r) => r.root === sel!.root)?.stashes.find((x) => x.hash === sel!.hash);
    filesTitle.textContent = s ? `${s.ref} ${stashLabel(s.message)}` : t('Changed files');
    filesReq = seq++;
    post({ type: 'unstashFiles', requestId: filesReq, root: sel.root, hash: sel.hash });
  }

  return {
    load,
    onData(m: Extract<ToWebview, { type: 'unstashData' }>) {
      if (m.requestId !== loadReq) return;
      repos = m.repos;
      if (sel && !repos.some((r) => r.root === sel!.root && r.stashes.some((s) => s.hash === sel!.hash))) sel = undefined;
      if (!sel) {
        const first = repos.find((r) => r.stashes.length > 0);
        if (first) sel = { root: first.root, hash: first.stashes[0].hash };
      }
      render();
      requestFiles();
    },
    onFiles(m: Extract<ToWebview, { type: 'unstashFiles' }>) {
      if (m.requestId !== filesReq || !sel) return;
      clear(files);
      if (m.files.length === 0) files.append(el('div', { className: 'empty-text', text: t('No changes') }));
      for (const f of m.files) {
        const name = f.path.slice(f.path.lastIndexOf('/') + 1);
        const dir = f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')));
        const row = el(
          'div',
          { className: 'tree-row', title: `${f.path}\n${t('Double-click to show the diff')}` },
          fileIcon(f.path),
          el('span', { className: `tree-label status-${f.status}`, text: name }),
          el('span', { className: 'tree-count', text: [dir, f.untracked ? t('untracked') : ''].filter(Boolean).join(' · ') }),
        );
        row.style.paddingLeft = '8px';
        const cur = sel;
        row.addEventListener('dblclick', () => post({ type: 'openStashDiff', root: cur.root, hash: cur.hash, file: f }));
        files.append(row);
      }
    },
  };
})();

/** 「On main: msg」→「msg」；「WIP on main: abc123 subject」→「WIP: subject」 */
function stashLabel(msg: string): string {
  const wip = /^WIP on [^:]+: [0-9a-f]+ (.*)$/.exec(msg);
  if (wip) return `WIP: ${wip[1]}`;
  const on = /^On [^:]+: (.*)$/.exec(msg);
  return on ? on[1] : msg;
}

// ---------- 訊息 ----------
window.addEventListener('message', (ev: MessageEvent<ToWebview>) => {
  const m = ev.data;
  switch (m.type) {
    case 'commitState':
      state = m.state;
      // 已不存在的檔案：移除明確勾選紀錄與選取
      {
        const live = new Set(state.repos.flatMap((r) => r.changes.map((c) => keyOf(r.root, c.path))));
        for (const k of [...explicit.keys()]) if (!live.has(k)) explicit.delete(k);
      }
      render();
      break;
    case 'commitLastMessage':
      if (ui.amend && !message.value.trim()) {
        message.value = m.message;
        ui.message = m.message;
        persist();
        syncButtons();
      }
      break;
    case 'commitDone':
      if (m.requestId !== commitRequest) break;
      busy = false;
      if (m.ok) {
        message.value = '';
        ui.message = '';
        ui.amend = false;
        amendBox.checked = false;
        draftBeforeAmend = undefined;
        explicit.clear();
        persist();
      }
      syncButtons();
      break;
    case 'unstashData':
      stash.onData(m);
      break;
    case 'unstashFiles':
      stash.onFiles(m);
      break;
    case 'confirm':
      showConfirm(m);
      break;
  }
});

setTab(ui.tab);
render();
post({ type: 'commitReady' });
