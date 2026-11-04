<p align="center">
  <img src="media/icon.png" width="96" height="96" alt="Wright for Git">
</p>

<h1 align="center">Wright for Git</h1>

<p align="center"><strong>在 VS Code 使用 IntelliJ 風格的 Git 工具視窗，為含有多個 repo 的工作區設計。</strong></p>

<p align="center">
  <a href="https://github.com/xjin9612/wright-for-git/releases/latest"><img src="https://img.shields.io/github/v/release/xjin9612/wright-for-git" alt="最新版本"></a>
  <a href="https://github.com/xjin9612/wright-for-git/actions/workflows/ci.yml"><img src="https://github.com/xjin9612/wright-for-git/actions/workflows/ci.yml/badge.svg" alt="測試"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 授權"></a>
  <a href="#隱私與安全"><img src="https://img.shields.io/badge/data%20collected-none-brightgreen" alt="不收集任何資料"></a>
</p>

<p align="center"><a href="README.md">English</a> | 繁體中文</p>

把工作區裡所有 repo 的 commit 放進同一個 Git 記錄，畫出完整的提交圖，可以依分支、作者、路徑或日期篩選。提交時只送出你勾選的檔案或段落，不動暫存區，並用 Changelist 整理手上的工作。可以跨多個 repo 一次擱置變更、以互動式 rebase 整理 commit，在三方合併畫面解決衝突。用過 IntelliJ 的 Git 工具視窗，就知道怎麼用。

![Git 記錄：分支樹、合併兩個 repo 的提交圖，以及選取 commit 的變更檔案與詳情](docs/screenshots/zh-TW/1-log.png)

## 安裝

