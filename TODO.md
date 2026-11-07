# 工作計畫

> 建立：2026-11-03　順序：A → B → C（Shelf 做完再上架，上架首版與 GIF 都能包含 Shelf）

共 **15 步**：A 4 步、B 6 步、C 5 步。每步完成後我驗證型別／單元測試能跑的部分；需要 `npm` 的建置與測試由你在 Windows 端執行。

---

## 進度（2026-11-04）

- ✅ A1～A4、插隊項目、多項 UI 修正、版號規則、`.claude/settings.json`
- ✅ B1～B8 已 commit；擱置補齊 UI 測試；`defaultFavoriteBranches` 設定
- ✅ 整條歷史重寫 commit 訊息，已推到新 repo `xjin9612/wright-for-git`（main、feat/1.4.0、v1.0.0～v1.3.0）；repo 描述與 topics 已設定

### 待辦（依序）
1. ⏳ 手動驗收（使用者）：下方「待手動驗收」10 輪；問題在 `feat/1.4.0` 修
2. ✅ 改名 Wright for Git（`f99462e`，分支 `feat/rename-wright`，從 `feat/1.4.0` 開；驗收修正後 rebase 到最新的 `feat/1.4.0`）
3. ✅ 新商店圖示（`8f202ce`，同分支；`node scripts/make-icon.mjs` 由 `assets/icon.svg` 產生；HEAD 節點改白外圈以免像 i 的點）
4. ✅ C1（`6277d8b`，另有 CONTRIBUTING.zh-TW.md）：README 的 Development／Releasing／Architecture 搬到 `CONTRIBUTING.md`
5. ✅ C2（`cf5941b`）：keywords 30 個、`galleryBanner`、`pricing: "Free"`、描述更新；✅ Marketplace 搜「Wright」確認（2026-11-04 使用者查過：沒有 Git 相關或同名的擴充功能；結果有 Markdown Wright、WrightAI（紫色圓形 W 圖示，與我們的圓角方形 W 可區分）、作者姓 Wright 的擴充功能）
6. ✅ C3：中英文 README 重寫（`a017e1e`）（參考 marklens 結構）；⏳ 截圖與 GIF 由使用者錄製，放 `docs/screenshots/en/`、`docs/screenshots/zh-TW/`（介面語言分別設 en、zh-tw；VS Code 深色主題；視窗約 1280×800，用 `node scripts/make-playground.mjs` 的範例 repo）
   - `1-log.png`：Git 記錄全貌，選一筆 api-server 的 commit（右欄有檔案與詳情），Paths 顯示兩個 repo
   - `2-commit.png`：提交視窗，兩個 Changelist，`src/config.ts` 只選一段（顯示 1/2），訊息框有文字
   - `3-shelf.gif`（約 10～15 秒）：選兩個 repo 的檔案 → 擱置變更 → 擱置分頁 → 雙擊 → 取回對話框勾選並選 Changelist → 取回
   - `4-rebase.gif`（約 10 秒）：互動式 rebase 分頁拖曳一筆 commit 到新位置，再改成 squash
   - `5-merge.png`：合併 `conflict/theme` 後開 `theme.ts` 的三方合併，一個衝突已用 ≫ 解決、一個未處理
   - GIF 建議用 ScreenToGif，寬 ≤1200 px、每個 ≤5 MB
7. ⬜ C4：版號 1.4.0；`release.yml` 加 Marketplace（OIDC）與 Open VSX（`OVSX_PAT`）發佈
8. ⬜ C5：使用者的手動發佈步驟（publisher、token、secrets、Open VSX namespace）
9. ⬜ `feat/1.4.0` 開 PR 合進 main，打 `v1.4.0` 發佈
10. ✅ 舊 repo 已刪除（2026-11-04）；⬜ Website 填 Marketplace 網址（上架後）
11. 延後：英文提示大小寫統一

---

## A. 提交詳情檔案樹：Ctrl+C／F4／右鍵選單

**A1. Ctrl+C 複製檔名**
- `src/webview/fileTree.ts` `onKey`：選到檔案列時複製 `basename(path)`；選到資料夾、repo 列不動作。
- 共用元件，Log 詳情、Commit 視窗、取消儲藏對話框的檔案樹都會生效。
- 若 `commitMain.ts` 已有自己的 Ctrl+C（多選複製），保留原行為，FileTree 只在沒人處理時才複製。

