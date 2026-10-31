// 多 repo 合併 log 的 graph 模型：每個 repo 各自計算 lane，繪製時再依可見範圍分配欄位
import { GraphLayout, applyRow, passThrough, type GraphRow, type LaneState } from './graph';

export interface FrameRow {
  /** 此列所屬 repo */
  repo: number;
  row: GraphRow;
  /** 此 repo 直通此列的 lane */
  through: { lane: number; color: number }[];
  /** 其他 repo 尚未結束、穿過此列的 lane */
  others: { repo: number; lane: number; color: number }[];
}

export interface FrameLayout {
  /** 每個 repo 的第一條 lane 在畫面上的欄位位移 */
  offsets: Map<number, number>;
  /** 此範圍需要的總 lane 數 */
  lanes: number;
  /** 依 [first, last) 順序 */
  rows: FrameRow[];
}

export interface GraphModel {
  /** 合併後的列數 */
  readonly length: number;
  /** 結果中包含的 repo 數 */
  readonly repoCount: number;
  frame(first: number, last: number): FrameLayout;
}

const FLAT: GraphRow = { col: 0, color: 0, top: [], bottom: [], width: 1 };

/** 最大的 i 使 arr[i] < x；沒有則 -1 */
function lastBelow(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export class MultiGraph implements GraphModel {
  /** 每列所屬的 repo 索引 */
  readonly repoOf: number[] = [];
  /** 每列在所屬 repo 內的序號 */
  private readonly localIndex: number[] = [];
  /** 每個 repo 在合併清單中的列索引（遞增） */
  private readonly positions = new Map<number, number[]>();
  private readonly layouts = new Map<number, GraphLayout>();

  /** @param graph false 時（文字／User 篩選）只畫節點不畫連線 */
  constructor(private readonly graph: boolean) {}

  get length(): number {
    return this.repoOf.length;
  }

  get repoCount(): number {
    return this.positions.size;
  }

  add(commits: ReadonlyArray<{ hash: string; parents: readonly string[]; repo: number }>): void {
    for (const c of commits) {
      let pos = this.positions.get(c.repo);
      if (!pos) this.positions.set(c.repo, (pos = []));
      this.localIndex.push(pos.length);
      pos.push(this.repoOf.length);
      this.repoOf.push(c.repo);
      if (this.graph) {
        let layout = this.layouts.get(c.repo);
        if (!layout) this.layouts.set(c.repo, (layout = new GraphLayout()));
        layout.add([c]);
      }
    }
  }

  /** 第 i 列的 graph 資料 */
  rowAt(i: number): GraphRow {
    const layout = this.layouts.get(this.repoOf[i]);
    return layout ? layout.rows[this.localIndex[i]] : FLAT;
  }

  private stateBefore(repo: number, local: number): LaneState {
    return this.layouts.get(repo)?.stateBefore(local) ?? [];
  }

  /** 計算可見範圍 [first, last) 的繪製資料：各 repo 占用連續且不重疊的欄位 */
  frame(first: number, last: number): FrameLayout {
    const states = new Map<number, LaneState>();
    const widths = new Map<number, number>();
    for (const [repo, pos] of this.positions) {
      const p = lastBelow(pos, first);
      const st = p >= 0 ? this.stateBefore(repo, p + 1) : [];
      states.set(repo, st);
      if (st.length > 0) widths.set(repo, st.length);
    }

    const rows: FrameRow[] = [];
    for (let i = first; i < last && i < this.repoOf.length; i++) {
      const repo = this.repoOf[i];
      const row = this.rowAt(i);
      const before = states.get(repo) ?? [];
      const others: FrameRow['others'] = [];
      for (const [other, st] of states) {
        if (other === repo) continue;
        st.forEach((color, lane) => {
          if (color !== -1) others.push({ repo: other, lane, color });
        });
      }
      rows.push({ repo, row, through: passThrough(before, row), others });
      widths.set(repo, Math.max(widths.get(repo) ?? 0, row.width));
      states.set(repo, this.graph ? applyRow(before, row) : before);
    }

    const offsets = new Map<number, number>();
    let lanes = 0;
    for (const r of [...widths.keys()].sort((a, b) => a - b)) {
      offsets.set(r, lanes);
      lanes += widths.get(r)!;
    }
    return { offsets, lanes: Math.max(lanes, 1), rows };
  }
}
