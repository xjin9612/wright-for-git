// VS Code 載入的測試進入點（extensionTestsPath）：依序載入各測試檔後執行
import './activation.test';
import './diff.test';
import './commands.test';
import './watch.test';
import './repos.test';
import './merge.test';
import { runAll } from './harness';

export function run(): Promise<void> {
  return runAll();
}
