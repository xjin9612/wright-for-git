// 三方合併分頁（對應 IntelliJ 的 Merge Revisions）：左邊我的、中間結果（可直接編輯）、右邊他們的。
// 每個變更區塊一組 ≫ ✕（套用／略過）；「逐行」模式下衝突區塊的每一行各有自己的 ≫ ✕。
import type { MergeArgs, MergeSegment } from '../shared/protocol';
import { clear, el, icon } from './dom';
import { plural, t } from './l10n';
import { post } from './vscodeApi';

type Chunk = Extract<MergeSegment, { kind: 'chunk' }>;
type LineState = 'pending' | 'applied' | 'ignored';

interface Side {
  /** 這一邊有變更（沒有變更的一邊不顯示按鈕） */
  changed: boolean;
  lines: LineState[];
  /** 整段套用了（刪除整段時沒有行，靠這個記錄） */
  took: boolean;
  /** 整段略過或套用了（不再顯示按鈕） */
  done: boolean;
}

interface Block {
  chunk?: Chunk;
  ours?: Side;
  theirs?: Side;
  /** 中間結果欄的內容 */
  lines: string[];
  /** 使用者手動改過這一段 */
  edited: boolean;
}

type Snapshot = { lines: string[]; edited: boolean; ours?: Side; theirs?: Side }[];

const cloneSide = (s?: Side): Side | undefined => (s ? { ...s, lines: [...s.lines] } : undefined);

let args: MergeArgs;
let blocks: Block[] = [];
let lineMode = false;
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
let typing: ReturnType<typeof setTimeout> | undefined;
let current = -1;

const grid = el('div', { className: 'merge-grid' });
const scroller = el('div', { className: 'merge-scroll' }, grid);
const counter = el('span', { className: 'muted merge-counter' });
const lineToggle = el('button', { className: 'button secondary merge-line-toggle', attrs: { type: 'button', 'aria-pressed': 'false', title: t('Resolve conflicts line by line') } }, icon('list-flat'), el('span', { text: t('Line by Line') }));
const applyNonConflicting = el('button', { className: 'button secondary', text: t('Apply Non-Conflicting Changes'), attrs: { type: 'button' } });

// ---------- 狀態 ----------

function newSide(changed: boolean, count: number): Side {
  return { changed, lines: Array.from({ length: changed ? count : 0 }, () => 'pending' as LineState), took: false, done: !changed };
}

function initBlocks(): void {
  blocks = args.segments.map((seg) => {
    if (seg.kind === 'stable') return { lines: [...seg.lines], edited: false };
    const b: Block = { chunk: seg, ours: newSide(seg.oursChanged, seg.ours.length), theirs: newSide(seg.theirsChanged, seg.theirs.length), lines: [...seg.base], edited: false };
    // 兩邊改得一樣：直接採用（重複套用兩邊會變成兩份）
    if (seg.oursChanged && seg.theirsChanged && !seg.conflict) {
      setSide(b, 'ours', 'applied');
      setSide(b, 'theirs', 'ignored');
    }
    return b;
  });
}

function setSide(b: Block, which: 'ours' | 'theirs', state: 'applied' | 'ignored', line?: number): void {
  const s = b[which];
  if (!s?.changed) return;
  if (line === undefined) {
    s.lines = s.lines.map(() => state);
    s.done = true;
    if (state === 'applied') s.took = true;
  } else {
    s.lines[line] = state;
    if (state === 'applied') s.took = true;
    s.done = s.lines.every((x) => x !== 'pending');
  }
  b.edited = false;
  b.lines = compute(b);
}

/** 結果：套用的我的行在前、他們的行在後；兩邊都沒套用時為原本（base）的內容 */
function compute(b: Block): string[] {
  const c = b.chunk!;
  const take = (s: Side | undefined, src: string[]) => (s?.took ? src.filter((_, i) => s.lines[i] === 'applied') : []);
  if (!b.ours?.took && !b.theirs?.took) return [...c.base];
  return [...take(b.ours, c.ours), ...take(b.theirs, c.theirs)];
}

