// 中欄表格：虛擬捲動 + Canvas 畫 commit graph
import type { CommitInfo, HeadInfo, RefInfo, RepoState } from '../shared/protocol';
import { MultiGraph, type FrameLayout, type GraphModel } from '../shared/multiGraph';
import { buildLabels, type RefLabel } from '../shared/refs';
import { el, formatDate, icon } from './dom';

export const ROW_HEIGHT = 22;
const LANE_WIDTH = 14;
const GRAPH_PAD = 6;
const OVERSCAN = 8;
/** 多 repo 時每列最左側的 repo 色條寬度 */
const STRIP_WIDTH = 4;
const STRIP_GAP = 4;

/** repo 色條顏色（與 lane 顏色錯開） */
export const REPO_COLORS = ['#4C9AEB', '#E5A05B', '#73BD79', '#C48AE6', '#4FC1C1', '#E48AB8', '#DCC35C', '#F07178', '#8C8CF0', '#9AA0A8'];

const EMPTY_MODEL: GraphModel = new MultiGraph(true);

/** lane 顏色（深淺主題皆可辨識） */
const PALETTE = ['#5FB950', '#D99A3D', '#4C9AEB', '#C674D9', '#E06666', '#3DBDBD', '#C9B53D', '#8C8CF0', '#E07FB0', '#7DB86B'];

export interface Columns {
  author: boolean;
  date: boolean;
  hash: boolean;
}

/** 中欄的視覺強調選項（👁 選單中的 Highlight） */
export interface Highlights {
  /** 依 Conventional Commits 類型（feat/fix/…）為 subject 前綴上色 */
  commitType: boolean;
  /** 自己的 commit 粗體 */
  mine: boolean;
  /** merge commit 淡化 */
  merges: boolean;
}