- **VS Code Marketplace**：在「延伸模組」搜尋 *Wright for Git*，或在快速開啟（`Ctrl+P`）執行 `ext install xjin9612.wright-for-git`
- **Open VSX**（VSCodium、Cursor 等）：[xjin9612/wright-for-git](https://open-vsx.org/extension/xjin9612/wright-for-git)
- **VSIX**：從 [Releases](https://github.com/xjin9612/wright-for-git/releases) 下載，再執行「延伸模組: 從 VSIX 安裝…」

安裝後按 `Alt+9` 打開 Git 記錄、`Alt+0` 打開提交視窗，或點活動列的「Git 歷程」與「提交」圖示。需要 VS Code 1.90 以上與 Git。新版本的變更見 [CHANGELOG](CHANGELOG.md)（英文）。

> 從 Git Workbench 升級？1.4.0 起改名為 Wright for Git，會以新的擴充功能安裝。請解除安裝 Git Workbench，並把 `gitWorkbench.*` 的設定改到 `wright.*`。

## 特色

### 所有 repo 在同一個記錄

工作區裡每個 repo 的 commit 依時間合併成一個記錄，各自有自己的提交圖線條與色條。不同 repo 中同名的分支合成一項，雙擊就能在所有 repo 簽出 `feature/login`。Paths 篩選可以只看部分 repo 或資料夾，Fetch、Pull、Push 只對目前看得到的 repo 執行。

### 不動暫存區的提交視窗

勾選要提交的檔案，或只挑檔案中的某幾段。用 Changelist 分組變更，一個訊息提交到多個 repo，也可以 Amend、Sign-off 或「提交並推送」。提交經由暫存的 index 完成，你在 VS Code「原始檔控制」暫存的內容維持原樣。

![提交視窗：兩個 Changelist、一個只選了部分段落的檔案，以及提交訊息框](docs/screenshots/zh-TW/2-commit.png)

### 跨 repo 擱置變更

不提交，先把變更放到一邊，多個 repo 的變更算同一筆。之後可以全部或只取回部分檔案，放進指定的 Changelist。擱置存在 repo 裡，不會出現在 stash 清單，也可以匯出成 `git apply` 與 IntelliJ 都能讀的 `.patch` 檔。

![取回擱置：勾選兩個 repo 的檔案並選擇要放進的 Changelist](docs/screenshots/zh-TW/3-shelf.gif)

### 拖曳整理的互動式 rebase

拖曳或按 `Alt+↑↓` 調整 commit 順序，每筆可選 pick、reword、edit、squash、fixup 或 drop。rebase、merge 或 cherry-pick 進行中時，記錄上方會出現「繼續」「略過」「中止」。

![在互動式 rebase 分頁把一筆 commit 拖到新位置，再改成 squash](docs/screenshots/zh-TW/4-rebase.gif)

### 三方合併解決衝突

「衝突」分頁列出所有衝突的檔案，可以「採用我的」「採用他們的」或「合併…」。合併分頁並排顯示我的、可編輯的結果與他們的；用 ≫ 和 ✕ 逐段或逐行取用，套用後就能繼續。

![三方合併分頁：一個衝突已解決、一個還沒處理](docs/screenshots/zh-TW/5-merge.png)

## 完整功能

**Git 記錄**
- 有顏色線條的提交圖；指向同一個 commit 的本機與遠端分支合成一個標籤
- 篩選：文字或 hash（支援 regex 與大小寫）、Branch、User（`me` 代表你）、Paths（repo 與資料夾）、Date
- 多個記錄分頁，各自保留篩選
- 多選 commit 查看合併後的變更，一次 cherry-pick 或 revert
- 右鍵：簽出、新增分支或標籤、cherry-pick、revert、reset、Push 到這裡為止、與工作區比較、從這裡開始互動式 rebase
- 長串的分支 commit 可收合成一列「⋯ N commits」
- 提交訊息中的 issue 編號轉成連結
- 大型 repo 也快：10 萬筆 commit 的 repo，約一秒載入 5 萬筆

**分支**
- 本機、遠端、標籤，依 `/` 分資料夾或依 repo 分組，顯示 ↑領先 ↓落後
- 點分支篩選記錄，雙擊簽出
- 加星號置頂，或只顯示我的最愛
- 新增分支、與目前分支比較、合併、rebase、更新、推送、重新命名、刪除

**提交視窗**
- 提交勾選的檔案或段落；Changelist；未追蹤與已忽略的檔案
- 依目錄、repo 或模組分組
- Amend、Sign-off、略過 hook、提交並推送…
- 捨棄變更、加入 `.gitignore`
- 儲藏分頁：所有 repo 的 stash 與其中的檔案、差異

**擱置**
- 跨 repo 擱置選取的檔案或段落，也可以保留工作目錄的版本
- 全部取回、只取回部分檔案，或依序取回多筆；有衝突時打開衝突清單
- 重新命名、刪除、匯出與匯入 `.patch` 檔

**變更檔案**
- 樹狀或平鋪，依目錄、repo 或模組分組
- 雙擊開啟 VS Code 的 diff；diff 標題列的 ← → 切換檔案
- 開啟檔案（`F4`）、開啟儲存庫版本、複製檔名（`Ctrl+C`）、複製路徑
- 在其他位置顯示（`Alt+F1`）：在檔案總管檢視或 Windows 檔案總管／Finder 中顯示，或在檔案所在資料夾開終端機

**同步**
- Fetch、Pull，以及列出各 repo 要推送內容的 Push 對話框
- Force Push（with lease）；只推送到指定的 commit

**VS Code 其他地方**
- 檔案總管右鍵：顯示 Git 歷史、與分支或標籤比較…、儲藏變更…、取消儲藏…、匯入 Patch 到擱置…
- 編輯器右鍵切換 Git Blame 標註
- Git 主控台：每個 git 指令與輸出記錄在「輸出」面板的 *Wright* 頻道
- 英文與繁體中文介面

## 快捷鍵

Git 記錄中：

| 按鍵 | 動作 |
|---|---|
| `↑` `↓` `PageUp` `PageDown` `Home` `End` | 移動選取 |
| `Shift+↑↓`、`Ctrl`／`Shift`+點選、`Ctrl+A` | 多選 commit |
| `Ctrl+C` | 複製選取 commit 的 hash |
| `Ctrl+F` | 聚焦搜尋框 |
| `Esc`（搜尋框內） | 清除文字篩選 |
| `Shift+F10` 或選單鍵 | 開啟右鍵選單 |

變更檔案樹中：

| 按鍵 | 動作 |
|---|---|
| `Enter` | 顯示差異 |
| `F4` | 開啟工作目錄的檔案 |
| `Alt+F1` | 在其他位置顯示：檔案總管檢視、Windows 檔案總管／Finder、終端機 |
| `Ctrl+C` | 複製檔名（資料夾則複製 repo 內的路徑） |

VS Code 任何地方，可在「鍵盤快速鍵」修改（搜尋 *Wright*）：

| 按鍵 | 動作 |
|---|---|
| `Alt+9` | 顯示 Git 記錄 |
| `Alt+0` | 顯示提交視窗 |
| `Ctrl+Alt+PageUp`／`Ctrl+Alt+PageDown`（diff 中） | 上一個／下一個變更檔案 |
| `F4`（變更檔案樹中） | 開啟選取的檔案 |
| `Alt+F1`（變更檔案樹中） | 在其他位置顯示 |

提交視窗的訊息框中，`Ctrl+Enter` 提交。

## 設定

多數設定可以從 Git 記錄或提交視窗標題列的齒輪修改，立即生效。

| 設定 | 預設值 | 說明 |
|---|---|---|
| `wright.maxCommits` | `50000` | 記錄最多載入的 commit 數（所有 repo 合計，上限 200000） |
| `wright.autoRefresh` | `true` | refs／HEAD 變動時自動重新整理 |
| `wright.defaultFavoriteBranches` | `["main", "master"]` | 預設的我的最愛分支（本機與遠端）；在工作區手動加星或取消星號後改用你的設定；`[]` 為不預設 |
| `wright.scanDepth` | `3` | 在每個工作區資料夾下往下掃描幾層找 repo |
| `wright.scanExclude` | `node_modules`、`target`… | 掃描時略過的資料夾名稱 |
| `wright.language` | `auto` | 面板、對話框與訊息的語言：`auto`（跟隨 VS Code）、`en`、`zh-tw` |
| `wright.issueLinks` | `[]` | 把提交訊息中的 issue 編號轉成連結，例如 `{ "pattern": "PROJ-(\\d+)", "url": "https://tracker.example.com/browse/PROJ-$1" }`。`$1`… 為群組，`{repo}` 為 repo 的網頁網址。未設定時，`#123` 連到遠端的 issue 頁面 |

## 隱私與安全

Wright for Git 不收集任何資料，也沒有遙測。它在你的電腦上執行 `git` 指令，只有在你 Fetch、Pull 或 Push 時，才由 git 本身連網。issue 連結只在你點擊時用瀏覽器打開。

需要信任工作區才會啟用：repo 的 Git 設定與 hook 可以執行任意指令，所以在受限模式下不會執行。提交視窗從不改動你的暫存區；硬重設（hard reset）、Force Push、捨棄變更、刪除分支這類可能遺失內容的操作都會先確認。

## 常見問題

**它會取代 VS Code 的「原始檔控制」嗎？**<br>
不會，兩者可以同時用在同一個 repo。提交視窗經由自己的暫存 index 提交，不會改動你在「原始檔控制」暫存的內容。

**我在「原始檔控制」暫存了檔案，為什麼沒有一起提交？**<br>
提交視窗提交的是在它裡面勾選的檔案與段落，不看暫存區。請在提交視窗勾選該檔案。

**擱置存在哪裡？會被推送嗎？**<br>
每個 repo 把自己那部分存在 `refs/wright/shelf/` 底下。一般的 `git push` 不會推送，`git stash list` 也看不到。要帶到另一台電腦，請用「匯出 Patch…」。

**怎麼修改 `F4`、`Alt+F1`、`Alt+9`、`Alt+0`？**<br>
點 Git 記錄標題列的齒輪 →「鍵盤快速鍵」，或在「鍵盤快速鍵」搜尋 *Wright*。

**很大的 repo 記錄很慢。**<br>
在命令選擇區執行「Wright: 最佳化儲存庫（加快歷史讀取）」。它會寫入 Git 的 commit-graph 檔（`git commit-graph write --reachable --changed-paths`）：在 10 萬筆 commit 的 repo，第一頁從約 0.6 秒縮短到約 0.1 秒，依檔案路徑篩選從約 1.2 秒縮短到約 0.2 秒。它只在 `.git/objects/info` 新增一個檔案，不改任何 commit 或檔案，也不會被推送；刪掉該檔案就還原。

**有些 repo 沒有出現。**<br>
只會在每個工作區資料夾往下 `wright.scanDepth` 層（預設 3 層）內找 repo，並略過 `wright.scanExclude` 列的資料夾。請調高層數，或把該資料夾加入工作區。

## 參與開發

歡迎到 [issues](https://github.com/xjin9612/wright-for-git/issues) 回報問題或提出想法。建置、測試、發佈流程與程式架構見 [CONTRIBUTING.zh-TW.md](CONTRIBUTING.zh-TW.md)。

## 授權

[MIT](LICENSE)

本專案受 IntelliJ IDEA 的 Git 工具視窗啟發，與 JetBrains 無關聯，也未獲其背書。