const resolved = (b: Block) => !b.chunk || b.edited || ((b.ours?.done ?? true) && (b.theirs?.done ?? true));
const unresolvedBlocks = () => blocks.filter((b) => !resolved(b));
const unresolvedConflicts = () => blocks.filter((b) => b.chunk?.conflict && !resolved(b));

function snapshot(): Snapshot {
  return blocks.map((b) => ({ lines: [...b.lines], edited: b.edited, ours: cloneSide(b.ours), theirs: cloneSide(b.theirs) }));
}

function restore(s: Snapshot): void {
  s.forEach((x, i) => Object.assign(blocks[i], { lines: [...x.lines], edited: x.edited, ours: cloneSide(x.ours), theirs: cloneSide(x.theirs) }));
}

/** 改變前記錄（≫ ✕、整批套用；打字時一段連續輸入記一次） */
function record(): void {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function undo(): void {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snapshot());
  restore(s);
  render();
}

function redo(): void {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snapshot());
  restore(s);
  render();
}

function change(fn: () => void): void {
  record();
  fn();
  render();
}

// ---------- 畫面 ----------

function lineEl(no: number, text: string, cls = ''): HTMLElement {
  return el('div', { className: `merge-line ${cls}` }, el('span', { className: 'merge-no', text: String(no) }), el('span', { className: 'merge-text', text: text || ' ' }));
}

function sideButtons(b: Block, which: 'ours' | 'theirs', line?: number): HTMLElement[] {
  const applyLabel = which === 'ours' ? t('Apply change from the left') : t('Apply change from the right');
  // 按鈕只有符號：名稱放在 aria-label，螢幕閱讀器才不會只念出符號
  const apply = el('button', { className: 'merge-btn apply', text: which === 'ours' ? '≫' : '≪', attrs: { type: 'button', title: applyLabel, 'aria-label': applyLabel } });
  const ignore = el('button', { className: 'merge-btn ignore', text: '✕', attrs: { type: 'button', title: t('Ignore change'), 'aria-label': t('Ignore change') } });
  apply.addEventListener('click', () => change(() => setSide(b, which, 'applied', line)));
  ignore.addEventListener('click', () => change(() => setSide(b, which, 'ignored', line)));
  return which === 'ours' ? [apply, ignore] : [ignore, apply];
}

/** 中間欄與兩側欄之間的按鈕：一般模式一段一組，逐行模式（衝突區塊）每行一組 */
function gutter(b: Block, which: 'ours' | 'theirs'): HTMLElement {
  const cell = el('div', { className: `merge-gutter ${which}` });
  const s = b[which];
  // 手動編輯過但還有沒決定的一邊：按鈕保留，按 ≫ 會以套用的結果蓋掉手動內容
  if (!s?.changed) return cell;
  if (lineMode && b.chunk?.conflict && s.lines.length > 0) {
    for (let i = 0; i < s.lines.length; i++) cell.append(el('div', { className: 'merge-gutter-line' }, ...(s.lines[i] === 'pending' ? sideButtons(b, which, i) : [])));
  } else if (!s.done) {
    cell.append(el('div', { className: 'merge-gutter-line' }, ...sideButtons(b, which)));
  }
  return cell;
}

function chunkClass(b: Block): string {
  if (!b.chunk) return '';
  if (resolved(b)) return ' resolved';
  return b.chunk.conflict ? ' conflict' : ' change';
}

