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
| `test/ui/log.test.js` | 多 repo 合併顯示與標籤；文字、hash、regex 篩選；User（`me`）、Branch 串接選單、Date、Paths（Ctrl+點選）篩選；HEAD 不在篩選中的提示；repo 名稱欄；選取 commit 的檔案與詳情；issue 連結；多選合併變更；右鍵選單；Log 分頁；欄寬拖曳與隱藏欄位 |
| `test/ui/branches.test.js` | Branches 樹與資料夾、同名分支合併；搜尋；新增分支（名稱驗證）；刪除已合併／未合併（確認框）；重新命名；右鍵選單與停用項目；我的最愛；雙擊遠端分支（失敗與成功）；合併衝突、進行中列、中止確認 |
| `test/ui/sync.test.js` | Push 分頁（目標、commit、檔案、警告）；推送成功與被拒；Pull；Force Push 確認；新分支 New 與改名後設定 upstream；Push 到這裡為止；Fetch |
| `test/ui/commit.test.js` | 提交視窗的清單與預設勾選；分組（模組、平鋪）；逐段提交且不動內建暫存區；跨 repo 提交；Amend（只改訊息）；捨棄變更；加入 .gitignore；Changelist；儲藏分頁（分組、未追蹤、diff、刪除後即時更新）；儲藏變更 |
| `test/ui/rebase.test.js` | reword（保留 `#` 開頭的行）、squash、調整順序、drop、自動儲藏；edit 停下後「繼續」；分支變動時拒絕；detached HEAD 拒絕 |
| `test/ui/misc.test.js` | 繁中介面與即時切換語言；顯示 Git 歷史；與分支或標籤比較；取消儲藏分頁（以新分支取消儲藏）；沒有變更時的儲藏提示；切換 Git Blame；開啟設定；Fetch 指令 |

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

## 1. 開啟與版面
- [ ] 點活動列的 Git Workbench 圖示：側邊欄依序出現「提交」與「儲存庫」，底部同時開啟 Git 記錄面板
- [ ] 狀態列「Git Log」按鈕與 `Alt+9` 開啟記錄面板；`Alt+0` 開啟提交視窗
- [ ] 記錄面板、提交、儲存庫的標題列都有齒輪按鈕，按下後開啟設定頁，且只列出 Git Workbench 的設定
- [ ] 記錄面板三欄的分隔線可拖曳；左右兩欄可收合再展開。重新載入視窗後，寬度、收合狀態、欄寬、分組選項、我的最愛都保留
- [ ] 切換淺色／深色主題（「喜好設定: 色彩佈景主題」），面板、選單、對話框分頁顏色都正常、文字看得清楚

## 2. 原生 diff
- [ ] 記錄右欄雙擊檔案：開啟 VS Code 的 diff；新增的檔案左側為空、刪除的檔案右側為空；選 `docs: API reference for orders` 開 `中文說明.md`，中文檔名正常
- [ ] diff 標題列有 ↑↓ 按鈕，可切換上一個／下一個變更檔案；`Ctrl+Alt+PageUp`／`Ctrl+Alt+PageDown` 也可以；到第一個或最後一個檔案時狀態列提示
- [ ] 提交視窗雙擊 `src/config.ts`：開啟「HEAD ↔ 工作區」的 diff，可直接在右側編輯
- [ ] 儲藏分頁雙擊檔案：開啟該 stash 的 diff

## 3. 選單與快捷鍵
- [ ] 檔案總管對檔案按右鍵 → Git Workbench 子選單：顯示 Git 歷史、與分支或標籤比較…、儲藏變更…、取消儲藏…
- [ ] 編輯器內按右鍵：「顯示 Git 歷史」「切換 Git Blame 標註」；切換後行尾出現／消失內建的 blame 標註
- [ ] 記錄面板內：`↑` `↓` `PageUp` `PageDown` `Home` `End` 移動選取；`Ctrl+C` 複製 hash（貼到別處確認）；`Ctrl+F` 聚焦搜尋框；搜尋框內 `Esc` 清除
- [ ] 提交視窗：`空白鍵` 切換勾選；在提交訊息中 `Ctrl+Enter` 提交
- [ ] 互動式 rebase 分頁：用滑鼠拖曳列調整順序

## 4. 自動重新整理
- [ ] 在終端機執行 `git checkout`、`git commit`、`git fetch`：記錄面板自動更新
- [ ] 用 VS Code 內建的「原始檔控制」提交：記錄面板與提交視窗都自動更新
- [ ] 在編輯器修改並存檔、或在終端機 `git add`：提交視窗約 0.5 秒內更新
- [ ] 在終端機執行 `git stash`：儲藏分頁的清單更新

## 5. 多 repo 與側邊欄
- [ ] 「儲存庫」列出 api-server、api-server/libs/shared、web-app（不含 notes），沒有重複
- [ ] 取消勾選某個 repo：記錄面板的 Paths 篩選同步；在 Paths 選單勾回來，側邊欄也同步
- [ ] 點儲存庫名稱：記錄面板只顯示該 repo

## 6. 對話框與分頁
- [ ] Push…、取消儲藏…、選取要提交的區段…、互動式重訂基底… 都開在編輯器分頁；可拖到其他編輯器群組，或右鍵分頁「移到新視窗」
- [ ] 確認框（刪除分支、強制推送、捨棄變更、中止合併…）顯示在面板或分頁內：破壞性操作的按鈕為紅色、預設焦點在「取消」；`Esc` 取消、`Tab` 切換按鈕

## 7. Git 主控台
- [ ] Log 面板標題列的「顯示 Git 主控台」按鈕：開啟「輸出」面板並切到 Git Workbench 頻道
- [ ] 按 Fetch、Push、提交後，主控台出現 `[repo] git …` 與 `✓ … (毫秒)`，push 顯示 `To … main -> main`
- [ ] 讓 Push 被拒（`node scripts/make-playground.mjs remote-push web-app` 後直接推送）：主控台以紅色 error 顯示指令、結束代碼與 git 的錯誤；錯誤通知上的「顯示 Git 主控台」按鈕可直接跳過去
- [ ] 「開發人員: 設定記錄層級」→ Git Workbench → 追蹤：log、status 等只讀取的指令也會出現

## 8. 合併衝突的實際解決
- [ ] web-app：分支右鍵 `conflict/theme` →「合併到目前的分支」→ 衝突提示選「開啟原始檔控制」→ 在 VS Code 的衝突編輯器解決並暫存 → 記錄面板上方「web-app：合併進行中」按「繼續」完成合併

## 9. 語言
- [ ] `gitWorkbench.language` 為 `auto` 時跟隨 VS Code 的顯示語言（繁中／英文各切一次，需重新啟動 VS Code）
- [ ] 指令名稱、設定說明跟隨 VS Code 的顯示語言，不受 `gitWorkbench.language` 影響（VS Code 的限制，預期行為）

## 10. 真實環境
- [ ] 用你自己的 GitHub／GitLab repo（SSH 遠端）各 Fetch、Pull、Push 一次；有密碼的 SSH key 在沒有 ssh-agent 時可能失敗，請回報訊息
- [ ] 上述 repo 的提交訊息含 `#123` 時，在詳情中變成連結並開啟該 repo 的 issue 頁（未設定 `gitWorkbench.issueLinks` 時）
- [ ] 數萬筆 commit 的 repo：開啟、捲動、篩選都順暢
