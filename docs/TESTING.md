# 手動測試清單（發佈前在真實 VS Code 執行）

自動化測試涵蓋 git 解析、graph、多 repo 合併與 webview 渲染，但無法啟動真實 VS Code。

## 測試用 playground

在專案資料夾執行下列指令，會在專案的上一層建立 `playground`（測試用的工作區）與 `playground-remotes`（遠端與「另一台電腦」）：

```
node scripts/make-playground.mjs            # 第一次建立
node scripts/make-playground.mjs --force    # 測完想重來：刪除後重建
node scripts/make-playground.mjs remote-push web-app   # 模擬別人推了一筆新 commit（測 Pull／Push 被拒）
```

用 VS Code 開啟 `playground` 資料夾（不是 `playground-remotes`）。內容：
- `api-server`：main 領先遠端 2 筆；`feature/rate-limit` 尚未推送（New）；`experiment/cache` 未合併；`old/merged-work` 已合併；tag `v1.0.0`（annotated）、`v1.1.0`；有 rename、刪除、中文檔名；提交訊息含 `#12`、`#31`、`PROJ-42`
- `api-server` 未提交的變更：`src/config.ts` 兩段修改（兩個 hunk）、刪除 `config/db.yml`、未追蹤 `src/todo.ts`、已忽略 `node_modules/`、子模組 `packages/sdk` 內的修改
- `api-server/libs/shared`：巢狀 repo
- `web-app`：main 落後遠端 1 筆；2 個 stash（其中一個含未追蹤檔案）；`conflict/theme` 與 main 改同一行（merge／rebase／cherry-pick 會衝突）；`src/pages/Login.tsx` 有未提交的修改
- 兩個 repo 都有 `feature/checkout`（同名 branch 合併顯示）
- `notes`：一般資料夾，不是 repo
- 作者 Alice／Bob／Carol／Dave，時間分布在最近 4 個月；「我」是 Alice
以下項目請在 Windows 的 VS Code 中逐一確認；安裝或更新 `.vsix` 後先執行「開發人員: 重新載入視窗」。

## 開啟與版面
- [ ] 活動列 Git Workbench 圖示：側邊欄依序出現「提交」與 Repositories，底部 Log 面板同時開啟
- [ ] 狀態列「Git Log」按鈕與 `Alt+9` 都能開啟 Log 面板；`Alt+0` 開啟提交視窗
- [ ] Log 面板、提交、儲存庫的標題列都有齒輪按鈕，按下開啟 Git Workbench 的設定頁（只列出本擴充套件的設定）
- [ ] 三欄分隔線可拖曳；左右欄可收合再展開；重新載入視窗後寬度保留
- [ ] 切換淺色／深色主題，顏色正常

## Branches
- [ ] Local／Remote／Tags 正確；`feat/`、`fix/` 等依 `/` 分資料夾
- [ ] 搜尋框過濾；定位目前 branch；展開／收合全部
- [ ] 點 branch → Log 篩選；雙擊 local branch → checkout 成功、面板自動更新
- [ ] 雙擊 remote branch（本地沒有同名）→ 建立 tracking branch
- [ ] 有未提交變更導致 checkout 失敗時，顯示錯誤訊息且畫面不壞

## Commit Log
- [ ] Graph 線條連續、HEAD 空心圓；同名 local／remote 標籤合併為 `origin & xxx`
- [ ] 文字搜尋（中文、`fix(ui)` 這類特殊字元）、`.*` regex、`Cc` 大小寫
- [ ] 貼上 hash 前 8 碼可找到該 commit
- [ ] User 篩選：`me`、多值 `|`、`Enter` 補完、`Ctrl+Enter` 套用
- [ ] 👁 選單：欄位顯示／隱藏、Highlight 三個選項
- [ ] 鍵盤 ↑↓／PageUp／PageDown／Home／End；`Ctrl+C` 複製 hash；右鍵選單
- [ ] 大型 repo（數萬 commit）捲動順暢

