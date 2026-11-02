# 測試

測試分四層：

| 層 | 指令 | 範圍 |
|---|---|---|
| 單元與整合測試 | `npm test` | git 解析、graph、多 repo 合併、提交與 rebase 的 git 操作、三方合併演算法、翻譯是否齊全、打包設定 |
| UI 端對端測試 | `npm run test:ui` | 真實的 webview 與真實 git，在 Chromium 中點擊操作；VS Code API 為模擬。約 1.5 分鐘 |
| 真實 VS Code 測試 | `npm run test:vscode` | 下載真實的 VS Code 執行擴充功能：原生 diff、指令、檔案監看、與內建 Git 的整合。webview 內部看不到，由上一層負責 |
| 手動測試 | 本文件下方的清單 | 只有人眼才判斷得了的部分：主題顏色、按鈕位置、拖曳分頁、重新載入後保留、真實的遠端與大型 repo |

CI（GitHub Actions）在 Windows 與 Linux 上跑前三層；真實 VS Code 測試在 Linux 上另外以最低支援版本 1.90.0 跑一次。

## 執行 UI 測試

第一次需要下載 Chromium（約 150 MB，之後不必再下載）：

```
npx playwright install chromium
npm run test:ui
```

每個測試檔會在系統暫存資料夾建立一份新的 playground，不會動到手動測試用的範例 repo。失敗時訊息會指出哪一個步驟、預期與實際的內容；等待逾時還會附上診斷：各 repo 的 `git status`、錯誤與警告通知、Git 主控台最後幾行、當下開著的選單與確認框。回報失敗時請連同這段一起貼上。

### UI 測試涵蓋的項目（不需手動再測）

| 檔案 | 內容 |
|---|---|
| `test/ui/log.test.js` | 鍵盤移動選取、`Ctrl+C`、`Ctrl+F`、`Esc`；鍵盤開啟與操作右鍵選單；狀態字母；沒有結果時清除篩選；多 repo 合併顯示與標籤；文字、hash、regex 篩選；User（`me`）、Branch 串接選單、Date、Paths（Ctrl+點選；Select… 對話框的鍵盤展開與勾選）篩選；HEAD 不在篩選中的提示；repo 名稱欄；選取 commit 的檔案與詳情；issue 連結；多選合併變更；右鍵選單；Log 分頁；欄寬拖曳與隱藏欄位 |
| `test/ui/branches.test.js` | 確認框的焦點、`Tab`、`Esc`；Branches 樹與資料夾、同名分支合併；搜尋；新增分支（名稱驗證）；刪除已合併／未合併（確認框）；重新命名；右鍵選單與停用項目；我的最愛；雙擊遠端分支（失敗與成功）；合併衝突、進行中列、中止確認 |
| `test/ui/sync.test.js` | Git 主控台記錄指令與失敗原因；Push 分頁（目標、commit、警告；預設看全部 commit 合併後的檔案、Ctrl 多選、點 repo 列、檔案分組並記住）；推送成功與被拒；Pull；Force Push 確認；新分支 New 與改名後設定 upstream；Push 到這裡為止；Fetch |
| `test/ui/commit.test.js` | 空白鍵勾選、`Ctrl+Enter` 提交；提交視窗的清單與預設勾選；分組（模組、平鋪）；逐段提交且不動內建暫存區；跨 repo 提交；Amend（只改訊息）；捨棄變更；加入 .gitignore；Changelist；儲藏分頁（分組、未追蹤、diff、刪除後即時更新）；儲藏變更 |
| `test/ui/rebase.test.js` | 滑鼠拖曳調整順序；reword（保留 `#` 開頭的行）、squash、調整順序、drop、自動儲藏；edit 停下後「繼續」；分支變動時拒絕；detached HEAD 拒絕 |
| `test/ui/conflicts.test.js` | 合併後 Log 操作列的衝突數與「解決衝突…」；提交視窗衝突群組的種類說明、「解決…」連結、右鍵選單（標記已解決時的衝突標記確認、採用他們的刪除檔案）；衝突清單分頁（我的／他們的狀態、採用我的、全部解決後「繼續合併」）；三方合併分頁（不衝突的變更、整段 ≫ ✕、逐行、手動編輯後 ≫ 蓋掉、復原與重做、套用）；cherry-pick 衝突 |
| `test/ui/collapse.test.js` | 長線性分支折疊：全部收合（頭尾保留、中間收成「⋯ 3 commits」）；點收合列展開並選取；右鍵收合／展開、Enter 展開、右欄說明；點分支線收合；全部展開；文字篩選時停用 |
| `test/ui/sidebar.test.js` | Branch、Paths 選單的搜尋（類型標示、Enter 套用、Paths 不關閉選單、Esc 先清除）；顯示全部儲存庫；側邊欄 Branches：Log 收起自己的 Branches 欄、點分支篩選、Log 篩選反映到側邊欄、右鍵在新分頁顯示、選項同步、隱藏後 Log 的 Branches 欄回來、隱藏期間不同步且再顯示時補送 |
| `test/ui/misc.test.js` | 繁中介面與即時切換語言；面板內設定框；顯示 Git 歷史；與分支或標籤比較；取消儲藏分頁（以新分支取消儲藏）；沒有變更時的儲藏提示；切換 Git Blame；開啟設定；Fetch 指令 |

