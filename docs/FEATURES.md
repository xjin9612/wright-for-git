# 功能規格：VS Code Git Workbench

目標：在 VS Code 底部 Panel 重現 IntelliJ Git 工具視窗的三欄連動體驗（Branches｜Log｜變更檔案＋詳情）。

優先級：**P0** = MVP 必備｜**P1** = 第二階段｜**P2** = 之後再做

---

## 1. 工具視窗框架

| # | 功能 | 優先級 |
|---|---|---|
| 1.1 | 底部 Panel 的 `WebviewView`，三欄版面 | P0 |
| 1.2 | 三欄分隔線可拖曳，寬度記憶（per workspace） | P0 |
| 1.3 | 左欄（Branches）、右欄（Details）可收合 | P0 |
| 1.4 | 主題跟隨 VS Code（`--vscode-*` CSS 變數），淺色／深色／高對比皆可用 | P0 |
| 1.5 | 多個 Log 分頁，各自保留篩選條件；`+` 新增、`×` 關閉 | P1 |
| 1.6 | 多 repo 工作區：切換 repo 或合併顯示 | P1 |
| 1.7 | 檔案系統／`.git` 變動時自動重新整理（debounce） | P0 |

## 2. 左欄：Branches

| # | 功能 | 優先級 |
|---|---|---|
| 2.1 | 樹狀結構：`HEAD (Current Branch)`／`Local`／`Remote/<remote>`／`Tags` | P0 |
| 2.2 | 依 `/` 自動分資料夾（`feat/`、`fix/`…），可收合 | P0 |
| 2.3 | 目前 branch 特殊圖示與高亮 | P0 |
| 2.4 | `Branch or tag` 即時搜尋過濾 | P0 |
| 2.5 | 點選 branch／tag → 中欄 Log 篩選到該 ref | P0 |
| 2.6 | 雙擊 branch → checkout | P0 |
| 2.7 | Favorite ★：標記、置頂、「只顯示 favorite」開關 | P1 |
| 2.8 | 顯示 ahead / behind 數量（相對 upstream） | P1 |
| 2.9 | 定位目前 branch（⊕）、全部展開／收合 | P1 |
| 2.10 | 工具列：新增 branch、刪除、fetch | P1 |
| 2.11 | Branch 右鍵選單：checkout、new branch from、rename、delete、merge into current、rebase current onto、compare with current、push、pull | P1 |
| 2.12 | Tag 右鍵選單：checkout、delete、push tag | P2 |

## 3. 中欄：Commit Log

### 3.1 篩選列

| # | 功能 | 優先級 |
|---|---|---|
| 3.1.1 | `Text or hash` 搜尋：比對 message 或 hash 前綴 | P0 |
| 3.1.2 | Regex（`.*`）、大小寫（`Cc`）開關 | P0 |
| 3.1.3 | **Branch 篩選**：下拉多選，可 `×` 清除 | P0 |
| 3.1.4 | **User 篩選**：下拉列出 repo 內所有作者、`me` 快捷選項、最近使用；可輸入多值，以 `\|` 或換行分隔，`Ctrl+Enter` 完成 | P0 |
| 3.1.5 | **Date 篩選**：最近 24h／7 天／30 天、自訂區間 | P1 |
| 3.1.6 | **Paths 篩選**：選擇檔案或資料夾，只顯示動到它的 commit | P1 |
| 3.1.7 | 排序切換：拓撲序／日期序 | P1 |
| 3.1.8 | 篩選條件組合（AND），篩選中的 chip 可個別移除 | P0 |
| 3.1.9 | 工具列：重新整理、cherry-pick、顯示選項（👁） | P0 / P1 |

### 3.2 表格與 Graph

| # | 功能 | 優先級 |
|---|---|---|
| 3.2.1 | Commit graph：lane 分配、合併／分叉連線、節點 | P0 |
| 3.2.2 | Lane 依所屬 head 著色，可一眼看出哪些 commit 未進 master | P0 |
| 3.2.3 | HEAD 節點特殊樣式（空心圓 ◎） | P0 |
| 3.2.4 | 欄位：Graph、Subject、Author、Date、**Hash**；欄位可顯示／隱藏、可調寬 | P0 |
| 3.2.5 | Ref 標籤貼在 subject 右側：branch、remote、**tag（如 `v3.8.2`）** | P0 |
| 3.2.6 | 本地與遠端同點時**合併為單一標籤**（`origin & release_xxx`） | P0 |
| 3.2.7 | 長 ref 名稱從中間截斷；空間不足時收合為圖示，hover 顯示全名 | P1 |
| 3.2.8 | Author 標 `*` 表示 author ≠ committer，tooltip 顯示兩者 | P1 |
| 3.2.9 | 自己的 commit 粗體或標示（可設定） | P2 |
| 3.2.10 | 選中列、hover 列高亮；不屬於目前 branch 的 commit 灰化（可設定） | P1 |
| 3.2.11 | 點選 lane 高亮整條分支路徑 | P2 |
| 3.2.12 | 長線性分支折疊／展開 | P2 |

### 3.3 互動