function render(): void {
  const focusIndex = blocks.findIndex((_, i) => document.activeElement === grid.querySelector(`textarea[data-index="${i}"]`));
  const scroll = scroller.scrollTop;
  clear(grid);
  let noOurs = 1;
  let noTheirs = 1;
  let noResult = 1;
  blocks.forEach((b, i) => {
    const cls = chunkClass(b);
    const c = b.chunk;
    const oursLines = c ? c.ours : b.lines;
    const theirsLines = c ? c.theirs : b.lines;
    const left = el('div', { className: `merge-cell side${c?.oursChanged ? cls : ''}` });
    oursLines.forEach((line, k) => left.append(lineEl(noOurs + k, line, b.ours?.changed ? `state-${b.ours.lines[k]}` : '')));
    const right = el('div', { className: `merge-cell side${c?.theirsChanged ? cls : ''}` });
    theirsLines.forEach((line, k) => right.append(lineEl(noTheirs + k, line, b.theirs?.changed ? `state-${b.theirs.lines[k]}` : '')));
    noOurs += oursLines.length;
    noTheirs += theirsLines.length;

    const nums = el('div', { className: 'merge-nums' });
    for (let k = 0; k < b.lines.length; k++) nums.append(el('div', { text: String(noResult + k) }));
    noResult += b.lines.length;
    const area = el('textarea', { className: 'merge-input', attrs: { spellcheck: 'false', wrap: 'off', 'data-index': String(i), 'aria-label': t('Result') } });
    area.value = b.lines.join('\n');
    area.rows = Math.max(1, b.lines.length);
    if (b.lines.length === 0) area.classList.add('empty');
    area.addEventListener('beforeinput', () => {
      if (!typing) record();
      clearTimeout(typing);
      typing = setTimeout(() => (typing = undefined), 800);
    });
    area.addEventListener('input', () => {
      b.lines = area.value.split('\n');
      if (b.chunk) b.edited = true;
      area.rows = Math.max(1, b.lines.length);
      area.classList.remove('empty');
      renumber();
      row.className = `merge-cell result${chunkClass(b)}`;
      syncStatus();
    });
    const row = el('div', { className: `merge-cell result${cls}`, attrs: { 'data-index': String(i) } }, nums, area);
    grid.append(left, gutter(b, 'ours'), row, gutter(b, 'theirs'), right);
  });
  scroller.scrollTop = scroll;
  if (focusIndex >= 0) grid.querySelector<HTMLTextAreaElement>(`textarea[data-index="${focusIndex}"]`)?.focus();
  syncStatus();
}

/** 結果欄的行號（打字時不重繪整個畫面，只更新行號） */
function renumber(): void {
  let no = 1;
  grid.querySelectorAll<HTMLElement>('.merge-cell.result').forEach((cell, i) => {
    const nums = cell.querySelector('.merge-nums')!;
    const count = blocks[i].lines.length;
    if (nums.childElementCount !== count || nums.firstElementChild?.textContent !== String(no)) {
      clear(nums);
      for (let k = 0; k < count; k++) nums.append(el('div', { text: String(no + k) }));
    }
    no += count;
  });
}

function syncStatus(): void {
  const conflicts = unresolvedConflicts().length;
  const changes = unresolvedBlocks().length - conflicts;
  const parts = [conflicts > 0 ? plural(conflicts, '{0} conflict left', '{0} conflicts left') : t('All conflicts resolved')];
  if (changes > 0) parts.push(plural(changes, '{0} non-conflicting change', '{0} non-conflicting changes'));
  counter.textContent = parts.join(' · ');
  applyNonConflicting.disabled = changes === 0;
  lineToggle.classList.toggle('active', lineMode);
  lineToggle.setAttribute('aria-pressed', String(lineMode));
}

/** 跳到上一個／下一個還沒處理的區塊 */
function go(dir: 1 | -1): void {
  const list = blocks.map((b, i) => (resolved(b) ? -1 : i)).filter((i) => i >= 0);
  if (list.length === 0) return;
  const next = dir > 0 ? (list.find((i) => i > current) ?? list[0]) : ([...list].reverse().find((i) => i < current) ?? list[list.length - 1]);
  current = next;
  const cell = grid.querySelector<HTMLElement>(`.merge-cell.result[data-index="${next}"]`);
  cell?.scrollIntoView({ block: 'center' });
  cell?.classList.add('flash');
  setTimeout(() => cell?.classList.remove('flash'), 600);
}

function resultText(): string {
  const lines = blocks.flatMap((b) => b.lines);
  if (lines.length === 0) return '';
  return lines.join(args.eol) + (args.finalNewline ? args.eol : '');
}

// ---------- 進入點 ----------