## 執行真實 VS Code 測試

```
npm run test:vscode
```

- 第一次會下載 VS Code（解壓後約 350 MB，存在專案的 `.vscode-test/`，之後沿用）。
- 測試期間會開出一個 VS Code 視窗，跑完自動關閉；請不要操作它。
- 使用全新的使用者設定與暫存的 playground，不會動到你自己的 VS Code 設定與手動測試用的範例 repo。
- `VSCODE_VERSION=1.90.0` 指定版本（預設 stable）；`GWB_GREP=diff` 只跑名稱含這段文字的測試（同一檔內的測試有先後依賴，只跑其中一項可能失敗，建議以整個檔案的主題篩選）。PowerShell 寫法：`$env:GWB_GREP="diff"; npm run test:vscode`。
- 等待逾時會附上診斷：各 repo 的 `git status`、使用中的分頁、記錄的篩選、最近的 git 指令。

webview 內部的狀態（篩選、提交視窗的清單）測試讀不到，擴充功能啟用時會回傳一組只給測試用的介面（`src/testApi.ts`），一般使用不會用到。

### 真實 VS Code 測試涵蓋的項目（不需手動再測）

| 檔案 | 內容 |
|---|---|
| `test/vscode/suite/activation.test.ts` | 指令都已註冊；`Alt+9`、`Alt+0` 的指令打開記錄與提交視窗；「Git 歷程」的側邊欄 Branches 收到分支資料並打開記錄；偵測 repo（含巢狀、排除一般資料夾） |
| `test/vscode/suite/diff.test.ts` | 從記錄開 diff：新增的左邊空、刪除的右邊空、中文檔名內容正確、標題的「1/2」；← → 切換檔案；提交視窗的 diff 右邊是可編輯的實際檔案 |
| `test/vscode/suite/commands.test.ts` | 顯示 Git 歷史（切 repo 並篩選路徑）；切換 Git Blame（1.96 以前只提示）；顯示 Git 主控台；最佳化儲存庫 |
| `test/vscode/suite/watch.test.ts` | 在 VS Code 外面建立分支、commit，記錄自動更新；存檔後提交視窗出現檔案、還原後消失；外部 stash 後提交視窗更新 |
| `test/vscode/suite/repos.test.ts` | 只顯示部分儲存庫時，記錄的 repo 篩選跟著改變 |
| `test/vscode/suite/merge.test.ts` | 合併衝突的種類；「在 VS Code 合併編輯器開啟」打開內建合併編輯器；採用一邊後繼續合併 |

## 大型 repo 效能量測

```
npm run bench:vscode
```

- 先在系統暫存資料夾用 `scripts/make-large-repo.mjs` 產生 10 萬筆 commit 的 repo（約 15 秒；固定亂數種子，每次內容相同，作者與訊息都是虛構的），再開真實 VS Code 量測。`GWB_BENCH_COMMITS=200000` 可改 commit 數。
- 量測 Log 各種篩選的載入時間：無篩選、文字、作者、單一檔案、資料夾、hash、單一分支。時間從 extension 收到 webview 的載入請求起算，「首屏」是第一批送出、「全部載入」是全部送完；每項 3 次取中位數。
- 先量沒有 commit-graph 的情況，再執行 `git commit-graph write --reachable --changed-paths` 後重量一次，比較差異。
- 結果印在終端機，並寫入 `out/bench/results.md` 與 `results.json`。
- 數字會隨電腦而不同，不放進 CI；改動 Log 載入相關的程式時，前後各跑一次比較。

