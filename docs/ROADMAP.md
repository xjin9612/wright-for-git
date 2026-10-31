# 待辦清單（Roadmap）

已完成：1.0.0（Log／Branches／詳情三欄、篩選、Highlight、多 repo、顯示 Git 歷史、自動發佈）、1.1.0（同步、Commit 右鍵），詳見 CHANGELOG

---

## 與 VS Code 內建 Git 的差距

| 功能 | 內建 Git | Git Workbench | 規劃 |
|---|---|---|---|
| 歷史與 graph | Source Control Graph（較陽春） | ✅ 完整 | — |
| 多 repo 合併檢視 | 各 repo 分開 | ✅ | — |
| 檔案歷史 | Timeline | ✅ 顯示 Git 歷史 | — |
| Checkout branch | ✅ | ✅ | — |
| Fetch／Pull／Push／Sync、ahead/behind | ✅ | ✅ 1.1.0 | — |
| Branch 建立／改名／刪除／merge／rebase | ✅ | ❌ | 階段二 |
| Commit 操作：cherry-pick／revert／reset／建 tag | 部分（指令面板） | ✅ 1.1.0 | — |
| Stash 建立／套用／刪除 | ✅ | ❌ | 階段二 |
| 變更清單、stage／unstage、discard、commit／amend | ✅ | ❌ | 階段五（評估） |
| 編輯器行號旁的變更標示、merge 衝突編輯器 | ✅ | ❌ | 沿用內建 |
| Clone／Init／Remote 管理 | ✅ | ❌ | 沿用內建 |

建議定位：**歷史、branch、同步、stash 由 Git Workbench 負責；工作區變更與 commit 繼續用內建 Source Control**（IntelliJ 也是把 Log 與 Commit 分成兩個視窗）。行號旁的變更標示與衝突編輯器綁定 VS Code 的 SCM 介面，重做的成本高且會和內建重複。

---

## 階段二：取代內建的日常操作

| # | 項目 | 說明 |
|---|---|---|
| 2.1 | ✅ 同步（1.1.0） | Fetch 在 Branches 工具列；Pull／Push 在 Log 工具列；Push 先開對話框（待推 commit、檔案、Push tags、下拉 Force Push）；右鍵 Push All up to Here；Branches 樹顯示 ahead／behind（↑↓）；多 repo 時一次對所選 repo 執行 |
| 2.2 | Branch 右鍵選單 | Checkout、New Branch from…、Rename、Delete、Merge into Current、Rebase Current onto、Compare with Current、Push、Pull |
| 2.3 | ✅ Commit 右鍵選單（1.1.0） | Cherry-pick、Revert、Reset Current Branch to Here（soft／mixed／hard）、New Branch、New Tag、Compare with Local |
| 2.4 | Stash | 底部面板新增 Stash 分頁：清單、檢視內容、Apply／Pop／Drop、Stash 目前變更 |
| 2.5 | 多選 commit | `Ctrl`／`Shift` 多選，右欄顯示合併後的變更 |
| 2.6 | 篩選提示 | 目前 branch 被 Branch 篩選排除時提示「HEAD 不在篩選中」，一鍵切回 |
| 2.7 | Date 篩選 | 最近 24 小時／7 天／30 天、自訂區間 |
| 2.8 | Favorite | 手動標記或取消 ★、置頂、「只顯示 favorite」 |

## 階段三：體驗補強

| # | 項目 | 說明 |
|---|---|---|
| 3.1 | 欄寬拖曳 | Author、Date、Hash 欄可拖曳調整並記憶 |
| 3.2 | 篩選下的 graph | 文字／User 篩選時畫簡化連線 |
| 3.3 | 多個 Log 分頁 | 各分頁保留自己的篩選條件 |
| 3.4 | Diff 導覽 | diff 內切換上一個／下一個變更檔案 |
| 3.5 | 檔案樹顯示 | 樹狀／平鋪切換、依檔案類型顯示圖示 |
| 3.6 | 繁中介面 | Webview 內文字接上 l10n |

## 階段四：進階

| # | 項目 |
|---|---|
| 4.1 | Interactive rebase（reword、squash、fixup、drop、調整順序） |
| 4.2 | Annotate（blame）——新版 VS Code 已有內建 blame，需先評估是否重複 |
| 4.3 | Commit message 中的 issue 編號轉連結 |
| 4.4 | 點選 lane 高亮整條分支路徑、長線性分支折疊 |

## 階段五（評估中）：IntelliJ 風格 Commit 視窗

變更清單（changelist）、部分提交（hunk 勾選）、commit／amend。需評估與內建 Source Control 的分工，避免兩套 stage 狀態互相干擾。

## 工程與發佈

| # | 項目 | 說明 |
|---|---|---|
| 5.1 | ✅ 上 GitHub | `xjin9612/vscode-git-workbench`，1.0.0 已發佈 |
| 5.2 | CI | ✅ GitHub Actions：typecheck、測試、打包（Windows／Linux）；推 tag 自動發佈 Release |
| 5.3 | 整合測試 | `@vscode/test-electron` 在真實 VS Code 中跑主要流程 |
| 5.4 | 大型 repo 效能 | 實測 VS Code 內的載入時間；提示或自動執行 `git commit-graph write` |
| 5.5 | Marketplace 發佈 | publisher 帳號、英文 CHANGELOG |