## 變更檔案與詳情
- [ ] 新增綠、修改藍、刪除灰；rename 顯示原路徑
- [ ] 雙擊檔案開啟 diff（新增檔左側為空、刪除檔右側為空）；中文檔名正常
- [ ] 詳情的 hash 點擊可複製；「In N branches … Show all」

## 多 repo
- [ ] 開啟含多個 repo 的上層資料夾：Repositories 列出全部（含巢狀 repo），沒有重複
- [ ] Log 左側色條區分 repo；graph 各 repo 分區
- [ ] Paths：勾選 repo；只選一個 repo 時展開子資料夾；篩選框顯示 `repo / 路徑`
- [ ] 側邊欄勾選與 Paths 同步；點 repo 名稱只顯示該 repo
- [ ] 同名 branch 顯示「N repos」；雙擊確認後一次 checkout 多個 repo
- [ ] 檔案總管右鍵「顯示 Git 歷史」：切到該檔所屬（最內層）repo 並篩選路徑

## 自動重新整理
- [ ] 在終端機執行 `git checkout`、`git commit`、`git fetch` 後，面板自動更新
- [ ] 在 VS Code 內建原始檔控制 commit 後，面板自動更新

---

# 下一版新增項目（Unreleased）

> 寫入類操作請用測試 repo 或測試 branch，不要在正式的 main 上測。

## 同步
- [ ] Fetch 在左側 Branches 直式工具列；按下後狀態列顯示「Fetch: N succeeded」
- [ ] Log 工具列只剩 Pull 與 Push…（沒有舊的 Push 下拉箭頭）
- [ ] 本機領先 1～2 筆時按 Push…：對話框列出 `main → origin : main` 與待推 commit；點 commit 右側列出檔案，雙擊檔案開 diff
- [ ] Esc、取消都只關閉對話框；點對話框外面不會關閉
- [ ] 按 Push 後對話框關閉、推送成功、↑ 數字歸零
- [ ] 新 branch：顯示「New」「set upstream」；把目標 branch 名稱改掉再推，遠端 branch 名稱正確且已設定 upstream
- [ ] 遠端有本機沒有的 commit（另一處推了新 commit 再 Fetch）：對話框顯示黃色警告；Push 被拒並顯示錯誤
- [ ] 承上，▾ → Force Push（with lease）：跳出確認框；確認後覆蓋遠端
- [ ] 勾選「推送 tag」：annotated tag 一併推上去
- [ ] Commit 右鍵「Push 到這裡為止…」：只推到該 commit；選不在目前 branch 上的 commit 顯示「commit 不在目前 branch 上」
- [ ] Pull：落後遠端時按 Pull，↓ 消失；沒有 upstream 的 repo 會被略過並提示
- [ ] SSH remote 實際 Push／Pull 一次（有密碼的 key 在沒有 ssh-agent 時可能失敗，請回報訊息）
- [ ] 命令面板「Git Workbench: Push…」也是開對話框

## Branches 右鍵
- [ ] Local branch 選單：Checkout、從此新增 Branch、與目前的 branch 比較、在 Log 中顯示、在新分頁中顯示、Merge、Rebase、更新、Push…、重新命名、刪除；目前 branch 的 Checkout／比較／Merge／Rebase／刪除為停用
- [ ] 從 remote branch 新增 Branch：預設名稱為遠端 branch 名，建立後已追蹤該 remote branch
- [ ] 與目前的 branch 比較：列出不同的檔案與「各有幾個 commit 不在對方」，選檔案開 diff
- [ ] Merge 到目前的 branch：成功；衝突時提示「開啟原始檔控制／中止」
- [ ] Rebase 目前的 branch：成功；衝突時同上，中止後恢復原狀
- [ ] 更新（非目前 branch）：從 upstream fast-forward，不切換 branch；不能 fast-forward 時顯示錯誤
- [ ] 重新命名：名稱不合法或已存在時無法送出
- [ ] 刪除已合併的 branch：直接刪除；未合併：先詢問「仍要刪除」
- [ ] 刪除 remote branch、刪除 tag：一定先確認
- [ ] Tag 選單「推送 Tag…」：推到 origin（多個 remote 時可選）
- [ ] 多 repo 同名 branch：操作會套用到所有擁有該 branch 的 repo，並先列出 repo 確認

