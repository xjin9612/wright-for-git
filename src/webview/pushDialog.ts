// Push 對話框（仿 IntelliJ Push Commits）：
// 左側列出各 repo 的推送目標與待推 commit，右側為選取 commit 的變更檔案；
// Push 按鈕的下拉選單提供 Force Push。推送前一定經過這個對話框，避免誤觸。
import type { ChangedFile, PushCommit, PushPlan, PushTarget, ToWebview } from '../shared/protocol';
import { clear, el, formatDate, icon, showMenu } from './dom';
import { post } from './vscodeApi';

export interface PushDialogOptions {
  roots: string[];
  /** 推指定的 local branch（Branches 右鍵 Push…）；未指定為目前 branch */
  branch?: string;
  /** Push All up to Here：只推到這個 commit */
  upTo?: { root: string; hash: string };
  onOpenDiff: (root: string, hash: string, parent: string | undefined, file: ChangedFile) => void;
}

type DialogMessage = Extract<ToWebview, { type: 'pushPreview' | 'pushCommitFiles' | 'pushStatus' }>;

const STATUS_TEXT: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflict' };

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
      return 'detached HEAD';
    case 'noRemote':
      return 'no remote';
    case 'notAncestor':
      return 'commit is not on the current branch';
    case 'error':
      return p.message ?? 'error';
    default:
      return 'nothing to push';
  }
}

