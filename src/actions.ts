// 寫入類操作的 UI 流程：同步（fetch／pull／push）與 Commit 右鍵選單
// git 指令本身在 GitRepository；這裡負責確認框、多 repo 彙整、衝突處理
import * as path from 'node:path';
import * as vscode from 'vscode';
import { revisionUri } from './diffProvider';
import type { GitRepository } from './git/repository';
import type { CommitAction, PushPlan, PushTarget, RefAction, RefInfo, RepoState, SyncAction } from './shared/protocol';
import { t } from './i18n';
import { confirm, type ConfirmHost } from './dialogs';

export interface RepoTarget {
  repo: GitRepository;
  name: string;
  state?: RepoState;
}


function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function short(hash: string): string {
  return hash.slice(0, 8);
}

type Operation = 'cherry-pick' | 'revert' | 'merge' | 'rebase';

/**
 * 執行可能產生衝突的操作：只有「這次操作才開始」的 cherry-pick／revert／merge／rebase 才視為衝突；
 * 原本就在進行中的操作（使用者正在解衝突）不會被誤判，也不會提供中止它的按鈕。
 * @returns 發生衝突時回傳進行中的操作；其他錯誤照常丟出
 */
async function withConflictCheck(target: RepoTarget, fn: () => Promise<void>): Promise<Operation | undefined> {
  const before = await target.repo.operationInProgress();
  try {
    await fn();
    return undefined;
  } catch (e) {
    const op = before ? undefined : await target.repo.operationInProgress();
    if (op) return op;
    throw e;
  }
}

/** 提示到原始檔控制解決衝突，或中止這次操作（不等待使用者回應，避免卡住進度通知） */
function promptConflict(target: RepoTarget, op: Operation): void {
  const openScm = t('Open Source Control');
  const abort = t('Abort {0}', op);
  void vscode.window
    .showWarningMessage(t('{0}: {1} stopped because of conflicts. Resolve them in Source Control, then continue or abort.', target.name, op), openScm, abort)
    .then(async (answer) => {
      if (answer === openScm) await vscode.commands.executeCommand('workbench.view.scm');
      else if (answer === abort) {
        try {
          await target.repo.abortOperation(op);
        } catch (e) {
          void vscode.window.showErrorMessage(errorMessage(e));
        }
      }
    });
}

function currentBranch(target: RepoTarget): string | undefined {
  return target.state?.head.branch;
}

function upstreamOf(target: RepoTarget): string | undefined {
  const branch = currentBranch(target);
  return branch ? target.state?.refs.find((r) => r.type === 'local' && r.short === branch)?.upstream : undefined;
}

// ---------- 同步 ----------

const SYNC_TITLES: Record<SyncAction, string> = {
  fetch: 'Fetch',
  pull: 'Pull',
};

/**
 * 對多個 repository 依序執行同步。依序（而非並行）是為了避免多個認證視窗同時跳出。
 */