## 我的最愛
- [ ] 預設 main／master 有 ★ 並置頂
- [ ] 滑鼠移到 branch 列尾出現空心星號，點一下加入我的最愛並置頂；右鍵可移除
- [ ] 工具列 ★ 按鈕：只顯示我的最愛；再按一次恢復
- [ ] 重新載入視窗後我的最愛與「只顯示」狀態保留

## Commit Log
- [ ] Branch 篩選不含目前 branch 時，上方出現藍色提示；「顯示 HEAD」「顯示所有 branch」都有效
- [ ] 日期篩選：最近 24 小時／7 天／30 天／90 天／一年；選擇區間（從／到）；清除 ✕
- [ ] 文字或作者篩選時，結果之間有 graph 連線
- [ ] 拖曳 Author／Date／Hash 欄的左緣調整寬度；雙擊還原；重新載入視窗後保留
- [ ] 👁 →「新增 Log 分頁」或 Branches 右鍵「在新分頁中顯示」：出現分頁列，各分頁篩選獨立；關閉分頁後回到上一個；只剩一個分頁時分頁列隱藏

## 多選 commit
- [ ] Ctrl+點選、Shift+點選、Shift+↑↓、Ctrl+A 都能多選
- [ ] 右欄顯示合併後的變更（多 repo 時分 repo 列出），下方列出選取的 commit，點一下回到單選
- [ ] 雙擊檔案：diff 為「最舊選取 commit 之前 ↔ 最新選取 commit」
- [ ] 右鍵：複製 N 個 Revision 編號、複製標題；同一 repo 時可一次 Cherry-Pick／Revert（含 merge commit 時會提示）

## 儲藏（提交視窗的「儲藏」分頁、檔案總管右鍵）
- [ ] 「儲藏」分頁列出所有 repo 的 stash（web-app 有 2 個）；選一個 stash，下方列出檔案，未追蹤的檔案另列在「未追蹤的檔案」底下；雙擊檔案開 diff
- [ ] 檔案清單上方 👁「分組方式」：目錄／儲存庫／模組，與 Log 右欄相同；重新載入視窗後保留
- [ ] 右鍵：套用、套用並還原暫存狀態、套用並刪除、從儲藏建立分支…、刪除…；「清除所有儲藏…」會先確認
- [ ] 工具列「儲藏變更…」：選 repo、選模式（已追蹤／含未追蹤／保留已暫存）、輸入說明 → 出現在清單
- [ ] 沒有變更時提示「沒有可儲藏的本機變更」
- [ ] 套用並刪除（Pop）遇到衝突時提示，stash 保留
- [ ] 在終端機執行 `git stash` 後清單自動更新
- [ ] 檔案總管右鍵 → Git Workbench →「取消儲藏…」：開在編輯器分頁的對話框，選 stash 看檔案，套用／套用並刪除／刪除／清除、從儲藏建立分支；Esc 關閉

## 變更檔案與 Diff
- [ ] 👁 選單「分組方式」：目錄／儲存庫／模組可複選；選 api-server 的 `feat(sdk): add client package`，依模組時 `packages/sdk` 獨立一組
- [ ] 右欄工具列切換樹狀／平鋪；檔案依類型顯示圖示（TS、JS、{}、M↓…）
- [ ] 從 Log 開啟 diff 後，編輯器標題列有 ↑↓ 按鈕，可切換上一個／下一個變更檔案；`Ctrl+Alt+PageUp／PageDown` 也可以
- [ ] 第一個／最後一個檔案時，狀態列提示已到底

