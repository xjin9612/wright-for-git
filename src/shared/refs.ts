// Ref 標籤合併與排序（純函式，供 webview 使用並可單元測試）
import type { HeadInfo, RefInfo, RepoState } from './protocol';

export type LabelKind = 'head' | 'branch' | 'remote' | 'tag';

export interface RefLabel {
  text: string;
  kind: LabelKind;
  /** tooltip：列出所有合併進來的完整 ref */
  title: string;
  /** 是否為目前 branch */
  current: boolean;
}

/** 依 commit hash 建立 ref 索引 */
export function indexRefs(refs: readonly RefInfo[]): Map<string, RefInfo[]> {
  const map = new Map<string, RefInfo[]>();
  for (const r of refs) {
    const list = map.get(r.hash);
    if (list) list.push(r);
    else map.set(r.hash, [r]);
  }
  return map;
}

/**
 * 產生一個 commit 上要顯示的標籤：
 * - local branch 與同名 remote branch 指向同一 commit 時合併為「origin & main」
 * - 目前 branch 排最前，其次 local、remote、tag
 * - detached HEAD 顯示「HEAD」
 */
export function buildLabels(refs: readonly RefInfo[] | undefined, head: HeadInfo, hash: string): RefLabel[] {
  const labels: RefLabel[] = [];
  if (head.hash === hash && !head.branch) {
    labels.push({ text: 'HEAD', kind: 'head', title: 'HEAD (detached)', current: true });
  }
  if (!refs || refs.length === 0) return labels;

  const locals = refs.filter((r) => r.type === 'local');
  const remotes = refs.filter((r) => r.type === 'remote');
  const tags = refs.filter((r) => r.type === 'tag');
  const usedRemotes = new Set<RefInfo>();

  const localLabels: RefLabel[] = locals.map((l) => {
    const same = remotes.filter((r) => r.remoteBranch === l.short);
    same.forEach((r) => usedRemotes.add(r));
    const current = head.branch === l.short;
    const text = same.length > 0 ? `${same.map((r) => r.remote).join(' & ')} & ${l.short}` : l.short;
    const title = [l.short, ...same.map((r) => r.short)].join(', ');
    return { text, kind: 'branch', title, current };
  });
  localLabels.sort((a, b) => Number(b.current) - Number(a.current) || a.text.localeCompare(b.text));
  labels.push(...localLabels);

  for (const r of remotes) {
    if (!usedRemotes.has(r)) labels.push({ text: r.short, kind: 'remote', title: r.short, current: false });
  }
  for (const t of tags) {
    labels.push({ text: t.short, kind: 'tag', title: t.short, current: false });
  }
  return labels;
}

/** 自然排序（v2.10 排在 v2.9 之後） */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** 多個 repo 中同名（完整名稱相同）的 ref 合併為一筆 */
export interface MergedRef extends RefInfo {
  /** 擁有此 ref 的 repository root */
  roots: string[];
  /** 是否為任一 repo 的目前 branch */
  current: boolean;
}

export function mergeRefs(states: readonly RepoState[]): MergedRef[] {
  const map = new Map<string, MergedRef>();
  for (const s of states) {
    for (const r of s.refs) {
      const isCurrent = r.type === 'local' && r.short === s.head.branch;
      const m = map.get(r.name);
      if (m) {
        m.roots.push(s.root);
        m.current ||= isCurrent;
        // 多個 repo 的領先／落後數加總
        if (r.ahead) m.ahead = (m.ahead ?? 0) + r.ahead;
        if (r.behind) m.behind = (m.behind ?? 0) + r.behind;
      } else {
        map.set(r.name, { ...r, roots: [s.root], current: isCurrent });
      }
    }
  }
  return [...map.values()];
}
