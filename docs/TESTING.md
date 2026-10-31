# 手動測試清單（發佈前在真實 VS Code 執行）

自動化測試涵蓋 git 解析、graph、多 repo 合併與 webview 渲染，但無法啟動真實 VS Code。
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
