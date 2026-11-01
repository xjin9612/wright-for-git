// 三方合併（diff3）：以共同祖先（base）比對我的（ours）與他們的（theirs），切成不變段落與變更區塊。
// 只做行比對，不依賴外部套件；合併分頁（mergeDialog）用結果畫出三欄與 ≫ ✕。
import type { MergeSegment } from '../shared/protocol';

export type { MergeSegment };

/** base[a0, a1) 被換成 side[b0, b1) */
export interface LineHunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** 超過這個編輯距離就不再細分，整段視為一個變更（避免極端大檔耗盡記憶體） */
const MAX_EDIT = 4000;

/** 行比對（Myers O(ND)）：回傳把 a 變成 b 的變更區段，依位置排序 */
export function diffLines(a: readonly string[], b: readonly string[]): LineHunk[] {
  // 去掉相同的開頭與結尾，縮小比對範圍
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ a0: start, a1: endA, b0: start, b1: endB }];

  const max = Math.min(n + m, MAX_EDIT);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [{ a0: start, a1: endA, b0: start, b1: endB }];

  // 回溯，收集相同的行（對角線），再把中間的空隙轉成變更區段
  const matches: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      matches.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    matches.push([x, y]);
  }
  matches.reverse();

  const out: LineHunk[] = [];
  let pa = 0;
  let pb = 0;
  for (const [ma, mb] of [...matches, [n, m] as [number, number]]) {
    if (ma > pa || mb > pb) out.push({ a0: start + pa, a1: start + ma, b0: start + pb, b1: start + mb });
    pa = ma + 1;
    pb = mb + 1;
  }
  return out;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 三方合併：回傳依順序的段落。兩邊的變更重疊或相鄰時合成一個衝突區塊（與 git 相同，相鄰也算衝突）。
 * 兩邊改得一樣的區塊不算衝突（oursChanged、theirsChanged 都為 true、conflict 為 false）。
 */
export function merge3(base: readonly string[], ours: readonly string[], theirs: readonly string[]): MergeSegment[] {
  const hunks = [...diffLines(base, ours).map((h) => ({ ...h, side: 0 as const })), ...diffLines(base, theirs).map((h) => ({ ...h, side: 1 as const }))].sort(
    (p, q) => p.a0 - q.a0 || p.a1 - q.a1,
  );
  const out: MergeSegment[] = [];
  const pushStable = (from: number, to: number) => {
    if (to <= from) return;
    const last = out[out.length - 1];
    if (last?.kind === 'stable') last.lines.push(...base.slice(from, to));
    else out.push({ kind: 'stable', lines: base.slice(from, to) });
  };
  // 每一邊：base 位置 → 該邊位置的位移（前面的變更造成的行數差）
  const shift = [0, 0];
  let pos = 0;
  let i = 0;
  while (i < hunks.length) {
    const group = [hunks[i]];
    let r0 = hunks[i].a0;
    let r1 = hunks[i].a1;
    i++;
    while (i < hunks.length && hunks[i].a0 <= r1) {
      r1 = Math.max(r1, hunks[i].a1);
      r0 = Math.min(r0, hunks[i].a0);
      group.push(hunks[i]);
      i++;
    }
    pushStable(pos, r0);
    const sideLines = (side: 0 | 1, lines: readonly string[]) => {
      const hs = group.filter((h) => h.side === side);
      if (hs.length === 0) return { lines: base.slice(r0, r1), changed: false };
      const first = hs[0];
      const last = hs[hs.length - 1];
      const b0 = first.b0 - (first.a0 - r0);
      const b1 = last.b1 + (r1 - last.a1);
      return { lines: lines.slice(b0, b1), changed: true };
    };
    const o = sideLines(0, ours);
    const t = sideLines(1, theirs);
    for (const h of group) shift[h.side] += h.b1 - h.b0 - (h.a1 - h.a0);
    const both = o.changed && t.changed;
    out.push({ kind: 'chunk', base: base.slice(r0, r1), ours: o.lines, theirs: t.lines, oursChanged: o.changed, theirsChanged: t.changed, conflict: both && !same(o.lines, t.lines) });
    pos = r1;
  }
  pushStable(pos, base.length);
  return out;
}

/** 文字 → 行（不含換行字元），記下換行符號、結尾是否有換行 */
export function splitText(text: string): { lines: string[]; eol: '\n' | '\r\n'; finalNewline: boolean } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text === '') return { lines: [], eol, finalNewline: false };
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const finalNewline = lines[lines.length - 1] === '';
  if (finalNewline) lines.pop();
  return { lines, eol, finalNewline };
}

export function joinLines(lines: readonly string[], eol: string, finalNewline: boolean): string {
  if (lines.length === 0) return '';
  return lines.join(eol) + (finalNewline ? eol : '');
}