## 確認框（面板內）
- [ ] Log 面板開著時，刪除分支、強制推送、硬重設、簽出標籤／修訂版本、多儲存庫簽出、刪除儲藏等確認框都顯示在面板內（深色、與 Push 對話框同風格），不再是 Windows 原生對話框
- [ ] 破壞性操作（刪除、強制推送、硬重設）確認按鈕為紅色，預設焦點在「取消」；Esc 取消、Tab 切換按鈕
- [ ] Log 面板關閉時從側邊欄刪除儲藏：退回 VS Code 對話框（預期行為）

## 介面語言
- [ ] 設定 `gitWorkbench.language`：`auto`（跟隨 VS Code）、`en`、`zh-tw`；切換後面板立即重新載入成對應語言，篩選與版面保留
- [ ] 繁中時面板、選單、對話框、通知訊息都是中文用語（分支、標籤、提交、推送、提取、擷取、簽出、合併、重訂基底、揀選、儲藏…）
- [ ] 指令名稱與設定說明跟隨 VS Code 的顯示語言（VS Code 的限制，預期行為）

## 分支欄工具列與選項
- [ ] 直式工具列順序：隱藏、新增分支、更新、刪除、與目前分支比較、與工作區比較、擷取、只顯示我的最愛、在記錄中跳到選取分支的最新提交（◎）、設定、展開／收合
- [ ] 選一個分支後，更新／刪除／比較／與工作區比較／◎ 才可用；◎ 讓 Log 捲到該分支 HEAD
- [ ] 「與工作區比較」：列出分支與目前工作區不同的檔案，雙擊開 diff
- [ ] 設定（齒輪）：依目錄分組、依儲存庫分組、顯示標籤、點選時在記錄中跳到該分支；切換後立即生效，重新載入視窗後保留
- [ ] 多 repo 時，分支後面顯示所屬 repo（3 個以內列名稱，超過顯示數量）

## Branch 篩選選單
- [ ] Log 工具列 Branch：串接選單，依序為「選擇…」、HEAD、我的最愛、本機／遠端／標籤子選單
- [ ] 子選單內點星號可加入／移除我的最愛，選單不關閉
- [ ] 「選擇…」可多選分支

## Paths 與儲存庫名稱欄
- [ ] Paths 選單的「儲存庫」區：勾選／取消 repo；`Ctrl+點選` 只顯示該 repo
- [ ] Paths →「選擇資料夾…」：跨 repo 勾選資料夾（如 api-server 的 `src/orders` 與 web-app 的 `src/pages`），Log 只顯示動到這些資料夾的 commit；篩選框可搜尋資料夾；勾選上層後子資料夾自動勾選且不能單獨取消
- [ ] 點 Log 左側色條：出現／隱藏 repo 名稱欄
- [ ] 選取一個 commit：不在其路徑上的列變淡；選回其他 commit 或清除選取後恢復

## Push 分頁
- [ ] Push… 開在編輯器分頁（不是面板內浮層）；可拖到其他編輯器群組或移到新視窗
- [ ] 分頁內的確認框（Force Push）顯示在分頁內
- [ ] 推送完成後分頁自動關閉

## 檔案總管右鍵
- [ ] 右鍵檔案或資料夾 → Git Workbench 子選單：顯示 Git 歷史、與分支或標籤比較…、儲藏變更…、取消儲藏…
- [ ] 「與分支或標籤比較…」：對 `src/orders/pricing.ts` 選 `release/1.x`，直接開啟 diff；對資料夾則列出不同的檔案供挑選；沒有差異時提示
- [ ] 「儲藏變更…」：儲藏該檔所屬 repo 的變更（與 IntelliJ 相同，不是只儲藏該檔）