| # | 功能 | 優先級 |
|---|---|---|
| 3.3.1 | 鍵盤上下移動，選中即更新右欄 | P0 |
| 3.3.2 | 多選 commit（Ctrl／Shift），右欄顯示合併變更 | P1 |
| 3.3.3 | 跳到 hash／branch／tag（Go to） | P1 |
| 3.3.4 | Commit 右鍵選單：copy hash、checkout revision、new branch、new tag、cherry-pick、revert、reset current branch to here（soft／mixed／hard）、compare with local | P1 |
| 3.3.5 | Interactive rebase from here、edit message、squash、fixup | P2 |

## 4. 右欄：變更檔案＋詳情

### 4.1 變更檔案樹

| # | 功能 | 優先級 |
|---|---|---|
| 4.1.1 | 依目錄分組的樹狀清單 | P0 |
| 4.1.2 | 單一子目錄路徑壓縮（`src\main`） | P0 |
| 4.1.3 | 資料夾顯示檔案數（`2 files`） | P0 |
| 4.1.4 | 檔名依變更類型上色：新增／修改／刪除／重新命名 | P0 |
| 4.1.5 | 雙擊或 Enter 開啟原生 diff（`vscode.diff`），diff 內可切換上一個／下一個檔案 | P0 |
| 4.1.6 | 樹狀／平鋪切換、展開／收合全部 | P1 |
| 4.1.7 | 工具列：Show Diff、Revert selected changes、File History | P1 |
| 4.1.8 | 依模組／repo 分組（`web-app 2 files`） | P2 |
| 4.1.9 | `Ctrl+C` 複製選取檔案的檔名；資料夾複製 repo 內的相對路徑、repo 列複製 repo 名稱 | P1 |
| 4.1.10 | `F4` 開啟選取檔案的工作目錄版本（Jump to Source；可在鍵盤快速鍵改鍵） | P1 |
| 4.1.11 | 檔案右鍵選單（也可用選單鍵／Shift+F10）：Show Diff、Open File、Open Repository Version、Select In…、Copy File Name、Copy Path | P1 |
| 4.1.12 | `Alt+F1` Select In：在檔案總管檢視、系統檔案管理員或整合式終端機中顯示選取的檔案（可在鍵盤快速鍵改鍵） | P1 |

### 4.2 Commit 詳情

| # | 功能 | 優先級 |
|---|---|---|
| 4.2.1 | 完整 commit message（多行） | P0 |
| 4.2.2 | 短 hash（可點擊複製）、作者名稱與 email、時間 | P0 |
| 4.2.3 | 該 commit 上的所有 ref（HEAD、branch、remote、tag） | P0 |
| 4.2.4 | `In N branches: ... Show all`（包含該 commit 的 branch） | P1 |
| 4.2.5 | message 中的 issue 編號／URL 轉連結（可設定 pattern） | P2 |

## 5. 檔案層級整合

| # | 功能 | 優先級 |
|---|---|---|
| 5.1 | 編輯器／檔案總管右鍵 `Show History`：開啟以該路徑篩選的 Log 分頁 | P1 |
| 5.2 | Annotate（blame）於 gutter | P2 |

## 5A. 擱置（Shelf）

| # | 功能 | 優先級 |
|---|---|---|
| 5A.1 | 提交視窗選取檔案「擱置變更…」：修改、刪除、未追蹤檔案；可跨多個 repo 成為同一筆；可選擇保留工作目錄 | P1 |
| 5A.2 | 只擱置選取的路徑（沒選的已暫存檔案不受影響）；存成 `refs/git-workbench/shelf/<id>`，不在 stash 清單 | P1 |
| 5A.3 | 「擱置」分頁：清單（名稱、儲存庫、時間，可多選刪除）、檔案依 repo 分組（可多選）、diff | P1 |
| 5A.4 | 取回對話框：勾選 repo／檔案、放進 changelist（預設擱置名稱）、取回的檔案從擱置移除（其餘保留）、已存在的未追蹤檔案勾選才覆蓋 | P1 |
| 5A.5 | 取回有衝突：衝突標記留在檔案、自動打開衝突清單，「對方」標示擱置名稱 | P1 |
| 5A.6 | 改名、刪除；匯出 `.patch`（每個 repo 一個檔）、匯入 `.patch`（依檔名與能否套用判斷 repo，不動工作區） | P2 |

## 6. 非功能需求

| # | 項目 | 目標 |
|---|---|---|
| 6.1 | 虛擬捲動 | 10 萬 commit 捲動維持流暢 |
| 6.2 | 分批載入 | 首屏 < 500ms（以 1 萬 commit repo 為基準），背景補載 |
| 6.3 | Graph 計算 | 增量計算，不阻塞 UI（必要時放 Web Worker） |
| 6.4 | Git 存取 | 直接呼叫 `git` CLI 並解析，不依賴 libgit2 |
| 6.5 | 依賴 | Webview 不使用前端框架，原生 TS + Canvas |
| 6.6 | 設定項 | 欄位顯示、日期格式、graph 著色、自動重新整理開關 |

---

## MVP（P0）範圍摘要

三欄框架＋主題 → Branches 樹（分資料夾、搜尋、點選篩選、checkout）→ Log 表格（graph、ref 標籤、hash 欄、Text／Branch／User 篩選）→ 變更檔案樹＋原生 diff → Commit 詳情 → 虛擬捲動與分批載入。
