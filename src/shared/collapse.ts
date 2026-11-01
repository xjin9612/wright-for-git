// 長線性分支折疊（對應 IntelliJ Graph Options 的 Collapse／Expand Linear Branches）：
// 分支上連續、沒有分岔與標籤的 commit 收成一列「⋯ N commits」，graph 以虛線連接。
// 規則：主線（HEAD 的 first-parent 歷史）不收；分支最新與第一筆保留；中間少於 MIN_HIDDEN 筆不收。

export const MIN_HIDDEN = 3;

export interface CollapsibleCommit {
  hash: string;
  parents: readonly string[];
  repo: number;
}

export interface LinearRun {
  /** `${repo}:${第一筆被收的 hash}`：辨識這一段（展開／收合的狀態以此記錄） */
  key: string;
  repo: number;
  /** 保留的上端（分支較新的一筆） */
  tip: string;
  /** 被收起來的 commit（由新到舊） */
  hidden: string[];
  /** 保留的下端（分支較舊的一筆） */
  last: string;
}

const keyOf = (repo: number, hash: string) => `${repo}:${hash}`;

/**
 * 找出可以收合的線性段落。
 * @param heads 各 repo 的 HEAD；其 first-parent 歷史為主線，不收
 * @param labeled 有分支或 tag 標籤的 commit（`${repo}:${hash}`），不收
 */
export function findLinearRuns(commits: readonly CollapsibleCommit[], heads: ReadonlyMap<number, string | undefined>, labeled: ReadonlySet<string>): LinearRun[] {
  const byKey = new Map<string, CollapsibleCommit>();
  const children = new Map<string, number>();
  for (const c of commits) byKey.set(keyOf(c.repo, c.hash), c);
  for (const c of commits) for (const p of c.parents) children.set(keyOf(c.repo, p), (children.get(keyOf(c.repo, p)) ?? 0) + 1);

  // 主線：從各 repo 的 HEAD 沿第一個 parent 往下
  const mainline = new Set<string>();
  for (const [repo, head] of heads) {
    let h = head;
    while (h) {
      const k = keyOf(repo, h);
      if (mainline.has(k)) break;
      mainline.add(k);
      h = byKey.get(k)?.parents[0];
    }
  }

  /** 可以被收的 commit：只有一個 parent、一個 child，不在主線上，沒有標籤 */
  const interior = (k: string) => {
    const c = byKey.get(k);
    return !!c && c.parents.length === 1 && children.get(k) === 1 && !mainline.has(k) && !labeled.has(k);
  };

  const runs: LinearRun[] = [];
  const taken = new Set<string>();
  for (const c of commits) {
    const ck = keyOf(c.repo, c.hash);
    const first = c.parents[0];
    if (!first || taken.has(ck)) continue;
    const fk = keyOf(c.repo, first);
    if (!interior(fk) || taken.has(fk)) continue;
    // c 是這一段的上端：沿第一個 parent 收集連續可收的 commit
    const chain: string[] = [];
    let h: string | undefined = first;
    while (h && interior(keyOf(c.repo, h)) && !taken.has(keyOf(c.repo, h))) {
      chain.push(h);
      h = byKey.get(keyOf(c.repo, h))!.parents[0];
    }
    // 保留分支的第一筆（最舊的一筆）當下端
    const last = chain.pop();
    if (!last || chain.length < MIN_HIDDEN) continue;
    for (const x of chain) taken.add(keyOf(c.repo, x));
    runs.push({ key: keyOf(c.repo, chain[0]), repo: c.repo, tip: c.hash, hidden: chain, last });
  }
  return runs;
}

/** 收合列：代表一段被收起來的 commit */
export interface CollapsedRow {
  key: string;
  count: number;
  /** 下端（保留的較舊一筆）的 hash，graph 以虛線連到它 */
  last: string;
}

/**
 * 依收合的段落產生顯示用清單：被收的 commit 換成一列收合列（放在第一筆被收的位置），
 * 上端的第一個 parent 改指向收合列（只影響 graph，commit 本身的 parents 不變）。
 */
export function applyCollapse<T extends CollapsibleCommit>(
  commits: readonly T[],
  runs: readonly LinearRun[],
  collapsed: (run: LinearRun) => boolean,
  makeRow: (run: LinearRun, first: T) => T,
): { view: T[]; graphParents: Map<string, string[]> } {
  const hiddenRun = new Map<string, LinearRun>();
  const graphParents = new Map<string, string[]>();
  for (const run of runs) {
    if (!collapsed(run)) continue;
    for (const h of run.hidden) hiddenRun.set(keyOf(run.repo, h), run);
  }
  if (hiddenRun.size === 0) return { view: commits as T[], graphParents };
  const byKey = new Map(commits.map((c) => [keyOf(c.repo, c.hash), c]));
  const view: T[] = [];
  for (const c of commits) {
    const run = hiddenRun.get(keyOf(c.repo, c.hash));
    if (!run) {
      view.push(c);
      continue;
    }
    if (c.hash !== run.hidden[0]) continue;
    const row = makeRow(run, c);
    view.push(row);
    graphParents.set(keyOf(run.repo, row.hash), [run.last]);
    const tip = byKey.get(keyOf(run.repo, run.tip));
    if (tip) graphParents.set(keyOf(run.repo, tip.hash), [row.hash, ...tip.parents.slice(1)]);
  }
  return { view, graphParents };
}
