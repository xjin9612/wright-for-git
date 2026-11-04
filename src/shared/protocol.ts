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
  /** 遠端（origin）的網頁網址，例如 https://github.com/owner/repo；用於 issue 連結 */
  webUrl?: string;
  /** 進行中的 rebase／merge／cherry-pick／revert（等待解決衝突或 edit） */
  operation?: 'cherry-pick' | 'revert' | 'merge' | 'rebase';
  /** 尚未解決的衝突檔案數 */
  conflicts?: number;
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

/** 變更檔案樹有焦點時選取的檔案（供 F4 開啟） */
export interface FocusedFile {
  root: string;
  path: string;
}

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
  /** 儲藏中的未追蹤檔案 */
  untracked?: boolean;
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

/**
 * 衝突的種類（git status 的 XY）：both-modified（UU）、both-added（AA）、deleted-by-us（DU）、deleted-by-them（UD）、
 * added-by-us（AU）、added-by-them（UA）、both-deleted（DD）
 */
export type ConflictType = 'both-modified' | 'both-added' | 'deleted-by-us' | 'deleted-by-them' | 'added-by-us' | 'added-by-them' | 'both-deleted';

/** 兩邊都有內容、可以逐段合併的衝突；其他種類只能整個採用某一邊 */
export const isContentConflict = (c: ConflictType | undefined): boolean => c === 'both-modified' || c === 'both-added';

/** 衝突清單分頁的一列 */
export interface ConflictFile {
  path: string;
  conflict: ConflictType;
}

/** 三方合併的段落：不變的行，或變更區塊（base／我的／他們的） */
export type MergeSegment =
  | { kind: 'stable'; lines: string[] }
  | {
      kind: 'chunk';
      base: string[];
      ours: string[];
      theirs: string[];
      oursChanged: boolean;
      theirsChanged: boolean;
      /** 兩邊都改、且改得不一樣 */
      conflict: boolean;
    };

/** 三方合併分頁的資料 */
export interface MergeArgs {
  root: string;
  path: string;
  oursLabel: string;
  theirsLabel: string;
  /** 不是 UTF-8 文字（二進位或其他編碼）：只能整個採用某一邊或改用 VS Code 合併編輯器 */
  binary?: boolean;
  eol: '\n' | '\r\n';
  finalNewline: boolean;
  segments: MergeSegment[];
}

export interface WorkingChange {
  /** 相對 repo 根目錄，'/' 分隔；已忽略的資料夾以 '/' 結尾 */
  path: string;
  /** rename 的原路徑 */
  oldPath?: string;
  /** 相對 HEAD 的狀態（A／M／D／R／C／T／U） */
  status: FileStatus;
  kind: ChangeKind;
  /** kind 為 conflict 時的衝突種類 */
  conflict?: ConflictType;
}

