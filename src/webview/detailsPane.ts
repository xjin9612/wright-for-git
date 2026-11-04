// 右欄：變更檔案樹 + Commit 詳情
import type { ChangedFile, CommitDetails, HeadInfo, RefInfo, RepoState } from '../shared/protocol';
import { buildLabels } from '../shared/refs';
import { clear, el, formatDate, iconButton, makeSplitter, MOD_KEY, type MenuItem } from './dom';
import { FileTree, fileName, type FileGroup, type FileGrouping } from './fileTree';
import { plural, t } from './l10n';
import { linkify } from './issueLinks';
import { renderLabel } from './logTable';
import { post } from './vscodeApi';

export type { FileGrouping };

export interface DetailsCallbacks {
  /** 開啟 diff：單一 commit 時 parent 取自真正的 parent（不受路徑篩選改寫影響）；多選時 file 自帶 left／right */
  onOpenDiff: (root: string, file: ChangedFile, hash: string, parent: string | undefined, files: ChangedFile[]) => void;
  /** 多選時點選 commit 清單中的項目 */
  onPickCommit?: (root: string, hash: string) => void;
  onCopy: (text: string) => void;
  onRequestContaining: (root: string, hash: string) => void;
  onCollapsePane: () => void;
  onSplitChange: (ratio: number) => void;
  /** 分組方式變更 */
  onGroupChange?: (group: FileGrouping) => void;
}

/** 多選時資訊區列出的 commit */
export interface SelectedCommit {
  root: string;
  hash: string;
  subject: string;
  author: string;
  authorTime: number;
}

export class DetailsPane {
  readonly element: HTMLElement;
  private readonly tree: FileTree;
  private readonly info: HTMLElement;
  private readonly filesSection: HTMLElement;
  private details: CommitDetails | null = null;
  /** 多選模式：各 repo 的合併變更（null 表示單選或尚未載入） */
  private multi: { commits: SelectedCommit[]; groups: { root: string; files: ChangedFile[] }[] | null } | null = null;
  private states = new Map<string, RepoState>();
  private containing: { root: string; hash: string; branches: string[] } | undefined;
  private showAllBranches = false;
  private splitRatio: number;

  constructor(
    private readonly cb: DetailsCallbacks,
    splitRatio: number | undefined,
    grouping?: Partial<FileGrouping>,
  ) {
    this.splitRatio = splitRatio ?? 0.55;
    this.tree = new FileTree({
      grouping,
      reportFocus: true,
      fileMenu: (g, file) => this.fileMenu(g, file),
      onGroupChange: cb.onGroupChange,
      repoName: (root) => this.states.get(root)?.name ?? '',
      onOpen: (g, file, files) => {
        if (this.details) cb.onOpenDiff(g.root, file, this.details.hash, this.details.parents[0], files);
        else if (file.right !== undefined) cb.onOpenDiff(g.root, file, file.right, file.left, files);
      },
    });
    const toolbar = el(
      'div',
      { className: 'pane-toolbar' },
      iconButton('diff', t('Show diff (Enter)'), () => this.tree.openSelected()),
      this.tree.groupButton,
      el('div', { className: 'toolbar-spacer' }),
      iconButton('expand-all', t('Expand all'), () => this.tree.expandAll()),
      iconButton('collapse-all', t('Collapse all'), () => this.tree.collapseAll()),
      iconButton('close', t('Hide details'), () => cb.onCollapsePane()),
    );
    this.filesSection = el('div', { className: 'details-files' }, toolbar, this.tree.element);
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
    this.renderEmpty(t('Select a commit to view changes'));
  }

  /** 檔案右鍵選單（選單開啟前已選取該檔案） */
  private fileMenu(g: FileGroup, file: ChangedFile): MenuItem[] {
    // 該 commit 的版本：多選合併變更自帶右側 revision；刪除的檔案在該 commit 不存在
    const ref = file.right !== undefined ? file.right : file.status === 'D' ? '' : (this.details?.hash ?? '');
    return [
      { label: t('Show Diff'), keybinding: 'Enter', action: () => this.tree.openSelected() },
      { label: t('Open File'), disabled: file.status === 'D', action: () => post({ type: 'openWorkingFile', root: g.root, path: file.path }) },
      { label: t('Open Repository Version'), disabled: !ref, action: () => post({ type: 'openRevisionFile', root: g.root, ref, path: file.path }) },
      { label: t('Select In…'), disabled: file.status === 'D', action: () => post({ type: 'selectInFile', root: g.root, path: file.path }) },
      '-',
      { label: t('Copy File Name'), keybinding: `${MOD_KEY}C`, action: () => post({ type: 'copy', text: fileName(file.path) }) },
      { label: t('Copy Path'), action: () => post({ type: 'copy', text: file.path }) },
    ];
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
    this.tree.setEmpty(text);
    clear(this.info);
  }

