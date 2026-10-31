// Extension 與 Webview 之間共用的資料型別與訊息協定

export interface CommitInfo {
  hash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  /** Unix 秒 */
  authorTime: number;
  committer: string;
  committerEmail: string;
  /** Unix 秒；多 repo 合併排序用 */
  commitTime: number;
  subject: string;
  /** 所屬 repository 在 RepoState 清單中的索引（由 extension 填入） */
  repo: number;
}

export type RefType = 'local' | 'remote' | 'tag';

export interface RefInfo {
  /** 完整名稱，如 refs/heads/main */
  name: string;
  /** 短名稱，如 main、origin/main、v1.0 */
  short: string;
  type: RefType;
  /** 指向的 commit（tag 已 peel） */
  hash: string;
  /** remote ref 所屬的 remote 名稱 */
  remote?: string;
  /** remote ref 去掉 remote 前綴後的 branch 名稱 */
  remoteBranch?: string;
  /** local branch 的 upstream 短名稱 */
  upstream?: string;
  /** 相對 upstream 領先的 commit 數 */
  ahead?: number;
  /** 相對 upstream 落後的 commit 數 */
  behind?: number;
  /** upstream 已被刪除 */
  gone?: boolean;
}

export interface HeadInfo {
  hash?: string;
  /** 目前 branch 短名稱；detached 時為 undefined */
  branch?: string;
}

export interface RepoState {
  root: string;
  /** 顯示名稱：相對工作區資料夾的路徑（巢狀 repo 如 api-server/libs/x） */
  name: string;
  head: HeadInfo;
  refs: RefInfo[];
  remotes: string[];
  userName?: string;
  userEmail?: string;
}

export interface LogFilter {
  text: string;
  regex: boolean;
  matchCase: boolean;
  /** ref 名稱（完整名稱或 HEAD）；空陣列表示全部 */
  branches: string[];
  /** 作者（子字串比對） */
  users: string[];
  /** 路徑（相對 repo 根目錄，'/' 分隔）；空陣列表示不限 */
  paths: string[];
  /** 只顯示這些 repository（root 路徑）；空陣列表示全部 */
  roots: string[];
  /** 各 repository 的路徑篩選（Paths → Select… 跨 repo 勾選資料夾）；有值時優先於 paths */
  pathsByRoot?: Record<string, string[]>;
  /** 日期範圍（git 日期字串，如 7.days.ago、2026-01-31）；比對 committer 日期 */
  since?: string;
  until?: string;
}

export const EMPTY_FILTER: LogFilter = { text: '', regex: false, matchCase: false, branches: [], users: [], paths: [], roots: [] };

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface ChangedFile {
  status: FileStatus;
  path: string;
  /** rename／copy 的原路徑 */
  oldPath?: string;
  /** 所屬模組（相對 repo 根目錄；依目前工作區判斷） */
  module?: string;
  /** 多選合併變更時，diff 左右兩側的 revision（'' 表示不存在）；單一 commit 時不填 */
  left?: string;
  right?: string;
}

export interface CommitDetails {
  root: string;
  hash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  authorTime: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  message: string;
  files: ChangedFile[];
}

/** 工作區變更（提交視窗） */
export type ChangeKind = 'changed' | 'untracked' | 'ignored' | 'conflict';

export interface WorkingChange {
  /** 相對 repo 根目錄，'/' 分隔；已忽略的資料夾以 '/' 結尾 */
  path: string;
  /** rename 的原路徑 */
  oldPath?: string;
  /** 相對 HEAD 的狀態（A／M／D／R／C／T／U） */
  status: FileStatus;
  kind: ChangeKind;
}

export interface Changelist {
  id: string;
  name: string;
}

/** 提交視窗的資料 */
export interface CommitState {
  repos: { root: string; name: string; branch?: string; changes: (WorkingChange & { module?: string })[] }[];
  changelists: Changelist[];
  activeList: string;
  /** `${root}\0${path}` → changelist id；沒有指定的屬於目前使用中的 changelist */
  assign: Record<string, string>;
  /** 只提交部分 hunk 的檔案：`${root}\0${path}` → 選取的段數／總段數 */
  partial: Record<string, { selected: number; total: number }>;
  showIgnored: boolean;
}

/** diff 的一段（hunk） */
export interface DiffHunk {
  /** 在檔案 diff 中的序號 */
  index: number;
  header: string;
  lines: string[];
}

export interface StashInfo {
  /** stash@{n} */
  ref: string;
  hash: string;
  parents: string[];
  /** Unix 秒 */
  time: number;
  /** 例如「On main: message」或「WIP on main: abc123 subject」 */
  message: string;
  /** stash 時所在的 branch */
  branch?: string;
}

