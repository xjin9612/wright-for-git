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

```
npm run test:ui
```

執行前會先跑 `pretest:ui`（`playwright install chromium`）：第一次下載 Chromium（約 150 MB），之後已安裝就直接略過。

每個測試檔會在系統暫存資料夾建立一份新的 playground，不會動到手動測試用的範例 repo。失敗時訊息會指出哪一個步驟、預期與實際的內容；等待逾時還會附上診斷：各 repo 的 `git status`、錯誤與警告通知、Git 主控台最後幾行、當下開著的選單與確認框。回報失敗時請連同這段一起貼上。

### UI 測試涵蓋的項目（不需手動再測）

| 檔案 | 內容 |
|---|---|
| `test/ui/log.test.js` | 開啟時的載入進度；前往 HEAD；鍵盤移動選取、`Ctrl+C`、`Ctrl+F`、`Esc`；webview 已處理的按鍵不轉給 VS Code；彈出框放不下時只捲清單、從按鈕展開的選單不蓋住按鈕；焦點離開 webview 時選單關閉；鍵盤開啟與操作右鍵選單；狀態字母；沒有結果時清除篩選；多 repo 合併顯示與標籤；文字、hash、regex 篩選；User（`me`）、Branch 串接選單、Date、Paths（Ctrl+點選；Select… 對話框的鍵盤展開與勾選）篩選；HEAD 不在篩選中的提示；repo 名稱欄；選取 commit 的檔案與詳情；變更檔案樹的 `Ctrl+C`（檔名、資料夾路徑、repo 名稱）、`F4` 開檔（失去焦點後不作用）、`Alt+F1` Select In（三個選項、已刪除的檔案只提示）、右鍵選單（顯示差異、開啟檔案、開啟儲存庫版本、Select In、複製檔名與路徑）；issue 連結；多選合併變更、`Ctrl+C` 與右鍵複製全部選取的 hash；右鍵選單；Log 分頁；欄寬拖曳與隱藏欄位 |
| `test/ui/branches.test.js` | 確認框的焦點、`Tab`、`Esc`；Branches 樹與資料夾、同名分支合併；搜尋；新增分支（名稱驗證）；刪除已合併／未合併（確認框）；重新命名；右鍵選單與停用項目；我的最愛、`wright.defaultFavoriteBranches` 設定；雙擊遠端分支（失敗與成功）；合併衝突、進行中列、中止確認 |
| `test/ui/sync.test.js` | Git 主控台記錄指令與失敗原因；Push 分頁（目標、commit、警告；預設看全部 commit 合併後的檔案、Ctrl 多選、點 repo 列、檔案分組並記住）；推送成功與被拒；Pull；Force Push 確認；新分支 New 與改名後設定 upstream；Push 到這裡為止；Fetch |
| `test/ui/commit.test.js` | 第一次載入的進度；空白鍵勾選、`Ctrl+Enter` 提交；提交視窗的清單與預設勾選；分組（模組、平鋪）；逐段提交且不動內建暫存區；跨 repo 提交；Amend（只改訊息）；捨棄變更；加入 .gitignore；Changelist；儲藏分頁（分組、未追蹤、diff、刪除後即時更新）；儲藏變更；擱置（跨 repo 一筆、保留工作目錄、只擱置選取的段落、不帶走使用者暫存的檔案）；擱置分頁（清單、檔案依 repo 分組、diff、改名、多選刪除）；取回對話框（預先勾選、取回部分檔案、從擱置移除或保留、changelist、已存在的檔案勾選才覆蓋、Esc）；取回有衝突時打開衝突清單並標示擱置名稱；多筆依序取回（取消、衝突時停下並提示）；匯出 patch（各 repo 一個檔）與匯入（依檔名與能否套用判斷 repo、套不上時請使用者選並顯示錯誤） |
| `test/ui/rebase.test.js` | 滑鼠拖曳調整順序；reword（保留 `#` 開頭的行）、squash、調整順序、drop、自動儲藏；edit 停下後「繼續」；分支變動時拒絕；detached HEAD 拒絕 |
| `test/ui/conflicts.test.js` | 合併後 Log 操作列的衝突數與「解決衝突…」；提交視窗衝突群組的種類說明、「解決…」連結、右鍵選單（標記已解決時的衝突標記確認、採用他們的刪除檔案）；衝突清單分頁（我的／他們的狀態、採用我的、全部解決後「繼續合併」）；三方合併分頁（不衝突的變更、整段 ≫ ✕、逐行、手動編輯後 ≫ 蓋掉、復原與重做、套用）；cherry-pick 衝突 |
| `test/ui/collapse.test.js` | 長線性分支折疊：全部收合（頭尾保留、中間收成「⋯ 3 commits」）；點收合列展開並選取；右鍵收合／展開、Enter 展開、右欄說明；點分支線收合；全部展開；文字篩選時停用 |
| `test/ui/sidebar.test.js` | Branch、Paths 選單的搜尋（類型標示、Enter 套用、Paths 不關閉選單、Esc 先清除）；顯示全部儲存庫；側邊欄 Branches：Log 收起自己的 Branches 欄、點分支篩選、Log 篩選反映到側邊欄、右鍵在新分頁顯示、選項同步、隱藏後 Log 的 Branches 欄回來、隱藏期間不同步且再顯示時補送 |
| `test/ui/misc.test.js` | 繁中介面與即時切換語言；面板內設定框（焦點離開 webview 才關閉、下拉選單展開時不關閉）；顯示 Git 歷史；與分支或標籤比較；取消儲藏分頁（以新分支取消儲藏）；沒有變更時的儲藏提示；切換 Git Blame；開啟設定；Fetch 指令 |

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

