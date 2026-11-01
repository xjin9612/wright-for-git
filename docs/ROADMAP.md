# 待辦清單（Roadmap）

已完成：1.0.0（Log／Branches／詳情三欄、篩選、Highlight、多 repo、顯示 Git 歷史、自動發佈）

1.1.0：階段二～六、Git 主控台、面板內設定框、無障礙與介面收斂。之後的項目見最下方。

---

## 與 VS Code 內建 Git 的差距

| 功能 | 內建 Git | Git Workbench | 規劃 |
|---|---|---|---|
| 歷史與 graph | Source Control Graph（較陽春） | ✅ 完整 | — |
| 多 repo 合併檢視 | 各 repo 分開 | ✅ | — |
| 檔案歷史 | Timeline | ✅ 顯示 Git 歷史 | — |
| Checkout branch | ✅ | ✅ | — |
| Fetch／Pull／Push／Sync、ahead/behind | ✅ | ✅ 1.1.0 | — |
| Branch 建立／改名／刪除／merge／rebase | ✅ | ✅ | — |
| Commit 操作：cherry-pick／revert／reset／建 tag | 部分（指令面板） | ✅ 1.1.0 | — |
| Stash 建立／套用／刪除 | ✅ | ✅ | — |
| 變更清單、部分提交、discard、commit／amend | ✅（stage 模型） | ✅ Commit 視窗（勾選模型，不動暫存區） | — |
| Blame | ✅ 內建 | ✅ 右鍵切換內建 blame | — |
| 合併衝突處理 | ✅ 合併編輯器 | ✅ 1.1.0 衝突清單與三方合併（可改用內建合併編輯器） | — |
| 編輯器行號旁的變更標示 | ✅ | ❌ | 沿用內建 |
| Clone／Init／Remote 管理 | ✅ | ❌ | 沿用內建 |

定位：**歷史、branch、同步、stash、commit、合併衝突由 Git Workbench 負責（IntelliJ 式勾選提交）；內建 Source Control 仍可並用**——Commit 視窗透過暫時 index 提交，不改動內建的暫存區狀態。行號旁的變更標示綁定 VS Code 的 SCM 介面，重做的成本高且會和內建重複。

---

## 階段二：取代內建的日常操作

| # | 項目 | 說明 |
|---|---|---|
| 2.1 | ✅ 同步（1.1.0） | Fetch 在 Branches 工具列；Pull／Push 在 Log 工具列；Push 先開對話框（待推 commit、檔案、Push tags、下拉 Force Push）；右鍵 Push All up to Here；Branches 樹顯示 ahead／behind（↑↓）；多 repo 時一次對所選 repo 執行 |
| 2.2 | ✅ Branch 右鍵選單 | Checkout、New Branch from…、Rename、Delete、Merge into Current、Rebase Current onto、Compare with Current、Push、Pull |
| 2.3 | ✅ Commit 右鍵選單（1.1.0） | Cherry-pick、Revert、Reset Current Branch to Here（soft／mixed／hard）、New Branch、New Tag、Compare with Local |
| 2.4 | ✅ Stash | Commit 視窗的「儲藏」分頁：清單、檢視內容、Apply／Pop／Drop／Clear、從 Stash 建立 Branch、Stash 目前變更；檔案總管右鍵取消儲藏對話框 |
| 2.5 | ✅ 多選 commit | `Ctrl`／`Shift` 多選，右欄顯示合併後的變更 |
| 2.6 | ✅ 篩選提示 | 目前 branch 被 Branch 篩選排除時提示「HEAD 不在篩選中」，一鍵切回 |
| 2.7 | ✅ Date 篩選 | 最近 24 小時／7 天／30 天、自訂區間 |
| 2.8 | ✅ Favorite | 手動標記或取消 ★、置頂、「只顯示 favorite」 |

## 階段三：體驗補強

| # | 項目 | 說明 |
|---|---|---|
| 3.1 | ✅ 欄寬拖曳 | Author、Date、Hash 欄可拖曳調整並記憶 |
| 3.2 | ✅ 篩選下的 graph | 文字／User 篩選時畫簡化連線 |
| 3.3 | ✅ 多個 Log 分頁 | 各分頁保留自己的篩選條件 |
| 3.4 | ✅ Diff 導覽 | diff 內切換上一個／下一個變更檔案 |
| 3.5 | ✅ 檔案樹顯示 | 樹狀／平鋪切換、依檔案類型顯示圖示 |
| 3.6 | ✅ 繁中介面 | Webview 內文字接上 l10n |

