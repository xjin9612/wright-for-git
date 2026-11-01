// 給真實 VS Code 自動化測試（test/vscode）用的介面：webview 內的狀態測試讀不到，透過這裡讀取狀態、觸發與畫面相同的動作。
// 一般使用不會用到；只回傳既有物件的方法，不新增任何行為。
import type { CommitViewProvider } from './commitView';
import { recentGitLog } from './gitConsole';
import type { RepositorySummary, WorkbenchViewProvider } from './provider';
import type { CommitState, ConflictFile, LogFilter, WorkingChange } from './shared/protocol';

export interface TestApi {
  repositories(): Promise<RepositorySummary[]>;
  /** Log 目前使用中的篩選（webview 套用後回報） */
  logFilter(): LogFilter;
  repoSnapshot(root: string): { head?: string; refs: string[] } | undefined;
  /** 等同 Log 右欄雙擊檔案：開該 commit 的 diff，並可用 ← → 切換同一個 commit 的其他檔案 */
  openCommitDiff(root: string, hash: string, path: string): Promise<void>;
  /** 等同提交視窗雙擊檔案 */
  openWorkingDiff(root: string, path: string): Promise<void>;
  /** 提交視窗最近一次的狀態（視窗可見時才會更新） */
  commitState(): CommitState | undefined;
  /** 等同 Repositories 側邊欄的勾選 */
  setRepositoriesVisible(roots: string[]): Promise<void>;
  conflicts(): Promise<{ root: string; name: string; files: ConflictFile[] }[]>;
  resolveConflicts(items: { root: string; path: string }[], action: 'ours' | 'theirs' | 'resolved'): Promise<void>;
  openInMergeEditor(root: string, path: string): Promise<void>;
  runOperation(root: string, action: 'continue' | 'skip' | 'abort'): Promise<void>;
  /** 最近的寫入 git 指令與失敗（測試失敗時的診斷） */
  recentGitLog(): readonly string[];
}

export function createTestApi(provider: WorkbenchViewProvider, commitView: () => CommitViewProvider | undefined): TestApi {
  return {
    repositories: () => provider.repositories(),
    logFilter: () => provider.logFilter,
    repoSnapshot: (root) => provider.repoSnapshot(root),
    async openCommitDiff(root, hash, filePath) {
      const repo = provider.getRepository(root);
      if (!repo) throw new Error(`沒有這個 repository：${root}`);
      const parents = (await repo.exec(['rev-list', '--parents', '-n1', hash])).trim().split(' ').slice(1);
      const files = await repo.getChangedFiles(hash, parents.slice(0, 1));
      const file = files.find((f) => f.path === filePath);
      if (!file) throw new Error(`${hash.slice(0, 8)} 沒有變更 ${filePath}：${files.map((f) => f.path).join(', ')}`);
      await provider.openLogDiff(root, hash, parents[0], file, files);
    },
    async openWorkingDiff(root, filePath) {
      const repo = provider.getRepository(root);
      const change: WorkingChange | undefined = (await repo?.getWorkingChanges())?.find((c) => c.path === filePath);
      if (!change) throw new Error(`${filePath} 沒有本機變更`);
      await commitView()?.openDiff(root, change);
    },
    commitState: () => commitView()?.lastState,
    setRepositoriesVisible: (roots) => provider.showRepositories(roots, false),
    async conflicts() {
      return (await provider.dialogs.conflicts.data()).map(({ root, name, files }) => ({ root, name, files }));
    },
    resolveConflicts: (items, action) => provider.dialogs.conflicts.act(items, action),
    openInMergeEditor: (root, filePath) => provider.dialogs.conflicts.openInMergeEditor(root, filePath),
    runOperation: (root, action) => provider.runOperation(root, action),
    recentGitLog,
  };
}