/** 解析 Conventional Commits 前綴：type(scope)!: */
const CC_RE = /^([a-zA-Z]+)(\([^)]*\))?(!)?:/;
const CC_TYPES = new Set(['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'style', 'build', 'ci', 'chore', 'revert']);

export interface LogTableCallbacks {
  onSelect: (index: number) => void;
  /** 多選（Ctrl／Shift）：indices 依列順序排列，至少兩筆 */
  onMultiSelect: (indices: number[]) => void;
  onContextMenu: (index: number, x: number, y: number) => void;
}

interface RowView {
  root: HTMLDivElement;
  subject: HTMLSpanElement;
  labels: HTMLSpanElement;
  author: HTMLDivElement;
  date: HTMLDivElement;
  hash: HTMLDivElement;
  index: number;
}

export class LogTable {
  readonly element: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly rowsLayer: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLDivElement;
  private pool: RowView[] = [];

  private commits: CommitInfo[] = [];
  private graph: GraphModel = EMPTY_MODEL;
  /** key = `${repo}:${hash}` */
  private refsByKey = new Map<string, RefInfo[]>();
  private states: readonly RepoState[] = [];
  private selected = -1;
  /** 多選時的所有選取列（含 selected）；單選時為空 */
  private multi = new Set<number>();
  /** Shift 範圍選取的起點 */
  private anchor = -1;
  private columns: Columns;
  private highlights: Highlights;
  private frame = 0;
  private heldScroll: number | undefined;

  constructor(
    private readonly cb: LogTableCallbacks,
    columns: Columns,
    highlights: Highlights,
  ) {
    this.columns = columns;
    this.highlights = highlights;
    this.spacer = el('div', { className: 'log-spacer' });
    this.rowsLayer = el('div', { className: 'log-rows' });
    this.canvas = el('canvas', { className: 'log-graph' });
    this.viewport = el('div', { className: 'log-viewport', attrs: { tabindex: '0', role: 'grid', 'aria-label': 'Commits' } }, this.canvas, this.spacer, this.rowsLayer);
    this.overlay = el('div', { className: 'log-overlay hidden' });
    this.element = el('div', { className: 'log-table' }, this.viewport, this.overlay);

    this.viewport.addEventListener('scroll', () => this.schedule());
    new ResizeObserver(() => this.schedule()).observe(this.viewport);
    this.viewport.addEventListener('keydown', (e) => this.onKey(e));
    this.rowsLayer.addEventListener('mousedown', (e) => {
      const idx = this.indexFromEvent(e);
      if (idx === undefined) return;
      // 右鍵點在已選取的列上：保留多選（右鍵選單作用於整個選取）
      if (e.button !== 0 && this.isSelected(idx)) return;
      if (e.button === 0 && e.shiftKey) {
        e.preventDefault();
        this.selectRange(this.anchor >= 0 ? this.anchor : idx, idx, e.ctrlKey || e.metaKey);
      } else if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        this.toggleIndex(idx);
      } else {
        this.select(idx, true);
      }
    });
    this.rowsLayer.addEventListener('contextmenu', (e) => {
      const idx = this.indexFromEvent(e);
      if (idx === undefined) return;
      e.preventDefault();
      if (!this.isSelected(idx)) this.select(idx, true);
      this.cb.onContextMenu(idx, e.clientX, e.clientY);
    });
    this.applyColumns();
  }

  private indexFromEvent(e: MouseEvent): number | undefined {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.log-row');
    if (!row) return undefined;
    const idx = Number(row.dataset.index);
    return Number.isFinite(idx) ? idx : undefined;
  }

  setColumns(columns: Columns): void {
    this.columns = columns;
    this.applyColumns();
    this.schedule();
  }

  private applyColumns(): void {
    this.element.classList.toggle('hide-author', !this.columns.author);
    this.element.classList.toggle('hide-date', !this.columns.date);
    this.element.classList.toggle('hide-hash', !this.columns.hash);
  }

  setHighlights(h: Highlights): void {
    this.highlights = h;
    this.invalidateRows();
  }

  /** 強制下一次繪製時重填所有列 */
  private invalidateRows(): void {
    for (const v of this.pool) v.index = -1;
    this.schedule();
  }

  /** 所有 repository 的狀態；commit.repo 為其索引 */
  setRepos(states: readonly RepoState[]): void {
    this.states = states;
    this.refsByKey = new Map();
    states.forEach((st, repo) => {
      for (const r of st.refs) {
        const key = `${repo}:${r.hash}`;
        const list = this.refsByKey.get(key);
        if (list) list.push(r);
        else this.refsByKey.set(key, [r]);
      }
    });
    this.invalidateRows();
  }

  private headOf(repo: number): HeadInfo {
    return this.states[repo]?.head ?? {};
  }

  /** 重新載入時保留捲動位置：資料長度足夠後回到原位置 */
  holdScroll(): void {
    this.heldScroll = this.viewport.scrollTop;
  }

  releaseScroll(): void {
    if (this.heldScroll !== undefined) this.viewport.scrollTop = this.heldScroll;
    this.heldScroll = undefined;
  }

  setData(commits: CommitInfo[], graph: GraphModel): void {
    this.commits = commits;
    this.graph = graph;
    this.spacer.style.height = `${commits.length * ROW_HEIGHT}px`;
    if (this.heldScroll !== undefined && commits.length * ROW_HEIGHT >= this.heldScroll + this.viewport.clientHeight) this.releaseScroll();
    this.schedule();
  }

  setMessage(text: string | undefined): void {
    this.overlay.textContent = text ?? '';
    this.overlay.classList.toggle('hidden', !text);
  }

  get selectedIndex(): number {
    return this.selected;
  }

  select(index: number, notify: boolean, scroll: 'nearest' | 'center' | 'none' = 'nearest'): void {
    if (index < 0 || index >= this.commits.length) return;
    this.selected = index;
    this.anchor = index;
    this.multi.clear();
    this.scrollToIndex(index, scroll);
    this.schedule();
    if (notify) this.cb.onSelect(index);
  }

  /** 所有選取列（依列順序） */
  get selectedIndices(): number[] {
    if (this.multi.size > 0) return [...this.multi].sort((a, b) => a - b);
    return this.selected >= 0 ? [this.selected] : [];
  }

  private isSelected(idx: number): boolean {
    return this.multi.size > 0 ? this.multi.has(idx) : idx === this.selected;
  }

  /** 多選上限：避免一次合併過多 commit 的變更 */
  static readonly MAX_MULTI = 200;

  private selectRange(from: number, to: number, add: boolean): void {
    const set = add ? new Set(this.selectedIndices) : new Set<number>();
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (let i = a; i <= b && set.size < LogTable.MAX_MULTI; i++) set.add(i);
    this.selected = to;
    this.applyMulti(set);
  }

  private toggleIndex(idx: number): void {
    const set = new Set(this.selectedIndices);
    if (set.has(idx)) {
      if (set.size === 1) return;
      set.delete(idx);
      this.selected = [...set].sort((a, b) => a - b)[0];
    } else {
      if (set.size >= LogTable.MAX_MULTI) return;
      set.add(idx);
      this.selected = idx;
    }
    this.anchor = idx;
    this.applyMulti(set);
  }

  private applyMulti(set: Set<number>): void {
    this.scrollToIndex(this.selected, 'nearest');
    if (set.size <= 1) {
      this.multi.clear();
      this.schedule();
      this.cb.onSelect(this.selected);
      return;
    }
    this.multi = set;
    this.schedule();
    this.cb.onMultiSelect(this.selectedIndices);
  }

  clearSelection(): void {
    this.selected = -1;
    this.anchor = -1;
    this.multi.clear();
    this.schedule();
  }

  focus(): void {
    this.viewport.focus();
  }

  private scrollToIndex(index: number, mode: 'nearest' | 'center' | 'none'): void {
    if (mode === 'none') return;
    const top = index * ROW_HEIGHT;
    const h = this.viewport.clientHeight;
    const st = this.viewport.scrollTop;
    if (mode === 'center') {
      if (top < st || top + ROW_HEIGHT > st + h) this.viewport.scrollTop = top - h / 2 + ROW_HEIGHT / 2;
    } else if (top < st) {
      this.viewport.scrollTop = top;
    } else if (top + ROW_HEIGHT > st + h) {
      this.viewport.scrollTop = top + ROW_HEIGHT - h;
    }
  }

  private onKey(e: KeyboardEvent): void {
    const page = Math.max(1, Math.floor(this.viewport.clientHeight / ROW_HEIGHT) - 1);
    let next: number | undefined;
    switch (e.key) {
      case 'ArrowDown':
        next = this.selected + 1;
        break;
      case 'ArrowUp':
        next = this.selected - 1;
        break;
      case 'PageDown':
        next = this.selected + page;
        break;
      case 'PageUp':
        next = this.selected - page;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.commits.length - 1;
        break;
      case 'a':
      case 'A':
        // Ctrl+A：選取可見範圍內最多 MAX_MULTI 筆
        if (!(e.ctrlKey || e.metaKey) || this.commits.length === 0) return;
        e.preventDefault();
        this.selectRange(0, Math.min(this.commits.length, LogTable.MAX_MULTI) - 1, false);
        return;
      default:
        return;
    }
    e.preventDefault();
    const target = Math.max(0, Math.min(this.commits.length - 1, next));
    if (e.shiftKey && this.anchor >= 0) this.selectRange(this.anchor, target, false);
    else this.select(target, true);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const vh = this.viewport.clientHeight;
    const vw = this.viewport.clientWidth;
    const st = this.viewport.scrollTop;
    const first = Math.max(0, Math.floor(st / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.commits.length, Math.ceil((st + vh) / ROW_HEIGHT) + OVERSCAN);

    const frame = this.graph.frame(first, last);
    const multi = this.graph.repoCount > 1;
    const graphLeft = multi ? STRIP_WIDTH + STRIP_GAP : 0;
    const graphWidth = graphLeft + GRAPH_PAD * 2 + frame.lanes * LANE_WIDTH;
    this.element.classList.toggle('multi-repo', multi);

    // 列：重複使用 DOM 節點
    const needed = last - first;
    while (this.pool.length < needed) this.pool.push(this.createRow());
    for (let i = 0; i < this.pool.length; i++) {
      const view = this.pool[i];
      const idx = first + i;
      if (idx >= last) {
        view.root.style.display = 'none';
        continue;
      }
      view.root.style.display = '';
      this.fillRow(view, idx, graphWidth, multi);
    }

    this.drawGraph(first, st, vh, vw, graphWidth, graphLeft, frame, multi);
  }

  private createRow(): RowView {
    const subject = el('span', { className: 'cell-subject-text' });
    const labels = el('span', { className: 'cell-labels' });
    const author = el('div', { className: 'cell cell-author' });
    const date = el('div', { className: 'cell cell-date' });
    const hash = el('div', { className: 'cell cell-hash' });
    const root = el('div', { className: 'log-row', attrs: { role: 'row' } }, el('div', { className: 'cell cell-subject' }, subject, labels), author, date, hash);
    this.rowsLayer.append(root);
    return { root, subject, labels, author, date, hash, index: -1 };
  }

  private fillRow(view: RowView, idx: number, graphWidth: number, multi: boolean): void {
    const c = this.commits[idx];
    const head = this.headOf(c.repo);
    view.root.style.transform = `translateY(${idx * ROW_HEIGHT}px)`;
    (view.root.firstElementChild as HTMLElement).style.paddingLeft = `${graphWidth}px`;
    view.root.classList.toggle('selected', this.isSelected(idx));
    view.root.classList.toggle('focused', this.multi.size > 0 && idx === this.selected);
    view.root.classList.toggle('is-head', c.hash === head.hash);
    const key = `${c.repo}:${c.hash}`;
    if (view.index === idx && view.root.dataset.key === key) return;
    view.index = idx;
    view.root.dataset.index = String(idx);
    view.root.dataset.key = key;
    const st = this.states[c.repo];
    view.root.title = multi && st ? st.name : '';

    const h = this.highlights;
    const me = { name: st?.userName, email: st?.userEmail };
    const mine = h.mine && ((!!me.email && c.authorEmail === me.email) || (!!me.name && c.author === me.name));
    view.root.classList.toggle('is-mine', mine);
    view.root.classList.toggle('is-merge', h.merges && c.parents.length > 1);
    renderSubject(view.subject, c.subject, h.commitType);
    view.subject.title = c.subject;
    view.labels.replaceChildren(...buildLabels(this.refsByKey.get(key), head, c.hash).map(renderLabel));

    const differs = c.author !== c.committer || c.authorEmail !== c.committerEmail;
    view.author.textContent = differs ? `${c.author}*` : c.author;
    view.author.title = differs ? `Author: ${c.author} <${c.authorEmail}>\nCommitter: ${c.committer} <${c.committerEmail}>` : `${c.author} <${c.authorEmail}>`;
    view.date.textContent = formatDate(c.authorTime);
    view.hash.textContent = c.hash.slice(0, 8);
  }

  private drawGraph(first: number, st: number, vh: number, vw: number, graphWidth: number, graphLeft: number, frame: FrameLayout, multi: boolean): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(graphWidth, vw);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(vh * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(vh * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${vh}px`;
      this.canvas.style.marginBottom = `${-vh}px`;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, vh);
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';

    const x = (repo: number, lane: number) => graphLeft + GRAPH_PAD + ((frame.offsets.get(repo) ?? 0) + lane) * LANE_WIDTH + LANE_WIDTH / 2;
    const color = (i: number) => PALETTE[i % PALETTE.length];
    const line = (c: number, x0: number, y0: number, x1: number, y1: number) => {
      ctx.strokeStyle = color(c);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };

    frame.rows.forEach((fr, k) => {
      const i = first + k;
      const { repo, row } = fr;
      const y0 = i * ROW_HEIGHT - st;
      const mid = y0 + ROW_HEIGHT / 2;
      const y1 = y0 + ROW_HEIGHT;
      if (multi) {
        ctx.fillStyle = REPO_COLORS[repo % REPO_COLORS.length];
        ctx.fillRect(0, y0, STRIP_WIDTH, ROW_HEIGHT);
      }
      // 直通線：此 repo 未與節點相連的 lane，以及其他 repo 穿過此列的 lane
      for (const t of fr.through) line(t.color, x(repo, t.lane), y0, x(repo, t.lane), y1);
      for (const o of fr.others) line(o.color, x(o.repo, o.lane), y0, x(o.repo, o.lane), y1);
      for (const s of row.top) line(s.color, x(repo, s.from), y0, x(repo, s.to), mid);
      for (const s of row.bottom) line(s.color, x(repo, s.from), mid, x(repo, s.to), y1);
    });

    // 節點畫在線上方
    frame.rows.forEach((fr, k) => {
      const i = first + k;
      const { repo, row } = fr;
      const cx = x(repo, row.col);
      const cy = i * ROW_HEIGHT - st + ROW_HEIGHT / 2;
      const c = color(row.color);
      if (this.commits[i]?.hash === this.headOf(repo).hash) {
        // HEAD：挖空圓心（露出列底色，選取列也正確），再畫外環與中心點
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy, 5.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}

function renderSubject(target: HTMLElement, subject: string, colorType: boolean): void {
  const m = colorType ? CC_RE.exec(subject) : null;
  if (!m || !CC_TYPES.has(m[1].toLowerCase())) {
    target.textContent = subject;
    return;
  }
  const [prefix, type, scope, bang] = m;
  target.replaceChildren(
    el('span', { className: `cc-type cc-${type.toLowerCase()}`, text: type }),
    scope ? el('span', { className: 'cc-scope', text: scope }) : '',
    bang ? el('span', { className: 'cc-breaking', text: bang }) : '',
    el('span', { className: 'cc-colon', text: ':' }),
    subject.slice(prefix.length),
  );
}

export function renderLabel(l: RefLabel): HTMLElement {
  const iconName = l.kind === 'head' ? 'head' : 'tag';
  return el('span', { className: `ref-label kind-${l.kind}${l.current ? ' current' : ''}`, title: l.title }, icon(iconName), el('span', { className: 'ref-text', text: l.text }));
}