class PushDialog {
  private readonly overlay: HTMLElement;
  private readonly list: HTMLElement;
  private readonly files: HTMLElement;
  private readonly filesTitle: HTMLElement;
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
  private selected: { root: string; commit: PushCommit } | undefined;
  private busy = false;
  private loaded = false;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(private readonly opts: PushDialogOptions) {
    this.list = el('div', { className: 'push-list', attrs: { tabindex: '0' } });
    this.filesTitle = el('div', { className: 'push-files-title muted', text: 'Changed files' });
    this.files = el('div', { className: 'tree push-files' });
    this.tagsBox = el('input', { attrs: { type: 'checkbox', id: 'push-tags' } });

    this.pushButton = el('button', { className: 'button primary push-main', text: 'Push', attrs: { type: 'button' } });
    this.pushButton.addEventListener('click', () => this.confirm(false));
    this.caretButton = el('button', { className: 'button primary push-caret', title: 'More push options', attrs: { type: 'button', 'aria-label': 'More push options' } }, icon('chevron-down'));
    this.caretButton.addEventListener('click', () => {
      const r = this.caretButton.getBoundingClientRect();
      showMenu(r.right - 200, r.bottom + 2, [{ label: 'Force Push (with lease)…', disabled: !this.canPush(), action: () => this.confirm(true) }]);
    });
    const cancel = el('button', { className: 'button secondary', text: 'Cancel', attrs: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());

    const title = opts.upTo ? `Push Commits up to ${opts.upTo.hash.slice(0, 8)}` : opts.branch ? `Push ${opts.branch}` : 'Push Commits';
    const dialog = el(
      'div',
      { className: 'push-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
      el('div', { className: 'push-header', text: title }),
      el('div', { className: 'push-body' }, this.list, el('div', { className: 'push-files-pane' }, this.filesTitle, this.files)),
      el(
        'div',
        { className: 'push-footer' },
        el('label', { className: 'push-option', title: 'Also push annotated tags that point at the pushed commits (--follow-tags)', attrs: { for: 'push-tags' } }, this.tagsBox, 'Push tags'),
        el('div', { className: 'toolbar-spacer' }),
        cancel,
        el('div', { className: 'split-button' }, this.pushButton, this.caretButton),
      ),
    );
    this.overlay = el('div', { className: 'modal-overlay' }, dialog);
    // 點遮罩不關閉（避免誤觸），只有 Cancel／Esc 會關閉
    document.body.append(this.overlay);
    document.addEventListener('keydown', this.onKey, true);
    this.list.append(el('div', { className: 'empty-text', text: 'Loading…' }));
    this.updateButtons();
    this.requestPreview();
    this.list.focus();
  }

  close(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.overlay.remove();
    if (current === this) current = undefined;
  }

  onMessage(m: DialogMessage): void {
    if (m.type === 'pushPreview' && m.requestId === this.previewRequest) {
      const first = !this.loaded;
      this.loaded = true;
      this.plans = m.plans;
      // 預設勾選所有可推送的 repo；之後的重新整理保留使用者的勾選
      for (const p of m.plans) {
        if (!pushable(p)) this.checked.delete(p.root);
        else if (first) this.checked.add(p.root);
      }
      if (first || !this.selected || !this.findCommit(this.selected.root, this.selected.commit.hash)) {
        const p = m.plans.find((x) => pushable(x) && x.commits.length > 0);
        this.select(p ? { root: p.root, commit: p.commits[0] } : undefined);
      }
      this.render();
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
    post({ type: 'pushPreview', requestId: this.previewRequest, roots: this.opts.roots, branch: this.opts.branch, upTo: this.opts.upTo, overrides: [...this.overrides.values()] });
  }

  private findCommit(root: string, hash: string): PushCommit | undefined {
    return this.plans.find((p) => p.root === root)?.commits.find((c) => c.hash === hash);
  }

  private select(sel: { root: string; commit: PushCommit } | undefined): void {
    this.selected = sel;
    clear(this.files);
    if (!sel) {
      this.filesTitle.textContent = 'Changed files';
      return;
    }
    this.filesTitle.textContent = `${sel.commit.hash.slice(0, 8)} ${sel.commit.subject}`;
    this.filesTitle.title = this.filesTitle.textContent;
    this.files.append(el('div', { className: 'empty-text', text: 'Loading…' }));
    this.filesRequest = nextRequest++;
    post({ type: 'pushCommitFiles', requestId: this.filesRequest, root: sel.root, hash: sel.commit.hash });
  }

  private canPush(): boolean {
    return !this.busy && this.plans.some((p) => pushable(p) && this.checked.has(p.root));
  }

  private updateButtons(): void {
    const ok = this.canPush();
    this.pushButton.disabled = !ok;
    this.caretButton.disabled = this.busy || !this.plans.some(pushable);
    this.pushButton.textContent = this.busy ? 'Pushing…' : 'Push';
  }

  private confirm(force: boolean): void {
    if (!this.canPush()) return;
    const targets: PushTarget[] = this.plans
      .filter((p) => pushable(p) && this.checked.has(p.root))
      .map((p) => ({ root: p.root, branch: p.branch, remote: p.remote!, remoteBranch: p.remoteBranch!, upTo: p.upTo }));
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
      const text = this.plans.length === 1 ? `Nothing to push (${problemText(this.plans[0])})` : 'Nothing to push';
      this.list.append(el('div', { className: 'empty-text', text, title: idle.map((p) => `${p.name} (${problemText(p)})`).join('\n') }));
    }

    for (const p of active) {
      const box = el('input', { attrs: { type: 'checkbox', 'aria-label': `Push ${p.name}` } });
      box.checked = this.checked.has(p.root);
      box.addEventListener('change', () => {
        if (box.checked) this.checked.add(p.root);
        else this.checked.delete(p.root);
        this.updateButtons();
      });

      const remote: HTMLElement =
        p.remotes.length > 1
          ? (() => {
              const s = el('select', { className: 'push-remote', attrs: { 'aria-label': 'Remote' } });
              for (const r of p.remotes) s.append(el('option', { text: r, attrs: { value: r } }));
              s.value = p.remote!;
              s.addEventListener('change', () => this.retarget(p, { remote: s.value }));
              return s;
            })()
          : el('span', { className: 'push-remote', text: p.remote! });

      const branchInput = el('input', { className: 'push-branch', attrs: { type: 'text', spellcheck: 'false', 'aria-label': 'Remote branch', title: 'Remote branch (click to edit)' } });
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

      const source = p.upTo ? el('span', { className: 'push-source hash', text: p.upTo.slice(0, 8), title: `Only commits up to ${p.upTo}` }) : el('span', { className: 'push-source', text: p.branch ?? '' });
      const header = el(
        'div',
        { className: 'push-repo' },
        box,
        multi ? el('span', { className: 'push-repo-name', text: p.name, title: p.root }) : null,
        icon('branch'),
        source,
        el('span', { className: 'muted', text: '→' }),
        remote,
        el('span', { className: 'muted', text: ':' }),
        branchInput,
        p.isNew ? el('span', { className: 'push-badge new', text: 'New', title: 'The branch does not exist on the remote yet' }) : null,
        !p.hasUpstream && !p.upTo ? el('span', { className: 'push-badge', text: 'set upstream', title: 'The local branch will track this remote branch (--set-upstream)' }) : null,
        el('span', { className: 'toolbar-spacer' }),
        el('span', { className: 'tree-count', text: `${p.total} ${p.total === 1 ? 'commit' : 'commits'}` }),
      );
      this.list.append(header);

      if (p.behind > 0) {
        this.list.append(
          el(
            'div',
            { className: 'push-warning' },
            `⚠ The remote branch has ${p.behind} ${p.behind === 1 ? 'commit' : 'commits'} you don't have. Push will be rejected — pull first, or use Force Push to overwrite.`,
          ),
        );
      }
      for (const c of p.commits) {
        const sel = this.selected?.root === p.root && this.selected.commit.hash === c.hash;
        const row = el(
          'div',
          { className: `push-commit${sel ? ' selected' : ''}`, title: `${c.hash}\n${c.author} · ${formatDate(c.authorTime)}` },
          el('span', { className: 'push-commit-subject', text: c.subject }),
          el('span', { className: 'muted push-commit-meta', text: `${c.author} · ${formatDate(c.authorTime)}` }),
        );
        row.addEventListener('click', () => {
          this.list.querySelector('.push-commit.selected')?.classList.remove('selected');
          row.classList.add('selected');
          this.select({ root: p.root, commit: c });
        });
        this.list.append(row);
      }
      if (p.total > p.commits.length) this.list.append(el('div', { className: 'push-more muted', text: `… and ${p.total - p.commits.length} more` }));
    }

    if (idle.length > 0 && active.length > 0) {
      const names = idle.map((p) => `${p.name} (${problemText(p)})`);
      this.list.append(el('div', { className: 'push-idle muted', text: `Nothing to push in ${idle.length} ${idle.length === 1 ? 'repository' : 'repositories'}`, title: names.join('\n') }));
    }
    this.updateButtons();
  }

  private renderFiles(files: ChangedFile[]): void {
    clear(this.files);
    const sel = this.selected;
    if (!sel) return;
    if (files.length === 0) {
      this.files.append(el('div', { className: 'empty-text', text: 'No changes' }));
      return;
    }
    for (const f of files) {
      const name = f.path.split('/').pop() ?? f.path;
      const dir = f.path.slice(0, f.path.length - name.length).replace(/\/$/, '');
      const row = el(
        'div',
        { className: 'tree-row', title: `${STATUS_TEXT[f.status] ?? f.status}: ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}\nDouble-click to show the diff` },
        icon('file'),
        el('span', { className: `tree-label status-${f.status}`, text: name }),
        dir ? el('span', { className: 'tree-count', text: dir }) : null,
      );
      row.addEventListener('click', () => {
        this.files.querySelector('.tree-row.selected')?.classList.remove('selected');
        row.classList.add('selected');
      });
      row.addEventListener('dblclick', () => this.opts.onOpenDiff(sel.root, sel.commit.hash, sel.commit.parents[0], f));
      this.files.append(row);
    }
  }
}
