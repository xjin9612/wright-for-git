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

每個測試檔會在系統暫存資料夾建立一份新的 playground，不會動到專案旁邊的 `playground`。失敗時訊息會指出哪一個步驟、預期與實際的內容。

### UI 測試涵蓋的項目（不需手動再測）

| 檔案 | 內容 |
|---|---|
| `test/ui/log.test.js` | 鍵盤移動選取、`Ctrl+C`、`Ctrl+F`、`Esc`；鍵盤開啟與操作右鍵選單；狀態字母；沒有結果時清除篩選；多 repo 合併顯示與標籤；文字、hash、regex 篩選；User（`me`）、Branch 串接選單、Date、Paths（Ctrl+點選）篩選；HEAD 不在篩選中的提示；repo 名稱欄；選取 commit 的檔案與詳情；issue 連結；多選合併變更；右鍵選單；Log 分頁；欄寬拖曳與隱藏欄位 |
| `test/ui/branches.test.js` | 確認框的焦點、`Tab`、`Esc`；Branches 樹與資料夾、同名分支合併；搜尋；新增分支（名稱驗證）；刪除已合併／未合併（確認框）；重新命名；右鍵選單與停用項目；我的最愛；雙擊遠端分支（失敗與成功）；合併衝突、進行中列、中止確認 |
| `test/ui/sync.test.js` | Git 主控台記錄指令與失敗原因；Push 分頁（目標、commit、檔案、警告）；推送成功與被拒；Pull；Force Push 確認；新分支 New 與改名後設定 upstream；Push 到這裡為止；Fetch |
| `test/ui/commit.test.js` | 空白鍵勾選、`Ctrl+Enter` 提交；提交視窗的清單與預設勾選；分組（模組、平鋪）；逐段提交且不動內建暫存區；跨 repo 提交；Amend（只改訊息）；捨棄變更；加入 .gitignore；Changelist；儲藏分頁（分組、未追蹤、diff、刪除後即時更新）；儲藏變更 |
| `test/ui/rebase.test.js` | 滑鼠拖曳調整順序；reword（保留 `#` 開頭的行）、squash、調整順序、drop、自動儲藏；edit 停下後「繼續」；分支變動時拒絕；detached HEAD 拒絕 |
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
- `web-app`：main 落後遠端 1 筆；2 個 stash；`conflict/theme` 與 main 改同一行（合併會衝突）；`src/pages/Login.tsx` 有未提交的修改
- `notes`：一般資料夾，不是 repo
- 作者 Alice／Bob／Carol／Dave；「我」是 Alice

## 1. 開啟、版面與主題
- [ ] 點活動列的 Git Workbench 圖示：側邊欄出現「提交」與「儲存庫」，底部開啟 Git 記錄；狀態列「Git Log」、`Alt+9`、`Alt+0` 也能開啟
- [ ] 分隔線拖曳、左右欄收合後重新載入視窗：寬度、收合、欄寬、分組選項、我的最愛都保留
- [ ] Git 記錄、提交視窗標題列的齒輪打開面板右上角的設定框（面板內沒有其他重複的設定按鈕）；切換語言：面板立即以新語言重新載入，設定框自動再打開；語言設為「跟隨 VS Code」時跟隨 VS Code 的顯示語言
- [ ] 切換淺色、深色、高對比主題：文字與選取都看得清楚；對話框按鈕在 Windows 上為「主要按鈕在左、取消在右」

## 2. VS Code 原生功能的整合
- [ ] 記錄右欄雙擊檔案開啟 diff（新增的左側為空、刪除的右側為空、`docs/中文說明.md` 檔名正常）；diff 標題列的 ↑↓ 與 `Ctrl+Alt+PageUp／PageDown` 切換檔案
- [ ] 提交視窗雙擊 `src/config.ts`：開啟「HEAD ↔ 工作區」diff，可在右側直接編輯
- [ ] 檔案總管右鍵 → Git Workbench 子選單四個項目都在；編輯器右鍵有「顯示 Git 歷史」「切換 Git Blame 標註」，切換後行尾出現／消失 blame
- [ ] Push… 等編輯器分頁可拖到其他編輯器群組或「移到新視窗」
- [ ] Log 標題列「顯示 Git 主控台」：開啟「輸出」並切到 Git Workbench 頻道，看得到剛才的 Push／Fetch 指令

## 3. 自動重新整理（檔案監看）
- [ ] 在終端機執行 `git checkout`、`git commit`、`git stash`：記錄面板與儲藏分頁自動更新
- [ ] 用 VS Code 內建「原始檔控制」提交、或在編輯器修改存檔：記錄面板與提交視窗約 1 秒內更新

## 4. 側邊欄「儲存庫」
- [ ] 列出 api-server、api-server/libs/shared、web-app（不含 notes）
- [ ] 取消勾選某個 repo，記錄面板的 Paths 篩選同步；在 Paths 選單勾回來，側邊欄也同步

## 5. 合併衝突的實際解決
- [ ] web-app：分支右鍵 `conflict/theme` →「合併到目前的分支」→ 衝突提示選「開啟原始檔控制」→ 在衝突編輯器解決並暫存 → 記錄上方「合併進行中」按「繼續」完成

## 6. 真實環境
- [ ] 你自己的 GitHub／GitLab repo（SSH 遠端）：Fetch、Pull、Push 各一次；提交訊息中的 `#123` 連到該 repo 的 issue 頁
- [ ] 數萬筆 commit 的 repo：開啟、捲動、篩選都順暢
