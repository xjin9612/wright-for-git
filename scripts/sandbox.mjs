// 手動測試用的範例 repo 統一放在專案旁邊的 vscode-git-workbench-test 資料夾（不放在專案資料夾的上一層到處都是）：
//   <上一層>/vscode-git-workbench-test/
//     playground/            make-playground.mjs（手動測試清單用）
//     playground-remotes/    playground 的遠端與模擬的另一台電腦
//     large-repo/            make-large-repo.mjs（大型 repo、長線性分支折疊）
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SANDBOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vscode-git-workbench-test');