**A2. F4 開啟檔案（可改鍵）**
- `package.json` 新增指令 `gitWorkbench.openSelectedFile`（命令面板隱藏），keybinding `f4`，
  `when`: `focusedView == gitWorkbench.log && gitWorkbench.fileTreeFocus`（Commit 視窗同理加 `gitWorkbench.commit`）。
- webview 檔案樹 focus／blur → 通知 extension `setContext gitWorkbench.fileTreeFocus`。
- 指令 → post 給 webview → webview 回傳選取檔案 → extension `vscode.open` 工作目錄檔案。已刪除的檔案不處理。
- 風險：需在真實 VS Code 確認 webview view 有設定 `focusedView`；不行時改用自己的 context key（依 view 可見＋focus 訊息）。

**A3. 詳情檔案樹右鍵選單**
- Show Diff（Enter）、Open File（不標快速鍵）、Open Repository Version（該 commit 的版本，用既有 content provider）、Copy File Name（Ctrl+C）、Copy Path。
- `FileTreeOptions` 加 `onContextMenu`，選單沿用 `dom.ts` 的 `showMenu`。

**A4. 測試與文件**
- `test/ui`：Ctrl+C 複製檔名、右鍵選單項目與動作。
- `test/vscode`：F4 keybinding 觸發開檔。
- README 鍵盤段落、`docs/FEATURES.md`、l10n（zh-tw）、`CHANGELOG.md` Unreleased。

---

## 下一個（插隊）

- Log 開啟時畫面一律從最上面開始：仍選取上次的 commit／HEAD 並顯示詳情，但不為它捲動；重新整理維持保留位置
- 新增「回到 HEAD」（工具列按鈕或快捷鍵）
- 設定頁（齒輪）加「鍵盤快速鍵…」連結，打開只列出 Git Workbench 的快速鍵

---

## B7、B8（使用者要求上架前做完，與 B4～B6 一起驗收）

**B7. 多筆擱置依序取回**
- 擱置清單多選時右鍵／工具列「取回 N 筆…」（不再反灰）：由舊到新，逐筆開取回對話框。
- webview 送 `shelfUnshelve` 時帶 `next: string[]`（剩下的 id）；extension 取回後若沒有衝突、沒有失敗，回傳 `shelfUnshelveNext { ids }` 讓 webview 開下一筆（必要時先載入檔案）。
- 遇到衝突或失敗就停：提示「停在 X，尚有 N 筆未取回：名稱…」；使用者在對話框按取消也停止，剩下的不處理。
- 測試：UI（兩筆依序取回；中途取消後剩下的保留）。

**B8. 只擱置部分段落**
- 提交分頁對某檔只勾了部分段落（`this.partial`）時，擱置只擱置那些段落；沿用提交時建 patch 的方式（`commitView` 的 commit 中部分提交那段：`parseFileDiff` + `buildPatch`）。
- git 層 `shelve(id, name, paths, keep, partials?: { path, patch }[])`：
  - 整檔的路徑照舊 `stash push`；部分段落的檔案不傳給 stash push。
  - 擱置內容：W tree = (stash 的 W 或 HEAD tree) 以暫時 index `git apply --cached` 加上部分段落；沒有整檔路徑時自建 stash 結構（I = HEAD tree）。
  - 工作區：先 `git apply -R --check`，備份這些檔案內容 → `git apply -R`（只動工作區）；任何一步失敗 → 還原備份、刪除擱置、丟出錯誤。keepChanges 時不動工作區。
  - 取回時照舊（工作區留著未選的段落，`git apply` 通常能套上；相鄰段落套不上時與一般衝突相同處理）。
- 輸入框的「會擱置整個檔案」提示改成「只擱置選取的段落」。
- 測試：單元（只擱置一段、另一段留在工作區、取回後兩段都在；反向套用失敗時還原；keepChanges）、UI（部分段落擱置）。

---

## 待手動驗收（B4～B8、改名後一次驗；在 `feat/rename-wright`）