產生大型 repo 也可以單獨用，見下方「範例 repo」。

---

# 手動測試清單

安裝或更新 `.vsix` 後先執行「開發人員: 重新載入視窗」。寫入類操作請用 playground，不要在正式的 repo 上測。

## 範例 repo

手動測試用的範例 repo 都放在專案旁邊的 `vscode-git-workbench-test` 資料夾（與專案資料夾同一層），不會散在上一層：

```
<上一層>/
  vscode-git-workbench/          ← 專案
  vscode-git-workbench-test/
    playground/                  ← 手動測試清單用，用 VS Code 開這個
    playground-remotes/          ← playground 的遠端與模擬的另一台電腦，不要用 VS Code 開
    large-repo/                  ← 大型 repo（效能、長線性分支折疊）
```

在專案資料夾執行：

```
node scripts/make-playground.mjs                       # 建立 playground
node scripts/make-playground.mjs --force               # 測完想重來：刪除後重建
node scripts/make-playground.mjs remote-push web-app   # 模擬別人推了一筆新 commit
node scripts/make-large-repo.mjs 3000                  # 3000 筆 commit 的 large-repo（看長線性分支折疊；約 1 秒）
node scripts/make-large-repo.mjs --force               # 10 萬筆（看大型 repo 的效能；約 15 秒）
```

`large-repo` 的 main 每 100 筆會合併一條 5 筆的 feature 分支：👁 →「Collapse Linear Branches」後往下捲約 90 列，可以看到第一個「⋯ 3 commits」。10 萬筆時可以試「Git Workbench: 最佳化儲存庫」前後，以單一檔案（例如 `src/mod07/file03.ts`）路徑篩選的速度差異。

用 VS Code 開啟 `playground` 資料夾（不是 `playground-remotes`）。內容：
- `api-server`：main 領先遠端 2 筆；`feature/rate-limit` 尚未推送；`experiment/cache` 未合併；tag `v1.0.0`、`v1.1.0`；有 rename、刪除、中文檔名（`docs/中文說明.md`）
- `api-server` 未提交的變更：`src/config.ts` 兩段修改、刪除 `config/db.yml`、未追蹤 `src/todo.ts`、已忽略 `node_modules/`、模組 `packages/sdk`（一般資料夾，提交視窗依模組分組時自成一組）內的修改
- `api-server/libs/shared`：巢狀 repo
- `web-app`：main 落後遠端 1 筆；2 個 stash；`src/pages/Login.tsx` 有未提交的修改；合併 `conflict/theme` 會產生兩個衝突：`src/theme.ts` 兩邊都改了第 2～3 行（另有兩處只有一邊改、不衝突），`src/legacy.ts` 我這邊修改、他們刪除
- `notes`：一般資料夾，不是 repo
- 作者 Alice／Bob／Carol／Dave；「我」是 Alice

## 怎麼看這份清單

每一項都寫成「**做**：操作步驟 → **應該看到**：結果」。照做，結果相符就打勾；不相符就截圖回報，並註明是哪一節、哪一項。

- 名稱以畫面上的文字為準。面板內的文字依 `gitWorkbench.language` 設定，可能是英文或中文，下面兩種都會寫出來。
- VS Code 自己的選單（右鍵、指令面板）跟著 VS Code 的顯示語言，下面以中文為準。
- 「Git 記錄面板」指底部面板的 Git 分頁，左邊是 Branches 樹、中間是 commit 清單、右邊是檔案與詳情。
- 「提交視窗」指左側活動列「提交」圖示打開的側邊欄。
- 「側邊欄 Branches」指左側活動列「Git 歷程」圖示打開的側邊欄。

## 1. 版面與主題

- [ ] **版面會被記住**
  - **做**：
    1. 拖曳 Git 記錄面板裡三欄之間的分隔線，改變寬度。
    2. 按 Branches 樹左上的「‹」收合左欄。
    3. 拖曳 Author、Date 欄位標題的左緣，改變欄寬。
    4. 在 Branches 樹把 `feature/rate-limit` 加上星號。
    5. 執行「開發人員: 重新載入視窗」。
  - **應該看到**：重新載入後，寬度、收合、欄寬、星號都和重新載入前一樣。
