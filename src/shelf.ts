// Shelf 的跨 repo 協調：同一次擱置的各 repo 共用 id，清單依 id 合併成一筆；
// 擱置中途失敗時把已擱置的 repo 還原，不留下只擱置一半的狀態；取回時逐 repo 執行並回報結果。
// 不依賴 vscode，方便以真實 git repo 做單元測試。
import type { GitRepository } from './git/repository';
import type { ShelfGroup, ShelfInfo } from './shared/protocol';

export type { ShelfGroup };

export interface UnshelveOutcome {
  root: string;
  /** 全部取回且沒有衝突 */
  ok: boolean;
  /** 有衝突：變更已套用，衝突標記留在檔案中（可用衝突對話框處理） */
  conflict?: boolean;
  /** 從擱置移除取回的檔案後，這個 repo 的部分是否還有剩（kept）或已整筆刪除（dropped）；沒有移除時為 undefined */
  removed?: 'kept' | 'dropped';
  /** 失敗原因或衝突訊息（git 的錯誤訊息） */
  error?: string;
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
  // 同一秒內的多筆：id 以毫秒時間開頭，依 id 由新到舊
  return [...groups.values()].sort((a, b) => b.time - a.time || b.id.localeCompare(a.id));
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
 * 逐 repo 取回 paths 指定的檔案（rename 要包含新舊路徑）；某個 repo 失敗不影響其他 repo。
 * remove 時，取回的檔案從擱置中移除（有衝突也算已取回：內容已在工作區的衝突標記裡），其餘保留；
 * 失敗（沒有套用任何東西）的 repo 不移除。overwrite 時覆蓋工作區已存在的未追蹤檔案。
 * label 是衝突畫面上「對方」的名稱（預設為擱置名稱）。
 */
export async function unshelveAcross(
  group: ShelfGroup,
  repoOf: (root: string) => GitRepository | undefined,
  opts: { paths: ReadonlyMap<string, readonly string[]>; remove: boolean; overwrite?: boolean; label?: string },
): Promise<UnshelveOutcome[]> {
  const outcomes: UnshelveOutcome[] = [];
  for (const { root, shelf } of group.entries) {
    const paths = opts.paths.get(root);
    if (!paths || paths.length === 0) continue;
    const repo = repoOf(root);
    if (!repo) {
      outcomes.push({ root, ok: false, error: 'Repository not found' });
      continue;
    }
    let error: string | undefined;
    let conflict = false;
    try {
      await repo.unshelve(shelf, [...paths], { overwrite: opts.overwrite, label: opts.label ?? group.name });
    } catch (e) {
      error = errorText(e);
      conflict = (await repo.conflictedPaths().catch(() => [])).length > 0;
      if (!conflict) {
        outcomes.push({ root, ok: false, error });
        continue;
      }
    }
    let removed: UnshelveOutcome['removed'];
    if (opts.remove) {
      try {
        removed = await repo.removeFromShelf(group.id, [...paths]);
      } catch (e) {
        error = [error, errorText(e)].filter(Boolean).join('\n');
      }
    }
    outcomes.push({ root, ok: !conflict && !error, conflict: conflict || undefined, removed, error });
  }
  return outcomes;
}

// ---------- 匯出／匯入 patch ----------

/** 檔名中不能用的字元換成 _ */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'shelf';
}

/** 匯出的檔名：單一 repo 為「<擱置名稱>.patch」，多個 repo 為「<擱置名稱>-<repo 名稱>.patch」 */
export function patchFileName(shelfName: string, repoName: string, multi: boolean): string {
  return multi ? `${safeName(shelfName)}-${safeName(repoName)}.patch` : `${safeName(shelfName)}.patch`;
}

/**
 * 判斷每個 patch 屬於哪個 repo：先依檔名（「…-<repo 名稱>.patch」或「<repo 名稱>.patch」）找，
 * 再確認能套用到該 repo 的 HEAD；檔名對不上時，試每個 repo，取第一個能套用的。都不行時 repo 為 undefined。
 */
export async function matchPatchRepos<T extends { fileName: string; patch: Buffer }>(
  files: readonly T[],
  repos: readonly { repo: GitRepository; name: string }[],
): Promise<(T & { repo?: GitRepository })[]> {
  // 名稱長的先比對，避免「api」先吃掉「api-server」
  const byName = [...repos].sort((a, b) => safeName(b.name).length - safeName(a.name).length);
  const out: (T & { repo?: GitRepository })[] = [];
  for (const f of files) {
    const base = f.fileName.replace(/\.(patch|diff)$/i, '');
    const named = byName.find((r) => base === safeName(r.name) || base.endsWith(`-${safeName(r.name)}`));
    let repo: GitRepository | undefined;
    if (named && (await named.repo.patchAppliesToHead(f.patch))) repo = named.repo;
    else {
      for (const r of repos) {
        if (await r.repo.patchAppliesToHead(f.patch)) {
          repo = r.repo;
          break;
        }
      }
    }
    out.push({ ...f, repo });
  }
  return out;
}

/** 匯入後的擱置名稱預設：第一個檔名去掉「-<repo 名稱>」與副檔名 */
export function shelfNameFromPatch(fileName: string, repoName?: string): string {
  let base = fileName.replace(/\.(patch|diff)$/i, '');
  if (repoName && base.endsWith(`-${safeName(repoName)}`)) base = base.slice(0, -(safeName(repoName).length + 1));
  return base.trim();
}

/**
 * 把 patch 匯入成同一筆擱置（各 repo 共用 id，不動工作區）。任何一個 repo 失敗時，已匯入的刪除後丟出 ShelveError。
 */
export async function importAcross(items: readonly { repo: GitRepository; patches: Buffer[] }[], name: string, opts: { id?: string } = {}): Promise<{ id: string; roots: string[] }> {
  const id = opts.id ?? newShelfId();
  const done: GitRepository[] = [];
  for (const { repo, patches } of items) {
    try {
      if (await repo.importShelf(id, name, patches)) done.push(repo);
    } catch (e) {
      const rollbackErrors: { root: string; error: string }[] = [];
      for (const r of done) {
        try {
          await r.dropShelf(id);
        } catch (err) {
          rollbackErrors.push({ root: r.root, error: errorText(err) });
        }
      }
      throw new ShelveError(errorText(e), repo.root, rollbackErrors);
    }
  }
  return { id, roots: done.map((r) => r.root) };
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
