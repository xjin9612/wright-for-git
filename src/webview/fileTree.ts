// 變更檔案樹（記錄右欄、儲藏的檔案清單共用）：依目錄／儲存庫／模組分組（對應 IntelliJ 的 Group By）
import type { ChangedFile } from '../shared/protocol';
import { buildTree, type TreeNode } from '../shared/tree';
import { clear, el, icon, iconButton, isContextMenuKey, openContextMenuFor, showMenu, treeItemAttrs, type MenuItem } from './dom';
import { fileIcon, statusClass, statusLetter } from './fileIcons';
import { plural, t } from './l10n';
import { post } from './vscodeApi';

/** 變更檔案的分組方式 */
export interface FileGrouping {
  directory: boolean;
  repository: boolean;
  module: boolean;
}

/** 一組檔案：同一個 repo；section 有值時上面多一層標題（如「未追蹤的檔案」） */
export interface FileGroup {
  root: string;
  files: ChangedFile[];
  section?: string;
}

export interface FileTreeOptions {
  grouping?: Partial<FileGrouping>;
  onGroupChange?: (group: FileGrouping) => void;
  /** 開啟 diff；files 為同一組檔案依樹狀顯示的順序（供 diff 切換上一個／下一個） */
  onOpen: (group: FileGroup, file: ChangedFile, files: ChangedFile[]) => void;
  repoName: (root: string) => string;
  /** 檔案列的額外說明（如「未追蹤」） */
  fileDetail?: (file: ChangedFile) => string | undefined;
  /** 把焦點與選取的檔案回報給 extension（F4 等可自訂快速鍵用；需要該 webview 的 host 處理 fileTreeFocus） */
  reportFocus?: boolean;
  /** 檔案列的右鍵選單（滑鼠右鍵、選單鍵或 Shift+F10）；資料夾、repo 列沒有選單 */
  fileMenu?: (group: FileGroup, file: ChangedFile) => MenuItem[];
}

const STATUS_TEXT: Record<string, string> = {
  A: t('Added'),
  M: t('Modified'),
  D: t('Deleted'),
  R: t('Renamed'),
  C: t('Copied'),
  T: t('Type changed'),
  U: t('Unmerged'),
  X: t('Unknown'),
};

interface Row {
  key: string;
  group: FileGroup;
  icon?: 'repo' | 'module' | 'section';
  detail?: string;
  depth: number;
  label: string;
  count?: number;
  file?: ChangedFile;
  /** 非檔案列按 Ctrl+C 複製的內容：資料夾為 repo 內的相對路徑、模組為模組路徑、repo 列為 repo 名稱 */
  copy?: string;
  expanded: boolean;
  expandable: boolean;
}

