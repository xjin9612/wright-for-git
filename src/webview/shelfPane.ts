// 提交視窗的「擱置」分頁：上方是擱置清單（一筆可能跨多個 repo，可多選刪除），下方是選取那筆的檔案（依 repo 分組，可多選）。
// 取回一律經過取回對話框：勾選 repo／檔案、放進哪個 changelist、取回後是否從擱置移除。
import type { ShelfGroup, ToWebview } from '../shared/protocol';
import { clear, el, formatDate, icon, iconButton, isContextMenuKey, openContextMenuFor, showMenu, type MenuItem } from './dom';
import { FileTree, type FileGroup, type FileGrouping } from './fileTree';
import { plural, t } from './l10n';
import { openUnshelveDialog, type ShelfFile } from './unshelveDialog';
import { post } from './vscodeApi';

export interface ShelfPaneOptions {
  grouping?: Partial<FileGrouping>;
  onGroupChange: (g: FileGrouping) => void;
  /** 目前的 changelist 名稱（取回對話框的建議） */
  changelists: () => string[];
}

const keyOf = (root: string, p: string) => `${root}\0${p}`;

export function createShelfPane(container: HTMLElement, opts: ShelfPaneOptions) {
  let groups: ShelfGroup[] = [];
  let repoNames: Record<string, string> = {};
  /** 目前顯示檔案的那一筆（也是 Shift 多選的起點） */
  let selId: string | undefined;
  /** 多選的擱置；空的時候以 selId 為唯一選取 */
  const multi = new Set<string>();
  let files: { id: string; repos: { root: string; files: ShelfFile[] }[] } | undefined;
  /** 檔案還沒載入時要開的取回對話框 */
  let pendingDialog: { id: string; preselect?: Set<string> } | undefined;
  let loadReq = 0;
  let filesReq = 0;
  let seq = 1;
  const repoName = (root: string) => repoNames[root] ?? root.split(/[\\/]/).pop() ?? root;
  const selected = () => groups.find((g) => g.id === selId);
  const selectedIds = () => (multi.size > 0 ? groups.filter((g) => multi.has(g.id)).map((g) => g.id) : selId ? [selId] : []);

  const list = el('div', { className: 'tree stash-list shelf-list', attrs: { tabindex: '0' } });
  const filesTitle = el('div', { className: 'push-files-title muted stash-files-title', text: t('Changed files') });
  const fileTree: FileTree = new FileTree({
    reportFocus: true,
    multiSelect: true,
    grouping: opts.grouping ?? { directory: true, repository: true, module: false },
    onGroupChange: opts.onGroupChange,
    repoName,
    onOpen: (g, file) => {
      if (files) post({ type: 'shelfOpenDiff', id: files.id, root: g.root, file });
    },
    fileMenu: (): MenuItem[] => {
      const id = files?.id;
      if (!id) return [];
      const picked: { group: FileGroup; file: ShelfFile }[] = fileTree.selectedFiles();
      return [
        { label: t('Show Diff'), keybinding: 'Enter', disabled: picked.length !== 1, action: () => fileTree.openSelected() },
        { label: picked.length > 1 ? t('Unshelve {0} Files…', picked.length) : t('Unshelve…'), action: () => openDialog(id, new Set(picked.map((p) => keyOf(p.group.root, p.file.path)))) },
      ];
    },
  });
  fileTree.element.classList.add('stash-files');
  const filesBar = el(
    'div',
    { className: 'pane-toolbar stash-files-toolbar' },
    iconButton('diff', t('Show diff (Enter)'), () => fileTree.openSelected()),
    fileTree.groupButton,
    filesTitle,
    el('div', { className: 'toolbar-spacer' }),
    iconButton('expand-all', t('Expand all'), () => fileTree.expandAll()),
    iconButton('collapse-all', t('Collapse all'), () => fileTree.collapseAll()),
  );
  const bar = el(
    'div',
    { className: 'pane-toolbar commit-toolbar' },
    iconButton('refresh', t('Refresh'), () => load()),
    el('div', { className: 'toolbar-sep-h' }),
    iconButton('pop', t('Unshelve…'), () => unshelveSelected()),
    iconButton('trash', t('Delete…'), () => dropSelected()),
  );
  container.append(bar, list, el('div', { className: 'stash-files-pane' }, filesBar, fileTree.element));

  list.addEventListener('keydown', (e) => {
    const i = groups.findIndex((g) => g.id === selId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = groups[Math.max(0, Math.min(groups.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (!next) return;
      e.preventDefault();
      multi.clear();
      select(next.id);
      list.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      unshelveSelected();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      dropSelected();
    } else if (isContextMenuKey(e)) {
      e.preventDefault();
      openContextMenuFor(list.querySelector('.tree-row.selected'));
    }
  });

  /** 多選時一次取回多筆會互相衝突，先只允許一筆 */
  function unshelveSelected(): void {
    const ids = selectedIds();
    if (ids.length === 1) openDialog(ids[0]);
  }

  function dropSelected(): void {
    const ids = selectedIds();
    if (ids.length > 0) post({ type: 'shelfDrop', ids });
  }

  function openDialog(id: string, preselect?: Set<string>): void {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    if (files?.id !== id) {
      // 檔案還沒載入（或載入的是另一筆）：載入後再開
      pendingDialog = { id, preselect };
      if (selId !== id) select(id);
      else requestFiles();
      return;
    }
    openUnshelveDialog(
      {
        name: g.name || t('Shelved changes'),
        repos: files.repos.map((r) => ({ root: r.root, name: repoName(r.root), files: r.files })),
        preselect,
        changelists: opts.changelists(),
      },
      (r) => post({ type: 'shelfUnshelve', id, paths: r.paths, remove: r.remove, overwrite: r.overwrite, changelist: r.changelist || undefined }),
    );
  }

  function menuFor(g: ShelfGroup): MenuItem[] {
    const ids = selectedIds();
    if (ids.length > 1) {
      return [
        { label: t('Unshelve…'), disabled: true, detail: t('one at a time') },
        '-',
        { label: t('Delete {0} Entries…', ids.length), action: () => dropSelected() },
      ];
    }
    return [{ label: t('Unshelve…'), action: () => openDialog(g.id) }, '-', { label: t('Rename…'), action: () => post({ type: 'shelfRename', id: g.id }) }, { label: t('Delete…'), action: () => dropSelected() }];
  }

  function select(id: string): void {
    if (selId === id) {
      render();
      return;
    }
    selId = id;
    render();
    requestFiles();
  }

  /** 清單點選：Ctrl 切換、Shift 從目前那筆延伸；一般點選只選這一筆 */
  function clickSelect(id: string, e: MouseEvent): void {
    if (e.shiftKey && selId) {
      const a = groups.findIndex((g) => g.id === selId);
      const b = groups.findIndex((g) => g.id === id);
      if (!(e.ctrlKey || e.metaKey)) multi.clear();
      for (const g of groups.slice(Math.min(a, b), Math.max(a, b) + 1)) multi.add(g.id);
      render();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (multi.size === 0 && selId) multi.add(selId);
      if (multi.has(id)) multi.delete(id);
      else multi.add(id);
      select(id);
      return;
    }
    multi.clear();
    select(id);
  }

  function load(): void {
    loadReq = seq++;
    post({ type: 'shelfLoad', requestId: loadReq });
  }

  function render(): void {
    clear(list);
    if (groups.length === 0) {
      list.append(el('div', { className: 'empty-text' }, t('No shelved changes'), el('br'), el('span', { className: 'muted', text: t('Select files in the Commit tab and choose Shelve Changes… to set them aside.') })));
      return;
    }
    for (const g of groups) {
      const repos = g.entries.map((e) => repoName(e.root));
      const where = repos.length > 1 ? plural(repos.length, '{0} repository', '{0} repositories') : repos[0];
      const isSel = multi.size > 0 ? multi.has(g.id) : g.id === selId;
      const row = el(
        'div',
        { className: `tree-row${isSel ? ' selected' : ''}`, title: `${g.name}\n${repos.join('\n')}\n${formatDate(g.time)}` },
        icon('shelve'),
        el('span', { className: 'tree-label', text: g.name || t('Shelved changes') }),
        el('span', { className: 'tree-count', text: [where, formatDate(g.time)].join(' · ') }),
      );
      row.style.paddingLeft = '6px';
      row.addEventListener('click', (e) => clickSelect(g.id, e));
      row.addEventListener('dblclick', () => openDialog(g.id));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // 在多選範圍內按右鍵：維持多選
        if (!multi.has(g.id)) {
          multi.clear();
          select(g.id);
        }
        showMenu(e.clientX, e.clientY, menuFor(g));
      });
      list.append(row);
    }
  }

  function requestFiles(): void {
    const g = selected();
    if (!g) {
      files = undefined;
      filesTitle.textContent = t('Changed files');
      fileTree.setEmpty('');
      return;
    }
    fileTree.setLoading();
    filesTitle.textContent = g.name || t('Shelved changes');
    filesReq = seq++;
    post({ type: 'shelfFiles', requestId: filesReq, id: g.id });
  }

  return {
    load,
    onData(m: Extract<ToWebview, { type: 'shelfData' }>) {
      if (m.requestId !== loadReq) return;
      groups = m.groups;
      repoNames = m.repoNames;
      for (const id of [...multi]) if (!groups.some((g) => g.id === id)) multi.delete(id);
      if (selId && !groups.some((g) => g.id === selId)) selId = undefined;
      selId ??= groups[0]?.id;
      files = undefined;
      render();
      requestFiles();
    },
    onFiles(m: Extract<ToWebview, { type: 'shelfFiles' }>) {
      if (m.requestId !== filesReq || m.id !== selId) return;
      const same = files?.id === m.id;
      files = { id: m.id, repos: m.repos };
      // 每個 repo：追蹤中的變更在上，未追蹤的檔案另成一組（與儲藏分頁相同）
      const fileGroups: FileGroup[] = [];
      for (const r of m.repos) {
        const tracked = r.files.filter((f) => !f.untracked);
        const untracked = r.files.filter((f) => f.untracked);
        if (tracked.length > 0 || untracked.length === 0) fileGroups.push({ root: r.root, files: tracked });
        if (untracked.length > 0) fileGroups.push({ root: r.root, files: untracked, section: t('Untracked files') });
      }
      fileTree.setGroups(fileGroups, same);
      if (pendingDialog?.id === m.id) {
        const p = pendingDialog;
        pendingDialog = undefined;
        openDialog(p.id, p.preselect);
      }
    },
  };
}