- [ ] **設定框與語言**
  - **做**：點 Git 記錄面板標題列（面板右上角那排圖示）的齒輪，把語言改成另一種；再點提交視窗標題列的齒輪。
  - **應該看到**：
    - 面板右上角彈出設定框。
    - 改語言後面板立刻換成新語言，設定框自動再打開。
    - 提交視窗標題列的齒輪在提交視窗內打開內容相同的設定框。
    - 面板內另外兩個齒輪不是設定框：Branches 工具列的齒輪是分組選項，提交視窗 Commit 按鈕列右邊的齒輪是提交選項（Amend、Sign-off…）。
- [ ] **主題**
  - **做**：按 `Ctrl+K` `Ctrl+T`，依序切換淺色、深色、高對比主題。每換一次，在 Branches 樹的 `experiment/cache` 上按右鍵 → Delete（刪除），出現確認框後按取消。
  - **應該看到**：
    - 每種主題下，文字、選取列、標籤都看得清楚。
    - 確認框裡，紅色的刪除按鈕在左、取消在右（Windows 的順序）。

## 2. 按鈕位置與選單

- [ ] **活動列的兩個圖示**
  - **做**：
    1. 點活動列的「提交」圖示。
    2. 點活動列的「Git 歷程」圖示。
    3. 點活動列的「檔案總管」。
  - **應該看到**：
    1. 側邊欄只有提交視窗；底部面板不會自動打開。
    2. 側邊欄顯示 Branches 樹（工具列在上方），底部同時打開 Git 記錄，焦點留在側邊欄；記錄左邊沒有 Branches 欄，也沒有「›」展開條；👁 選單的「Show Branches」是灰的。
    3. Git 記錄左邊的 Branches 欄回來了。
- [ ] **diff 標題列的按鈕**
  - **做**：在 Git 記錄面板點 `docs: API reference for orders`（api-server），在右欄雙擊 `中文說明.md`。
  - **應該看到**：標題列的 ← → 緊接在 VS Code 自己的 ↑↓ 後面。
- [ ] **檔案總管右鍵選單**
  - **做**：在檔案總管對 `api-server/src` 按右鍵 → Git Workbench。
  - **應該看到**：子選單有「顯示 Git 歷史」「與分支或標籤比較…」「儲藏變更…」「取消儲藏…」四項。
- [ ] **編輯器分頁可移動**
  - **做**：按 Git 記錄工具列的 Push（↑ 圖示），把開出來的「Push Commits」分頁拖到旁邊的編輯器群組；再對分頁按右鍵 →「移到新視窗」。
  - **應該看到**：分頁可以拖動，也能變成獨立視窗，內容正常。

## 3. 合併衝突的畫面

先製造衝突：在 Git 記錄面板左側的 Branches 樹，展開 Local → `conflict`，在 `theme` 上按右鍵 →「Merge 'conflict/theme' into Current」（中文介面為「將 'conflict/theme' 合併到目前的分支」）；若要求選 repo，選 web-app。右下角跳出通知後按「Resolve Conflicts…／解決衝突…」，在衝突分頁雙擊 `theme.ts`。

- [ ] **三方合併的畫面**
  - **做**：捲動畫面，並用 `Ctrl+K` `Ctrl+T` 切換淺色、深色、高對比主題。
  - **應該看到**：左中右三欄一起捲動；每種主題下，紅色（衝突）與藍色（不衝突的變更）都看得清楚。

測完要重來：`node scripts/make-playground.mjs --force`。

## 4. 真實環境

- [ ] **自己的 repo**
  - **做**：用 VS Code 開一個你自己的 GitHub 或 GitLab repo（SSH 遠端），各做一次 Fetch、Pull、Push。在記錄裡找一筆訊息含 `#數字` 的 commit，點那個連結。
  - **應該看到**：
    - Fetch、Pull、Push 都成功，「輸出」的 Git Workbench 頻道有對應的指令。
    - `#數字` 的連結打開該 repo 的 issue 頁。
- [ ] **大型 repo**
  - **做**：開一個有數萬筆 commit 的 repo，例如 clone 一個大型開源專案。開啟 Git 記錄，快速捲到底，再用文字篩選搜尋。
  - **應該看到**：
    - 開啟到出現第一批 commit 不超過幾秒，捲動不卡頓，篩選結果幾秒內出現。
    - 請記下大約花了幾秒。
