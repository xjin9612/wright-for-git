// 寫入類操作的 UI 流程：同步（fetch／pull／push）與 Commit 右鍵選單
// git 指令本身在 GitRepository；這裡負責確認框、多 repo 彙整、衝突處理
import * as path from 'node:path';
import * as vscode from 'vscode';
import { revisionUri } from './diffProvider';
import type { GitRepository } from './git/repository';
import type { CommitAction, PushPlan, PushTarget, RepoState, SyncAction } from './shared/protocol';

export interface RepoTarget {
  repo: GitRepository;
  name: string;
  state?: RepoState;
}

const t = vscode.l10n.t;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function short(hash: string): string {
  return hash.slice(0, 8);
}

/** 失敗後若有進行中的 cherry-pick／revert／merge／rebase，提示到原始檔控制解決衝突或中止 */
async function handleConflict(target: RepoTarget): Promise<boolean> {
  const op = await target.repo.operationInProgress();
  if (!op) return false;
  const openScm = t('Open Source Control');
  const abort = t('Abort {0}', op);
  const answer = await vscode.window.showWarningMessage(
    t('{0}: {1} stopped because of conflicts. Resolve them in Source Control, then continue or abort.', target.name, op),
    openScm,
    abort,
  );
  if (answer === openScm) await vscode.commands.executeCommand('workbench.view.scm');
  else if (answer === abort) {
    try {
      await target.repo.abortOperation(op);
    } catch (e) {
      void vscode.window.showErrorMessage(errorMessage(e));
    }
  }
  return true;
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
    { location: vscode.ProgressLocation.Notification, title: SYNC_TITLES[action], cancellable: false },
    async (progress) => {
      for (const [i, p] of plan.entries()) {
        progress.report({ message: plan.length > 1 ? `${p.target.name} (${i + 1}/${plan.length})` : p.target.name });
        try {
          if (action === 'fetch') await p.target.repo.fetch();
          else await p.target.repo.pull();
          succeeded++;
        } catch (e) {
          if (action === 'pull' && (await handleConflict(p.target))) failed.push(t('{0}: conflicts', p.target.name));
          else failed.push(`${p.target.name}: ${errorMessage(e)}`);
        }
      }
    },
  );

  const summary = t('{0}: {1} succeeded', SYNC_TITLES[action], succeeded);
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
export async function buildPushPlans(targets: RepoTarget[], upTo?: { root: string; hash: string }, overrides: PushTarget[] = []): Promise<PushPlan[]> {
  return Promise.all(
    targets.map(async (target): Promise<PushPlan> => {
      const o = overrides.find((x) => x.root === target.repo.root);
      const hash = upTo && upTo.root === target.repo.root ? upTo.hash : undefined;
      try {
        return { ...(await target.repo.getPushPlan({ upTo: hash, remote: o?.remote, remoteBranch: o?.remoteBranch })), name: target.name };
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
export async function runPush(entries: { target: RepoTarget; push: PushTarget }[], force: boolean, tags: boolean, onStarted: () => void): Promise<boolean> {
  // 送出前重新計算，確保與目前狀態一致（對話框開著時可能有其他操作）
  const plans = await buildPushPlans(
    entries.map((e) => e.target),
    undefined,
    entries.map((e) => e.push),
  );
  const work = entries.map((e, i) => ({ ...e, plan: plans[i] })).filter(({ plan, target }) => {
    if (!plan.problem) return true;
    void vscode.window.showWarningMessage(t('{0}: cannot push ({1})', target.name, plan.message ?? plan.problem));
    return false;
  });
  if (work.length === 0) {
    onStarted();
    return true;
  }

  if (force) {
    const ok = t('Force Push');
    const detail = [
      ...work.map(({ target, push }) => `${target.name}: ${push.upTo ? short(push.upTo) : target.state?.head.branch ?? ''} → ${push.remote}/${push.remoteBranch}`),
      '',
      t('Uses --force-with-lease: the push is rejected instead of overwriting if the remote has commits you have not fetched.'),
    ].join('\n');
    const answer = await vscode.window.showWarningMessage(t('Force push {0} branch(es)? Remote history will be rewritten.', work.length), { modal: true, detail }, ok);
    if (answer !== ok) return false;
  }
  onStarted();

  const failed: string[] = [];
  let succeeded = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: force ? 'Force Push' : 'Push', cancellable: false }, async (progress) => {
    for (const [i, { target, push, plan }] of work.entries()) {
      progress.report({ message: work.length > 1 ? `${target.name} (${i + 1}/${work.length})` : target.name });
      try {
        const src = push.upTo ?? `refs/heads/${plan.branch}`;
        // 第一次推送（沒有 upstream）且推整個 branch 時，一併設定 upstream
        await target.repo.pushTo(push.remote, src, push.remoteBranch, { force, tags, setUpstream: !plan.hasUpstream && !push.upTo });
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
        try {
          await repo.cherryPick(hash, mainline);
          vscode.window.setStatusBarMessage(`$(check) ${t('Cherry-picked {0}', label)}`, 4000);
        } catch (e) {
          if (!(await handleConflict(target))) throw e;
        }
        return;
      }
      case 'revert': {
        const mainline = await pickMainline(parents);
        if (mainline === null) return;
        try {
          await repo.revert(hash, mainline);
          vscode.window.setStatusBarMessage(`$(check) ${t('Reverted {0}', label)}`, 4000);
        } catch (e) {
          if (!(await handleConflict(target))) throw e;
        }
        return;
      }
      case 'reset': {
        const branch = currentBranch(target) ?? 'HEAD';
        const mode = await vscode.window.showQuickPick(
          [
            { label: 'Soft', description: t('Keep all changes staged'), mode: 'soft' as const },
            { label: 'Mixed', description: t('Keep changes in the working tree, unstaged (default)'), mode: 'mixed' as const },
            { label: 'Hard', description: t('Discard all changes — cannot be undone'), mode: 'hard' as const },
          ],
          { placeHolder: t('Reset {0} to {1}', branch, label) },
        );
        if (!mode) return;
        if (mode.mode === 'hard') {
          const dirty = await repo.isDirty();
          const ok = t('Reset Hard');
          const answer = await vscode.window.showWarningMessage(
            t('Hard reset {0} to {1}?', branch, short(hash)),
            {
              modal: true,
              detail: dirty
                ? t('You have uncommitted changes. They will be permanently lost.')
                : t('Commits after this one will no longer be on the branch.'),
            },
            ok,
          );
          if (answer !== ok) return;
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
        const files = await repo.diffWithWorkingTree(hash);
        if (files.length === 0) {
          void vscode.window.showInformationMessage(t('No differences between {0} and the working tree.', short(hash)));
          return;
        }
        const pick = await vscode.window.showQuickPick(
          files.map((f) => ({ label: path.basename(f.path), description: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path, detail: undefined, file: f })),
          { placeHolder: t('{0} file(s) differ between {1} and the working tree', files.length, short(hash)), matchOnDescription: true },
        );
        if (!pick) return;
        const f = pick.file;
        const left = revisionUri(repo.root, f.status === 'A' ? '' : hash, f.oldPath ?? f.path);
        const right = f.status === 'D' ? revisionUri(repo.root, '', f.path) : vscode.Uri.file(path.join(repo.root, f.path));
        await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(f.path)} (${short(hash)} ↔ ${t('Working Tree')})`);
        return;
      }
    }
  } catch (e) {
    void vscode.window.showErrorMessage(`${target.name}: ${errorMessage(e)}`);
  }
}