export interface UserInfo {
  name: string;
  email: string;
  count: number;
}

/** Webview → Extension */
export type ToExtension =
  | { type: 'ready' }
  /** generation：送出時 webview 持有的 repos 版本；與 extension 不一致時忽略（新的 repos 訊息已在路上） */
  | { type: 'loadLog'; requestId: number; generation: number; filter: LogFilter }
  | { type: 'selectCommit'; root: string; hash: string }
  | { type: 'containingBranches'; root: string; hash: string }
  /** 多選 commit：合併各 repo 選取 commit 的變更；requestId 用來忽略過期回應 */
  | { type: 'selectCommits'; requestId: number; items: { root: string; hash: string; parents: string[] }[] }
  /** files：同一組變更的所有檔案（依顯示順序），供 diff 內切換上一個／下一個檔案 */
  | { type: 'openDiff'; root: string; hash: string; parent?: string; file: ChangedFile; files?: ChangedFile[] }
  /** 在 roots 中所有擁有此 ref 的 repository checkout */
  | { type: 'checkout'; ref: string; roots: string[] }
  | { type: 'checkoutRevision'; root: string; hash: string }
  | { type: 'requestUsers' }
  | { type: 'requestPaths'; root: string }
  | { type: 'refresh' }
  | { type: 'copy'; text: string }
  | { type: 'selectRepository' }
  /** 同步：對 roots 中的 repository 執行 */
  | { type: 'sync'; action: SyncAction; roots: string[] }
  /** Push 對話框：取得各 repo 要推的內容；upTo 為「Push All up to Here」的 commit */
  | { type: 'pushPreview'; requestId: number; roots: string[]; branch?: string; upTo?: { root: string; hash: string }; overrides?: PushTarget[] }
  /** Push 對話框中點選 commit：取得變更檔案 */
  | { type: 'pushCommitFiles'; requestId: number; root: string; hash: string }
  /** 在編輯器分頁開啟 Push 對話框 */
  | { type: 'openPushPanel'; roots: string[]; branch?: string; upTo?: { root: string; hash: string } }
  /** 取消儲藏對話框 */
  | { type: 'unstashLoad'; requestId: number }
  | { type: 'unstashFiles'; requestId: number; root: string; hash: string }
  | { type: 'unstashApply'; root: string; hash: string; pop: boolean; index: boolean; branch?: string }
  | { type: 'unstashDrop'; root: string; hash: string }
  | { type: 'unstashClear'; root: string }
  | { type: 'openStashDiff'; root: string; hash: string; file: ChangedFile & { untracked?: boolean } }
  /** 提交視窗 */
  | { type: 'commitReady' }
  | { type: 'commitRefresh'; showIgnored: boolean }
  | { type: 'commitDiff'; root: string; change: WorkingChange }
  | { type: 'commitOpenFile'; root: string; path: string }
  | { type: 'commitRollback'; items: { root: string; change: WorkingChange }[] }
  | { type: 'commitLastMessage'; root: string }
  | { type: 'commitRun'; requestId: number; message: string; amend: boolean; signOff: boolean; noVerify: boolean; push: boolean; items: { root: string; changes: WorkingChange[] }[] }
  | { type: 'commitHunks'; root: string; path: string }
  | { type: 'commitClearPartial'; keys: string[] }
  | { type: 'commitAddIgnore'; root: string; paths: string[] }
  | { type: 'changelistNew'; keys?: string[] }
  | { type: 'changelistRename'; id: string }
  | { type: 'changelistDelete'; id: string }
  | { type: 'changelistActivate'; id: string }
  | { type: 'changelistMove'; keys: string[]; id?: string }
  | { type: 'stashSave' }
  | { type: 'openUnstash'; root?: string }
  /** 逐段提交面板：選取的 hunk（以內容辨識） */
  | { type: 'hunksSelect'; root: string; path: string; selected: number[] }
  /** 編輯器分頁的對話框要求關閉 */
  | { type: 'closeDialog' }
  /** 面板內確認框的結果 */
  | { type: 'confirmResult'; id: number; ok: boolean }
  /** Push 對話框確認 */
  | { type: 'pushConfirm'; requestId: number; targets: PushTarget[]; force: boolean; tags: boolean }
  /** Branches 右鍵選單的操作：ref 為完整名稱，roots 為擁有此 ref 的 repository */
  | { type: 'refAction'; action: RefAction; ref: string; roots: string[] }
  /** 多選 commit 的操作：依 commits 的順序逐一執行（同一個 repo） */
  | { type: 'commitsAction'; action: 'cherryPick' | 'revert'; root: string; commits: { hash: string; parents: string[]; subject: string }[] }
  /** Commit 右鍵選單的操作 */
  | { type: 'commitAction'; action: CommitAction; root: string; hash: string; parents: string[]; subject: string };

