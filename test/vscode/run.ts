// 真實 VS Code 自動化測試的啟動程式：下載 VS Code、建立 playground、以乾淨的使用者設定開啟並執行 suite/
// 用法：npm run test:vscode
//   VSCODE_VERSION=1.90.0  指定 VS Code 版本（預設 stable）
//   GWB_GREP=diff          只跑名稱含這段文字的測試
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

const ROOT = path.resolve(__dirname, '..', '..');

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(tmpdir(), 'gwb-vscode-'));
  const playground = path.join(tmp, 'playground');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-playground.mjs'), playground], { stdio: 'ignore' });

  // 乾淨的使用者設定：不受本機設定、其他擴充功能影響
  const userData = path.join(tmp, 'user-data');
  mkdirSync(path.join(userData, 'User'), { recursive: true });
  writeFileSync(
    path.join(userData, 'User', 'settings.json'),
    JSON.stringify(
      {
        'gitWorkbench.language': 'en',
        'security.workspace.trust.enabled': false,
        'workbench.startupEditor': 'none',
        'workbench.tips.enabled': false,
        'git.autofetch': false,
        'git.openRepositoryInParentFolders': 'never',
        'extensions.autoUpdate': false,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
      },
      null,
      2,
    ),
  );

  let failed = false;
  try {
    await runTests({
      version: process.env.VSCODE_VERSION || 'stable',
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(__dirname, 'suite', 'index.js'),
      launchArgs: [playground, '--user-data-dir', userData, '--extensions-dir', path.join(tmp, 'extensions'), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu'],
      extensionTestsEnv: { GWB_PLAYGROUND: playground, GWB_GREP: process.env.GWB_GREP ?? '' },
    });
  } catch (e) {
    failed = true;
    console.error(e instanceof Error ? e.message : e);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows 上 VS Code 剛結束時檔案可能仍被鎖住；暫存資料夾留給系統清理
    }
  }
  if (failed) process.exit(1);
}

void main();