export async function runSync(action: SyncAction, targets: RepoTarget[]): Promise<void> {
  if (targets.length === 0) return;
  const skipped: string[] = [];
  const failed: string[] = [];
  let succeeded = 0;
  let plan: { target: RepoTarget }[] = targets.map((target) => ({ target }));

  if (action === 'pull') {
    // 沒有 branch（detached）或沒有 upstream 的 repo 無法 pull
    plan = plan.filter(({ target }) => {
      if (!currentBranch(target)) skipped.push(t('{0} (detached HEAD)', target.name));
      else if (!upstreamOf(target)) skipped.push(t('{0} (no upstream)', target.name));
      else return true;
      return false;
    });
  }

  if (plan.length === 0) {
    if (skipped.length > 0) void vscode.window.showWarningMessage(t('{0}: nothing to do. Skipped: {1}', SYNC_TITLES[action], skipped.join(', ')));
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t(SYNC_TITLES[action]), cancellable: false },
    async (progress) => {
      for (const [i, p] of plan.entries()) {
        progress.report({ message: plan.length > 1 ? `${p.target.name} (${i + 1}/${plan.length})` : p.target.name });
        try {
          const op = await withConflictCheck(p.target, () => (action === 'fetch' ? p.target.repo.fetch() : p.target.repo.pull()));
          if (op) {
            failed.push(t('{0}: conflicts', p.target.name));
            promptConflict(p.target, op);
          } else succeeded++;
        } catch (e) {
          failed.push(`${p.target.name}: ${errorMessage(e)}`);
        }
      }
    },
  );

  const summary = t('{0}: {1} succeeded', t(SYNC_TITLES[action]), succeeded);
  if (failed.length === 0 && skipped.length === 0) {
    vscode.window.setStatusBarMessage(`$(check) ${summary}`, 4000);
  } else {
    const parts = [summary];
    if (failed.length > 0) parts.push(t('{0} failed', failed.length));
    if (skipped.length > 0) parts.push(t('skipped: {0}', skipped.join(', ')));
    const show = (failed.length > 0 ? vscode.window.showErrorMessage : vscode.window.showWarningMessage).bind(vscode.window);
    void show(parts.join(' · '), { detail: failed.join('\n') });
  }
}

// ---------- Push ----------

/** 各 repo 的 push 預覽（Push 對話框用）；overrides 為使用者在對話框改過的目標 */
export async function buildPushPlans(targets: RepoTarget[], upTo?: { root: string; hash: string }, overrides: PushTarget[] = [], branch?: string): Promise<PushPlan[]> {
  return Promise.all(
    targets.map(async (target): Promise<PushPlan> => {
      const o = overrides.find((x) => x.root === target.repo.root);
      const hash = o?.upTo ?? (upTo && upTo.root === target.repo.root ? upTo.hash : undefined);
      try {
        return { ...(await target.repo.getPushPlan({ branch: o?.branch ?? branch, upTo: hash, remote: o?.remote, remoteBranch: o?.remoteBranch })), name: target.name };
      } catch (e) {
        return { root: target.repo.root, name: target.name, remotes: [], hasUpstream: false, isNew: false, commits: [], total: 0, behind: 0, problem: 'error', message: errorMessage(e) };
      }
    }),
  );
}

/**
 * 依對話框確認的目標推送。force 時再以 modal 確認一次（改寫遠端歷史無法復原）。
 * @returns false：使用者在確認框取消
 */
export async function runPush(entries: { target: RepoTarget; push: PushTarget }[], force: boolean, tags: boolean, onStarted: () => void, host?: ConfirmHost): Promise<boolean> {
  // 送出前重新計算，確保與目前狀態一致（對話框開著時可能有其他操作）
  const plans = await buildPushPlans(
    entries.map((e) => e.target),
    undefined,
    entries.map((e) => e.push),
  );
  const work = entries.map((e, i) => ({ ...e, plan: plans[i] })).filter(({ plan, target, push }) => {
    if (plan.problem) {
      void vscode.window.showWarningMessage(t('{0}: cannot push ({1})', target.name, plan.message ?? plan.problem));
      return false;
    }
    // 對話框開著時遠端 branch 變了（例如自動 fetch 抓到別人的新 commit）：force push 會覆蓋沒看過的 commit，先擋下
    if (force && push.expected !== undefined && plan.trackingHash !== push.expected) {
      void vscode.window.showWarningMessage(t('{0}: the remote branch changed after the dialog was opened. Review the push again.', target.name));
      return false;
    }
    return true;
  });
  if (work.length === 0) {
    onStarted();
    return true;
  }

  if (force) {
    const ok = t('Force Push');
    const detail = [
      ...work.map(({ target, push }) => `${target.name}: ${push.upTo ? short(push.upTo) : push.branch ?? target.state?.head.branch ?? ''} → ${push.remote}/${push.remoteBranch}`),
      '',
      t('Uses --force-with-lease: the push is rejected instead of overwriting if the remote has commits you have not fetched.'),
    ].join('\n');
    if (!(await confirm(t('Force push {0} branch(es)? Remote history will be rewritten.', work.length), { detail, ok, kind: 'danger' }, host))) return false;
  }
  onStarted();

  const failed: string[] = [];
  let succeeded = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: force ? t('Force Push') : t('Push'), cancellable: false }, async (progress) => {
    for (const [i, { target, push, plan }] of work.entries()) {
      progress.report({ message: work.length > 1 ? `${target.name} (${i + 1}/${work.length})` : target.name });
      try {
        const src = push.upTo ?? `refs/heads/${plan.branch}`;
        // 第一次推送（沒有 upstream）且推整個 branch 時，一併設定 upstream
        await target.repo.pushTo(push.remote, src, push.remoteBranch, { force, lease: force ? (push.expected ?? plan.trackingHash) : undefined, tags, setUpstream: !plan.hasUpstream && !push.upTo });
        succeeded++;
      } catch (e) {
        failed.push(`${target.name}: ${errorMessage(e)}`);
      }
    }
  });

  const summary = t('Push: {0} succeeded', succeeded);
  if (failed.length === 0) vscode.window.setStatusBarMessage(`$(check) ${summary}`, 4000);
  else void vscode.window.showErrorMessage(`${summary} · ${t('{0} failed', failed.length)}`, { detail: failed.join('\n') });
  return true;
}

