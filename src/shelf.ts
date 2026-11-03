// Shelf 的跨 repo 協調：同一次擱置的各 repo 共用 id，清單依 id 合併成一筆；
// 擱置中途失敗時把已擱置的 repo 還原，不留下只擱置一半的狀態；取回時逐 repo 執行並回報結果。
// 不依賴 vscode，方便以真實 git repo 做單元測試。
import type { GitRepository } from './git/repository';
import type { ShelfInfo } from './shared/protocol';

/** 一次擱置（可能跨多個 repo） */
export interface ShelfGroup {
  id: string;
  name: string;
  /** 各 repo 中最新的擱置時間（Unix 秒） */
  time: number;
  entries: { root: string; shelf: ShelfInfo }[];
}

export interface UnshelveOutcome {
  root: string;
  ok: boolean;
  /** 取回後是否已從 Shelf 移除 */
  dropped?: boolean;
  /** 失敗原因（git 的錯誤訊息） */
  error?: string;
  /** 失敗是因為合併衝突（衝突標記留在工作區，可用衝突對話框處理） */
  conflict?: boolean;
}

/** 依時間排序、同一毫秒也不會重複的 id（只用 ref 名稱允許的字元） */
export function newShelfId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 掃描各 repo 的 shelf，依 id 合併；新的在前，entries 依 repos 的順序 */
export async function listShelfGroups(repos: readonly GitRepository[]): Promise<ShelfGroup[]> {
  const lists = await Promise.all(repos.map((r) => r.listShelves().catch(() => [] as ShelfInfo[])));
  const groups = new Map<string, ShelfGroup>();
  repos.forEach((repo, i) => {
    for (const shelf of lists[i]) {
      let g = groups.get(shelf.id);
      if (!g) {
        g = { id: shelf.id, name: shelf.name, time: shelf.time, entries: [] };
        groups.set(shelf.id, g);
      }
      if (!g.name) g.name = shelf.name;
      g.time = Math.max(g.time, shelf.time);
      g.entries.push({ root: repo.root, shelf });
    }
  });
  return [...groups.values()].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
}

/** 擱置失敗；rollbackErrors 為還原時又失敗的 repo（這些 repo 的變更仍在 shelf 中，沒有遺失） */
export class ShelveError extends Error {
  constructor(
    message: string,
    readonly root: string,
    readonly rollbackErrors: { root: string; error: string }[],
  ) {
    super(message);
  }
}

/**
 * 把各 repo 勾選的檔案擱置成同一筆 shelf。沒有任何變更可擱置時 roots 為空。
 * 任何一個 repo 失敗：已擱置的 repo 依相反順序還原（keepChanges 時只刪除 ref），再丟出 ShelveError。
 */
export async function shelveAcross(
  items: readonly { repo: GitRepository; paths: string[] }[],
  name: string,
  opts: { keepChanges?: boolean; id?: string } = {},
): Promise<{ id: string; roots: string[] }> {
  const id = opts.id ?? newShelfId();
  const done: { repo: GitRepository; hash: string }[] = [];
  for (const { repo, paths } of items) {
    try {
      const hash = await repo.shelve(id, name, paths, opts.keepChanges);
      if (hash) done.push({ repo, hash });
    } catch (e) {
      const rollbackErrors: { root: string; error: string }[] = [];
      for (const d of [...done].reverse()) {
        try {
          if (!opts.keepChanges) await d.repo.unshelve({ hash: d.hash, parents: [] });
          await d.repo.dropShelf(id);
        } catch (err) {
          rollbackErrors.push({ root: d.repo.root, error: errorText(err) });
        }
      }
      throw new ShelveError(errorText(e), repo.root, rollbackErrors);
    }
  }
  return { id, roots: done.map((d) => d.repo.root) };
}

/**
 * 逐 repo 取回；某個 repo 失敗不影響其他 repo。
 * paths 指定某個 repo 只取回部分檔案（該 repo 的 shelf 保留，因為還有沒取回的檔案）；
 * 整個 repo 取回成功且 keep 為 false 時，從 Shelf 移除該 repo 的部分。
 */
export async function unshelveAcross(
  group: ShelfGroup,
  repoOf: (root: string) => GitRepository | undefined,
  opts: { roots?: readonly string[]; paths?: ReadonlyMap<string, string[]>; keep?: boolean } = {},
): Promise<UnshelveOutcome[]> {
  const outcomes: UnshelveOutcome[] = [];
  for (const { root, shelf } of group.entries) {
    if (opts.roots && !opts.roots.includes(root)) continue;
    const repo = repoOf(root);
    if (!repo) {
      outcomes.push({ root, ok: false, error: 'Repository not found' });
      continue;
    }
    const paths = opts.paths?.get(root);
    try {
      await repo.unshelve(shelf, paths);
      const drop = !opts.keep && !paths;
      if (drop) await repo.dropShelf(group.id);
      outcomes.push({ root, ok: true, dropped: drop });
    } catch (e) {
      const conflict = (await repo.conflictedPaths().catch(() => [])).length > 0;
      outcomes.push({ root, ok: false, error: errorText(e), conflict: conflict || undefined });
    }
  }
  return outcomes;
}

export async function renameShelfGroup(group: ShelfGroup, name: string, repoOf: (root: string) => GitRepository | undefined): Promise<void> {
  for (const { root } of group.entries) await repoOf(root)?.renameShelf(group.id, name);
}

export async function dropShelfGroup(group: ShelfGroup, repoOf: (root: string) => GitRepository | undefined, roots?: readonly string[]): Promise<void> {
  for (const { root } of group.entries) {
    if (roots && !roots.includes(root)) continue;
    await repoOf(root)?.dropShelf(group.id);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
