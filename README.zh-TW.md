# Wright for Git

[![CI](https://github.com/xjin9612/wright-for-git/actions/workflows/ci.yml/badge.svg)](https://github.com/xjin9612/wright-for-git/actions/workflows/ci.yml)

[English](README.md) | 繁體中文

在 VS Code 重現 IntelliJ 的 Git 工具視窗：底部 Panel 的 **Git Log**（Branches 樹｜Commit Log（含 graph）｜變更檔案＋Commit 詳情，三欄連動），以及側邊欄的 **Commit 視窗**與 **Branches 樹**；完整支援含多個 repo 的工作區。

![Wright for Git](docs/images/screenshot.png)

## 功能

- **Branches**：Local／Remote／Tags 樹狀顯示，依 `/` 分資料夾或依 repo 分組；工具列照 IntelliJ 順序（新增、更新、刪除、比較、與工作區比較、擷取、我的最愛、跳到分支 HEAD）；點選即篩選 Log，雙擊 checkout；星號標記我的最愛並置頂（可只顯示我的最愛）；右鍵：從此新增 branch、與目前 branch 比較、merge、rebase、更新、push、重新命名、刪除、推送 tag
- **Commit Log**
  - Commit graph（lane 分配與著色、HEAD 標記）
  - Ref 標籤：同名 local／remote 合併顯示（`origin & main`）、tag、detached HEAD
  - 篩選：文字或 hash（支援 regex、大小寫）、Branch（含我的最愛的串接選單）、User（支援 `me`）、Paths（repo 與資料夾）、日期；Branch、Paths 選單上方有搜尋框，輸入關鍵字縮小清單，`↑` `↓` 移動、`Enter` 選取；多值以 `|` 或換行分隔，`Enter` 補完、`Ctrl+Enter` 完成；文字／User 篩選時仍會畫出簡化的 graph
  - 多個 Log 分頁，各自保留篩選條件
  - Highlight：Conventional Commits 類型上色、我的 commit 粗體、merge commit 淡化
  - 欄位：Author（author ≠ committer 時標 `*`）、Date、Hash，可在 👁 選單切換，拖曳欄位左緣調整寬度
  - 虛擬捲動，串流分批載入；以 10 萬筆 commit 測試過
  - 右鍵：複製 hash／subject、checkout revision、新建 branch／tag、cherry-pick、revert、reset（soft／mixed／hard）、Push 到這裡為止、與工作區比較、從這裡互動式 rebase
  - `Ctrl`／`Shift` 多選：右欄顯示合併後的變更，可一次 cherry-pick 或 revert 多個 commit
  - 互動式 rebase：pick、reword、edit、squash、fixup、drop，拖曳或 `Alt+↑↓` 調整順序；rebase／merge／cherry-pick／revert 進行中時，Log 上方顯示解決衝突、繼續、略過、中止
  - 提交訊息中的 issue 編號轉連結（`wright.issueLinks`）；選取 commit 時淡化不在其路徑上的列；👁 選單「收合線性分支」把分支上連續的 commit 收成一列虛線的「⋯ N commits」，點一下展開
- **Commit 視窗**（`Alt+0`）：勾選要提交的檔案或只提交部分 hunk；Changelist；未追蹤與已忽略檔案；依目錄／repo／模組分組；Amend、Sign-off、略過 hooks、提交並推送；捨棄變更、加入 `.gitignore`。透過暫時 index 提交，不影響內建原始檔控制的暫存區。另有「儲藏」分頁列出所有 repo 的 stash
- **擱置（Shelf）**：不提交、先把修改擱置起來，可以跨多個 repo 成為同一筆（提交視窗的「擱置變更…」）。「擱置」分頁列出每一筆與其檔案；「取回…」可勾選 repo 與檔案、放進哪個 changelist、取回的檔案是否從擱置移除；有衝突時直接打開衝突清單。擱置存在各 repo 中（不在 stash 清單），可匯出成 `.patch`，也能匯入 `git apply` 或 IntelliJ 產生的 patch
- **合併衝突**：衝突清單分頁（採用我的／採用他們的／合併…，解決完直接繼續）與三方合併分頁：左邊我的、中間可直接編輯的結果、右邊他們的，每個變更有 ≫ ✕，「逐行」模式每一行各有 ≫ ✕；套用所有不衝突的變更、復原／重做。merge、rebase、cherry-pick、revert、套用儲藏的衝突都適用
- **同步**：Fetch 在 Branches 工具列，Pull／Push 在 Log 工具列。Push 一律先開 Push Commits 對話框（編輯器分頁），列出要推的 commit 與檔案；Force Push（`--force-with-lease`）在對話框的下拉選單；右鍵 Push All up to Here… 只推到指定 commit；Branches 樹顯示 ↑領先 ↓落後
- **變更檔案**：樹狀或平鋪清單，可依目錄／repo／模組分組，依檔案類型顯示圖示（新增綠、修改藍、刪除灰），雙擊或 Enter 開啟 VS Code 原生 diff；diff 標題列的 ← → 可切換上一個／下一個檔案；右鍵：顯示差異、開啟檔案（`F4`）、開啟儲存庫版本、在其他位置顯示（`Alt+F1`：檔案總管檢視、Windows 檔案總管／Finder、終端機）、複製檔名（`Ctrl+C`）、複製路徑
- **Commit 詳情**：完整 message、作者／提交者、refs、包含此 commit 的 branch
- **活動列兩個圖示**：「提交」打開 Commit 視窗；「Git 歷程」在側邊欄顯示 Branches 樹，同時打開底部的 Log（Log 會收起自己的 Branches 欄，commit 清單變寬；側邊欄切到別的畫面時，Log 的 Branches 欄自動回來）
- 開啟 Log：活動列「Git 歷程」圖示、狀態列「Git Log」按鈕、`Alt+9`
- 檔案總管／編輯器右鍵「顯示 Git 歷史」：自動切到該檔所屬的 repository 並以 Paths 篩選；檔案總管的 Wright 子選單另有「與分支或標籤比較」「儲藏變更」「取消儲藏」，以及在 `.patch` 檔上的「匯入 Patch 到擱置」
- **Git 主控台**：在「輸出」面板的 *Wright* 頻道記錄每個 git 指令、輸出與失敗原因（Log 面板標題列有按鈕）
- 編輯器右鍵「切換 Git Blame 標註」（沿用 VS Code 內建 blame）
- 英文／繁體中文介面，可用 `wright.language` 獨立切換
- branch、tag、HEAD 變動時自動重新整理

## 多 repo

- 自動掃描每個工作區資料夾底下的 repo（`wright.scanDepth`、`wright.scanExclude`），工作區資料夾本身不是 repo 也可以，包含 repo 內的巢狀 repo
- 多個 repo 的 commit 依時間合併顯示，每個 repo 有各自的 graph lane，每列左側色條標示所屬 repo（滑鼠移上去顯示名稱）
- **Paths** 篩選：在 Roots 勾選 repo（`Ctrl+點選` 或 `Ctrl+Enter` 只看一個），可依名稱或分支搜尋、「顯示全部儲存庫」，或「選擇資料夾…」跨 repo 勾選資料夾（等同 IntelliJ 多 root 的 Paths）
- 點左側色條切換 repo 名稱欄
- 多個 repo 都有的同名 branch 在 Branches 樹中合併為一筆，雙擊一次 checkout 全部
- Fetch／Pull／Push 會對 Paths 篩選下可見的所有 repo 執行，結果彙整成一則通知

## 快捷鍵（Log 面板內）

| 按鍵 | 動作 |
|---|---|
| `↑` `↓` `PageUp` `PageDown` `Home` `End` | 移動選取的 commit |
| `Shift+↑↓`、`Ctrl`／`Shift`+點選、`Ctrl+A` | 多選 commit |
| `Ctrl+C` | 複製選取 commit 的 hash |
| `Ctrl+C`（變更檔案樹） | 複製選取檔案的檔名（資料夾則複製 repo 內的相對路徑） |
| `F4`（變更檔案樹） | 開啟選取檔案的工作目錄版本；可在「鍵盤快速鍵」改「開啟變更檔案樹中選取的檔案」的按鍵 |
| `Alt+F1`（變更檔案樹） | 在其他位置顯示選取的檔案：檔案總管檢視、Windows 檔案總管／Finder、終端機 |
| `Ctrl+F` | 聚焦搜尋框 |
| `Esc`（搜尋框內） | 清除文字篩選 |
| `Ctrl+Alt+PageUp`／`Ctrl+Alt+PageDown`（diff 中） | 上一個／下一個變更檔案 |
| `Alt+9`（任何地方） | 開啟 Git Log |
| `Alt+0`（任何地方） | 開啟 Commit 視窗 |
| `Ctrl+Enter`（提交訊息中） | 提交 |

## 大型 repo

10 萬筆 commit 的 repo，Log 載入 5 萬筆約 1 秒。有 git 的 commit-graph 會更快：實測首屏從約 0.6 秒變成 0.1 秒，以單一檔案路徑篩選從約 1.2 秒變成 0.2 秒。

git 平常自動執行 `git gc` 時多半會寫入 commit-graph，但不含加快路徑篩選的那部分。從指令面板執行 **Wright: 最佳化儲存庫（加快歷史讀取）**，會寫入完整的 commit-graph（`git commit-graph write --reachable --changed-paths`）。它只在 `.git/objects/info` 底下新增一個檔案，不改動任何 commit 或檔案、不會被推到遠端，git 本身與其他 git 工具也會一起變快；刪掉這個檔案就回到原狀。

## 設定

大部分設定可以直接在 Git 記錄或提交視窗標題列的齒輪裡調整，立即生效。

| 設定 | 預設 | 說明 |
|---|---|---|
| `wright.maxCommits` | `50000` | Log 最多載入的 commit 數（所有 repo 合計，上限 200000） |
| `wright.autoRefresh` | `true` | refs／HEAD 變動時自動重新整理 |
| `wright.defaultFavoriteBranches` | `["main", "master"]` | 預設的我的最愛分支（本機與遠端）；在工作區手動加星或取消星號後改用你的設定；`[]` 為不預設 |
| `wright.scanDepth` | `3` | 工作區資料夾往下掃描 repo 的層數 |
| `wright.scanExclude` | `node_modules`、`target`… | 掃描時略過的資料夾名稱 |
| `wright.language` | `auto` | 面板、對話框與訊息的語言：`auto`（跟隨 VS Code）、`en`、`zh-tw` |
| `wright.issueLinks` | `[]` | 把提交訊息中的 issue 編號轉成連結，例如 `{ "pattern": "PROJ-(\\d+)", "url": "https://tracker.example.com/browse/PROJ-$1" }`；`$1`… 為擷取群組，`{repo}` 為 repo 的網頁網址。未設定時 `#123` 連到遠端的 issues 頁面 |

## 安裝

從 [Releases](https://github.com/xjin9612/wright-for-git/releases) 下載 `.vsix`，在 VS Code 執行「延伸模組: 從 VSIX 安裝…」，安裝或更新後請「重新載入視窗」。

需要 VS Code 1.90 以上，以及 `PATH` 中的 Git（或在內建 Git 擴充套件設定的路徑）。

## 參與開發

建置、測試、發佈流程與程式架構見 [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md)。

## 授權

MIT

本專案受 IntelliJ IDEA 的 Git 工具視窗啟發，與 JetBrains 無關聯。
