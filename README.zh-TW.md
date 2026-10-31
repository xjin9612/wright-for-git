# Git Workbench

[![CI](https://github.com/xjin9612/vscode-git-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/xjin9612/vscode-git-workbench/actions/workflows/ci.yml)

[English](README.md) | 繁體中文

在 VS Code 底部 Panel 重現 IntelliJ 的 Git Log 視窗：**Branches 樹｜Commit Log（含 graph）｜變更檔案＋Commit 詳情**，三欄連動。

![Git Workbench](docs/images/screenshot.png)

## 功能

- **Branches**：Local／Remote／Tags 樹狀顯示，依 `/` 自動分資料夾；搜尋、定位目前 branch、展開／收合；點選即篩選 Log，雙擊 checkout
- **Commit Log**
  - Commit graph（lane 分配與著色、HEAD 標記）
  - Ref 標籤：同名 local／remote 合併顯示（`origin & main`）、tag、detached HEAD
  - 篩選：文字或 hash（支援 regex、大小寫）、Branch、User（支援 `me`）、Paths；多值以 `|` 或換行分隔，`Enter` 補完、`Ctrl+Enter` 完成
  - Highlight：Conventional Commits 類型上色、我的 commit 粗體、merge commit 淡化
  - 欄位：Author（author ≠ committer 時標 `*`）、Date、Hash，可在 👁 選單切換
  - 虛擬捲動，串流分批載入
  - 右鍵：複製 hash／subject、checkout revision
- **變更檔案**：樹狀（壓縮單一子目錄、檔案數；新增綠、修改藍、刪除灰），雙擊或 Enter 開啟 VS Code 原生 diff
- **Commit 詳情**：完整 message、作者／提交者、refs、包含此 commit 的 branch
- 開啟方式：左側活動列 Git Workbench 圖示、狀態列「Git Log」按鈕、`Alt+9`
- 檔案總管／編輯器右鍵「顯示 Git 歷史」：自動切到該檔所屬的 repository 並以 Paths 篩選
- branch、tag、HEAD 變動時自動重新整理

## 多 repo

- 自動掃描每個工作區資料夾底下的 repo（`gitWorkbench.scanDepth`、`gitWorkbench.scanExclude`），包含 repo 內的巢狀 repo
- 多個 repo 的 commit 依時間合併顯示，每列左側色條標示所屬 repo（滑鼠移上去顯示名稱）
- **Paths** 篩選：第一層勾選要顯示的 repo；只選一個 repo 時可再展開子資料夾（等同 IntelliJ 多 root 的 Paths）
- 側邊欄 **Repositories** 的勾選與 Paths 篩選同步
- 多個 repo 都有的同名 branch 在 Branches 樹中合併為一筆，雙擊一次 checkout 全部

## 快捷鍵（Log 面板內）

| 按鍵 | 動作 |
|---|---|
| `↑` `↓` `PageUp` `PageDown` `Home` `End` | 移動選取的 commit |
| `Ctrl+C` | 複製選取 commit 的 hash |
| `Ctrl+F` | 聚焦搜尋框 |
| `Esc`（搜尋框內） | 清除文字篩選 |

## 設定

| 設定 | 預設 | 說明 |
|---|---|---|
| `gitWorkbench.maxCommits` | `50000` | Log 最多載入的 commit 數（所有 repo 合計，上限 200000） |
| `gitWorkbench.autoRefresh` | `true` | refs／HEAD 變動時自動重新整理 |
| `gitWorkbench.scanDepth` | `3` | 工作區資料夾往下掃描 repo 的層數 |
| `gitWorkbench.scanExclude` | `node_modules`、`target`… | 掃描時略過的資料夾名稱 |

## 安裝

從 [Releases](https://github.com/xjin9612/vscode-git-workbench/releases) 下載 `.vsix`，在 VS Code 執行「延伸模組: 從 VSIX 安裝…」，安裝或更新後請「重新載入視窗」。

## 開發

```bash
npm install
npm run build       # 建置 dist/
npm run typecheck   # 型別檢查（extension 與 webview）
npm test            # 單元與整合測試（需要 git）
npm run package     # 打包 .vsix
```

在 VS Code 開啟此資料夾按 `F5` 啟動 Extension Development Host。

### 發佈新版本

1. 修改 `package.json` 的 `version`，並在 `CHANGELOG.md` 最上方新增同版本的段落（`## 1.1.0`）
2. commit 後打 tag 並推送：`git tag v1.1.0 && git push origin v1.1.0`
3. GitHub Actions（`.github/workflows/release.yml`）會檢查版本、跑測試、打包 `.vsix`，並以 CHANGELOG 該段落建立 Release

tag 版本與 `package.json` 不一致、或 CHANGELOG 沒有對應段落時，發佈會失敗。版本含 `-`（如 `v1.1.0-beta.1`）會標為 pre-release。

### 架構

```
src/
  extension.ts        進入點：註冊 WebviewView、唯讀檔案系統、指令
  provider.ts         WebviewView：repo 管理、訊息處理、自動重新整理、checkout
  diffProvider.ts     git-workbench: 唯讀檔案系統，提供某 revision 的檔案內容給 vscode.diff
  sidebar.ts          活動列 Repositories 清單與狀態列按鈕
  gitExtension.ts     取得內建 Git 擴充套件的 git 路徑與狀態事件
  git/                git CLI 執行與輸出解析（不依賴 vscode，可直接測試）
  shared/             extension 與 webview 共用：訊息協定、graph 佈局、ref 標籤、樹
  webview/            三欄 UI（原生 TypeScript + Canvas，無前端框架）
media/webview.css     樣式，顏色全部取自 VS Code 主題變數
```

## 授權

MIT

本專案受 IntelliJ IDEA 的 Git 工具視窗啟發，與 JetBrains 無關聯。
