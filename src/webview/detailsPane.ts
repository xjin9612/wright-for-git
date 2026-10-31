// 右欄：變更檔案樹 + Commit 詳情
import type { ChangedFile, CommitDetails, HeadInfo, RefInfo, RepoState } from '../shared/protocol';
import { buildLabels } from '../shared/refs';
import { buildTree, type TreeNode } from '../shared/tree';
import { clear, el, formatDate, icon, iconButton, makeSplitter } from './dom';
import { renderLabel } from './logTable';

export interface DetailsCallbacks {
  /** 開啟 diff：單一 commit 時 parent 取自真正的 parent（不受路徑篩選改寫影響）；多選時 file 自帶 left／right */
  onOpenDiff: (root: string, file: ChangedFile, hash: string, parent: string | undefined) => void;
  /** 多選時點選 commit 清單中的項目 */
  onPickCommit?: (root: string, hash: string) => void;
  onCopy: (text: string) => void;
  onRequestContaining: (root: string, hash: string) => void;
  onCollapsePane: () => void;
  onSplitChange: (ratio: number) => void;
}

const STATUS_TEXT: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Unmerged',
  X: 'Unknown',
};

/** 多選時資訊區列出的 commit */
export interface SelectedCommit {
  root: string;
  hash: string;
  subject: string;
  author: string;
  authorTime: number;
}

interface FileRow {
  key: string;
  root: string;
  depth: number;
  label: string;
  count?: number;
  file?: ChangedFile;
  expanded: boolean;
  expandable: boolean;
}

export class DetailsPane {
  readonly element: HTMLElement;
  private readonly fileList: HTMLElement;
  private readonly info: HTMLElement;
  private readonly filesSection: HTMLElement;
  private details: CommitDetails | null = null;
  /** 多選模式：各 repo 的合併變更（null 表示單選或尚未載入） */
  private multi: { commits: SelectedCommit[]; groups: { root: string; files: ChangedFile[] }[] | null } | null = null;
  private states = new Map<string, RepoState>();
  private collapsed = new Set<string>();
  private selectedFile: string | undefined;
  private rows: FileRow[] = [];
  private containing: { root: string; hash: string; branches: string[] } | undefined;
  private showAllBranches = false;
  private splitRatio: number;

  constructor(
    private readonly cb: DetailsCallbacks,
    splitRatio: number | undefined,
  ) {
    this.splitRatio = splitRatio ?? 0.55;
    const toolbar = el(
      'div',
      { className: 'pane-toolbar' },
      iconButton('diff', 'Show diff (Enter)', () => this.openSelected()),
      el('div', { className: 'toolbar-spacer' }),
      iconButton('expand-all', 'Expand all', () => {
        this.collapsed.clear();
        this.renderFiles();
      }),
      iconButton('collapse-all', 'Collapse all', () => {
        for (const r of this.rows) if (r.expandable) this.collapsed.add(r.key);
        this.renderFiles();
      }),
      iconButton('close', 'Hide details', () => cb.onCollapsePane()),
    );
    this.fileList = el('div', { className: 'tree file-tree', attrs: { tabindex: '0', role: 'tree' } });
    this.fileList.addEventListener('keydown', (e) => this.onKey(e));
    this.filesSection = el('div', { className: 'details-files' }, toolbar, this.fileList);
    this.info = el('div', { className: 'details-info' });

    let startHeight = 0;
    const splitter = makeSplitter(
      'horizontal',
      () => (startHeight = this.filesSection.getBoundingClientRect().height),
      (d) => {
        const total = this.element.getBoundingClientRect().height;
        this.splitRatio = Math.min(0.9, Math.max(0.1, (startHeight + d) / total));
        this.applySplit();
      },
      () => cb.onSplitChange(this.splitRatio),
    );
    this.element = el('div', { className: 'details-pane' }, this.filesSection, splitter, this.info);
    this.applySplit();
    this.renderEmpty('Select a commit to view changes');
  }

  private applySplit(): void {
    this.filesSection.style.flexBasis = `${this.splitRatio * 100}%`;
  }

  setRepos(states: readonly RepoState[]): void {
    this.states = new Map(states.map((st) => [st.root, st]));
    if (this.details) this.renderInfo();
  }

  /** 目前詳情所屬 repository 的狀態 */
  private get state(): RepoState | undefined {
    return this.details ? this.states.get(this.details.root) : undefined;
  }

  private get refs(): RefInfo[] {
    return this.state?.refs ?? [];
  }

  private get head(): HeadInfo {
    return this.state?.head ?? {};
  }

  renderEmpty(text: string): void {
    this.details = null;
    this.multi = null;
    this.fileList.classList.remove('loading');
    this.rows = [];
    clear(this.fileList);
    this.fileList.append(el('div', { className: 'empty-text', text }));
    clear(this.info);
  }