手動測試用的範例 repo 都放在專案旁邊的 `wright-for-git-test` 資料夾（與專案資料夾同一層），不會散在上一層：

```
<上一層>/
  wright-for-git/          ← 專案
  wright-for-git-test/
    playground/                  ← 手動測試清單用，用 VS Code 開這個
    playground-remotes/          ← playground 的遠端與模擬的另一台電腦，不要用 VS Code 開
    large-repo/                  ← 大型 repo（效能、長線性分支折疊）
    shelf/                       ← 擱置的手動測試（api、web 兩個 repo 與 patches 資料夾）
```

在專案資料夾執行：

```
node scripts/make-playground.mjs                       # 建立 playground
node scripts/make-playground.mjs --force               # 測完想重來：刪除後重建
node scripts/make-playground.mjs remote-push web-app   # 模擬別人推了一筆新 commit
node scripts/make-large-repo.mjs 3000                  # 3000 筆 commit 的 large-repo（看長線性分支折疊；約 1 秒）
node scripts/make-large-repo.mjs --force               # 10 萬筆（看大型 repo 的效能；約 15 秒）
node scripts/make-shelf-fixture.mjs init               # 擱置的手動測試 repo（之後每個情境一個指令，見第 6 節）
```

`large-repo` 的 main 每 100 筆會合併一條 5 筆的 feature 分支：👁 →「Collapse Linear Branches」後往下捲約 90 列，可以看到第一個「⋯ 3 commits」。10 萬筆時可以試「Wright: 最佳化儲存庫」前後，以單一檔案（例如 `src/mod07/file03.ts`）路徑篩選的速度差異。

用 VS Code 開啟 `playground` 資料夾（不是 `playground-remotes`）。內容：
- `api-server`：main 領先遠端 2 筆；`feature/rate-limit` 尚未推送；`experiment/cache` 未合併；tag `v1.0.0`、`v1.1.0`；有 rename、刪除、中文檔名（`docs/中文說明.md`）
- `api-server` 未提交的變更：`src/config.ts` 兩段修改、刪除 `config/db.yml`、未追蹤 `src/todo.ts`、已忽略 `node_modules/`、模組 `packages/sdk`（一般資料夾，提交視窗依模組分組時自成一組）內的修改
- `api-server/libs/shared`：巢狀 repo
- `web-app`：main 落後遠端 1 筆；2 個 stash；`src/pages/Login.tsx` 有未提交的修改；合併 `conflict/theme` 會產生兩個衝突：`src/theme.ts` 兩邊都改了第 2～3 行（另有兩處只有一邊改、不衝突），`src/legacy.ts` 我這邊修改、他們刪除
- `notes`：一般資料夾，不是 repo
- 作者 Alice／Bob／Carol／Dave；「我」是 Alice

## 怎麼看這份清單

每一項都寫成「**做**：操作步驟 → **應該看到**：結果」。照做，結果相符就打勾；不相符就截圖回報，並註明是哪一節、哪一項。

- 名稱以畫面上的文字為準。面板內的文字依 `wright.language` 設定，可能是英文或中文，下面兩種都會寫出來。
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
  - **做**：在檔案總管對 `api-server/src` 按右鍵 → Wright。
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
    - Fetch、Pull、Push 都成功，「輸出」的 Wright 頻道有對應的指令。
    - `#數字` 的連結打開該 repo 的 issue 頁。
- [ ] **大型 repo**
  - **做**：開一個有數萬筆 commit 的 repo，例如 clone 一個大型開源專案。開啟 Git 記錄，快速捲到底，再用文字篩選搜尋。
  - **應該看到**：
    - 開啟到出現第一批 commit 不超過幾秒，捲動不卡頓，篩選結果幾秒內出現。
    - 請記下大約花了幾秒。
