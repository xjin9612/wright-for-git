// git 指令參數組裝與輸出解析（純函式，不依賴 vscode，可單元測試）
import type { ChangedFile, CommitInfo, FileStatus, LogFilter, RefInfo, UserInfo } from '../shared/protocol';

const US = '\x1f'; // 欄位分隔
const RS = '\x1e'; // 記錄分隔

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s'].join('%x1f') + '%x1e';
export const DETAILS_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f');
export const REF_FORMAT = ['%(refname)', '%(objectname)', '%(*objectname)', '%(upstream:short)', '%(symref)', '%(upstream:track)'].join('%00');

/** 是否為「只依 ref 篩選」：此時才有完整的 parent 關係可畫 graph */
export function isGraphFilter(filter: LogFilter): boolean {
  return filter.text.trim() === '' && filter.users.length === 0;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface LogArgOptions {
  /** HEAD 是否指向 commit；unborn（剛 init、orphan branch）時為 false，不可把 HEAD 當 revision */
  hasHead?: boolean;
}

export function buildLogArgs(filter: LogFilter, maxCount: number, opts: LogArgOptions = {}): string[] {
  const hasHead = opts.hasHead ?? true;
  const args = ['-c', 'log.showSignature=false', 'log', '--topo-order', '--no-color', `--format=${LOG_FORMAT}`, `--max-count=${maxCount}`];
  const text = filter.text.trim();
  const useRegex = text !== '' && filter.regex;

  if (text !== '' || filter.users.length > 0) {
    // git 的 -i 同時作用在 --grep 與 --author；有作者條件時一律不分大小寫
    if (!filter.matchCase || filter.users.length > 0) args.push('--regexp-ignore-case');
    args.push(useRegex ? '--extended-regexp' : '--fixed-strings');
  }
  if (text !== '') args.push(`--grep=${text}`);
  for (const u of filter.users) {
    const v = u.trim();
    if (v) args.push(`--author=${useRegex ? escapeRegex(v) : v}`);
  }

  if (filter.since && isDateValue(filter.since)) args.push(`--since=${filter.since}`);
  if (filter.until && isDateValue(filter.until)) args.push(`--until=${filter.until}`);

  // 防止以 '-' 開頭的值被 git 當成選項
  const branches = filter.branches.filter((b) => b && !b.startsWith('-') && (hasHead || b !== 'HEAD'));
  if (branches.length > 0) {
    args.push(...branches);
  } else {
    args.push('--branches', '--remotes', '--tags');
    if (hasHead) args.push('HEAD');
  }
  const paths = (filter.paths ?? []).map((p) => p.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean);
  if (paths.length > 0) {
    // --parents 讓 %P 輸出「改寫後」的 parent，路徑篩選下 graph 仍連得起來
    args.splice(args.indexOf('--topo-order') + 1, 0, '--parents');
    args.push('--', ...paths);
  } else {
    args.push('--');
  }
  return args;
}

/** 日期篩選值：相對時間（7.days.ago）或日期（2026-01-31、2026-01-31 23:59:59） */
export function isDateValue(v: string): boolean {
  return /^(\d+\.(hours?|days?|weeks?|months?|years?)\.ago|\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?)$/.test(v);
}

/** 可能是 hash 的搜尋字串 */
export function looksLikeHash(text: string): boolean {
  return /^[0-9a-fA-F]{7,64}$/.test(text.trim());
}

/** 只接受完整或縮寫的 commit hash（用於 diff 內容 URI 等外部輸入） */
export function isHash(text: string): boolean {
  return /^[0-9a-fA-F]{4,64}$/.test(text);
}

function parseCommitFields(f: string[]): CommitInfo {
  return {
    hash: f[0],
    parents: f[1] ? f[1].split(' ') : [],
    author: f[2],
    authorEmail: f[3],
    authorTime: Number(f[4]),
    committer: f[5],
    committerEmail: f[6],
    commitTime: Number(f[7]),
    subject: f[8] ?? '',
    repo: 0,
  };
}

/**
 * 解析串流中的 log 輸出。回傳完整記錄與尚未結束的剩餘字串。
 */
export function parseLogChunk(buffer: string): { commits: CommitInfo[]; rest: string } {
  const parts = buffer.split(RS);
  const rest = parts.pop() ?? '';
  const commits: CommitInfo[] = [];
  for (const p of parts) {
    const rec = p.replace(/^\n/, '');
    if (!rec) continue;
    commits.push(parseCommitFields(rec.split(US)));
  }
  return { commits, rest };
}

export function parseDetails(text: string): Omit<import('../shared/protocol').CommitDetails, 'files' | 'root'> {
  const f = text.split(US);
  const base = parseCommitFields(f);
  return {
    hash: base.hash,
    parents: base.parents,
    author: base.author,
    authorEmail: base.authorEmail,
    authorTime: base.authorTime,
    committer: base.committer,
    committerEmail: base.committerEmail,
    commitTime: Number(f[7]),
    message: f.slice(8).join(US).replace(/\s+$/, ''),
  };
}

export function parseRefs(text: string, remotes: readonly string[]): RefInfo[] {
  // 長的 remote 名稱優先比對，避免 remote 名稱含 '/' 時誤判
  const sortedRemotes = [...remotes].sort((a, b) => b.length - a.length);
  const refs: RefInfo[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [name, objectName, peeled, upstream, symref, track] = line.split('\0');
    if (symref) continue; // 略過 origin/HEAD 這類 symbolic ref
    const hash = peeled || objectName;
    if (name.startsWith('refs/heads/')) {
      refs.push({ name, short: name.slice(11), type: 'local', hash, upstream: upstream || undefined, ...parseTrack(track) });
    } else if (name.startsWith('refs/remotes/')) {
      const short = name.slice(13);
      const remote = sortedRemotes.find((r) => short.startsWith(`${r}/`)) ?? short.split('/')[0];
      refs.push({ name, short, type: 'remote', hash, remote, remoteBranch: short.slice(remote.length + 1) });
    } else if (name.startsWith('refs/tags/')) {
      refs.push({ name, short: name.slice(10), type: 'tag', hash });
    }
  }
  return refs;
}

/** 解析 `%(upstream:track)`：「[ahead 2, behind 3]」「[gone]」或空字串 */
export function parseTrack(track: string | undefined): Pick<RefInfo, 'ahead' | 'behind' | 'gone'> {
  if (!track) return {};
  if (track.includes('gone')) return { gone: true };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ...(ahead ? { ahead: Number(ahead[1]) } : {}), ...(behind ? { behind: Number(behind[1]) } : {}) };
}