/** Commit 訊息中的 issue 編號轉連結：pattern 為正規表示式，url 可用 $0、$1… 與 {repo}（遠端網頁網址） */
export interface IssueLinkRule {
  pattern: string;
  url: string;
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseEntry {
  hash: string;
  action: RebaseAction;
  /** reword／squash 的新訊息 */
  message?: string;
}

export interface RebaseCommit {
  hash: string;
  subject: string;
  message: string;
  author: string;
  authorTime: number;
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

/**
 * Shelf 在單一 repo 的一筆：存成 refs/wright/shelf/<id>，內容與 stash 相同（git stash push 產生的 commit），
 * 但不在 refs/stash，不會出現在 stash 清單，也不會被 gc 清掉。同一次 shelve 的各 repo 共用 id。
 */
export interface ShelfInfo {
  id: string;
  name: string;
  hash: string;
  parents: string[];
  /** Unix 秒 */
  time: number;
}

/** 一次擱置（可能跨多個 repo，各 repo 共用 id） */
export interface ShelfGroup {
  id: string;
  name: string;
  /** 各 repo 中最新的擱置時間（Unix 秒） */
  time: number;
  entries: { root: string; shelf: ShelfInfo }[];
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

/** 面板內設定框顯示的設定值 */
export interface SettingsValues {
  language: 'auto' | 'en' | 'zh-tw';
  autoRefresh: boolean;
  maxCommits: number;
  scanDepth: number;
  /** 自訂 issue 連結規則的數量 */
  issueLinks: number;
}

/** Branches 樹的顯示選項 */
export interface BranchViewOptions {
  /** 依 '/' 分資料夾 */
  groupByDirectory: boolean;
  /** 多 repo 時依儲存庫分組（不合併同名分支） */
  groupByRepository: boolean;
  showTags: boolean;
  /** 點選分支時：false 依分支篩選記錄；true 只在記錄中跳到該分支的最新 commit */
  navigateOnSelect: boolean;
}

/** Branches 樹的偏好（Log 與側邊欄共用，存在 Log 的 webview 狀態） */
export interface BranchPrefs {
  /** 我的最愛（完整 ref 名稱）；未設定時預設為 main／master */
  favorites?: string[];
  onlyFavorites: boolean;
  options: BranchViewOptions;
  expanded: string[];
}

/** Log → 側邊欄 Branches：要顯示的 repository、目前篩選的分支與偏好 */
export interface BranchesSync {
  states: RepoState[];
  /** 沒有 repository 時的說明 */
  message?: string;
  /** Branch 篩選只有一個值時的 ref 名稱（或 'HEAD'） */
  selected?: string;
  prefs: BranchPrefs;
  /** 設定 wright.defaultFavoriteBranches */
  defaultFavorites?: string[];
}

/** 側邊欄 Branches → Log：需要 Log 處理的操作（ref 為完整名稱） */
export type BranchesEvent =
  | { kind: 'select'; ref: string }
  | { kind: 'newTab'; ref: string }
  | { kind: 'navigate'; ref: string }
  | { kind: 'prefs'; prefs: BranchPrefs };

/** Webview → Extension */
export type ToExtension =
  /** Log 的 Branches 狀態（轉給側邊欄） */
  | { type: 'branchesSync'; sync: BranchesSync }
  /** 側邊欄 Branches 的操作（轉給 Log） */
  | { type: 'branchesEvent'; event: BranchesEvent }
  | { type: 'getSettings' }
  /** 編輯器分頁對話框的偏好（例如變更檔案的分組方式），存在 globalState，下次開啟沿用 */
  | { type: 'dialogPref'; key: string; value: unknown }
  /** 衝突：整個檔案採用我的／他們的版本，或標記為已解決 */
  | { type: 'conflictAction'; items: { root: string; path: string }[]; action: 'ours' | 'theirs' | 'resolved' }
  /** 開啟三方合併分頁 */
  | { type: 'openMerge'; root: string; path: string }
  /** 開啟衝突清單分頁 */
  | { type: 'openConflicts'; root?: string }
  | { type: 'conflictsLoad' }
  /** 三方合併分頁：寫入結果並標記為已解決；unresolved 為還沒處理的衝突區塊數 */
  | { type: 'mergeApply'; root: string; path: string; text: string; unresolved: number }
  | { type: 'mergeOpenEditor'; root: string; path: string }
  | { type: 'setSetting'; key: string; value: unknown }
  | { type: 'openSettingsPage' }
  /** 開啟 VS Code 的鍵盤快速鍵頁，只列出這個擴充功能的快速鍵 */
  | { type: 'openKeybindingsPage' }
  | { type: 'editIssueLinks' }
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
  /** 變更檔案樹的焦點與選取檔案（失去焦點時 focused 為 false） */
  | { type: 'fileTreeFocus'; focused: boolean; file?: FocusedFile }
  /** 開啟工作目錄中的檔案 */
  | { type: 'openWorkingFile'; root: string; path: string }
  /** Select In：在檔案總管檢視、檔案管理員或終端機中顯示工作目錄的檔案 */
  | { type: 'selectInFile'; root: string; path: string }
  /** 以唯讀方式開啟檔案在某個 revision 的內容 */
  | { type: 'openRevisionFile'; root: string; ref: string; path: string }
  /** 開啟外部連結（只接受 http／https） */
  | { type: 'openExternal'; url: string }
  /** 同步：對 roots 中的 repository 執行 */
  | { type: 'sync'; action: SyncAction; roots: string[] }
  /** Push 對話框：取得各 repo 要推的內容；upTo 為「Push All up to Here」的 commit */
  | { type: 'pushPreview'; requestId: number; roots: string[]; branch?: string; upTo?: { root: string; hash: string }; overrides?: PushTarget[] }
  /** Push 對話框中點選 commit：取得變更檔案；hashes 有多筆時回傳這些 commit 合併後的淨變更（新到舊排列） */
  | { type: 'pushCommitFiles'; requestId: number; root: string; hash: string; hashes?: string[] }
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
  /** 擱置選取的變更（keep：工作區保留原樣）；name 為預設名稱 */
  | { type: 'commitShelve'; items: { root: string; change: WorkingChange }[]; keep: boolean; name: string }
  /** 擱置分頁 */
  | { type: 'shelfLoad'; requestId: number }
  | { type: 'shelfFiles'; requestId: number; id: string }
  | { type: 'shelfOpenDiff'; id: string; root: string; file: ChangedFile & { untracked?: boolean } }
  /**
   * 取回 paths 列出的檔案（rename 含新舊路徑）；remove：取回的檔案從擱置移除；
   * overwrite：覆蓋工作區已存在的未追蹤檔案；changelist：已追蹤的檔案放進這個 changelist（沒有就建立）
   */
  | { type: 'shelfUnshelve'; id: string; paths: { root: string; paths: string[] }[]; remove: boolean; overwrite: boolean; changelist?: string; next?: string[] }
  /** 依序取回多筆時，使用者取消了某一筆：剩下的 id 不取回 */
  | { type: 'shelfUnshelveStopped'; ids: string[] }
  | { type: 'shelfRename'; id: string }
  /** 匯出成 .patch（每個 repo 一個檔） */
  | { type: 'shelfExport'; id: string }
  /** 選 .patch 檔匯入成一筆擱置 */
  | { type: 'shelfImport' }
  | { type: 'shelfDrop'; ids: string[] }
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
  /** 逐段提交面板：選取的 hunk 序號（對應開啟時的 diff；extension 端再以內容比對） */
  | { type: 'hunksSelect'; root: string; path: string; selected: number[] }
  /** 進行中的 rebase／merge 等：繼續、略過、中止 */
  | { type: 'operation'; root: string; action: 'continue' | 'skip' | 'abort'; /** 畫面上顯示的進行中操作；與實際不符時不執行 */ expected?: 'cherry-pick' | 'revert' | 'merge' | 'rebase' }
  /** 互動式 rebase */
  | { type: 'openRebase'; root: string; hash: string }
  | { type: 'rebaseStart'; root: string; base: string; entries: RebaseEntry[] }
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
  | { type: 'branchesSync'; sync: BranchesSync }
  | { type: 'branchesEvent'; event: BranchesEvent }
  /** 側邊欄的 Branches 是否顯示中（顯示時 Log 收起自己的 Branches 欄） */
  | { type: 'branchesDocked'; docked: boolean }
  | { type: 'conflictsData'; repos: { root: string; name: string; operation?: RepoState['operation']; files: ConflictFile[] }[] }
  | { type: 'settings'; values: SettingsValues; open?: boolean }
  /** 所有 repository 的狀態；commit.repo 為此陣列的索引 */
  | { type: 'repos'; states: RepoState[]; generation: number; message?: string; issueLinks?: IssueLinkRule[]; defaultFavorites?: string[] }
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
  | { type: 'stashChanged' }
  /** Shelf 有變動（擱置、取回、改名、刪除） */
  | { type: 'shelfChanged' }
  /** 切到提交視窗的某個分頁（例如匯入 patch 後顯示擱置） */
  | { type: 'commitShowTab'; tab: 'commit' | 'stash' | 'shelf' }
  /** 依序取回多筆：上一筆順利取回，接著開下一筆的取回對話框 */
  | { type: 'shelfUnshelveNext'; ids: string[] }
  | { type: 'shelfData'; requestId: number; groups: ShelfGroup[]; repoNames: Record<string, string> }
  /** exists：未追蹤檔案在工作區已存在（取回時要覆蓋才會還原） */
  | { type: 'shelfFiles'; requestId: number; id: string; repos: { root: string; files: (ChangedFile & { untracked?: boolean; exists?: boolean })[] }[] }
  /** 在面板內顯示確認框（取代 VS Code 的 modal 對話框） */
  | { type: 'confirm'; id: number; message: string; detail?: string; ok: string; cancel: string; kind: 'info' | 'warning' | 'danger' }
  /** 由 extension 指定篩選（如檔案總管的「顯示 Git 歷史」） */
  | { type: 'applyFilter'; filter: Partial<LogFilter> };