## 提交視窗
- [ ] 開啟後列出 api-server 與 web-app 的變更：變更、未追蹤的檔案、已忽略的檔案（預設收合）
- [ ] `src/config.ts` 雙擊開 diff；右鍵「選取要提交的區段…」開分頁，只勾第一個 hunk → 套用後列表顯示 `1/2 changes`
- [ ] 只勾 `src/config.ts`（部分）與 `src/todo.ts`，輸入訊息，`Ctrl+Enter` 提交：只有第一個 hunk 與 todo.ts 進入 commit；第二個 hunk 仍在工作區；內建原始檔控制的暫存狀態不受影響
- [ ] 同時勾選 api-server 與 web-app 的檔案提交：兩個 repo 各產生一個相同訊息的 commit
- [ ] 「修改上一次提交（Amend）」：勾選後帶入上一個 commit 的訊息；提交後 Log 中原 commit 被取代
- [ ] 提交選項：加上 Signed-off-by、略過 Git hooks（在 `.git/hooks/pre-commit` 放 `exit 1` 驗證）
- [ ] 「提交並推送…」：提交後開啟 Push 分頁
- [ ] 右鍵「捨棄變更…」：先確認；修改與刪除的檔案還原，新增的檔案變回未追蹤
- [ ] 右鍵未追蹤的檔案「加入 .gitignore」：該檔移到已忽略
- [ ] 分組依據：目錄／儲存庫／模組（`packages/sdk` 為獨立模組）；樹狀／平鋪
- [ ] Changelist：新增、重新命名、刪除、設為使用中；把檔案移到另一個 changelist；新變更進入使用中的 changelist；重新載入視窗後保留
- [ ] 在終端機修改檔案或 `git add`：列表約 0.5 秒內自動更新
- [ ] 沒有勾選檔案或沒有訊息時，提交按鈕停用

## 互動式 rebase
- [ ] 在 api-server main 往前數第 3 個 commit 右鍵「從這裡開始互動式重訂基底…」：開在編輯器分頁，列出之後的 commit
- [ ] 各列可選 pick／reword／edit／squash／fixup／drop；單鍵快速切換；拖曳或 `Alt+↑↓` 調整順序
- [ ] reword：直接修改訊息，完成後 Log 中訊息已更新
- [ ] squash／fixup：合併進上一個 commit
- [ ] edit：rebase 停下後 Log 上方出現「api-server：重訂基底進行中」列，按「繼續」完成
- [ ] 有未提交的變更時仍可 rebase，結束後變更還在（自動儲藏）
- [ ] rebase 分頁開著時另外提交一筆，再按開始：提示分支已變動並重新載入清單（不會丟掉新提交）
- [ ] detached HEAD 或範圍內有 merge commit 時拒絕並說明

## 進行中的操作
- [ ] web-app 把 `conflict/theme` 合併到 main 造成衝突：Log 上方出現「web-app：合併進行中」，有繼續／中止；在原始檔控制解決衝突後按繼續完成
- [ ] Rebase 衝突時另有「略過」
- [ ] 按「中止」先跳出確認框（紅色按鈕）；確認後恢復原狀，提示列消失
- [ ] 合併進行中時，在提交視窗只勾部分檔案提交：被拒絕並提示改用「繼續」

## Issue 連結
- [ ] 設定 `"gitWorkbench.issueLinks": [{ "pattern": "PROJ-(\\d+)", "url": "https://tracker.example.com/browse/PROJ-$1" }]`：api-server `feat(auth): add API keys` 詳情中的 `PROJ-42` 變成連結，點擊以瀏覽器開啟
- [ ] 在遠端為 GitHub／GitLab 的實際 repo，不設定時 `#123` 連到該 repo 的 issues 頁面（playground 的遠端是本機資料夾，所以不會有連結，屬預期）

## Git Blame
- [ ] 編輯器右鍵「切換 Git Blame 標註」：顯示／隱藏 VS Code 內建的 blame（`git.blame.editorDecoration.enabled`）