### 準備

> 改名後擱置存在 `refs/wright/shelf/`；之前在舊版建立的擱置不會出現，第 2 步的 `init` 會在新資料夾重建測試 repo。

1. 切到 `feat/rename-wright`：`xvfb-run -a npm run check` → **先解除安裝舊的 Git Workbench**（ID 不同，不解除會同時有兩個）→ `code --install-extension wright-for-git-1.3.0.vsix --force`。舊的 `gitWorkbench.*` 設定不會沿用，需要的話改到 `wright.*`。
2. 在專案根目錄建立測試 repo：`node scripts/make-shelf-fixture.mjs init`（建在 `../wright-for-git-test/shelf`，內有 `api`、`web` 兩個 repo 與 `patches` 資料夾）。
3. VS Code「檔案 > 開啟資料夾」開 `../wright-for-git-test/shelf` → Reload Window → 打開 Wright 的提交視窗。
4. 每一輪開始前執行指定的情境指令（下面寫成 `F <情境>`，即 `node scripts/make-shelf-fixture.mjs <情境>`）：它會把兩個 repo 還原成同一個起點（含清掉擱置、儲藏），再做出這輪需要的修改。執行後在提交視窗按「重新整理」。
5. 隨時可用 `F status` 看兩個 repo 的工作區、暫存區、儲藏筆數與擱置（`擱置 <id> shelf:<id> <名稱>`）。

### 用語
- **選取**：在檔案列上點一下，Ctrl＋點加選。是列的反白，**不是**勾選框。擱置只看選取，不看勾選。
- **提交分頁**、**儲藏分頁**、**擱置分頁**：提交視窗上方的三個分頁。
- 擱置分頁上半是擱置清單，下半是選到那筆的檔案（依 repo 分組）。
- 標「（UI 測試有）」的項目已有自動測試；這裡是在真的 VS Code 再確認一次。

### 第 1 輪：擱置、整筆取回到 changelist（`F basic`）
起點：api 有 `src/service.txt`（M）、`api-new.txt`（未追蹤）；web 有 `src/app.txt`（M）、`web-new.txt`（未追蹤）。
1. 提交分頁選取這四個檔案 → 在其中一個上按右鍵 →「擱置變更…」。（UI 測試有）
   - 輸入框上方提示「擱置 2 個儲存庫中的 4 個檔案」→ 輸入「測試」→ Enter。
   - 預期：四個檔案從提交分頁消失；`F status` 兩個 repo 的工作區都乾淨、儲藏 0 筆、各有一筆擱置且 id 相同。
2. 切到擱置分頁：清單有「測試 · 2 個儲存庫」。點它 → 下半出現 `api`、`web` 兩組，各兩個檔案。雙擊 `src/service.txt` → 開 diff，左邊原本、右邊擱置的內容。
3. 雙擊上半的「測試」→ 取回對話框（UI 測試有）：
   - 標題「取回「測試」」；四個檔案都勾；Changelist 欄位預設「測試」；「取回的檔案從擱置中移除」已勾。
   - 按「取回」→ 預期：四個檔案回到工作區；擱置清單變成「沒有擱置的變更」；提交分頁多一個 changelist「測試」，裡面是 `src/service.txt`、`src/app.txt`；兩個新檔在「未追蹤的檔案」（未追蹤的檔案不屬於 changelist）。
4. 收尾：提交分頁對 changelist「測試」右鍵刪除（檔案移回「變更」），之後各輪才不會受影響。

### 第 2 輪：取回部分檔案、保留在擱置（`F basic`）
1. 同第 1 輪第 1 步擱置四個檔案，名稱「測試2」。
2. 擱置分頁點「測試2」→ 下半選取 `src/service.txt`，Ctrl＋點 `src/app.txt` → 右鍵「取回 2 個檔案…」。（UI 測試有）
   - 預期：對話框列出四個檔案，只有這兩個打勾 → 取回 → 這兩個回到工作區；「測試2」還在，下半只剩 `api-new.txt`、`web-new.txt`。
3. 雙擊「測試2」→ 取消勾選「取回的檔案從擱置中移除」→ 取回。（UI 測試有）
   - 預期：兩個新檔回到工作區；「測試2」仍在清單、下半仍是那兩個檔案。