## 階段四：進階

| # | 項目 | 說明 |
|---|---|---|
| 4.1 | ✅ Interactive rebase | pick／reword／edit／squash／fixup／drop、拖曳或 `Alt+↑↓` 調整順序；進行中的 rebase／merge 在 Log 上方顯示繼續／略過／中止 |
| 4.2 | ✅ Annotate（blame） | 沿用 VS Code 內建 blame，編輯器右鍵切換（不重做） |
| 4.3 | ✅ Issue 連結 | `gitWorkbench.issueLinks` 自訂規則；預設 `#123` 連到遠端 issues |
| 4.4 | ◐ 路徑高亮 | ✅ 選取 commit 時淡化不在其路徑上的列；長線性分支折疊未做 |

## 階段五：IntelliJ 風格 Commit 視窗 ✅

側邊欄 Commit 視窗（`Alt+0`）：勾選提交、部分提交（hunk）、Changelist、未追蹤／已忽略檔案、依目錄／repo／模組分組、Amend／Sign-off／略過 hooks、提交並推送、捨棄變更。透過暫時 index 提交，避免與內建 Source Control 的暫存區互相干擾。

## 階段六：合併衝突處理 ✅（1.1.0）

| # | 項目 | 說明 |
|---|---|---|
| 6.1 | ✅ 提交視窗的衝突群組 | 右鍵：開啟合併工具、接受我的／他們的、標記已解決；一邊刪除一邊修改的衝突只給保留／刪除；「合併進行中」提示條的「解決衝突…」 |
| 6.2 | ✅ 衝突清單分頁 | 各 repo 的衝突檔案；全部解決後直接繼續 |
| 6.3 | ✅ 三方合併分頁 | 我的／結果／他們的三欄；衝突區塊 ≫ ✕，「逐行」模式每行各自 ≫ ✕；結果欄可直接編輯；可改用 VS Code 合併編輯器；merge、rebase、cherry-pick、取消儲藏共用 |

## 其他已完成（1.1.0）

- Branches 工具列照 IntelliJ 順序、分組與點選行為選項；Branch 篩選串接選單
- Paths 篩選：Roots 勾選與跨 repo 資料夾選擇；repo 名稱欄
- Push、取消儲藏、hunk 選擇、互動式 rebase 改開在編輯器分頁
- 確認框顯示在面板內；介面語言可獨立切換（英文／繁中）
- 檔案總管右鍵 Git Workbench 子選單
- Git 主控台：「輸出」面板的 Git Workbench 頻道記錄每個 git 指令、耗時與失敗原因；錯誤通知可直接開啟
- 面板內設定框：Git 記錄與提交視窗標題列的齒輪，語言切換立即生效
- 無障礙：右鍵選單可用鍵盤操作（Shift+F10／選單鍵、方向鍵、Enter、Esc）、高對比主題、減少動態效果
- 介面收斂：狀態字母與線條圖示、提交類型只為 feat／fix／revert 上色、4px 間距與圓角一致

## 工程與發佈

| # | 項目 | 說明 |
|---|---|---|
| 5.1 | ✅ 上 GitHub | `xjin9612/vscode-git-workbench`，1.0.0 已發佈 |
| 5.2 | CI | ✅ GitHub Actions：typecheck、測試、打包（Windows／Linux）；推 tag 自動發佈 Release |
| 5.3 | ◐ 整合測試 | ✅ `npm run test:ui`：Playwright 操作真實 webview＋真實 git（VS Code API 模擬）；◐ `npm run test:vscode`：真實 VS Code（`@vscode/test-electron`）中的 diff、指令、檔案監看、內建 Git 整合，已加入 CI，待第一次在 Windows／CI 上驗證 |
| 5.4 | 大型 repo 效能 | 模擬環境 10 萬 commit：首屏約 1.4 秒、全部載入約 6.4 秒；待實測 VS Code 內的數字，再評估提示 `git commit-graph write` |
| 5.5 | Marketplace 發佈 | publisher 帳號、英文 CHANGELOG |

---

## 1.1.0 之後

| # | 項目 | 說明 |
|---|---|---|
| 4.4 | 長線性分支折疊 | 路徑高亮已完成；折疊需要調整 graph 版面 |
| 5.3 | ◐ 真實 VS Code 測試 | 進行中（見上方 5.3） |
| 5.4 | 大型 repo 效能實測 | 在 VS Code 內量測後再評估提示 `git commit-graph write` |
| 5.5 | Marketplace 發佈 | 建立 publisher 帳號；目前以 GitHub Release 發佈 |