export function openMergeDialog(a: MergeArgs): void {
  args = a;
  initBlocks();
  const toolbarButton = (iconName: Parameters<typeof icon>[0], title: string, fn: () => void) => {
    const b = el('button', { className: 'icon-button', attrs: { type: 'button', title, 'aria-label': title } }, icon(iconName));
    b.addEventListener('click', fn);
    return b;
  };
  const accept = (side: 'ours' | 'theirs') => post({ type: 'conflictAction', items: [{ root: args.root, path: args.path }], action: side });
  const yours = el('button', { className: 'button secondary', text: t('Accept Yours'), attrs: { type: 'button' } });
  const theirs = el('button', { className: 'button secondary', text: t('Accept Theirs'), attrs: { type: 'button' } });
  const vscodeEditor = el('button', { className: 'button secondary', text: t('Open in VS Code Merge Editor'), attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button secondary dialog-cancel', text: t('Cancel'), attrs: { type: 'button' } });
  const apply = el('button', { className: 'button primary', text: t('Apply'), attrs: { type: 'button' } });
  yours.addEventListener('click', () => accept('ours'));
  theirs.addEventListener('click', () => accept('theirs'));
  vscodeEditor.addEventListener('click', () => post({ type: 'mergeOpenEditor', root: args.root, path: args.path }));
  cancel.addEventListener('click', () => post({ type: 'closeDialog' }));
  apply.addEventListener('click', () => post({ type: 'mergeApply', root: args.root, path: args.path, text: resultText(), unresolved: unresolvedBlocks().length }));
  lineToggle.addEventListener('click', () => {
    lineMode = !lineMode;
    render();
  });
  applyNonConflicting.addEventListener('click', () =>
    change(() => {
      for (const b of blocks) {
        if (!b.chunk || b.chunk.conflict || resolved(b)) continue;
        if (b.chunk.oursChanged) setSide(b, 'ours', 'applied');
        if (b.chunk.theirsChanged) setSide(b, 'theirs', 'applied');
      }
    }),
  );

  const header = el('div', { className: 'push-header' }, `${t('Merge')}: ${args.path}`);
  let body: HTMLElement;
  if (args.binary) {
    body = el('div', { className: 'merge-binary' }, el('p', { text: t('This file is not UTF-8 text, so it cannot be merged line by line here. Accept one side, or open it in the VS Code merge editor.') }));
    apply.disabled = true;
  } else {
    const toolbar = el(
      'div',
      { className: 'merge-toolbar' },
      toolbarButton('arrow-up', `${t('Previous Change')} (Shift+F7)`, () => go(-1)),
      toolbarButton('arrow-down', `${t('Next Change')} (F7)`, () => go(1)),
      counter,
      el('span', { className: 'merge-sep' }),
      applyNonConflicting,
      lineToggle,
      el('span', { className: 'toolbar-spacer' }),
      toolbarButton('undo', `${t('Undo')} (Ctrl+Z)`, undo),
      toolbarButton('redo', `${t('Redo')} (Ctrl+Shift+Z)`, redo),
    );
    const heads = el(
      'div',
      { className: 'merge-heads' },
      el('div', {}, el('b', { text: t('Yours') }), el('span', { className: 'muted', text: args.oursLabel })),
      el('div'),
      el('div', {}, el('b', { text: t('Result') })),
      el('div'),
      el('div', {}, el('b', { text: t('Theirs') }), el('span', { className: 'muted', text: args.theirsLabel })),
    );
    body = el('div', { className: 'merge-body' }, toolbar, heads, scroller);
  }
  const dialog = el(
    'div',
    { className: 'push-dialog merge-dialog', attrs: { role: 'dialog', 'aria-label': `${t('Merge')}: ${args.path}` } },
    header,
    body,
    el('div', { className: 'push-footer' }, yours, theirs, vscodeEditor, el('div', { className: 'toolbar-spacer' }), cancel, apply),
  );
  document.body.append(el('div', { className: 'modal-overlay embedded' }, dialog));

  document.addEventListener(
    'keydown',
    (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (document.querySelector('.confirm-dialog')) return;
      if (mod && e.key.toLowerCase() === 'z') {
        // 打字、≫ ✕ 共用同一個復原紀錄
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'F7') {
        e.preventDefault();
        go(e.shiftKey ? -1 : 1);
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        apply.click();
      } else if (e.key === 'Escape' && undoStack.length === 0) {
        // 有改過時不用 Esc 關閉，避免誤按丟掉合併結果
        post({ type: 'closeDialog' });
      }
    },
    true,
  );
  if (!args.binary) {
    render();
    // 開啟時捲到第一個衝突
    requestAnimationFrame(() => go(1));
  }
}