4. 收尾：選「測試2」按 Delete 鍵 → 確認 → 刪除。

### 第 3 輪：暫存區不受影響（`F staged`）
起點：api 的 `src/other.txt` 已暫存（stage）、`src/service.txt` 未暫存。
1. 提交分頁只選取 `src/service.txt` → 右鍵「擱置變更…」→ 名稱「暫存」。（UI 測試有）
2. 預期：`F status` 的暫存區仍是 `src/other.txt`；擱置分頁點「暫存」，下半只有 `src/service.txt`。

### 第 4 輪：只擱置部分段落（`F hunks`）
起點：`src/hunks.txt` 第 2 行改成 `FIRST CHANGE`、第 29 行改成 `SECOND CHANGE`，是兩段修改。
1. 提交分頁對 `src/hunks.txt` 右鍵「選取要提交的區段…」→ 對話框有兩段 → 取消勾選第二段（SECOND CHANGE）→「套用」。檔案列右側顯示「1/2 段」。（UI 測試有）
2. 選取 `src/hunks.txt` → 右鍵「擱置變更…」。
   - 輸入框提示要包含「其中 1 個檔案只擱置選取的段落，其餘留在工作目錄」→ 名稱「段落」。
3. 預期：打開 `src/hunks.txt`，第 2 行回到 `hunks line 2`，第 29 行仍是 `SECOND CHANGE`。擱置分頁雙擊下半的檔案開 diff，只有 FIRST CHANGE 那段。
4. 雙擊「段落」→ 取回 → 檔案同時有 `FIRST CHANGE` 和 `SECOND CHANGE`，擱置消失。
5. 另外試「擱置變更（保留工作目錄）…」（先 `F hunks`，重做第 1 步）：檔案兩段都還在，多一筆只含第一段的擱置。

### 第 5 輪：取回時有衝突（`F conflict`）
1. 擱置 `src/clash.txt`，名稱「衝突」→ 檔案變回 `base`。
2. 執行 `F conflict-commit`（把同一檔改成 `committed` 並提交）。
3. 雙擊「衝突」→ 取回。（UI 測試有）
   - 預期：衝突清單分頁自動打開，列出 `api` 的 `src/clash.txt`。雙擊它開 Wright 的三方合併分頁，「他們的」那側標題是「擱置：衝突」（VS Code 內建的合併編輯器用自己的標題）。
   - 「衝突」從擱置清單消失（衝突的檔案算已取回）。
4. 收尾：在衝突清單「採用他們的」或下一輪的 `F` 指令會自動還原。

### 第 6 輪：檔案已存在（`F exists`）
1. 選取 `exists.txt`、`exists-other.txt` → 擱置，名稱「已存在」。
2. 執行 `F exists-create`（建立 `exists.txt`，內容 `mine`）。
3. 雙擊「已存在」（UI 測試有）：
   - 預期：`exists.txt` 標示「已存在；勾選即覆蓋」且沒勾；`exists-other.txt` 有勾。
   - 直接取回 → `exists-other.txt` 回來；`exists.txt` 仍是 `mine`；擱置只剩 `exists.txt`。
4. 再雙擊「已存在」→ 勾 `exists.txt` → 取回 → 內容變成 `from shelf`，擱置消失。

### 第 7 輪：多筆依序取回（`F seq`）
起點：`seq-1.txt`、`seq-2.txt`、`seq-3.txt`（新檔）、`src/seq-clash.txt`（M）。
1. 依序擱置，一次一個檔：`seq-1.txt` →「S1」、`seq-2.txt` →「S2」。
2. 擱置分頁點「S1」、Ctrl＋點「S2」→ 右鍵「依序取回 2 筆…」。（UI 測試有）
   - 預期：先開「取回「S1」 (1/2)」（較舊的先）→ 取回 → 自動開「取回「S2」 (2/2)」→ 取回 → 兩個檔案都回來，清單空。
3. 取消：把 `seq-1.txt`、`seq-2.txt` 再各擱置一次（「S1」「S2」）→ 依序取回 → 在第一個對話框按「取消」（或 Esc）。
   - 預期：不再開下一筆；提示「還有 2 筆擱置沒有取回」；兩筆都還在。