// ---------- Commit 操作 ----------

/** merge commit 時讓使用者選擇主線 parent（1 起算）；非 merge commit 回傳 undefined；取消回傳 null */
async function pickMainline(parents: string[]): Promise<number | undefined | null> {
  if (parents.length < 2) return undefined;
  const pick = await vscode.window.showQuickPick(
    parents.map((p, i) => ({ label: t('Parent {0}', i + 1), description: short(p), detail: i === 0 ? t('The branch the merge was made on (usual choice)') : undefined, n: i + 1 })),
    { placeHolder: t('This is a merge commit. Choose the mainline parent.') },
  );
  return pick ? pick.n : null;
}

export async function runCommitAction(action: CommitAction, target: RepoTarget, hash: string, parents: string[], subject: string): Promise<void> {
  const { repo } = target;
  const label = `${short(hash)} ${subject}`;
  try {
    switch (action) {
      case 'cherryPick': {
        const mainline = await pickMainline(parents);
        if (mainline === null) return;
        const op = await withConflictCheck(target, () => repo.cherryPick(hash, mainline));
        if (op) promptConflict(target, op);
        else vscode.window.setStatusBarMessage(`$(check) ${t('Cherry-picked {0}', label)}`, 4000);
        return;
      }
      case 'revert': {
        const mainline = await pickMainline(parents);
        if (mainline === null) return;
        const op = await withConflictCheck(target, () => repo.revert(hash, mainline));
        if (op) promptConflict(target, op);
        else vscode.window.setStatusBarMessage(`$(check) ${t('Reverted {0}', label)}`, 4000);
        return;
      }
      case 'reset': {
        const branch = currentBranch(target) ?? 'HEAD';
        const mode = await vscode.window.showQuickPick(
          [
            { label: t('Soft'), description: t('Keep all changes staged'), mode: 'soft' as const },
            { label: t('Mixed'), description: t('Keep changes in the working tree, unstaged (default)'), mode: 'mixed' as const },
            { label: t('Hard'), description: t('Discard all changes — cannot be undone'), mode: 'hard' as const },
          ],
          { placeHolder: t('Reset {0} to {1}', branch, label) },
        );
        if (!mode) return;
        if (mode.mode === 'hard') {
          const dirty = await repo.isDirty();
          const ok = t('Reset Hard');
          const yes = await confirm(t('Hard reset {0} to {1}?', branch, short(hash)), {
            detail: dirty ? t('You have uncommitted changes. They will be permanently lost.') : t('Commits after this one will no longer be on the branch.'),
            ok,
            kind: 'danger',
          });
          if (!yes) return;
        }
        await repo.reset(hash, mode.mode);
        vscode.window.setStatusBarMessage(`$(check) ${t('Reset {0} to {1}', branch, short(hash))}`, 4000);
        return;
      }
      case 'newBranch': {
        const existing = new Set(target.state?.refs.filter((r) => r.type === 'local').map((r) => r.short));
        const name = await vscode.window.showInputBox({
          title: t('New Branch from {0}', short(hash)),
          prompt: t('The new branch will be checked out.'),
          validateInput: async (v) => {
            const s = v.trim();
            if (!s) return undefined;
            if (existing.has(s)) return t('Branch {0} already exists.', s);
            return (await repo.isValidRefName(s, 'branch')) ? undefined : t('Not a valid branch name.');
          },
        });
        if (!name?.trim()) return;
        await repo.createBranch(name.trim(), hash, true);
        vscode.window.setStatusBarMessage(`$(check) ${t('Created and checked out {0}', name.trim())}`, 4000);
        return;
      }
      case 'newTag': {
        const existing = new Set(target.state?.refs.filter((r) => r.type === 'tag').map((r) => r.short));
        const name = await vscode.window.showInputBox({
          title: t('New Tag on {0}', short(hash)),
          validateInput: async (v) => {
            const s = v.trim();
            if (!s) return undefined;
            if (existing.has(s)) return t('Tag {0} already exists.', s);
            return (await repo.isValidRefName(s, 'tag')) ? undefined : t('Not a valid tag name.');
          },
        });
        if (!name?.trim()) return;
        const message = await vscode.window.showInputBox({
          title: t('Tag message for {0}', name.trim()),
          prompt: t('Leave empty to create a lightweight tag.'),
        });
        if (message === undefined) return;
        await repo.createTag(name.trim(), hash, message.trim() || undefined);
        vscode.window.setStatusBarMessage(`$(check) ${t('Created tag {0}', name.trim())}`, 4000);
        return;
      }
      case 'compareLocal': {
        await compareWithWorkingTree(target, hash, short(hash));
        return;
      }
    }
  } catch (e) {
    void vscode.window.showErrorMessage(`${target.name}: ${errorMessage(e)}`);
  }
}

