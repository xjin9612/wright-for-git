// Push 對話框（仿 IntelliJ Push Commits）：
// 左側列出各 repo 的推送目標與待推 commit，右側為選取 commit 的變更檔案；
// Push 按鈕的下拉選單提供 Force Push。推送前一定經過這個對話框，避免誤觸。
import type { ChangedFile, PushCommit, PushPlan, PushTarget, ToWebview } from '../shared/protocol';
import { clear, el, formatDate, icon, showMenu } from './dom';
import { dialogFilesPane, type DialogFiles } from './dialogFiles';
import { post } from './vscodeApi';
import { plural, t } from './l10n';

export interface PushDialogOptions {
  roots: string[];
  /** 推指定的 local branch（Branches 右鍵 Push…）；未指定為目前 branch */
  branch?: string;
  /** Push All up to Here：只推到這個 commit */
  upTo?: { root: string; hash: string };
  onOpenDiff: (root: string, hash: string, parent: string | undefined, file: ChangedFile) => void;
  /** 開在編輯器分頁：填滿整頁、沒有遮罩；關閉時通知 extension 關掉分頁 */
  embedded?: boolean;
}

type DialogMessage = Extract<ToWebview, { type: 'pushPreview' | 'pushCommitFiles' | 'pushStatus' }>;


let current: PushDialog | undefined;
let nextRequest = 1;

export function openPushDialog(opts: PushDialogOptions): void {
  current?.close();
  current = new PushDialog(opts);
}

/** 由 main.ts 轉送 extension 的回應 */
export function handlePushMessage(m: DialogMessage): void {
  current?.onMessage(m);
}

export function isPushDialogOpen(): boolean {
  return current !== undefined;
}

/** 可以推送：沒有問題，且有 commit 要推、是新 branch，或遠端有本機沒有的 commit（force 時有意義） */
function pushable(p: PushPlan): boolean {
  return !p.problem && (p.total > 0 || p.isNew || p.behind > 0);
}

function problemText(p: PushPlan): string {
  switch (p.problem) {
    case 'detached':
      return t('detached HEAD');
    case 'noRemote':
      return t('no remote');
    case 'notAncestor':
      return t('commit is not on the current branch');
    case 'error':
      return p.message ?? t('error');
    default:
      return t('nothing to push');
  }
}