/** 解析 `git diff-tree -r -M --name-status -z` 輸出 */
export function parseNameStatusZ(text: string): ChangedFile[] {
  const tokens = text.split('\0');
  const files: ChangedFile[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++];
    if (!code) continue;
    const status = code[0] as FileStatus;
    if (status === 'R' || status === 'C') {
      const oldPath = tokens[i++];
      const path = tokens[i++];
      files.push({ status, path, oldPath });
    } else {
      files.push({ status, path: tokens[i++] });
    }
  }
  return files;
}

/** 解析 `git shortlog -sne` 輸出 */
export function parseShortlog(text: string): UserInfo[] {
  const users: UserInfo[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\t(.*?)\s*<([^>]*)>\s*$/.exec(line);
    if (m) users.push({ count: Number(m[1]), name: m[2], email: m[3] });
  }
  return users;
}

const CONFLICT_TYPES: Record<string, import('../shared/protocol').ConflictType> = {
  UU: 'both-modified',
  AA: 'both-added',
  DU: 'deleted-by-us',
  UD: 'deleted-by-them',
  AU: 'added-by-us',
  UA: 'added-by-them',
  DD: 'both-deleted',
};

/** 解析 `git status --porcelain=v2 -z`（含 --untracked-files、--ignored） */
export function parseStatusV2(text: string): import('../shared/protocol').WorkingChange[] {
  const out: import('../shared/protocol').WorkingChange[] = [];
  const parts = text.split('\0');
  const combined = (xy: string): FileStatus => {
    const [x, y] = [xy[0], xy[1]];
    // y === 'A'：intent-to-add（git add -N），尚未在 HEAD 中
    if (x === 'A' || y === 'A') return 'A';
    if (x === 'D' || y === 'D') return 'D';
    if (x === 'T' || y === 'T') return 'T';
    return 'M';
  };
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const type = rec[0];
    if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const f = splitN(rec, 9);
      out.push({ path: f[8], status: combined(f[1]), kind: 'changed' });
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const f = splitN(rec, 10);
      const orig = parts[++i];
      out.push({ path: f[9], oldPath: orig, status: f[8].startsWith('C') ? 'C' : 'R', kind: 'changed' });
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = splitN(rec, 11);
      out.push({ path: f[10], status: 'U', kind: 'conflict', conflict: CONFLICT_TYPES[f[1]] ?? 'both-modified' });
    } else if (type === '?') {
      out.push({ path: rec.slice(2), status: 'A', kind: 'untracked' });
    } else if (type === '!') {
      out.push({ path: rec.slice(2), status: 'X', kind: 'ignored' });
    }
  }
  return out;
}

/** 以空白切成 n 段，最後一段保留剩餘內容（路徑可能含空白） */
function splitN(s: string, n: number): string[] {
  const out: string[] = [];
  let rest = s;
  for (let i = 0; i < n - 1; i++) {
    const k = rest.indexOf(' ');
    if (k < 0) break;
    out.push(rest.slice(0, k));
    rest = rest.slice(k + 1);
  }
  out.push(rest);
  return out;
}

/** 解析單一檔案的 unified diff：檔頭（diff --git 到 +++）與各段 hunk */
export function parseFileDiff(text: string): { header: string[]; hunks: import('../shared/protocol').DiffHunk[] } {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const header: string[] = [];
  const hunks: import('../shared/protocol').DiffHunk[] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) {
      hunks.push({ index: hunks.length, header: line, lines: [] });
    } else if (hunks.length === 0) {
      header.push(line);
    } else {
      hunks[hunks.length - 1].lines.push(line);
    }
  }
  return { header, hunks };
}

/** 由選取的 hunk 組回 patch（套用在 HEAD 上；配合 git apply --recount） */
export function buildPatch(header: string[], hunks: readonly import('../shared/protocol').DiffHunk[], selected: ReadonlySet<number>): string | undefined {
  const chosen = hunks.filter((h) => selected.has(h.index));
  if (chosen.length === 0) return undefined;
  return [...header, ...chosen.flatMap((h) => [h.header, ...h.lines]), ''].join('\n');
}

/**
 * 遠端網址 → 網頁網址：git@github.com:owner/repo.git、ssh://git@host/owner/repo、https://user@host/owner/repo.git
 * 都轉成 https://host/owner/repo；無法判斷時回傳 undefined。
 */
export function remoteWebUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let m = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/.exec(url);
  if (m && !url.includes('://')) return `https://${m[1]}/${m[2]}`;
  m = /^(?:ssh|git|https?):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (m) return `https://${m[1]}/${m[2]}`;
  return undefined;
}
