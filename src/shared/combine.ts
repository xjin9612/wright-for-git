// 多選 commit：把多個 commit 的檔案變更合併成「從最舊到最新」的淨變更（對應 IntelliJ 多選時的變更清單）
import type { ChangedFile } from './protocol';

export interface CommitChanges {
  hash: string;
  /** 第一個 parent；root commit 為 undefined */
  parent?: string;
  files: ChangedFile[];
}

/**
 * @param commits 由舊到新排列
 * @returns 每個檔案的淨變更；left／right 為 diff 兩側的 revision（'' 表示該側不存在）
 */
export function combineChanges(commits: readonly CommitChanges[]): ChangedFile[] {
  const map = new Map<string, ChangedFile>();
  for (const c of commits) {
    for (const f of c.files) {
      const right = f.status === 'D' ? '' : c.hash;
      // rename：沿用舊路徑上累積的變更
      const prevKey = f.oldPath && map.has(f.oldPath) ? f.oldPath : f.path;
      const prev = map.get(prevKey);
      if (!prev) {
        map.set(f.path, { ...f, left: f.status === 'A' || !c.parent ? '' : c.parent, right });
        continue;
      }
      map.delete(prevKey);
      let status = f.status;
      if (prev.status === 'A') {
        // 選取範圍內新增後又刪除：淨變更為無
        if (f.status === 'D') continue;
        status = 'A';
      } else if (prev.status === 'D' && f.status === 'A') {
        status = 'M';
      } else if ((prev.status === 'R' || prev.status === 'C') && f.status === 'M') {
        status = prev.status;
      }
      const merged: ChangedFile = { status, path: f.path, left: prev.left, right };
      const oldPath = prev.oldPath ?? (f.oldPath && f.oldPath !== f.path ? f.oldPath : undefined);
      if (oldPath && oldPath !== f.path && status !== 'A') merged.oldPath = oldPath;
      map.set(f.path, merged);
    }
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}
