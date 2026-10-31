# 待辦清單（Roadmap）

已完成：1.0.0（Log／Branches／詳情三欄、篩選、Highlight、多 repo、顯示 Git 歷史、自動發佈）；下一版 1.1.0（CHANGELOG 的 Unreleased）：階段二～五全部項目（4.4 的長線性分支折疊除外）

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
| 編輯器行號旁的變更標示、merge 衝突編輯器 | ✅ | ❌ | 沿用內建 |
| Clone／Init／Remote 管理 | ✅ | ❌ | 沿用內建 |

定位：**歷史、branch、同步、stash、commit 由 Git Workbench 負責（IntelliJ 式勾選提交）；內建 Source Control 仍可並用**——Commit 視窗透過暫時 index 提交，不改動內建的暫存區狀態。行號旁的變更標示與衝突編輯器綁定 VS Code 的 SCM 介面，重做的成本高且會和內建重複。

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

## 其他已完成（1.1.0）

- Branches 工具列照 IntelliJ 順序、分組與點選行為選項；Branch 篩選串接選單
- Paths 篩選：Roots 勾選與跨 repo 資料夾選擇；repo 名稱欄
- Push、取消儲藏、hunk 選擇、互動式 rebase 改開在編輯器分頁
- 確認框顯示在面板內；介面語言可獨立切換（英文／繁中）
- 檔案總管右鍵 Git Workbench 子選單

## 工程與發佈

| # | 項目 | 說明 |
|---|---|---|
| 5.1 | ✅ 上 GitHub | `xjin9612/vscode-git-workbench`，1.0.0 已發佈 |
| 5.2 | CI | ✅ GitHub Actions：typecheck、測試、打包（Windows／Linux）；推 tag 自動發佈 Release |
| 5.3 | 整合測試 | `@vscode/test-electron` 在真實 VS Code 中跑主要流程 |
| 5.4 | 大型 repo 效能 | 模擬環境 10 萬 commit：首屏約 1.4 秒、全部載入約 6.4 秒；待實測 VS Code 內的數字，再評估提示 `git commit-graph write` |
| 5.5 | Marketplace 發佈 | publisher 帳號、英文 CHANGELOG |
