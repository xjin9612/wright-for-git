# 測試

測試分三層：

| 層 | 指令 | 範圍 |
|---|---|---|
| 單元與整合測試 | `npm test` | git 解析、graph、多 repo 合併、提交與 rebase 的 git 操作、翻譯是否齊全、打包設定 |
| UI 端對端測試 | `npm run test:ui` | 真實的 webview 與真實 git，在 Chromium 中點擊操作；VS Code API 為模擬。約 1.5 分鐘 |
| 手動測試 | 本文件下方的清單 | 只有真實 VS Code 才看得到的部分：原生 diff、選單位置、快捷鍵、主題、重新載入後保留、檔案監看等 |

CI（GitHub Actions）在 Windows 與 Linux 上跑前兩層。

## 執行 UI 測試

第一次需要下載 Chromium（約 150 MB，之後不必再下載）：

```
npx playwright install chromium
npm run test:ui
```

每個測試檔會在系統暫存資料夾建立一份新的 playground，不會動到專案旁邊的 `playground`。失敗時訊息會指出哪一個步驟、預期與實際的內容；等待逾時還會附上診斷：各 repo 的 `git status`、錯誤與警告通知、Git 主控台最後幾行、當下開著的選單與確認框。回報失敗時請連同這段一起貼上。

### UI 測試涵蓋的項目（不需手動再測）

| 檔案 | 內容 |
|---|---|
| `test/ui/log.test.js` | 鍵盤移動選取、`Ctrl+C`、`Ctrl+F`、`Esc`；鍵盤開啟與操作右鍵選單；狀態字母；沒有結果時清除篩選；多 repo 合併顯示與標籤；文字、hash、regex 篩選；User（`me`）、Branch 串接選單、Date、Paths（Ctrl+點選）篩選；HEAD 不在篩選中的提示；repo 名稱欄；選取 commit 的檔案與詳情；issue 連結；多選合併變更；右鍵選單；Log 分頁；欄寬拖曳與隱藏欄位 |
| `test/ui/branches.test.js` | 確認框的焦點、`Tab`、`Esc`；Branches 樹與資料夾、同名分支合併；搜尋；新增分支（名稱驗證）；刪除已合併／未合併（確認框）；重新命名；右鍵選單與停用項目；我的最愛；雙擊遠端分支（失敗與成功）；合併衝突、進行中列、中止確認 |
| `test/ui/sync.test.js` | Git 主控台記錄指令與失敗原因；Push 分頁（目標、commit、檔案、警告）；推送成功與被拒；Pull；Force Push 確認；新分支 New 與改名後設定 upstream；Push 到這裡為止；Fetch |
| `test/ui/commit.test.js` | 空白鍵勾選、`Ctrl+Enter` 提交；提交視窗的清單與預設勾選；分組（模組、平鋪）；逐段提交且不動內建暫存區；跨 repo 提交；Amend（只改訊息）；捨棄變更；加入 .gitignore；Changelist；儲藏分頁（分組、未追蹤、diff、刪除後即時更新）；儲藏變更 |
| `test/ui/rebase.test.js` | 滑鼠拖曳調整順序；reword（保留 `#` 開頭的行）、squash、調整順序、drop、自動儲藏；edit 停下後「繼續」；分支變動時拒絕；detached HEAD 拒絕 |
| `test/ui/conflicts.test.js` | 合併後 Log 操作列的衝突數與「解決衝突…」；提交視窗衝突群組的種類說明、「解決…」連結、右鍵選單（標記已解決時的衝突標記確認、採用他們的刪除檔案）；衝突清單分頁（我的／他們的狀態、採用我的、全部解決後「繼續合併」）；三方合併分頁（不衝突的變更、整段 ≫ ✕、逐行、手動編輯後 ≫ 蓋掉、復原與重做、套用）；cherry-pick 衝突 |
| `test/ui/misc.test.js` | 繁中介面與即時切換語言；面板內設定框；顯示 Git 歷史；與分支或標籤比較；取消儲藏分頁（以新分支取消儲藏）；沒有變更時的儲藏提示；切換 Git Blame；開啟設定；Fetch 指令 |

---

# 手動測試清單

安裝或更新 `.vsix` 後先執行「開發人員: 重新載入視窗」。寫入類操作請用 playground，不要在正式的 repo 上測。

## 測試用 playground

在專案資料夾執行（會在專案的上一層建立 `playground` 與 `playground-remotes`）：

```
node scripts/make-playground.mjs            # 第一次建立
node scripts/make-playground.mjs --force    # 測完想重來：刪除後重建
node scripts/make-playground.mjs remote-push web-app   # 模擬別人推了一筆新 commit
```