4. 衝突時停下（UI 測試有）：
   - 重新執行 `F seq`；擱置 `src/seq-clash.txt` →「C1」，再擱置 `seq-3.txt` →「C2」。
   - 執行 `F seq-commit` → 多選「C1」「C2」→ 依序取回 → 第一個對話框按取回。
   - 預期：衝突清單打開；提示「在「C1」之後停止，還有 1 筆擱置沒有取回」；「C2」還在。

### 第 8 輪：改名、刪除、匯出／匯入（`F basic`）
1. 選取 `src/service.txt` → 右鍵「擱置變更（保留工作目錄）…」→ 名稱「單一」→ 檔案仍在工作區，擱置分頁多一筆「單一」（沒有「2 個儲存庫」）。（UI 測試有）
2. 選取剩下三個檔案加上 `src/service.txt` → 「擱置變更…」→ 名稱「測試」。
3. 改名：右鍵「單一」→「重新命名…」→「單一改」→ 清單更新。
4. 單一 repo 匯出：右鍵「單一改」→「匯出 Patch…」→ 存檔對話框預設檔名「單一改.patch」→ 存到 `patches` 資料夾。
5. 跨 repo 匯出：右鍵「測試」→「匯出 Patch…」→ 選資料夾 `patches` 資料夾 → 產生「測試-api.patch」「測試-web.patch」。（匯出有 UI 測試）再匯出一次 → 問「要覆蓋 2 個已存在的檔案嗎？」。
6. 右鍵「測試」→「刪除…」→ 確認。工具列「匯入 Patch…」→ 選「測試-api.patch」「測試-web.patch」→ 名稱預設「測試」→ Enter。（UI 測試有）
   - 預期：多一筆「測試 · 2 個儲存庫」；`F status` 工作區沒有變化（匯入不動工作區）。
7. 檔案總管對 `patches/單一改.patch` 右鍵 →「Wright」→「匯入 Patch 到擱置…」→ 名稱 Enter → 自動切到擱置分頁，出現新的一筆。
8. 多選刪除：點兩筆、Ctrl＋點 → 右鍵「刪除 2 筆…」→ 確認框列出名稱 → 刪除 → 都消失。（UI 測試有）

### 第 9 輪：匯入時判斷 repo（`F patch`）
`patches/whatever.patch`（檔名對不上任何 repo，但套得上 web）、`patches/nowhere.patch`（哪裡都套不上）。
1. 「匯入 Patch…」選 `whatever.patch` → 不問 repo、直接問名稱 → 匯入到 `web`。（UI 測試有）
2. 「匯入 Patch…」選 `nowhere.patch` → 出現「nowhere.patch 無法直接套用到任何儲存庫。要匯入到哪個儲存庫？」→ 選 `api` → 名稱 Enter。（UI 測試有）
   - 預期：錯誤「無法匯入到 api：…。沒有匯入任何內容。」，清單沒有新的一筆。

### 第 10 輪：先前延後的（`F stash`）
1. 儲藏分頁點「manual stash」→ 下半選 `src/stash-a.txt` → Ctrl+C → 剪貼簿是 `stash-a.txt`；按 F4 → 開啟工作區的檔案。
2. 提交分頁對 `src/service.txt` 右鍵「開啟檔案」，再對 `src/other.txt` 右鍵「開啟檔案」→ 兩個編輯器分頁都在（不是同一個分頁被換掉）。
3. Shift+F10：側邊欄 Branches 選一個分支按 Shift+F10、提交視窗選一個檔案按 Shift+F10 → 只出現 Wright 自己的右鍵選單，不會另外跳出 VS Code 的選單。
4. 預設我的最愛：設定 `wright.defaultFavoriteBranches` 改成 `[]` → Log 的 Branches 和側邊欄 Branches 的 `main` 都沒有星號、不再置頂；Log 篩選的 Branch 選單也沒有 main。改回預設（刪除該設定）→ `main` 又有星號。（UI 測試有，側邊欄沒有）
5. Select In（`Alt+F1`）：Git 記錄右欄選 `F stash` 後還存在的檔案（例如 api 的某個 commit 的 `src/service.txt`）→ 按 `Alt+F1` → 出現三項：「在檔案總管檢視中顯示」「在 Windows 檔案總管中顯示」「在整合式終端機中開啟」；逐一試：側邊欄檔案總管選到該檔案、Windows 檔案總管打開並選取（WSL 專案特別注意這項能不能用）、終端機目錄是該檔案所在資料夾。右鍵選單、提交分頁的檔案右鍵也有「在其他位置顯示…」。已刪除的檔案：右鍵該項反灰；按 `Alt+F1` 只在狀態列提示。編輯器內按 `Alt+F1` 仍是 VS Code 原本的協助工具說明。（UI 測試有，實際打開的效果沒有）