  showLoading(): void {
    this.fileList.classList.add('loading');
  }

  /** 多選：先顯示 commit 清單，變更載入後再呼叫 setMultiFiles */
  showMulti(commits: SelectedCommit[]): void {
    this.details = null;
    this.multi = { commits, groups: null };
    this.selectedFile = undefined;
    this.fileList.classList.add('loading');
    this.renderFiles();
    this.renderInfo();
  }

  setMultiFiles(groups: { root: string; files: ChangedFile[] }[]): void {
    if (!this.multi) return;
    this.multi.groups = groups;
    this.fileList.classList.remove('loading');
    this.renderFiles();
  }

  /** 目前顯示中的檔案群組（單選時只有一組） */
  private get groups(): { root: string; files: ChangedFile[] }[] {
    if (this.details) return [{ root: this.details.root, files: this.details.files }];
    return this.multi?.groups ?? [];
  }

  private openFile(root: string, file: ChangedFile): void {
    if (this.details) this.cb.onOpenDiff(root, file, this.details.hash, this.details.parents[0]);
    else if (file.right !== undefined) this.cb.onOpenDiff(root, file, file.right, file.left);
  }

  setDetails(d: CommitDetails): void {
    this.multi = null;
    const sameCommit = this.details?.hash === d.hash && this.details.root === d.root;
    this.details = d;
    this.fileList.classList.remove('loading');
    if (!sameCommit) {
      this.selectedFile = undefined;
      this.showAllBranches = false;
      if (this.containing?.hash !== d.hash || this.containing.root !== d.root) this.containing = undefined;
    }
    this.renderFiles();
    this.renderInfo();
    if (!this.containing) this.cb.onRequestContaining(d.root, d.hash);
  }

  setContaining(root: string, hash: string, branches: string[]): void {
    this.containing = { root, hash, branches };
    if (this.details?.hash === hash && this.details.root === root) this.renderInfo();
  }

  // ---------- 檔案樹 ----------

  private buildRows(): FileRow[] {
    const rows: FileRow[] = [];
    for (const g of this.groups) {
      const rootKey = `\u0000root:${g.root}`;
      const rootOpen = !this.collapsed.has(rootKey);
      rows.push({ key: rootKey, root: g.root, depth: 0, label: this.states.get(g.root)?.name ?? '', count: g.files.length, expanded: rootOpen, expandable: true });
      if (!rootOpen) continue;
      const walk = (nodes: TreeNode<ChangedFile>[], depth: number) => {
        for (const n of nodes) {
          if (n.item) {
            rows.push({ key: `${g.root}\u0000${n.item.path}`, root: g.root, depth, label: n.name, file: n.item, expanded: false, expandable: false });
          } else {
            const key = `${g.root}\u0000${n.path}/`;
            const open = !this.collapsed.has(key);
            rows.push({ key, root: g.root, depth, label: n.name, count: n.count, expanded: open, expandable: true });
            if (open) walk(n.children, depth + 1);
          }
        }
      };
      walk(buildTree(g.files, (f) => f.path), 1);
    }
    return rows;
  }

  private renderFiles(): void {
    this.rows = this.buildRows();
    clear(this.fileList);
    if (!this.details && !this.multi?.groups) return;
    if (this.groups.every((g) => g.files.length === 0)) {
      this.fileList.append(el('div', { className: 'empty-text', text: 'No changes' }));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const r of this.rows) {
      const twisty = r.expandable ? icon(r.expanded ? 'chevron-down' : 'chevron-right', 'twisty') : el('span', { className: 'twisty' });
      const f = r.file;
      const title = f ? `${STATUS_TEXT[f.status] ?? f.status}: ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}` : r.label;
      const row = el(
        'div',
        { className: `tree-row${r.key === this.selectedFile ? ' selected' : ''}`, title, attrs: { role: 'treeitem' } },
        twisty,
        icon(f ? 'file' : r.depth === 0 ? 'repo' : 'folder'),
        el('span', { className: `tree-label${f ? ` status-${f.status}` : ''}`, text: r.label }),
        r.count !== undefined ? el('span', { className: 'tree-count', text: `${r.count} ${r.count === 1 ? 'file' : 'files'}` }) : null,
        f?.oldPath ? el('span', { className: 'tree-count', text: `← ${f.oldPath}` }) : null,
      );
      row.style.paddingLeft = `${4 + r.depth * 14}px`;
      row.addEventListener('click', () => {
        this.selectedFile = r.key;
        if (r.expandable) this.toggle(r.key);
        else this.renderFiles();
      });
      row.addEventListener('dblclick', () => {
        if (f) this.openFile(r.root, f);
      });
      frag.append(row);
    }
    this.fileList.append(frag);
  }