用 VS Code 開啟 `playground` 資料夾（不是 `playground-remotes`）。內容：
- `api-server`：main 領先遠端 2 筆；`feature/rate-limit` 尚未推送；`experiment/cache` 未合併；tag `v1.0.0`、`v1.1.0`；有 rename、刪除、中文檔名（`docs/中文說明.md`）
- `api-server` 未提交的變更：`src/config.ts` 兩段修改、刪除 `config/db.yml`、未追蹤 `src/todo.ts`、已忽略 `node_modules/`、子模組 `packages/sdk` 內的修改
- `api-server/libs/shared`：巢狀 repo
- `web-app`：main 落後遠端 1 筆；2 個 stash；`src/pages/Login.tsx` 有未提交的修改；合併 `conflict/theme` 會產生兩個衝突：`src/theme.ts` 兩邊都改了第 2～3 行（另有兩處只有一邊改、不衝突），`src/legacy.ts` 我這邊修改、他們刪除
- `notes`：一般資料夾，不是 repo
- 作者 Alice／Bob／Carol／Dave；「我」是 Alice

## 怎麼看這份清單

每一項都寫成「**做**：操作步驟 → **應該看到**：結果」。照做，結果相符就打勾；不相符就截圖回報，並註明是哪一節、哪一項。

- 名稱以畫面上的文字為準。面板內的文字依 `gitWorkbench.language` 設定，可能是英文或中文，下面兩種都會寫出來。
- VS Code 自己的選單（右鍵、指令面板）跟著 VS Code 的顯示語言，下面以中文為準。
- 「Git 記錄面板」指底部面板的 Git 分頁，左邊是 Branches 樹、中間是 commit 清單、右邊是檔案與詳情。
- 「提交視窗」指左側 Git Workbench 側邊欄裡的「提交」。

## 1. 開啟、版面與主題

- [ ] **入口**
  - **做**：點左側活動列的 Git Workbench 圖示；再分別點狀態列左下的「Git Log」、按 `Alt+9`、按 `Alt+0`。
  - **應該看到**：
    - 活動列圖示：左側出現「提交」與「儲存庫」，底部面板切到 Git 記錄。
    - 「Git Log」與 `Alt+9`：打開 Git 記錄面板。
    - `Alt+0`：游標移到提交視窗。
- [ ] **版面會被記住**
  - **做**：
    1. 拖曳 Git 記錄面板裡三欄之間的分隔線，改變寬度。
    2. 按 Branches 樹左上的「‹」收合左欄。
    3. 拖曳 Author、Date 欄位標題的左緣，改變欄寬。
    4. 在 Branches 樹把 `feature/rate-limit` 加上星號。
    5. 執行「開發人員: 重新載入視窗」。
  - **應該看到**：重新載入後，寬度、收合、欄寬、星號都和重新載入前一樣。
- [ ] **設定框與語言**
  - **做**：
    1. 點 Git 記錄面板標題列（面板右上角那排圖示）的齒輪。
    2. 把語言改成另一種。
    3. 再點提交視窗標題列的齒輪。
  - **應該看到**：
    - 面板右上角彈出設定框。
    - 改語言後面板立刻換成新語言，設定框自動再打開。
    - 提交視窗的齒輪也會打開同一個設定框。
    - 面板內部沒有其他齒輪按鈕。
- [ ] **主題**
  - **做**：按 `Ctrl+K` `Ctrl+T`，依序切換到淺色、深色、高對比主題。每換一次，在 Branches 樹的 `experiment/cache` 上按右鍵 → Delete（刪除），出現確認框後按取消。
  - **應該看到**：
    - 每種主題下，文字、選取列、標籤都看得清楚。
    - 確認框裡，紅色的刪除按鈕在左、取消在右（Windows 的順序）。

## 2. VS Code 原生功能的整合

- [ ] **從記錄開 diff**
  - **做**：
    1. 在 Git 記錄面板點 `docs: API reference for orders`（api-server 的 commit）。
    2. 在右欄雙擊 `中文說明.md`。
    3. 再點 `chore: drop legacy script`，雙擊 `legacy.sh`。
  - **應該看到**：
    - `中文說明.md`：開啟 diff，左邊空白（新增的檔案），檔名中文正常，分頁標題結尾是「· 1/2」或「· 2/2」。
    - `legacy.sh`：右邊空白（刪除的檔案）。
- [ ] **diff 切換檔案**
  - **做**：開著 `docs: API reference for orders` 的 diff，按標題列的 ← →，再按 `Ctrl+Alt+PageUp`、`Ctrl+Alt+PageDown`。
  - **應該看到**：
    - ← → 緊接在 VS Code 自己的 ↑↓ 後面。↑↓ 是在同一個檔案裡跳變更段落，← → 是換到同一個 commit 的另一個檔案。
    - 換檔案後分頁標題的「1/2」跟著變。
    - 快捷鍵的效果和按 ← → 相同。
- [ ] **提交視窗的 diff 可編輯**
  - **做**：在提交視窗雙擊 `src/config.ts`（api-server）。
  - **應該看到**：開啟「config.ts (HEAD ↔ Working Tree)」diff，可以直接在右邊打字。