---

## B. Shelf（跨 repo 的修改集合）

### 儲存設計
- 每個 repo：`git stash push -u -m "shelf:<id> <name>" -- <paths>` → 取 `stash@{0}` 的 sha → `git update-ref refs/git-workbench/shelf/<id> <sha>` → `git stash drop`。
  - ref 保住物件（不被 gc），不污染使用者的 stash 清單，unshelve 用 git 的三方合併。
  - 用 push 前後的 `stash@{0}` 比對判斷「沒有東西可擱置」。
- 同一次 shelve 的各 repo 共用 `<id>`；清單由 `git for-each-ref refs/git-workbench/shelf` 掃各 repo 後依 id 分組，不需額外儲存檔。
- 改名：`git commit-tree` 用同 tree／parents、新訊息建新 commit，再 `update-ref`。

**B1. Git 層（`src/git/repository.ts`）**
- `shelve(id, name, paths)`、`listShelves()`、`shelfFiles(sha)`（沿用 stash 的檔案解析，未追蹤檔在 `^3`）、
  `unshelve(sha, paths?)`（整筆：`git stash apply <sha>`；部分：`git diff <sha>^1 <sha> -- <paths>` ＋ `^3` 的未追蹤檔 → `git apply --3way`）、
  `renameShelf`、`dropShelf`（`update-ref -d`）。
- 單元測試（`test/` 下，用暫存 git repo）。

**B2. 跨 repo 協調（新檔 `src/shelf.ts`）**
- Shelve：依勾選的檔案分 repo 執行；中途失敗 → 已完成的 repo `stash apply` 套回並刪 ref，不留半套狀態。
- Unshelve：逐 repo 套用，成功的才刪 ref（可選保留）；有衝突 → 開既有衝突對話框；最後彙整每個 repo 結果。

**B3. Commit 視窗：Shelve 動作**
- 勾選檔案後工具列／右鍵「Shelve Changes…」→ 輸入名稱 → 執行 B2。
- 選項：保留工作目錄的變更（只存不還原）。

**B4. Commit 視窗：Shelf 分頁**
- 清單一筆＝「名稱（N 個 repo）」，展開 repo → 檔案；點檔案開 diff（同 Stash 分頁）。
- 右鍵：Unshelve…、Rename…、Delete、Export Patch…。
- Unshelve 對話框：勾選 repo／檔案、「成功後從 Shelf 移除」選項（參考 `unstashDialog.ts`、`dialogFiles.ts`）。

**B5. 匯出／匯入 .patch**
- 匯出：選資料夾，每個 repo 一個 `<shelf名稱>-<repo名稱>.patch`（`git diff --binary <sha>^1 <sha>` ＋ 未追蹤檔轉成新增檔 diff）。
  單一 repo 的 shelf 直接存成單一檔案。可被 `git apply`／IntelliJ 讀取。
- 匯入：選一或多個 `.patch` → 自動判斷目標 repo（檔名比對 repo 名稱，再以 `git apply --check` 確認；無法判斷就讓使用者選）→
  **匯入成 Shelf 項目**（不直接改工作目錄），之後照常 Unshelve。
  - 不動工作目錄的做法：暫時 index（`GIT_INDEX_FILE`）`read-tree HEAD` → `git apply --cached` → `write-tree` →
    `commit-tree` 組出 stash 結構（I = HEAD tree，W = 套用後 tree，parents HEAD＋I）→ `update-ref`。
  - 也可從檔案總管右鍵 `.patch` 匯入。