export function fileName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export class FileTree {
  readonly element: HTMLElement;
  readonly groupButton: HTMLButtonElement;
  private groups: FileGroup[] | null = null;
  private grouping: FileGrouping;
  private collapsed = new Set<string>();
  private selected: string | undefined;
  private rows: Row[] = [];
  private emptyText = '';
  private lastReport = '';

  constructor(private readonly opts: FileTreeOptions) {
    this.grouping = { directory: true, repository: true, module: false, ...opts.grouping };
    this.groupButton = iconButton('eye', t('Group By'), () => this.showGroupMenu());
    this.element = el('div', { className: 'tree file-tree', attrs: { tabindex: '0', role: 'tree' } });
    this.element.addEventListener('keydown', (e) => this.onKey(e));
    if (opts.reportFocus) {
      this.element.addEventListener('focus', () => this.reportFocus());
      this.element.addEventListener('blur', () => this.reportFocus());
      // 焦點移到 webview 外（編輯器、其他 view）時，元素不一定收到 blur；下一輪再看頁面是否還有焦點
      window.addEventListener('blur', () => setTimeout(() => this.reportFocus()));
      window.addEventListener('focus', () => this.reportFocus());
    }
  }

  /** 回報焦點與選取檔案；內容沒變時不重送 */
  private reportFocus(): void {
    if (!this.opts.reportFocus) return;
    const focused = document.hasFocus() && document.activeElement === this.element;
    const row = focused ? this.rows.find((r) => r.key === this.selected && r.file) : undefined;
    const file = row?.file ? { root: row.group.root, path: row.file.path } : undefined;
    const key = JSON.stringify([focused, file]);
    if (key === this.lastReport) return;
    this.lastReport = key;
    post({ type: 'fileTreeFocus', focused, file });
  }

  /** 顯示檔案；keepSelection 為 false 時清除選取（換成另一個 commit／儲藏） */
  setGroups(groups: FileGroup[], keepSelection = false): void {
    this.groups = groups;
    if (!keepSelection) this.selected = undefined;
    this.element.classList.remove('loading');
    this.render();
  }

  /** 顯示提示文字（尚未選取等） */
  setEmpty(text: string): void {
    this.groups = null;
    this.emptyText = text;
    this.selected = undefined;
    this.element.classList.remove('loading');
    this.render();
  }

  setLoading(loading = true): void {
    this.element.classList.toggle('loading', loading);
  }

  expandAll(): void {
    this.collapsed.clear();
    this.render();
  }

  collapseAll(): void {
    for (const r of this.rows) if (r.expandable) this.collapsed.add(r.key);
    this.render();
  }

  openSelected(): void {
    const row = this.rows.find((r) => r.key === this.selected && r.file) ?? this.rows.find((r) => r.file);
    if (row?.file) this.open(row.group, row.file);
  }

  /** 同一組的所有檔案列（不受收合影響，依顯示順序） */
  private filesInOrder(group: FileGroup): ChangedFile[] {
    const saved = this.collapsed;
    this.collapsed = new Set();
    try {
      return this.buildRows()
        .filter((r) => r.file && r.group === group)
        .map((r) => r.file!);
    } finally {
      this.collapsed = saved;
    }
  }

  private open(group: FileGroup, file: ChangedFile): void {
    this.opts.onOpen(group, file, this.filesInOrder(group));
  }

  private showGroupMenu(): void {
    const r = this.groupButton.getBoundingClientRect();
    const toggle = (k: keyof FileGrouping) => ({
      keepOpen: true,
      action: () => {
        this.grouping = { ...this.grouping, [k]: !this.grouping[k] };
        this.opts.onGroupChange?.(this.grouping);
        this.render();
        return this.grouping[k];
      },
    });
    showMenu(r.left, r.bottom + 2, [
      { label: t('Group By'), disabled: true },
      { label: t('Directory'), checked: this.grouping.directory, ...toggle('directory') },
      { label: t('Repository'), checked: this.grouping.repository, ...toggle('repository') },
      { label: t('Module'), checked: this.grouping.module, ...toggle('module') },
    ]);
  }

  private buildRows(): Row[] {
    const rows: Row[] = [];
    const groups = this.groups ?? [];
    const { directory, repository, module } = this.grouping;
    const multiRepo = new Set(groups.map((g) => g.root)).size > 1;

    const addFiles = (g: FileGroup, files: ChangedFile[], depth: number, prefix: string, base: string) => {
      const rel = (f: ChangedFile) => (base && f.path.startsWith(`${base}/`) ? f.path.slice(base.length + 1) : f.path);
      if (!directory) {
        // 平鋪：檔名在前、所在目錄淡色顯示在後
        const sorted = [...files].sort((a, b) => fileName(a.path).localeCompare(fileName(b.path)) || a.path.localeCompare(b.path));
        for (const f of sorted) rows.push({ key: `${prefix}\u0000${f.path}`, group: g, depth, label: fileName(f.path), file: f, expanded: false, expandable: false });
        return;
      }
      const walk = (nodes: TreeNode<ChangedFile>[], d: number) => {
        for (const n of nodes) {
          if (n.item) {
            rows.push({ key: `${prefix}\u0000${n.item.path}`, group: g, depth: d, label: n.name, file: n.item, expanded: false, expandable: false });
          } else {
            const key = `${prefix}\u0000dir:${n.path}/`;
            const open = !this.collapsed.has(key);
            rows.push({ key, group: g, depth: d, label: n.name, count: n.count, copy: base ? `${base}/${n.path}` : n.path, expanded: open, expandable: true });
            if (open) walk(n.children, d + 1);
          }
        }
      };
      walk(buildTree(files, rel), depth);
    };

    groups.forEach((g, gi) => {
      let depth = 0;
      const base = `${gi}\u0000${g.root}`;
      if (g.section !== undefined) {
        const key = `${base}\u0000section`;
        const open = !this.collapsed.has(key);
        rows.push({ key, group: g, depth: 0, label: g.section, count: g.files.length, expanded: open, expandable: true, icon: 'section' });
        if (!open) return;
        depth = 1;
      }
      if (repository || multiRepo) {
        const key = `${base}\u0000repo`;
        const open = !this.collapsed.has(key);
        rows.push({ key, group: g, depth, label: this.opts.repoName(g.root), count: g.files.length, copy: this.opts.repoName(g.root), expanded: open, expandable: true, icon: 'repo' });
        if (!open) return;
        depth++;
      }
      if (module) {
        const byModule = new Map<string, ChangedFile[]>();
        for (const f of g.files) {
          const m = f.module ?? '\u0000none';
          byModule.set(m, [...(byModule.get(m) ?? []), f]);
        }
        for (const [m, files] of [...byModule].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (m === '\u0000none') {
            addFiles(g, files, depth, `${base}\u0000nomodule`, '');
            continue;
          }
          const key = `${base}\u0000module:${m}`;
          const open = !this.collapsed.has(key);
          const label = m ? m.slice(m.lastIndexOf('/') + 1) : this.opts.repoName(g.root);
          rows.push({ key, group: g, depth, label, count: files.length, copy: m || this.opts.repoName(g.root), expanded: open, expandable: true, icon: 'module', detail: m || undefined });
          if (open) addFiles(g, files, depth + 1, key, m);
        }
      } else {
        addFiles(g, g.files, depth, base, '');
      }
    });
    return rows;
  }

  private render(): void {
    this.rows = this.buildRows();
    this.reportFocus();
    clear(this.element);
    if (!this.groups) {
      if (this.emptyText) this.element.append(el('div', { className: 'empty-text', text: this.emptyText }));
      return;
    }
    if (this.groups.every((g) => g.files.length === 0)) {
      this.element.append(el('div', { className: 'empty-text', text: t('No changes') }));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const r of this.rows) {
      const twisty = r.expandable ? icon(r.expanded ? 'chevron-down' : 'chevron-right', 'twisty') : el('span', { className: 'twisty' });
      const f = r.file;
      const title = f ? `${STATUS_TEXT[f.status] ?? f.status}: ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}` : r.label;
      const extra = f ? this.opts.fileDetail?.(f) : undefined;
      const row = el(
        'div',
        { className: `tree-row${r.key === this.selected ? ' selected' : ''}`, title, attrs: treeItemAttrs(r.depth, r.expandable, r.expanded, r.key === this.selected) },
        twisty,
        f ? fileIcon(f.path) : r.icon === 'section' ? null : icon(r.icon ?? 'folder'),
        el('span', { className: `tree-label${f ? ` ${statusClass(f.untracked ? 'untracked' : f.status)}` : ''}${r.icon === 'section' ? ' commit-section' : ''}`, text: r.label }),
        r.count !== undefined ? el('span', { className: 'tree-count', text: plural(r.count, '{0} file', '{0} files') }) : null,
        f && !this.grouping.directory && f.path.includes('/') ? el('span', { className: 'tree-count', text: f.path.slice(0, f.path.lastIndexOf('/')) }) : null,
        r.detail ? el('span', { className: 'tree-count', text: r.detail }) : null,
        f?.oldPath ? el('span', { className: 'tree-count', text: `← ${f.oldPath}` }) : null,
        extra ? el('span', { className: 'tree-count', text: extra }) : null,
        f ? statusLetter(f.untracked ? 'untracked' : f.status) : null,
      );
      row.style.paddingLeft = `${4 + r.depth * 14}px`;
      row.addEventListener('click', () => {
        this.selected = r.key;
        if (r.expandable) this.toggle(r.key);
        else this.render();
      });
      row.addEventListener('dblclick', () => {
        if (f) this.open(r.group, f);
      });
      const fileMenu = this.opts.fileMenu;
      if (f && fileMenu) {
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.selected = r.key;
          this.element.focus();
          this.render();
          showMenu(e.clientX, e.clientY, fileMenu(r.group, f));
        });
      }
      frag.append(row);
    }
    this.element.append(frag);
  }

  private toggle(key: string, open?: boolean): void {
    const next = open ?? this.collapsed.has(key);
    if (next) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    const idx = this.rows.findIndex((r) => r.key === this.selected);
    const row = this.rows[idx];
    const moveTo = (i: number) => {
      const r = this.rows[Math.max(0, Math.min(this.rows.length - 1, i))];
      if (!r) return;
      this.selected = r.key;
      this.render();
      this.element.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
    };
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
      // Ctrl+C：檔案複製檔名；資料夾複製 repo 內的相對路徑；repo、模組列複製其名稱／路徑
      const text = row?.file ? fileName(row.file.path) : row?.copy;
      if (text) post({ type: 'copy', text });
      e.preventDefault();
      return;
    }
    if (isContextMenuKey(e)) {
      if (row?.file && this.opts.fileMenu) openContextMenuFor(this.element.querySelector('.tree-row.selected'));
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        moveTo(idx + 1);
        break;
      case 'ArrowUp':
        moveTo(idx - 1);
        break;
      case 'ArrowRight':
        if (row?.expandable && !row.expanded) this.toggle(row.key, true);
        else moveTo(idx + 1);
        break;
      case 'ArrowLeft':
        if (row?.expandable && row.expanded) this.toggle(row.key, false);
        break;
      case 'Enter':
        if (row?.file) this.open(row.group, row.file);
        else if (row?.expandable) this.toggle(row.key);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