- [ ] **受限模式（不受信任的工作區）**
  - **做**：
    1. 打包並安裝 VSIX（`npm run package`，再從延伸模組檢視的「⋯」→「從 VSIX 安裝…」）。
    2. 執行「工作區: 管理工作區信任」，按「不信任」（或開一個從未信任過的資料夾）。
    3. 在延伸模組檢視點 Wright；再點狀態列左下的「受限模式」。
  - **應該看到**：
    - 延伸模組頁顯示因工作區不受信任而停用；活動列沒有「提交」「Git 歷程」圖示，狀態列沒有「Git Log」按鈕。
    - 受限模式頁的延伸模組清單裡，Wright 附有說明「會在工作區的儲存庫執行 git…因此需要信任此工作區」（中文介面）或英文版說明。
    - 改回「信任」後 Wright 啟用（VS Code 若要求重新載入視窗就照做），Log 正常載入。

## 5. 變更檔案樹的 Select In（Alt+F1）

- [ ] **三個去處都真的打開**
  - **做**：在 Git 記錄點一筆 commit，右欄選一個還存在的檔案，按 `Alt+F1`，依序試三個選項。
  - **應該看到**：
    - 「在檔案總管檢視中顯示」：側邊欄切到檔案總管，展開並選取該檔案。
    - 「在 Windows 檔案總管中顯示」（macOS 為 Finder、Linux 為開啟所在資料夾）：系統的檔案管理員打開並選取該檔案。透過 WSL 開啟的專案也要試，SSH／容器遠端時這一項不出現。
    - 「在整合式終端機中開啟」：開一個終端機，目前目錄是該檔案所在的資料夾。
    - 在編輯器中按 `Alt+F1` 仍是 VS Code 原本的協助工具說明（不被搶走）。

## 6. 擱置（只在真實 VS Code 才看得到的部分）

擱置的操作、取回對話框、衝突、匯出匯入都有 UI 測試；這裡只測 UI 測試模擬不到的部分。先執行 `node scripts/make-shelf-fixture.mjs init`，用 VS Code 開 `wright-for-git-test/shelf`。以下 `F <情境>` 指 `node scripts/make-shelf-fixture.mjs <情境>`：每個情境會把兩個 repo 還原成同一個起點（含清掉擱置、儲藏）再做出修改，執行後在提交視窗按重新整理。`F status` 顯示兩個 repo 的工作區、暫存區、儲藏筆數與擱置。

「選取」指點列（Ctrl＋點加選），不是勾選框；擱置只看選取的檔案。

- [ ] **擱置與取回的實際檔案**
  - **做**：`F basic`。提交分頁選取四個檔案 → 右鍵「Shelve Changes…／擱置變更…」→ 名稱「測試」。再到「Shelf／擱置」分頁雙擊「測試」→ 取回。
  - **應該看到**：
    - 擱置後四個檔案從提交分頁消失，編輯器裡開著的檔案內容變回原本；`F status` 兩個 repo 工作區乾淨、stash 0 筆、各一筆擱置且 id 相同。
    - 擱置分頁雙擊檔案開的 diff：左邊是原本、右邊是擱置的內容。
    - 取回後提交分頁多一個 changelist「測試」，裡面是兩個已追蹤檔；兩個新檔在未追蹤的檔案。
- [ ] **只擱置選取的段落**
  - **做**：`F hunks`。對 `src/hunks.txt` 右鍵「Select Changes to Commit…／選取要提交的區段…」→ 取消第二段（SECOND CHANGE）→ 套用；選取該檔 → 擱置。
  - **應該看到**：輸入框提示只擱置選取的段落；編輯器裡的檔案第 2 行變回原本、第 29 行仍是 `SECOND CHANGE`；取回後兩段都在。
- [ ] **衝突在合併編輯器的標示**
  - **做**：`F conflict`。擱置 `src/clash.txt`（名稱「衝突」）→ `F conflict-commit` → 取回「衝突」→ 在打開的衝突清單雙擊該檔（Wright 的三方合併分頁）。
  - **應該看到**：衝突清單自動打開；三方合併分頁中，對方那一側的標題是「Shelf: 衝突／擱置：衝突」（VS Code 內建的合併編輯器用自己的標題，不受影響）。
- [ ] **匯出與檔案總管匯入**
  - **做**：`F basic`。擱置四個檔案（名稱「測試」）→ 右鍵「Export Patch…／匯出 Patch…」→ 選 `patches` 資料夾 → 刪除這筆 → 在檔案總管對 `patches/測試-api.patch` 右鍵 → Wright →「匯入 Patch 到擱置…」。
  - **應該看到**：`patches` 出現「測試-api.patch」「測試-web.patch」，可用 `git apply --check` 套用；匯入後自動切到擱置分頁並出現新的一筆，工作區不變。