/** 多選 commit：一次 cherry-pick／revert（git 依序處理，衝突時停下） */
export async function runCommitsAction(action: 'cherryPick' | 'revert', target: RepoTarget, commits: { hash: string; parents: string[]; subject: string }[]): Promise<void> {
  if (commits.some((c) => c.parents.length > 1)) {
    void vscode.window.showWarningMessage(t('The selection contains merge commits. Cherry-pick or revert them one at a time to choose the mainline parent.'));
    return;
  }
  const ok = action === 'cherryPick' ? t('Cherry-Pick') : t('Revert');
  const yes = await confirm(
    action === 'cherryPick' ? t('Cherry-pick {0} commits onto {1}?', commits.length, currentBranch(target) ?? 'HEAD') : t('Revert {0} commits on {1}?', commits.length, currentBranch(target) ?? 'HEAD'),
    { detail: commits.map((c) => `${short(c.hash)} ${c.subject}`).join('\n'), ok, kind: 'info' },
  );
  if (!yes) return;
  try {
    const hashes = commits.map((c) => c.hash);
    const op = await withConflictCheck(target, () => (action === 'cherryPick' ? target.repo.cherryPickMany(hashes) : target.repo.revertMany(hashes)));
    if (op) promptConflict(target, op);
    else vscode.window.setStatusBarMessage(`$(check) ${action === 'cherryPick' ? t('Cherry-picked {0} commits', commits.length) : t('Reverted {0} commits', commits.length)}`, 4000);
  } catch (e) {
    void vscode.window.showErrorMessage(`${target.name}: ${errorMessage(e)}`);
  }
}

