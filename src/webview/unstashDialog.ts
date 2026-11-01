// 取消儲藏對話框（對應 IntelliJ 的 Unstash Changes）：選儲藏、看檔案，套用／套用並刪除／建立成分支
import type { ChangedFile, StashInfo, ToWebview } from '../shared/protocol';
import { clear, el, formatDate } from './dom';
import { fileIcon, statusClass, statusLetter } from './fileIcons';
import { t } from './l10n';
import { post } from './vscodeApi';

type RepoStashes = { root: string; name: string; stashes: StashInfo[] };
type Msg = Extract<ToWebview, { type: 'unstashData' | 'unstashFiles' | 'stashChanged' }>;

let instance: UnstashDialog | undefined;
let seq = 1;

export function openUnstashDialog(root: string | undefined): void {
  instance = new UnstashDialog(root);
}

export function handleUnstashMessage(m: Msg): void {
  instance?.onMessage(m);
}

/** 「On main: msg」→「msg」；「WIP on main: abc123 subject」→「WIP: subject」 */
function stashLabel(message: string): string {
  const wip = /^WIP on [^:]+: [0-9a-f]+ (.*)$/.exec(message);
  if (wip) return `WIP: ${wip[1]}`;
  const on = /^On [^:]+: (.*)$/.exec(message);
  return on ? on[1] : message;
}

class UnstashDialog {
  private repos: RepoStashes[] = [];
  private root: string | undefined;
  private selected: string | undefined;
  private loadRequest = 0;
  private filesRequest = 0;
  private readonly repoSelect = el('select', { className: 'push-remote', attrs: { 'aria-label': t('Repository') } });
  private readonly list = el('div', { className: 'push-list', attrs: { tabindex: '0' } });
  private readonly files = el('div', { className: 'tree push-files' });
  private readonly filesTitle = el('div', { className: 'push-files-title muted', text: t('Changed files') });
  private readonly pop = el('input', { attrs: { type: 'checkbox', id: 'unstash-pop' } });
  private readonly index = el('input', { attrs: { type: 'checkbox', id: 'unstash-index' } });
  private readonly branch = el('input', { className: 'text-input unstash-branch', attrs: { type: 'text', spellcheck: 'false', placeholder: t('As new branch (optional)') } });
  private readonly applyButton = el('button', { className: 'button primary', text: t('Apply Stash'), attrs: { type: 'button' } });
  private readonly dropButton = el('button', { className: 'button secondary', text: t('Drop'), attrs: { type: 'button' } });
  private readonly clearButton = el('button', { className: 'button secondary', text: t('Clear'), attrs: { type: 'button' } });

  constructor(root: string | undefined) {
    this.root = root;
    this.repoSelect.addEventListener('change', () => {
      this.root = this.repoSelect.value;
      this.selected = undefined;
      this.render();
    });
    const sync = () => this.syncButtons();
    this.pop.addEventListener('change', sync);
    this.branch.addEventListener('input', sync);
    this.applyButton.addEventListener('click', () => this.apply());
    this.dropButton.addEventListener('click', () => {
      if (this.root && this.selected) post({ type: 'unstashDrop', root: this.root, hash: this.selected });
    });
    this.clearButton.addEventListener('click', () => {
      if (this.root) post({ type: 'unstashClear', root: this.root });
    });
    const cancel = el('button', { className: 'button secondary dialog-cancel', text: t('Cancel'), attrs: { type: 'button' } });
    cancel.addEventListener('click', () => post({ type: 'closeDialog' }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.querySelector('.confirm-dialog')) post({ type: 'closeDialog' });
    });

