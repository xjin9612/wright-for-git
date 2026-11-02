// Branches 的右鍵選單與工具列操作：Log 左欄與側邊欄 Branches 共用
import type { RefAction, RepoState } from '../shared/protocol';
import type { MergedRef } from '../shared/refs';
import type { BranchToolbarAction } from './branchesPane';
import type { MenuItem } from './dom';
import { t } from './l10n';
import { post } from './vscodeApi';

/** 依所在位置不同的操作（Log 直接處理；側邊欄轉給 Log） */
export interface BranchHost {
  showInLog(ref: MergedRef): void;
  showInNewTab(ref: MergedRef): void;
  /** 在記錄中選取分支的最新 commit（不改變篩選） */
  navigate(ref: MergedRef): void;
  isFavorite(ref: MergedRef): boolean;
  toggleFavorite(ref: MergedRef): void;
  /** 目前 Paths 篩選下可見的 repository */
  visibleRepos(): RepoState[];
}

/** 右鍵選單（對應 IntelliJ 的 branch 選單；同名 branch 跨 repo 一次處理） */
export function refMenuItems(ref: MergedRef, host: BranchHost): MenuItem[] {
  const act = (action: RefAction) => () => post({ type: 'refAction', action, ref: ref.name, roots: ref.roots });
  const name = ref.short;
  const q = `'${name.length > 40 ? `${name.slice(0, 39)}…` : name}'`;
  const isLocal = ref.type === 'local';
  const current = isLocal && ref.current;
  const items: MenuItem[] = [
    { label: t('Checkout'), disabled: current, action: () => post({ type: 'checkout', ref: ref.name, roots: ref.roots }) },
    { label: t('New Branch from {0}…', q), action: act('newBranch') },
    { label: t('Compare with Current'), disabled: current, action: act('compare') },
    { label: t('Show Diff with Working Tree'), action: act('compareWorkingTree') },
    { label: t('Show in Log'), action: () => host.showInLog(ref) },
    { label: t('Show in New Tab'), action: () => host.showInNewTab(ref) },
    '-',
    { label: t('Merge {0} into Current', q), disabled: current, action: act('merge') },
  ];
  if (ref.type !== 'tag') items.push({ label: t('Rebase Current onto {0}', q), disabled: current, action: act('rebase') });
  if (ref.type !== 'tag') {
    const fav = host.isFavorite(ref);
    items.push('-', { label: fav ? t('Remove from Favorites') : t('Add to Favorites'), action: () => host.toggleFavorite(ref) });
  }
  if (isLocal) {
    items.push(
      '-',
      { label: t('Update'), disabled: !ref.upstream, action: act('update') },
      // Push 一律先開對話框確認
      { label: t('Push…'), action: () => post({ type: 'openPushPanel', roots: ref.roots, branch: ref.short }) },
      '-',
      { label: t('Rename…'), action: act('rename') },
      { label: t('Delete'), disabled: current, action: act('delete') },
    );
  } else if (ref.type === 'remote') {
    items.push('-', { label: t('Delete'), action: act('delete') });
  } else {
    items.push('-', { label: t('Push Tag…'), action: act('pushTag') }, { label: t('Delete'), action: act('delete') });
  }
  return items;
}

/** Branches 工具列的操作 */
export function runBranchToolbar(action: BranchToolbarAction, ref: MergedRef | undefined, host: BranchHost): void {
  if (action === 'newBranch' && !ref) {
    // 沒有選取：從目前分支（或 detached HEAD）建立
    const vis = host.visibleRepos();
    const branch = vis.find((r) => r.head.branch)?.head.branch;
    if (branch) {
      post({ type: 'refAction', action: 'newBranch', ref: `refs/heads/${branch}`, roots: vis.filter((r) => r.head.branch === branch).map((r) => r.root) });
    } else {
      const st = vis.find((r) => r.head.hash);
      if (st?.head.hash) post({ type: 'commitAction', action: 'newBranch', root: st.root, hash: st.head.hash, parents: [], subject: 'HEAD' });
    }
    return;
  }
  if (!ref) return;
  if (action === 'navigate') {
    host.navigate(ref);
    return;
  }
  post({ type: 'refAction', action, ref: ref.name, roots: ref.roots });
}
