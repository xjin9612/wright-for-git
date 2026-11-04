# 參與開發

[English](CONTRIBUTING.md) | 繁體中文

## 開發

```bash
npm install
npm run build       # 建置 dist/
npm run typecheck   # 型別檢查（extension 與 webview）
npm test            # 單元與整合測試（需要 git）
npm run test:ui     # UI 端對端測試（Chromium；第一次執行會自動下載）
npm run test:vscode # 在真實 VS Code 中執行的測試（第一次會下載 VS Code）
npm run bench:vscode # 大型 repo 載入效能量測（見 docs/TESTING.md）
npm run package     # 打包 .vsix
npm run check       # 依序跑型別檢查、所有測試與打包（不含效能量測），任一步失敗就停止
```

在 VS Code 開啟此資料夾按 `F5` 啟動 Extension Development Host。

測試分為單元、UI、真實 VS Code 與手動四層，各自涵蓋的範圍與手動測試用的範例 repo 見 [docs/TESTING.md](docs/TESTING.md)：

```bash
node scripts/make-playground.mjs        # 手動測試清單用的範例 repo
node scripts/make-shelf-fixture.mjs init # 擱置手動測試用的 repo
node scripts/make-icon.mjs               # 由 assets/icon.svg 重新產生 media/icon.png
```

## 發佈新版本

1. 修改 `package.json` 的 `version`（**版號規則**：只用 `major.minor.patch`；minor 偶數＝正式版、奇數＝預發布版，例如正式版 `1.4.0`、預發布 `1.5.0`），並在 `CHANGELOG.md`（英文，作為 Release 說明）最上方新增同版本的段落（`## 1.2.0`；開發中的變更先記在 `## Unreleased`，發佈時改成版本號）
2. commit 後打 tag 並推送：`git tag v1.2.0 && git push origin v1.2.0`
3. GitHub Actions（`.github/workflows/release.yml`）會檢查版本、跑測試、打包 `.vsix`，並以 CHANGELOG 該段落建立 Release

tag 版本與 `package.json` 不一致、或 CHANGELOG 沒有對應段落時，發佈會失敗。版號規則由 `scripts/check-version.mjs` 檢查（CI 與發佈都會跑）：含 `-`（如 `1.4.0-beta.1`）直接失敗，因為 VS Code Marketplace 不支援；minor 為奇數會標為 pre-release。

## 架構

```
src/
  extension.ts        進入點：註冊 WebviewView、唯讀檔案系統、指令
  provider.ts         Git Log WebviewView：repo 管理、訊息處理、自動重新整理、checkout
  commitView.ts       Commit 視窗 WebviewView：工作區變更、Changelist、提交
  branchesView.ts     側邊欄 Branches WebviewView：轉送 Log 的分支狀態與操作
  dialogPanel.ts      開在編輯器分頁的對話框：Push、取消儲藏、選擇 hunk、互動式 rebase、衝突清單、三方合併
  conflicts.ts        合併衝突：衝突清單、三方合併、整個檔案採用某一邊、標記已解決
  actions.ts          面板與對話框共用的 branch、commit、push 操作
  dialogs.ts          確認框：顯示在 Log 面板內（退回 VS Code 的 modal）
  stashView.ts        提交視窗與檔案總管共用的儲藏操作
  explorerCommands.ts 檔案總管右鍵：與分支或標籤比較、儲藏、取消儲藏
  gitConsole.ts       Git 主控台：在「輸出」面板記錄每個 git 指令
  optimize.ts         「最佳化儲存庫」指令（寫入 commit-graph）
  shelf.ts            跨 repo 的擱置：擱置、取回、改名、刪除、匯出與匯入 patch
  fileTreeFocus.ts    變更檔案樹的焦點與選取的檔案，供 F4 等可改鍵的快速鍵使用
  util.ts             不依賴 vscode 的小工具
  settingsBridge.ts   面板內的設定框
  modules.ts          「模組」分組（最近一個含專案檔的資料夾）
  i18n.ts             介面語言（跟隨 VS Code 或 wright.language）
  diffProvider.ts     wright: 唯讀檔案系統，提供某 revision 的檔案內容給 vscode.diff
  sidebar.ts          狀態列按鈕與「顯示全部儲存庫」指令
  gitExtension.ts     取得內建 Git 擴充套件的 git 路徑與狀態事件
  testApi.ts          只給真實 VS Code 測試用的狀態與操作介面
  git/                git CLI 執行、輸出解析、三方合併（不依賴 vscode，可直接測試）
  shared/             extension 與 webview 共用：訊息協定、graph 佈局、長線性分支折疊、ref 標籤、樹
  webview/            Log 面板、側邊欄 Branches、提交視窗與對話框的 UI（原生 TypeScript + Canvas，無前端框架）
media/webview.css     樣式，顏色全部取自 VS Code 主題變數
```
