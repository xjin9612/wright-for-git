// 取消儲藏對話框（對應 IntelliJ 的 Unstash Changes）：選儲藏、看檔案，套用／套用並刪除／建立成分支
import type { ChangedFile, StashInfo, ToWebview } from '../shared/protocol';
import { stashLabel } from '../shared/stash';
import { clear, el, formatDate } from './dom';
import { dialogFilesPane, type DialogFiles } from './dialogFiles';
import type { FileGroup } from './fileTree';
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


class UnstashDialog {
  private repos: RepoStashes[] = [];
  private root: string | undefined;
  private selected: string | undefined;
  private loadRequest = 0;
  private filesRequest = 0;
  private readonly repoSelect = el('select', { className: 'push-remote', attrs: { 'aria-label': t('Repository') } });
  private readonly list = el('div', { className: 'push-list', attrs: { tabindex: '0' } });
  private readonly files: DialogFiles = dialogFilesPane('unstash', {
    repoName: (root) => this.repos.find((r) => r.root === root)?.name ?? '',
    onOpen: (_g, file) => {
      if (this.root && this.selected) post({ type: 'openStashDiff', root: this.root, hash: this.selected, file });
    },
  });
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
    // 鍵盤：↑↓ 換儲藏、Enter 套用
    this.list.addEventListener('keydown', (e) => {
      const stashes = this.current?.stashes ?? [];
      const i = stashes.findIndex((s) => s.hash === this.selected);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const next = stashes[Math.max(0, Math.min(stashes.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (!next) return;
        e.preventDefault();
        this.selected = next.hash;
        this.render();
        this.list.querySelector('.push-commit.selected')?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && this.selected) {
        e.preventDefault();
        this.apply();
      }
    });
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
      el('div', { className: 'push-body' }, this.list, this.files.pane),
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
    const s = this.current?.stashes.find((x) => x.hash === this.selected);
    this.files.setTitle(s ? `${s.ref} ${stashLabel(s.message)}` : t('Changed files'));
    if (!s || !this.root) {
      this.files.tree.setEmpty('');
      return;
    }
    this.files.tree.setLoading();
    this.filesRequest = seq++;
    post({ type: 'unstashFiles', requestId: this.filesRequest, root: this.root, hash: s.hash });
  }

  private renderFiles(files: (ChangedFile & { untracked?: boolean })[]): void {
    if (!this.root) return;
    if (files.length === 0) {
      this.files.tree.setEmpty(t('No changes'));
      return;
    }
    // 未追蹤的檔案另成一組（與提交視窗的儲藏分頁相同）
    const tracked = files.filter((f) => !f.untracked);
    const untracked = files.filter((f) => f.untracked);
    const groups: FileGroup[] = [];
    if (tracked.length > 0) groups.push({ root: this.root, files: tracked });
    if (untracked.length > 0) groups.push({ root: this.root, files: untracked, section: t('Untracked files') });
    this.files.tree.setGroups(groups);
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

