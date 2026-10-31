// Commit graph 佈局：依 topo 順序（子先於父）逐筆放置，分配 lane 與顏色。
// 支援增量呼叫 add()，供串流載入時邊收邊算。
//
// 記憶體設計：每列只記錄「與節點相連」的線段（匯入、分岔），不記錄單純直通的 lane；
// 直通 lane 由每 SNAPSHOT_INTERVAL 列一份的 lane 快照回放得出（見 stateBefore／applyRow）。
// 因此記憶體約為 O(commit 數 + commit 數 / 間隔 × lane 數)，不再是 O(commit 數 × lane 數)。

export interface Segment {
  /** 起點 lane */
  from: number;
  /** 終點 lane */
  to: number;
  /** 顏色索引 */
  color: number;
}

export interface GraphRow {
  /** 節點所在 lane */
  col: number;
  /** 節點顏色索引 */
  color: number;
  /** 上半列：匯入節點的 lane（從列頂 from 到節點 to） */
  top: Segment[];
  /** 下半列：從節點連到各 parent 的 lane（從節點 from 到列底 to） */
  bottom: Segment[];
  /** 此列涉及的 lane 數（用於計算 graph 欄寬） */
  width: number;
}

/** lane 狀態：索引為 lane，值為顏色索引，-1 表示空 */
export type LaneState = number[];

export const SNAPSHOT_INTERVAL = 64;

/** 由某列之前的 lane 狀態推出該列之後的狀態 */
export function applyRow(before: LaneState, row: GraphRow): LaneState {
  const after = before.slice();
  for (const s of row.top) after[s.from] = -1;
  for (const s of row.bottom) {
    while (after.length <= s.to) after.push(-1);
    if (after[s.to] === -1) after[s.to] = s.color;
  }
  while (after.length > 0 && after[after.length - 1] === -1) after.pop();
  return after;
}

/** 該列中「直通」的 lane（列前列後都存在、且未與節點相連） */
export function passThrough(before: LaneState, row: GraphRow): { lane: number; color: number }[] {
  const touched = new Set(row.top.map((s) => s.from));
  const out: { lane: number; color: number }[] = [];
  before.forEach((c, k) => {
    if (c !== -1 && !touched.has(k)) out.push({ lane: k, color: c });
  });
  return out;
}

interface Lane {
  hash: string;
  color: number;
}

export class GraphLayout {
  readonly rows: GraphRow[] = [];
  private readonly lanes: (Lane | null)[] = [];
  private readonly snapshots: LaneState[] = [];
  private nextColor = 0;

  add(commits: ReadonlyArray<{ hash: string; parents: readonly string[] }>): void {
    for (const c of commits) {
      if (this.rows.length % SNAPSHOT_INTERVAL === 0) this.snapshots.push(this.currentState());
      this.rows.push(this.place(c.hash, c.parents));
    }
  }

  private currentState(): LaneState {
    return this.lanes.map((l) => (l ? l.color : -1));
  }

  /** 第 i 列之前的 lane 狀態（i 可等於 rows.length，表示最後一列之後） */
  stateBefore(i: number): LaneState {
    if (this.snapshots.length === 0 || i <= 0) return [];
    const idx = Math.min(Math.floor(i / SNAPSHOT_INTERVAL), this.snapshots.length - 1);
    let state = this.snapshots[idx];
    for (let j = idx * SNAPSHOT_INTERVAL; j < i && j < this.rows.length; j++) state = applyRow(state, this.rows[j]);
    return state;
  }

  private place(hash: string, parents: readonly string[]): GraphRow {
    const beforeLength = this.lanes.length;

    // 節點位置：第一條等待此 commit 的 lane；沒有則開新 lane（branch head）
    let col = this.lanes.findIndex((l) => l?.hash === hash);
    let color: number;
    if (col === -1) {
      col = this.freeSlot();
      color = this.newColor();
    } else {
      color = this.lanes[col]!.color;
    }

    // 上半：等待此 commit 的 lane 匯入節點，並釋放這些 lane
    const top: Segment[] = [];
    for (let k = 0; k < this.lanes.length; k++) {
      const l = this.lanes[k];
      if (l?.hash === hash) {
        top.push({ from: k, to: col, color: l.color });
        this.lanes[k] = null;
      }
    }

    // 下半：連到各 parent
    const bottom: Segment[] = [];
    parents.forEach((p, i) => {
      const existing = this.lanes.findIndex((l) => l?.hash === p);
      if (existing !== -1) {
        // parent 已有 lane 在等，直接連過去
        bottom.push({ from: col, to: existing, color: i === 0 ? color : this.lanes[existing]!.color });
        return;
      }
      if (i === 0) {
        // 第一個 parent 延續同一條 lane 與顏色
        this.lanes[col] = { hash: p, color };
        bottom.push({ from: col, to: col, color });
      } else {
        const k = this.freeSlot();
        const c = this.newColor();
        this.lanes[k] = { hash: p, color: c };
        bottom.push({ from: col, to: k, color: c });
      }
    });

    while (this.lanes.length > 0 && this.lanes[this.lanes.length - 1] === null) this.lanes.pop();

    const width = Math.max(beforeLength, this.lanes.length, col + 1);
    return { col, color, top, bottom, width };
  }

  private freeSlot(): number {
    const i = this.lanes.indexOf(null);
    if (i !== -1) return i;
    this.lanes.push(null);
    return this.lanes.length - 1;
  }

  private newColor(): number {
    return this.nextColor++;
  }
}