export type SyncAction = 'fetch' | 'pull';

/** Push 的目標：把 root 的目前 branch（或 upTo commit）推到 remote/remoteBranch */
export interface PushTarget {
  root: string;
  /** 要推的 local branch；未指定時為目前 branch */
  branch?: string;
  remote: string;
  remoteBranch: string;
  upTo?: string;
  /** 對話框預覽時看到的遠端 commit（'' 為新 branch）；送出時若已改變就拒絕 force push */
  expected?: string;
}

export interface PushCommit {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  authorTime: number;
}

/** 單一 repository 的 push 預覽 */
export interface PushPlan {
  root: string;
  name: string;
  /** 目前 branch；detached 時為 undefined */
  branch?: string;
  remote?: string;
  remoteBranch?: string;
  remotes: string[];
  /** 已設定 upstream（沒有時 push 會一併以 -u 設定） */
  hasUpstream: boolean;
  /** 遠端還沒有這個 branch */
  isNew: boolean;
  /** 預覽時遠端 branch 的 commit（remote-tracking ref；新 branch 為 ''）；force push 以此為 lease */
  trackingHash?: string;
  /** 只推到這個 commit 為止 */
  upTo?: string;
  /** 要推的 commit（新到舊，最多 limit 筆） */
  commits: PushCommit[];
  /** 要推的 commit 總數 */
  total: number;
  /** 遠端有而本機沒有的 commit 數（一般 push 會被拒絕） */
  behind: number;
  /** 無法 push 的原因 */
  problem?: 'detached' | 'noRemote' | 'notAncestor' | 'error';
  message?: string;
}
export type RefAction = 'newBranch' | 'rename' | 'delete' | 'merge' | 'rebase' | 'compare' | 'compareWorkingTree' | 'update' | 'pushTag';
export type CommitAction = 'cherryPick' | 'revert' | 'reset' | 'newBranch' | 'newTag' | 'compareLocal';

/** Extension → Webview */
export type ToWebview =
  /** 所有 repository 的狀態；commit.repo 為此陣列的索引 */
  | { type: 'repos'; states: RepoState[]; generation: number; message?: string }
  /** warnings：部分 repo 讀取失敗時的訊息（只在 done 時帶） */
  | { type: 'logBatch'; requestId: number; commits: CommitInfo[]; done: boolean; graph: boolean; warnings?: string[] }
  | { type: 'logError'; requestId: number; message: string }
  /** 文字／User 篩選的簡化 graph：[repo 索引, hash, 簡化後的 parent] */
  | { type: 'logGraph'; requestId: number; parents: [number, string, string[]][] }
  | { type: 'details'; details: CommitDetails }
  | { type: 'detailsError'; root: string; hash: string; message: string }
  | { type: 'multiDetails'; requestId: number; groups: { root: string; files: ChangedFile[] }[] }
  | { type: 'containing'; root: string; hash: string; branches: string[] }
  | { type: 'users'; users: UserInfo[] }
  | { type: 'paths'; root: string; paths: string[] }
  | { type: 'pushPreview'; requestId: number; plans: PushPlan[] }
  | { type: 'pushCommitFiles'; requestId: number; root: string; hash: string; files: ChangedFile[] }
  /** started：已開始推送（對話框關閉）；cancelled：使用者在確認框取消 */
  | { type: 'pushStatus'; requestId: number; status: 'started' | 'cancelled' }
  | { type: 'unstashData'; requestId: number; repos: { root: string; name: string; stashes: StashInfo[] }[] }
  | { type: 'unstashFiles'; requestId: number; root: string; hash: string; files: (ChangedFile & { untracked?: boolean })[] }
  | { type: 'commitState'; state: CommitState }
  | { type: 'commitLastMessage'; root: string; message: string }
  | { type: 'commitDone'; requestId: number; ok: boolean }
  | { type: 'hunksData'; root: string; path: string; hunks: DiffHunk[]; selected: number[] }
  /** 在面板內顯示確認框（取代 VS Code 的 modal 對話框） */
  | { type: 'confirm'; id: number; message: string; detail?: string; ok: string; cancel: string; kind: 'info' | 'warning' | 'danger' }
  /** 由 extension 指定篩選（如檔案總管的「顯示 Git 歷史」） */
  | { type: 'applyFilter'; filter: Partial<LogFilter> };
