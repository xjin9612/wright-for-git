// 多 repo log 的串流合併：每個 repo 各自維持 topo 順序，跨 repo 依 commit 時間由新到舊交錯。
// 只有在所有「尚未結束」的 repo 都有待處理的 commit 時才輸出，確保順序正確。
import type { CommitInfo } from '../shared/protocol';

export class LogMerger {
  private readonly queues: CommitInfo[][];
  private readonly heads: number[];
  private readonly done: boolean[];

  constructor(count: number) {
    this.queues = Array.from({ length: count }, () => []);
    this.heads = new Array<number>(count).fill(0);
    this.done = new Array<boolean>(count).fill(false);
  }

  push(index: number, commits: readonly CommitInfo[]): void {
    this.queues[index].push(...commits);
  }

  finish(index: number): void {
    this.done[index] = true;
  }

  /** 取出目前可以確定順序的 commit */
  drain(): CommitInfo[] {
    const out: CommitInfo[] = [];
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.queues.length; i++) {
        const has = this.heads[i] < this.queues[i].length;
        if (!has) {
          if (!this.done[i]) return this.compact(out); // 某個 repo 還沒資料，必須等待
          continue;
        }
        if (best === -1 || this.queues[i][this.heads[i]].commitTime > this.queues[best][this.heads[best]].commitTime) best = i;
      }
      if (best === -1) return this.compact(out);
      out.push(this.queues[best][this.heads[best]++]);
    }
  }

  private compact(out: CommitInfo[]): CommitInfo[] {
    // 釋放已輸出的部分，避免佇列無限成長
    for (let i = 0; i < this.queues.length; i++) {
      if (this.heads[i] > 4096) {
        this.queues[i] = this.queues[i].slice(this.heads[i]);
        this.heads[i] = 0;
      }
    }
    return out;
  }
}
