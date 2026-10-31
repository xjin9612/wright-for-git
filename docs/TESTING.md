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
- `api-server`：main 領先遠端 2 筆；`feature/rate-limit` 尚未推送（New）；`experiment/cache` 未合併；`old/merged-work` 已合併；tag `v1.0.0`（annotated）、`v1.1.0`；有 rename、刪除、中文檔名
- `api-server/libs/shared`：巢狀 repo
- `web-app`：main 落後遠端 1 筆；2 個 stash（其中一個含未追蹤檔案）；`conflict/theme` 與 main 改同一行（merge／rebase／cherry-pick 會衝突）
- 兩個 repo 都有 `feature/checkout`（同名 branch 合併顯示）
- `notes`：一般資料夾，不是 repo
- 作者 Alice／Bob／Carol／Dave，時間分布在最近 4 個月；「我」是 Alice
以下項目請在 Windows 的 VS Code 中逐一確認；安裝或更新 `.vsix` 後先執行「開發人員: 重新載入視窗」。

## 開啟與版面
- [ ] 活動列 Git Workbench 圖示：側邊欄出現 Repositories，底部 Log 面板同時開啟
- [ ] 狀態列「Git Log」按鈕與 `Alt+9` 都能開啟 Log 面板
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

## Stash（側邊欄 Stashes）
- [ ] 標題列「Stash 變更…」：選 repo、選模式（已追蹤／含未追蹤／保留已 stage）、輸入說明 → 出現在清單
- [ ] 沒有變更時提示「沒有可 stash 的本機變更」
- [ ] 展開 stash 看到檔案（未追蹤檔案標示「未追蹤」），點檔案開 diff
- [ ] 行內按鈕 Apply／Pop／刪除；右鍵「套用並還原 Staged 狀態」「從 Stash 建立 Branch…」
- [ ] Pop 遇到衝突時提示，stash 保留
- [ ] 在終端機執行 `git stash` 後清單自動更新

## 變更檔案與 Diff
- [ ] 右欄工具列切換樹狀／平鋪；檔案依類型顯示圖示（TS、JS、{}、M↓…）
- [ ] 從 Log 開啟 diff 後，編輯器標題列有 ↑↓ 按鈕，可切換上一個／下一個變更檔案；`Ctrl+Alt+PageUp／PageDown` 也可以
- [ ] 第一個／最後一個檔案時，狀態列提示已到底

## 繁中介面
- [ ] VS Code 顯示語言為繁體中文時，面板內的按鈕、選單、提示、Push 對話框都是中文；英文時維持英文