    const dialog = el(
      'div',
      { className: 'push-dialog', attrs: { role: 'dialog', 'aria-label': t('Unstash Changes') } },
      el('div', { className: 'push-header unstash-header' }, el('span', { text: t('Unstash Changes') }), el('span', { className: 'toolbar-spacer' }), this.repoSelect),
      el('div', { className: 'push-body' }, this.list, el('div', { className: 'push-files-pane' }, this.filesTitle, this.files)),
      el(
        'div',
        { className: 'push-footer' },
        el('label', { className: 'push-option', attrs: { for: 'unstash-pop' } }, this.pop, t('Pop stash')),
        el('label', { className: 'push-option', title: t('Also restore what was staged (--index)'), attrs: { for: 'unstash-index' } }, this.index, t('Reinstate index')),
        this.branch,
        el('div', { className: 'toolbar-spacer' }),
        this.clearButton,
        this.dropButton,
        cancel,
        this.applyButton,
      ),
    );
    document.body.append(el('div', { className: 'modal-overlay embedded' }, dialog));
    this.load();
  }

  private load(): void {
    this.loadRequest = seq++;
    post({ type: 'unstashLoad', requestId: this.loadRequest });
  }

  onMessage(m: Msg): void {
    if (m.type === 'stashChanged') this.load();
    else if (m.type === 'unstashData' && m.requestId === this.loadRequest) {
      this.repos = m.repos;
      if (!this.root || !this.repos.some((r) => r.root === this.root)) this.root = (this.repos.find((r) => r.stashes.length > 0) ?? this.repos[0])?.root;
      this.render();
    } else if (m.type === 'unstashFiles' && m.requestId === this.filesRequest) {
      this.renderFiles(m.files);
    }
  }

  private get current(): RepoStashes | undefined {
    return this.repos.find((r) => r.root === this.root);
  }

  private render(): void {
    clear(this.repoSelect);
    for (const r of this.repos) this.repoSelect.append(el('option', { text: `${r.name} (${r.stashes.length})`, attrs: { value: r.root } }));
    if (this.root) this.repoSelect.value = this.root;
    this.repoSelect.style.display = this.repos.length > 1 ? '' : 'none';

    clear(this.list);
    const stashes = this.current?.stashes ?? [];
    if (!stashes.some((s) => s.hash === this.selected)) this.selected = stashes[0]?.hash;
    if (stashes.length === 0) this.list.append(el('div', { className: 'empty-text', text: t('No stashes') }));
    for (const s of stashes) {
      const row = el(
        'div',
        { className: `push-commit${s.hash === this.selected ? ' selected' : ''}`, title: `${s.ref}\n${s.message}` },
        el('span', { className: 'hash', text: s.ref }),
        el('span', { className: 'push-commit-subject', text: stashLabel(s.message) }),
        el('span', { className: 'muted push-commit-meta', text: `${s.branch ?? ''} · ${formatDate(s.time)}` }),
      );
      row.addEventListener('click', () => {
        this.selected = s.hash;
        this.render();
      });
      row.addEventListener('dblclick', () => this.apply());
      this.list.append(row);
    }
    this.syncButtons();
    this.requestFiles();
  }

  private requestFiles(): void {
    clear(this.files);
    const s = this.current?.stashes.find((x) => x.hash === this.selected);
    this.filesTitle.textContent = s ? `${s.ref} ${stashLabel(s.message)}` : t('Changed files');
    if (!s || !this.root) return;
    this.files.append(el('div', { className: 'empty-text', text: t('Loading…') }));
    this.filesRequest = seq++;
    post({ type: 'unstashFiles', requestId: this.filesRequest, root: this.root, hash: s.hash });
  }

  private renderFiles(files: (ChangedFile & { untracked?: boolean })[]): void {
    clear(this.files);
    if (files.length === 0) this.files.append(el('div', { className: 'empty-text', text: t('No changes') }));
    for (const f of files) {
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      const dir = f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')));
      const row = el(
        'div',
        { className: 'tree-row', title: `${f.path}\n${t('Double-click to show the diff')}` },
        fileIcon(f.path),
        el('span', { className: `tree-label ${statusClass(f.untracked ? 'untracked' : f.status)}`, text: name }),
        el('span', { className: 'tree-count', text: dir }),
        statusLetter(f.untracked ? 'untracked' : f.status),
      );
      row.addEventListener('dblclick', () => {
        if (this.root && this.selected) post({ type: 'openStashDiff', root: this.root, hash: this.selected, file: f });
      });
      this.files.append(row);
    }
  }

  private syncButtons(): void {
    const has = !!this.selected;
    this.applyButton.disabled = !has;
    this.dropButton.disabled = !has;
    this.clearButton.disabled = (this.current?.stashes.length ?? 0) === 0;
    const branch = this.branch.value.trim();
    this.applyButton.textContent = branch ? t('Create Branch') : this.pop.checked ? t('Pop Stash') : t('Apply Stash');
    this.index.disabled = !!branch;
    this.pop.disabled = !!branch;
  }

  private apply(): void {
    if (!this.root || !this.selected) return;
    const branch = this.branch.value.trim();
    post({ type: 'unstashApply', root: this.root, hash: this.selected, pop: this.pop.checked, index: this.index.checked, branch: branch || undefined });
  }
}