  private toggle(key: string, open?: boolean): void {
    const next = open ?? this.collapsed.has(key);
    if (next) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.renderFiles();
  }

  private openSelected(): void {
    const row = this.rows.find((r) => r.key === this.selectedFile && r.file) ?? this.rows.find((r) => r.file);
    if (row?.file) this.openFile(row.root, row.file);
  }

  private onKey(e: KeyboardEvent): void {
    const idx = this.rows.findIndex((r) => r.key === this.selectedFile);
    const row = this.rows[idx];
    const moveTo = (i: number) => {
      const r = this.rows[Math.max(0, Math.min(this.rows.length - 1, i))];
      if (!r) return;
      this.selectedFile = r.key;
      this.renderFiles();
      this.fileList.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
    };
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
        if (row?.file) this.openFile(row.root, row.file);
        else if (row?.expandable) this.toggle(row.key);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ---------- 詳情 ----------

  private renderInfo(): void {
    const d = this.details;
    clear(this.info);
    if (this.multi) {
      this.renderMultiInfo(this.multi.commits);
      return;
    }
    if (!d) return;
    const short = d.hash.slice(0, 8);
    const hashLink = el('a', { className: 'link hash-link', text: short, title: `Copy ${d.hash}`, attrs: { href: '#' } });
    hashLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.cb.onCopy(d.hash);
    });

    const when = (t: number) => {
      const s = formatDate(t);
      const [date, time] = s.split(' ');
      return `${date} at ${time}`;
    };
    const meta = el('div', { className: 'details-meta' }, hashLink, ` ${d.author} `, el('span', { className: 'muted', text: `<${d.authorEmail}>` }), ` on ${when(d.authorTime)}`);
    const committerDiffers = d.committer !== d.author || d.committerEmail !== d.authorEmail;
    const committed = committerDiffers
      ? el('div', { className: 'details-meta' }, `committed by ${d.committer} `, el('span', { className: 'muted', text: `<${d.committerEmail}>` }), ` on ${when(d.commitTime)}`)
      : null;

    const labels = buildLabels(
      this.refs.filter((r) => r.hash === d.hash),
      this.head,
      d.hash,
    );
    const refsLine = labels.length > 0 ? el('div', { className: 'details-refs' }, ...labels.map(renderLabel)) : null;

    let branchesLine: HTMLElement;
    if (!this.containing || this.containing.hash !== d.hash) {
      branchesLine = el('div', { className: 'details-branches muted', text: 'Loading branches…' });
    } else {
      const list = this.containing.branches;
      const head = this.head.branch && list.includes(this.head.branch) ? ['HEAD'] : [];
      const all = [...head, ...list];
      const LIMIT = 3;
      if (all.length <= LIMIT || this.showAllBranches) {
        branchesLine = el('div', { className: 'details-branches' }, `In ${all.length} ${all.length === 1 ? 'branch' : 'branches'}: ${all.join(', ') || '—'}`);
      } else {
        const more = el('a', { className: 'link', text: 'Show all', attrs: { href: '#' } });
        more.addEventListener('click', (e) => {
          e.preventDefault();
          this.showAllBranches = true;
          this.renderInfo();
        });
        branchesLine = el('div', { className: 'details-branches' }, `In ${all.length} branches: ${all.slice(0, LIMIT).join(', ')}… `, more);
      }
    }

    const [subject, ...body] = d.message.split('\n');
    this.info.append(
      el('div', { className: 'details-message' }, el('div', { className: 'details-subject', text: subject }), body.join('\n').trim() ? el('pre', { className: 'details-body', text: body.join('\n').replace(/^\n+/, '') }) : null),
      meta,
      ...[committed, refsLine].filter((n): n is HTMLDivElement => n !== null),
      branchesLine,
    );
  }

  private renderMultiInfo(commits: SelectedCommit[]): void {
    const repos = new Set(commits.map((c) => c.root)).size;
    const header = el('div', { className: 'details-subject', text: `${commits.length} commits selected${repos > 1 ? ` in ${repos} repositories` : ''}` });
    const list = el('div', { className: 'multi-list' });
    for (const c of commits) {
      const row = el(
        'div',
        { className: 'multi-commit', title: `${c.hash}\n${c.author} · ${formatDate(c.authorTime)}` },
        el('span', { className: 'hash', text: c.hash.slice(0, 8) }),
        el('span', { className: 'multi-subject', text: c.subject }),
        el('span', { className: 'muted', text: c.author }),
      );
      row.addEventListener('click', () => this.cb.onPickCommit?.(c.root, c.hash));
      list.append(row);
    }
    this.info.append(el('div', { className: 'details-message' }, header), list);
  }
}