/** 列出 revision 與目前工作區不同的檔案，選一個開 diff（左：revision，右：工作區檔案） */
export async function compareWithWorkingTree(target: RepoTarget, hash: string, label: string, pathFilter?: string): Promise<void> {
  const { repo } = target;
  const files = (await repo.diffWithWorkingTree(hash)).filter((f) => !pathFilter || f.path === pathFilter || f.path.startsWith(`${pathFilter}/`) || f.oldPath === pathFilter);
  if (files.length === 0) {
    void vscode.window.showInformationMessage(t('No differences between {0} and the working tree.', label));
    return;
  }
  const open = async (f: (typeof files)[number]) => {
    const left = revisionUri(repo.root, f.status === 'A' ? '' : hash, f.oldPath ?? f.path);
    const right = f.status === 'D' ? revisionUri(repo.root, '', f.path) : vscode.Uri.file(path.join(repo.root, f.path));
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(f.path)} (${label} ↔ ${t('Working Tree')})`);
  };
  if (files.length === 1 && pathFilter === files[0].path) return open(files[0]);
  const pick = await vscode.window.showQuickPick(
    files.map((f) => ({ label: path.basename(f.path), description: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path, file: f })),
    { placeHolder: t('{0} file(s) differ between {1} and the working tree', files.length, label), matchOnDescription: true },
  );
  if (pick) await open(pick.file);
}

// ---------- Branch／Tag 操作 ----------

function refIn(target: RepoTarget, refName: string): RefInfo | undefined {
  return target.state?.refs.find((r) => r.name === refName);
}

/** 多個 repo 時先以 modal 確認，列出受影響的 repo */
async function confirmMulti(targets: RepoTarget[], message: string, ok: string, always = false, kind: 'warning' | 'danger' = 'warning'): Promise<boolean> {
  if (targets.length <= 1 && !always) return true;
  return confirm(message, { detail: targets.map((x) => x.name).join('\n'), ok, kind });
}

async function pickTarget(targets: RepoTarget[]): Promise<RepoTarget | undefined> {
  if (targets.length <= 1) return targets[0];
  const pick = await vscode.window.showQuickPick(
    targets.map((x) => ({ label: x.name, description: x.state?.head.branch, x })),
    { placeHolder: t('Choose a repository') },
  );
  return pick?.x;
}

/**
 * Branches 右鍵選單的操作。targets 為擁有此 ref 的 repository（同名 branch 跨 repo 一次處理）。
 */
export async function runRefAction(action: RefAction, refName: string, targets: RepoTarget[]): Promise<void> {
  const first = targets[0] && refIn(targets[0], refName);
  if (!first) return;
  const name = first.short;
  const failures: string[] = [];
  /** 只有 merge／rebase／update（pull）可能留下衝突 */
  const mayConflict = action === 'merge' || action === 'rebase' || action === 'update';
  const conflicts: { target: RepoTarget; op: Operation }[] = [];
  /** 依序對每個 repo 執行；失敗時收集訊息，最後一次顯示 */
  const each = async (fn: (target: RepoTarget, ref: RefInfo) => Promise<void>, list = targets) => {
    for (const target of list) {
      const ref = refIn(target, refName);
      if (!ref) continue;
      try {
        if (mayConflict) {
          const op = await withConflictCheck(target, () => fn(target, ref));
          if (op) conflicts.push({ target, op });
        } else {
          await fn(target, ref);
        }
      } catch (e) {
        failures.push(targets.length > 1 ? `${target.name}: ${errorMessage(e)}` : errorMessage(e));
      }
    }
  };
  const done = (msg: string) => {
    for (const c of conflicts) promptConflict(c.target, c.op);
    if (conflicts.length > 0 && failures.length === 0) return;
    if (failures.length > 0) void vscode.window.showErrorMessage(failures.join('\n'));
    else vscode.window.setStatusBarMessage(`$(check) ${msg}`, 4000);
  };

  switch (action) {
    case 'newBranch': {
      const existing = new Set(targets.flatMap((x) => x.state?.refs.filter((r) => r.type === 'local').map((r) => r.short) ?? []));
      const suggestion = first.type === 'remote' ? (first.remoteBranch ?? '') : '';
      const input = await vscode.window.showInputBox({
        title: t('New Branch from {0}', name),
        value: existing.has(suggestion) ? '' : suggestion,
        prompt: t('The new branch will be checked out.'),
        validateInput: async (v) => {
          const s = v.trim();
          if (!s) return undefined;
          if (existing.has(s)) return t('Branch {0} already exists.', s);
          return (await targets[0].repo.isValidRefName(s, 'branch')) ? undefined : t('Not a valid branch name.');
        },
      });
      const branch = input?.trim();
      if (!branch) return;
      await each(async (target, ref) => {
        await target.repo.createBranch(branch, ref.hash, true);
        // 從 remote branch 建立時設定為 upstream（與 IntelliJ 相同）
        if (ref.type === 'remote') await target.repo.exec(['branch', `--set-upstream-to=${ref.short}`, branch]);
      });
      done(t('Created and checked out {0}', branch));
      return;
    }
    case 'rename': {
      if (first.type !== 'local') return;
      const input = await vscode.window.showInputBox({
        title: t('Rename {0}', name),
        value: name,
        validateInput: async (v) => {
          const s = v.trim();
          if (!s || s === name) return undefined;
          if (targets.some((x) => x.state?.refs.some((r) => r.type === 'local' && r.short === s))) return t('Branch {0} already exists.', s);
          return (await targets[0].repo.isValidRefName(s, 'branch')) ? undefined : t('Not a valid branch name.');
        },
      });
      const next = input?.trim();
      if (!next || next === name) return;
      await each((target) => target.repo.renameBranch(name, next));
      done(t('Renamed {0} to {1}', name, next));
      return;
    }
    case 'delete': {
      if (first.type === 'local') {
        const current = targets.filter((x) => x.state?.head.branch === name);
        if (current.length > 0) {
          void vscode.window.showErrorMessage(t('Cannot delete the current branch {0}. Check out another branch first.', name));
          return;
        }
        if (!(await confirmMulti(targets, t('Delete branch {0} in {1} repositories?', name, targets.length), t('Delete'), false, 'danger'))) return;
        const unmerged: RepoTarget[] = [];
        await each(async (target) => {
          try {
            await target.repo.deleteBranch(name, false);
          } catch (e) {
            // -d 拒絕刪除尚未合併的 branch：之後一次詢問是否強制刪除
            if (/not fully merged/i.test(errorMessage(e))) unmerged.push(target);
            else throw e;
          }
        });
        if (unmerged.length > 0) {
          const force = t('Delete Anyway');
          const yes = await confirm(t('Branch {0} has commits that are not merged into the current branch or its upstream. Delete it anyway?', name), {
            detail: [t('Those commits will only be reachable through the reflog.'), '', ...unmerged.map((x) => x.name)].join('\n'),
            ok: force,
            kind: 'danger',
          });
          if (!yes) return;
          for (const target of unmerged) {
            try {
              await target.repo.deleteBranch(name, true);
            } catch (e) {
              failures.push(`${target.name}: ${errorMessage(e)}`);
            }
          }
        }
        done(t('Deleted branch {0}', name));
      } else if (first.type === 'remote') {
        const remote = first.remote!;
        const branch = first.remoteBranch!;
        if (!(await confirmMulti(targets, t('Delete remote branch {0}? This removes it from {1} for everyone.', name, remote), t('Delete'), true, 'danger'))) return;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Deleting {0}…', name) }, () =>
          each((target) => target.repo.deleteRemoteBranch(remote, branch)),
        );
        done(t('Deleted remote branch {0}', name));
      } else {
        if (!(await confirmMulti(targets, t('Delete tag {0}? Tags already pushed stay on the remote.', name), t('Delete'), true, 'danger'))) return;
        await each((target) => target.repo.deleteTag(name));
        done(t('Deleted tag {0}', name));
      }
      return;
    }
    case 'merge':
    case 'rebase': {
      const eligible = targets.filter((x) => x.state?.head.branch && x.state.head.branch !== (first.type === 'local' ? name : ''));
      if (eligible.length === 0) {
        void vscode.window.showWarningMessage(action === 'merge' ? t('No repository has a current branch to merge into.') : t('No repository has a current branch to rebase.'));
        return;
      }
      const ok = action === 'merge' ? t('Merge') : t('Rebase');
      const message =
        action === 'merge'
          ? t('Merge {0} into the current branch in {1} repositories?', name, eligible.length)
          : t('Rebase the current branch onto {0} in {1} repositories?', name, eligible.length);
      if (!(await confirmMulti(eligible, message, ok))) return;
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: action === 'merge' ? t('Merging {0}…', name) : t('Rebasing onto {0}…', name) }, () =>
        each((target) => (action === 'merge' ? target.repo.merge(refName) : target.repo.rebase(refName)), eligible),
      );
      done(action === 'merge' ? t('Merged {0}', name) : t('Rebased onto {0}', name));
      return;
    }
    case 'update': {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Updating {0}…', name) }, () => each((target) => target.repo.updateBranch(name)));
      done(t('Updated {0}', name));
      return;
    }
    case 'pushTag': {
      const remotes = [...new Set(targets.flatMap((x) => x.state?.remotes ?? []))];
      if (remotes.length === 0) {
        void vscode.window.showWarningMessage(t('No remote configured.'));
        return;
      }
      const remote =
        remotes.length === 1
          ? remotes[0]
          : (await vscode.window.showQuickPick(remotes.includes('origin') ? ['origin', ...remotes.filter((r) => r !== 'origin')] : remotes, { placeHolder: t('Push tag {0} to', name) }));
      if (!remote) return;
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Pushing tag {0}…', name) }, () =>
        each((target) => (target.state?.remotes.includes(remote) ? target.repo.pushTag(remote, name) : Promise.resolve())),
      );
      done(t('Pushed tag {0} to {1}', name, remote));
      return;
    }
    case 'compareWorkingTree': {
      const target = await pickTarget(targets);
      if (!target) return;
      const ref = refIn(target, refName);
      if (!ref) return;
      await compareWithWorkingTree(target, ref.hash, name);
      return;
    }
    case 'compare': {
      const target = await pickTarget(targets);
      if (!target) return;
      const { repo } = target;
      const head = await repo.resolve('HEAD');
      const other = await repo.resolve(refName);
      if (!head || !other) return;
      const counts = (await repo.exec(['rev-list', '--left-right', '--count', `${head}...${other}`])).trim().split(/\s+/).map(Number);
      const files = await repo.diffBetween(head, other);
      const current = target.state?.head.branch ?? 'HEAD';
      const summary = t('{0}: {1} commit(s) not in {2}; {2}: {3} commit(s) not in {0}', name, counts[1] ?? 0, current, counts[0] ?? 0);
      if (files.length === 0) {
        void vscode.window.showInformationMessage(`${t('No file differences between {0} and {1}.', current, name)} ${summary}`);
        return;
      }
      const pick = await vscode.window.showQuickPick(
        files.map((f) => ({ label: path.basename(f.path), description: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path, file: f })),
        { title: t('Compare {0} with {1}', current, name), placeHolder: `${t('{0} file(s) differ', files.length)} · ${summary}`, matchOnDescription: true },
      );
      if (!pick) return;
      const f = pick.file;
      const left = revisionUri(repo.root, f.status === 'A' ? '' : head, f.oldPath ?? f.path);
      const right = revisionUri(repo.root, f.status === 'D' ? '' : other, f.path);
      await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(f.path)} (${current} ↔ ${name})`);
      return;
    }
  }
}