- [ ] **右鍵選單**
  - **做**：
    1. 在檔案總管對 `api-server/src` 按右鍵 → Git Workbench。
    2. 開啟任一檔案，在編輯器裡按右鍵 →「切換 Git Blame 標註」，再按一次。
  - **應該看到**：
    - Git Workbench 子選單有「顯示 Git 歷史」「與分支或標籤比較…」「儲藏變更…」「取消儲藏…」四項。
    - 第一次切換後，每一行行尾出現作者與時間；再按一次就消失。
- [ ] **編輯器分頁可移動**
  - **做**：按 Git 記錄工具列的 Push（↑ 圖示），把開出來的「Push Commits」分頁拖到旁邊的編輯器群組；再對分頁按右鍵 →「移到新視窗」。
  - **應該看到**：分頁可以拖動，也能變成獨立視窗，內容正常。
- [ ] **Git 主控台**
  - **做**：按 Branches 工具列的 Fetch（雲朵圖示），再點 Git 記錄面板標題列的「顯示 Git 主控台」圖示。
  - **應該看到**：底部切到「輸出」，右上的下拉選單是「Git Workbench」，看得到剛才的 `git fetch` 指令和耗時。

## 3. 自動重新整理（檔案監看）

- [ ] **終端機操作**
  - **做**：開終端機，`cd api-server`，依序執行：
    1. `git checkout -b tmp`
    2. `git commit --allow-empty -m test`
    3. `git stash`
    4. `git checkout main`
  - **應該看到**：每一步做完 1～2 秒內，Git 記錄面板跟著更新，例如 Branches 出現 `tmp`、清單最上面出現 `test`；提交視窗的 Stash 分頁出現新的儲藏。
- [ ] **VS Code 內的修改**
  - **做**：在編輯器修改 `api-server/src/index.ts` 並存檔。
  - **應該看到**：約 1 秒內，提交視窗出現這個檔案。

## 4. 側邊欄「儲存庫」

- [ ] **列出的 repo**
  - **做**：看左側 Git Workbench 側邊欄的「儲存庫」。
  - **應該看到**：列出 api-server、api-server/libs/shared、web-app，沒有 notes。
- [ ] **與 Paths 篩選同步**
  - **做**：
    1. 取消勾選 web-app。
    2. 點 Git 記錄面板上方的 Paths 篩選。
    3. 在 Paths 選單裡把 web-app 勾回來。
  - **應該看到**：
    - 取消勾選後，記錄裡不再出現 web-app 的 commit，Paths 選單裡的 web-app 也是未勾選。
    - 在 Paths 選單勾回來後，側邊欄的 web-app 也被勾回來。

## 5. 合併衝突（實際畫面）

先製造衝突：

1. 在 Git 記錄面板左側的 Branches 樹，展開 Local → `conflict`。
2. 在 `theme` 上按右鍵 →「Merge 'conflict/theme' into Current」（中文介面為「將 'conflict/theme' 合併到目前的分支」）。若要求選 repo，選 web-app。
3. 右下角跳出「web-app：merge 因衝突而暫停」的通知。

接著檢查：

- [ ] **衝突清單**
  - **做**：在通知上按「Resolve Conflicts…／解決衝突…」。
  - **應該看到**：開啟衝突分頁，列出 `legacy.ts`（我的：修改、他們的：刪除）與 `theme.ts`（兩邊都是修改）。
- [ ] **三方合併畫面**
  - **做**：雙擊 `theme.ts`，捲動畫面，並用 `Ctrl+K` `Ctrl+T` 切換淺色、深色、高對比主題。
  - **應該看到**：
    - 開啟三方合併分頁，左中右三欄一起捲動。
    - 每種主題下，紅色（衝突）與藍色（不衝突的變更）都看得清楚。
- [ ] **編輯與復原**
  - **做**：在中間的結果欄打幾個字，按 `Ctrl+Z`，再按 `F7`。
  - **應該看到**：`Ctrl+Z` 把剛打的字復原；`F7` 跳到下一個變更。
- [ ] **VS Code 合併編輯器**
  - **做**：按「Open in VS Code Merge Editor／在 VS Code 合併編輯器開啟」。
  - **應該看到**：開啟 VS Code 內建的合併編輯器。確認後關掉它，回到衝突分頁。
- [ ] **完成合併**
  - **做**：
    1. 在衝突分頁選 `legacy.ts`，按「Accept Yours／採用我的」。
    2. 雙擊 `theme.ts`，在三方合併按左邊的 ≫，再按「Apply／套用」。
    3. 衝突分頁出現「Continue Merge／繼續合併」後，按下去。
  - **應該看到**：Git 記錄最上面多一筆 `Merge branch 'conflict/theme'`，上方的「合併進行中」提示消失。

測完要重來：`node scripts/make-playground.mjs --force`。

## 6. 真實環境

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