  showLoading(): void {
    this.tree.setLoading();
  }

  /** 多選：先顯示 commit 清單，變更載入後再呼叫 setMultiFiles */
  showMulti(commits: SelectedCommit[]): void {
    this.details = null;
    this.multi = { commits, groups: null };
    this.tree.setEmpty('');
    this.tree.setLoading();
    this.renderInfo();
  }

  setMultiFiles(groups: { root: string; files: ChangedFile[] }[]): void {
    if (!this.multi) return;
    this.multi.groups = groups;
    this.tree.setGroups(groups);
  }

  setDetails(d: CommitDetails): void {
    this.multi = null;
    const sameCommit = this.details?.hash === d.hash && this.details.root === d.root;
    this.details = d;
    if (!sameCommit) {
      this.showAllBranches = false;
      if (this.containing?.hash !== d.hash || this.containing.root !== d.root) this.containing = undefined;
    }
    this.tree.setGroups([{ root: d.root, files: d.files }], sameCommit);
    this.renderInfo();
    if (!this.containing) this.cb.onRequestContaining(d.root, d.hash);
  }

  setContaining(root: string, hash: string, branches: string[]): void {
    this.containing = { root, hash, branches };
    if (this.details?.hash === hash && this.details.root === root) this.renderInfo();
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
    const hashLink = el('a', { className: 'link hash-link', text: short, title: t('Copy {0}', d.hash), attrs: { href: '#' } });
    hashLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.cb.onCopy(d.hash);
    });

    const when = (unix: number) => {
      const s = formatDate(unix);
      const [date, time] = s.split(' ');
      return t('{0} at {1}', date, time);
    };
    const meta = el('div', { className: 'details-meta' }, hashLink, ` ${d.author} `, el('span', { className: 'muted', text: `<${d.authorEmail}>` }), ` ${t('on {0}', when(d.authorTime))}`);
    const committerDiffers = d.committer !== d.author || d.committerEmail !== d.authorEmail;
    const committed = committerDiffers
      ? el('div', { className: 'details-meta' }, `${t('committed by {0}', d.committer)} `, el('span', { className: 'muted', text: `<${d.committerEmail}>` }), ` ${t('on {0}', when(d.commitTime))}`)
      : null;

    const labels = buildLabels(
      this.refs.filter((r) => r.hash === d.hash),
      this.head,
      d.hash,
    );
    const refsLine = labels.length > 0 ? el('div', { className: 'details-refs' }, ...labels.map(renderLabel)) : null;

    let branchesLine: HTMLElement;
    if (!this.containing || this.containing.hash !== d.hash) {
      branchesLine = el('div', { className: 'details-branches muted', text: t('Loading branches…') });
    } else {
      const list = this.containing.branches;
      const head = this.head.branch && list.includes(this.head.branch) ? ['HEAD'] : [];
      const all = [...head, ...list];
      const LIMIT = 3;
      if (all.length <= LIMIT || this.showAllBranches) {
        branchesLine = el('div', { className: 'details-branches' }, `${plural(all.length, 'In {0} branch', 'In {0} branches')}: ${all.join(', ') || '—'}`);
      } else {
        const more = el('a', { className: 'link', text: t('Show all'), attrs: { href: '#' } });
        more.addEventListener('click', (e) => {
          e.preventDefault();
          this.showAllBranches = true;
          this.renderInfo();
        });
        branchesLine = el('div', { className: 'details-branches' }, `${plural(all.length, 'In {0} branch', 'In {0} branches')}: ${all.slice(0, LIMIT).join(', ')}… `, more);
      }
    }

    const [subject, ...body] = d.message.split('\n');
    this.info.append(
      el(
        'div',
        { className: 'details-message' },
        el('div', { className: 'details-subject' }, linkify(subject, this.state?.webUrl)),
        body.join('\n').trim() ? el('pre', { className: 'details-body' }, linkify(body.join('\n').replace(/^\n+/, ''), this.state?.webUrl)) : null,
      ),
      meta,
      ...[committed, refsLine].filter((n): n is HTMLDivElement => n !== null),
      branchesLine,
    );
  }

  private renderMultiInfo(commits: SelectedCommit[]): void {
    const repos = new Set(commits.map((c) => c.root)).size;
    const header = el('div', { className: 'details-subject', text: repos > 1 ? t('{0} commits selected in {1} repositories', commits.length, repos) : t('{0} commits selected', commits.length) });
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