**B6. 測試與文件**
- 單元：跨 repo shelve 失敗回復、部分 unshelve、匯出再匯入結果相同、衝突時的回報。
- `test/ui`：Shelf 分頁清單、右鍵、Unshelve 對話框。
- README／FEATURES／ROADMAP、l10n、CHANGELOG。

---

## C. 上架準備

**C1. 專案整理**
- `.claude/settings.json`：`sessionUrl: false` 搬到你的全域 `~/.claude/settings.json`（全域已有 `attribution.commit/pr` 為空），repo 端 `git rm`。
- README 的 Development／Releasing／Architecture 搬到 `CONTRIBUTING.md`。

**C2. Manifest**
- 2026-11-03 查證：`ITCode.git-workbench`「Git Workbench (Beta)」已在 Marketplace（71 安裝）與 Open VSX（1,538 下載）上架，
  同樣是 IntelliJ 風格的 Git 面板 → **建議首次上架前改 `displayName`**（`name` 可維持 `vscode-git-workbench`），待選定名稱。
- 版號規則已查證（官方：只收 `major.minor.patch`；建議偶數 minor＝正式、奇數＝預發布；兩者版號不可重複）。
- `keywords` 擴充到 ≤30 個（intellij、jetbrains、idea、shelf、stash、multi-repo、monorepo、commit、merge、rebase…）；`displayName` 不放商標字。
- `galleryBanner`、`pricing: "Free"`。
- **名稱（2026-11-04 決定）**：Wright for Git（Git 商標政策禁止「Git」當音節或混成詞，如 Gitwright；允許「[產品名] for Git」）。
  - GitHub repo、`package.json` 的 `name`：`wright-for-git`（ID `xjin9612.wright-for-git`）
  - displayName：「Wright for Git: Multi-Repo Log, Commit & Shelf」
  - 設定／指令／view 前綴 `wright.*`；擱置 ref `refs/wright/shelf/`；標記檔、測試資料夾（`wright-for-git-test`）跟著改
  - 上架前在 Marketplace 搜尋確認沒人用（Open VSX 已查無）
- **商店圖示（2026-11-04 決定）**：W 字分支線；深靛藍底 `#28347a`、白線（寬 10）、空心節點（r 11），最右上那顆（HEAD）實心橘 `#f08a3c`。草稿：https://claude.ai/code/artifact/fb01c80f-777d-4709-867e-b0f70d6cf5d5 的「微調 2」。改名時產生 `media/icon.png`，來源 SVG 只留一份（整理 `media/icon.svg`／`assets/icon.svg`）；活動列圖示不換。
- **歷史（2026-11-04 決定）**：開新 repo（舊 repo 無 issue／star／fork，可刪），保留細的歷史、整條重寫 commit 訊息（先給使用者看舊→新清單），tag 跟著改寫；改名放在最後一個 commit；1.4.0 為第一個上架版本。

**C3. README 改寫（英文＋繁中）**
- 結構：一句定位 → 主 GIF → 4–5 段功能各配 GIF（Log 篩選、Commit 視窗挑檔提交、Shelf 跨 repo、衝突合併、多 repo）→ 安裝 → 精簡快速鍵表 → 連到 FEATURES。
- GIF 由你錄製（我提供分鏡清單與檔名），放 `docs/images/`。
- CI 徽章 SVG 是否通過 vsce 檢查，打包時確認。

**C4. 版號規則與 release.yml**
- 改成 minor 奇數＝預發布（`--pre-release`），取代現在的「含 `-`」判斷。
- 目前 1.3.0 是奇數 minor → **Marketplace 首版用 1.4.0**。
- 新增 publish job：OIDC Trusted Publishing（`vsce publish --oidc`）＋ Open VSX（`OVSX_PAT`），`environment: marketplace`。

**C5. 你手動執行的步驟**
- `vsce ls` 確認打包內容、`vsce package` 無錯誤。
- 建立 publisher → 手動上傳 1.4.0 → 審核通過 → 建 Trusted Publishing policy、GitHub Environment `marketplace`（含 reviewer）、Open VSX namespace 與 token。
- 發一個 patch 版測自動發布。