class PushDialog {
  private readonly overlay: HTMLElement;
  private readonly list: HTMLElement;
  private readonly files: DialogFiles;
  private readonly pushButton: HTMLButtonElement;
  private readonly caretButton: HTMLButtonElement;
  private readonly tagsBox: HTMLInputElement;
  private plans: PushPlan[] = [];
  /** 使用者勾選要推的 repo */
  private readonly checked = new Set<string>();
  /** 使用者改過的目標（remote／remote branch） */
  private readonly overrides = new Map<string, PushTarget>();
  private previewRequest = 0;
  private filesRequest = 0;
  private confirmRequest = 0;
  /** 選取的 commit（同一個 repo，可多選；點 repo 列選取全部），依清單順序（新到舊） */
  private selected: { root: string; commits: PushCommit[] } | undefined;
  /** Shift 範圍選取的起點 */
  private anchor: string | undefined;
  private busy = false;
  /** 改了目標（remote／分支）後，等新的預覽回來前不能推送，避免推到舊的目標 */
  private pending = false;
  private loaded = false;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(private readonly opts: PushDialogOptions) {
    this.list = el('div', { className: 'push-list', attrs: { tabindex: '0' } });
    this.files = dialogFilesPane('push', {
      repoName: (root) => this.plans.find((p) => p.root === root)?.name ?? '',
      onOpen: (_g, file) => {
        // 多筆合併的檔案自帶左右兩側的 revision；單筆時以該 commit 與其 parent 比較
        const c = this.selected?.commits[0];
        if (c && this.selected) this.opts.onOpenDiff(this.selected.root, c.hash, c.parents[0], file);
      },
    });
    this.tagsBox = el('input', { attrs: { type: 'checkbox', id: 'push-tags' } });

    this.pushButton = el('button', { className: 'button primary push-main', text: t('Push'), attrs: { type: 'button' } });
    this.pushButton.addEventListener('click', () => this.confirm(false));
    this.caretButton = el('button', { className: 'button primary push-caret', title: t('More push options'), attrs: { type: 'button', 'aria-label': t('More push options') } }, icon('chevron-down'));
    this.caretButton.addEventListener('click', () => {
      const r = this.caretButton.getBoundingClientRect();
      showMenu(r.right - 200, r.bottom + 2, [{ label: t('Force Push (with lease)…'), disabled: !this.canPush(), action: () => this.confirm(true) }]);
    });
    const cancel = el('button', { className: 'button secondary dialog-cancel', text: t('Cancel'), attrs: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());

    const title = opts.upTo ? t('Push Commits up to {0}', opts.upTo.hash.slice(0, 8)) : opts.branch ? t('Push {0}', opts.branch) : t('Push Commits');
    const dialog = el(
      'div',
      { className: 'push-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
      el('div', { className: 'push-header', text: title }),
      el('div', { className: 'push-body' }, this.list, this.files.pane),
      el(
        'div',
        { className: 'push-footer' },
        el('label', { className: 'push-option', title: t('Also push annotated tags that point at the pushed commits (--follow-tags)'), attrs: { for: 'push-tags' } }, this.tagsBox, t('Push tags')),
        el('div', { className: 'toolbar-spacer' }),
        cancel,
        el('div', { className: 'split-button' }, this.pushButton, this.caretButton),
      ),
    );
    this.overlay = el('div', { className: `modal-overlay${opts.embedded ? ' embedded' : ''}` }, dialog);
    // 點遮罩不關閉（避免誤觸），只有 Cancel／Esc 會關閉
    document.body.append(this.overlay);
    document.addEventListener('keydown', this.onKey, true);
    this.list.append(el('div', { className: 'empty-text', text: t('Loading…') }));
    this.updateButtons();
    this.requestPreview();
    this.list.focus();
  }

  close(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.overlay.remove();
    if (current === this) current = undefined;
    if (this.opts.embedded) post({ type: 'closeDialog' });
  }

  onMessage(m: DialogMessage): void {
    if (m.type === 'pushPreview' && m.requestId === this.previewRequest) {
      this.pending = false;
      const first = !this.loaded;
      this.loaded = true;
      this.plans = m.plans;
      // 預設勾選所有可推送的 repo；之後的重新整理保留使用者的勾選
      for (const p of m.plans) {
        if (!pushable(p)) this.checked.delete(p.root);
        else if (first) this.checked.add(p.root);
      }
      const sel = this.selected;
      const still = sel && sel.commits.every((c) => this.findCommit(sel.root, c.hash));
      if (first || !still) {
        // 預設選取第一個 repo 的全部 commit：一次看這次要推的所有改動
        const p = m.plans.find((x) => pushable(x) && x.commits.length > 0);
        this.select(p ? { root: p.root, commits: [...p.commits] } : undefined);
      }
      this.render();
      this.updateButtons();
    } else if (m.type === 'pushCommitFiles' && m.requestId === this.filesRequest) {
      this.renderFiles(m.files);
    } else if (m.type === 'pushStatus' && m.requestId === this.confirmRequest) {
      if (m.status === 'started') this.close();
      else {
        this.busy = false;
        this.updateButtons();
      }
    }
  }

  private requestPreview(): void {
    this.previewRequest = nextRequest++;
    this.pending = true;
    if (this.pushButton) this.updateButtons();
    post({ type: 'pushPreview', requestId: this.previewRequest, roots: this.opts.roots, branch: this.opts.branch, upTo: this.opts.upTo, overrides: [...this.overrides.values()] });
  }

  private findCommit(root: string, hash: string): PushCommit | undefined {
    return this.plans.find((p) => p.root === root)?.commits.find((c) => c.hash === hash);
  }

  private select(sel: { root: string; commits: PushCommit[] } | undefined): void {
    this.selected = sel && sel.commits.length > 0 ? sel : undefined;
    this.syncSelection();
    if (!this.selected) {
      this.files.setTitle(t('Changed files'));
      this.files.tree.setEmpty('');
      return;
    }
    const { root, commits } = this.selected;
    const plan = this.plans.find((p) => p.root === root);
    const all = !!plan && commits.length === plan.commits.length && commits.length > 1;
    this.files.setTitle(
      commits.length === 1
        ? `${commits[0].hash.slice(0, 8)} ${commits[0].subject}`
        : all
          ? t('All {0} commits to push', commits.length)
          : plural(commits.length, '{0} commit selected', '{0} commits selected'),
    );
    this.files.tree.setLoading();
    this.filesRequest = nextRequest++;
    post({ type: 'pushCommitFiles', requestId: this.filesRequest, root, hash: commits[0].hash, hashes: commits.map((c) => c.hash) });
  }

  /** 點 commit：一般點選單選；Ctrl 加選／取消；Shift 範圍選取（只限同一個 repo） */
  private clickCommit(p: PushPlan, c: PushCommit, e: MouseEvent): void {
    const same = this.selected?.root === p.root;
    let list: PushCommit[];
    if (e.shiftKey && same && this.anchor) {
      const a = p.commits.findIndex((x) => x.hash === this.anchor);
      const b = p.commits.indexOf(c);
      list = a < 0 ? [c] : p.commits.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else if ((e.ctrlKey || e.metaKey) && same) {
      const has = this.selected!.commits.some((x) => x.hash === c.hash);
      const set = new Set(this.selected!.commits.map((x) => x.hash));
      if (has) set.delete(c.hash);
      else set.add(c.hash);
      list = p.commits.filter((x) => set.has(x.hash));
      this.anchor = c.hash;
    } else {
      list = [c];
      this.anchor = c.hash;
    }
    this.select({ root: p.root, commits: list });
  }

  /** 只更新選取樣式，不重繪清單（避免輸入框失去焦點） */
  private syncSelection(): void {
    const sel = this.selected;
    for (const row of this.list.querySelectorAll<HTMLElement>('.push-commit')) {
      row.classList.toggle('selected', !!sel && row.dataset.root === sel.root && sel.commits.some((c) => c.hash === row.dataset.hash));
    }
    for (const row of this.list.querySelectorAll<HTMLElement>('.push-repo')) {
      const plan = this.plans.find((p) => p.root === row.dataset.root);
      row.classList.toggle('selected', !!sel && !!plan && sel.root === plan.root && sel.commits.length === plan.commits.length && plan.commits.length > 1);
    }
  }

  private canPush(): boolean {
    return !this.busy && !this.pending && this.plans.some((p) => pushable(p) && this.checked.has(p.root));
  }

  private updateButtons(): void {
    const ok = this.canPush();
    this.pushButton.disabled = !ok;
    this.caretButton.disabled = this.busy || !this.plans.some(pushable);
    this.pushButton.textContent = this.busy ? t('Pushing…') : t('Push');
  }

  private confirm(force: boolean): void {
    if (!this.canPush()) return;
    const targets: PushTarget[] = this.plans
      .filter((p) => pushable(p) && this.checked.has(p.root))
      .map((p) => ({ root: p.root, branch: p.branch, remote: p.remote!, remoteBranch: p.remoteBranch!, upTo: p.upTo, expected: p.trackingHash }));
    this.busy = true;
    this.updateButtons();
    this.confirmRequest = nextRequest++;
    post({ type: 'pushConfirm', requestId: this.confirmRequest, targets, force, tags: this.tagsBox.checked });
  }

  private handleKey(e: KeyboardEvent): void {
    // 選單開著時讓選單自己處理 Esc
    if (document.querySelector('.context-menu')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!this.busy) this.close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      this.confirm(false);
    }
  }

  /** 修改推送目標後重新預覽 */
  private retarget(p: PushPlan, change: Partial<PushTarget>): void {
    const prev = this.overrides.get(p.root) ?? { root: p.root, branch: p.branch, remote: p.remote!, remoteBranch: p.remoteBranch! };
    const next = { ...prev, ...change };
    // 換 remote 時，branch 名稱回到預設（由 extension 決定）
    if (change.remote && change.remote !== prev.remote && !change.remoteBranch) next.remoteBranch = '';
    this.overrides.set(p.root, next);
    this.requestPreview();
  }

  private render(): void {
    clear(this.list);
    const active = this.plans.filter(pushable);
    const idle = this.plans.filter((p) => !pushable(p));
    const multi = this.plans.length > 1;

    if (active.length === 0) {
      const text = this.plans.length === 1 ? t('Nothing to push ({0})', problemText(this.plans[0])) : t('Nothing to push');
      this.list.append(el('div', { className: 'empty-text', text, title: idle.map((p) => `${p.name} (${problemText(p)})`).join('\n') }));
    }

    for (const p of active) {
      const box = el('input', { attrs: { type: 'checkbox', 'aria-label': t('Push {0}', p.name) } });
      box.checked = this.checked.has(p.root);
      box.addEventListener('change', () => {
        if (box.checked) this.checked.add(p.root);
        else this.checked.delete(p.root);
        this.updateButtons();
      });

      const remote: HTMLElement =
        p.remotes.length > 1
          ? (() => {
              const s = el('select', { className: 'push-remote', attrs: { 'aria-label': t('Remote') } });
              for (const r of p.remotes) s.append(el('option', { text: r, attrs: { value: r } }));
              s.value = p.remote!;
              s.addEventListener('change', () => this.retarget(p, { remote: s.value }));
              return s;
            })()
          : el('span', { className: 'push-remote', text: p.remote! });

      const branchInput = el('input', { className: 'push-branch', attrs: { type: 'text', spellcheck: 'false', 'aria-label': t('Remote branch'), title: t('Remote branch (click to edit)') } });
      branchInput.value = p.remoteBranch!;
      branchInput.size = Math.max(4, p.remoteBranch!.length);
      const commitBranch = () => {
        const v = branchInput.value.trim();
        if (v && v !== p.remoteBranch) this.retarget(p, { remoteBranch: v });
        else branchInput.value = p.remoteBranch!;
      };
      branchInput.addEventListener('input', () => (branchInput.size = Math.max(4, branchInput.value.length)));
      branchInput.addEventListener('change', commitBranch);
      branchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          branchInput.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          branchInput.value = p.remoteBranch!;
          branchInput.blur();
        }
      });

      const source = p.upTo ? el('span', { className: 'push-source hash', text: p.upTo.slice(0, 8), title: t('Only commits up to {0}', p.upTo) }) : el('span', { className: 'push-source', text: p.branch ?? '' });
      const header = el(
        'div',
        { className: 'push-repo', title: t('Click to show the changes of all commits to push'), attrs: { 'data-root': p.root } },
        box,
        multi ? el('span', { className: 'push-repo-name', text: p.name, title: p.root }) : null,
        icon('branch'),
        source,
        el('span', { className: 'muted', text: '→' }),
        remote,
        el('span', { className: 'muted', text: ':' }),
        branchInput,
        p.isNew ? el('span', { className: 'push-badge new', text: t('New'), title: t('The branch does not exist on the remote yet') }) : null,
        !p.hasUpstream && !p.upTo ? el('span', { className: 'push-badge', text: t('set upstream'), title: t('The local branch will track this remote branch (--set-upstream)') }) : null,
        el('span', { className: 'toolbar-spacer' }),
        el('span', { className: 'tree-count', text: plural(p.total, '{0} commit', '{0} commits') }),
      );
      // 點 repo 列（不含勾選框、輸入框）：選取這個 repo 的全部 commit，右側顯示合併後的所有改動
      header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('input, select')) return;
        this.anchor = p.commits[0]?.hash;
        this.select({ root: p.root, commits: [...p.commits] });
      });
      this.list.append(header);

      if (p.behind > 0) {
        this.list.append(
          el(
            'div',
            { className: 'push-warning' },
            icon('warning'),
            el('span', { text: t("The remote branch has {0} commit(s) you don't have. Push will be rejected — pull first, or use Force Push to overwrite.", p.behind) }),
          ),
        );
      }
      for (const c of p.commits) {
        const row = el(
          'div',
          { className: 'push-commit', title: `${c.hash}\n${c.author} · ${formatDate(c.authorTime)}`, attrs: { 'data-root': p.root, 'data-hash': c.hash } },
          el('span', { className: 'push-commit-subject', text: c.subject }),
          el('span', { className: 'muted push-commit-meta', text: `${c.author} · ${formatDate(c.authorTime)}` }),
        );
        row.addEventListener('click', (e) => this.clickCommit(p, c, e));
        this.list.append(row);
      }
      if (p.total > p.commits.length) this.list.append(el('div', { className: 'push-more muted', text: t('… and {0} more', p.total - p.commits.length) }));
    }

    if (idle.length > 0 && active.length > 0) {
      const names = idle.map((p) => `${p.name} (${problemText(p)})`);
      this.list.append(el('div', { className: 'push-idle muted', text: plural(idle.length, 'Nothing to push in {0} repository', 'Nothing to push in {0} repositories'), title: names.join('\n') }));
    }
    this.syncSelection();
    this.updateButtons();
  }

  private renderFiles(files: ChangedFile[]): void {
    const sel = this.selected;
    if (!sel) return;
    if (files.length === 0) this.files.tree.setEmpty(t('No changes'));
    else this.files.tree.setGroups([{ root: sel.root, files }]);
  }
}
