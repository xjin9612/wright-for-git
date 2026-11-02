// 建置腳本：extension（Node/CJS）、webview（瀏覽器/IIFE）、單元測試、真實 VS Code 測試
import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions[]} */
const vscodeTests = [
  // 真實 VS Code 自動化測試：啟動程式（Node）與在 VS Code 裡面執行的測試
  { ...common, entryPoints: ['test/vscode/run.ts'], outfile: 'out/vscode/run.js', platform: 'node', format: 'cjs', target: 'node20', external: ['@vscode/test-electron'], sourcemap: true, minify: false },
  { ...common, entryPoints: ['test/vscode/suite/index.ts'], outfile: 'out/vscode/suite/index.js', platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: true, minify: false },
  { ...common, entryPoints: ['test/vscode/bench/index.ts'], outfile: 'out/vscode/bench/index.js', platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: true, minify: false },
];

const targets = args.has('--vscode-tests')
  ? vscodeTests
  : args.has('--tests')
  ? [{
      ...common,
      entryPoints: readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => `test/${f}`),
      outdir: 'out/test',
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      sourcemap: true,
      minify: false,
    }]
  : [
      {
        ...common,
        entryPoints: ['src/extension.ts'],
        outfile: 'dist/extension.js',
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['vscode'],
      },
      {
        ...common,
        entryPoints: ['src/webview/main.ts'],
        outfile: 'dist/webview.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
      },
      {
        ...common,
        entryPoints: ['src/webview/commitMain.ts'],
        outfile: 'dist/commit.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
      },
      {
        ...common,
        entryPoints: ['src/webview/branchesMain.ts'],
        outfile: 'dist/branches.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
      },
      {
        ...common,
        entryPoints: ['src/webview/dialogMain.ts'],
        outfile: 'dist/dialog.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
      },
    ];

if (watch) {
  for (const t of targets) {
    const ctx = await esbuild.context(t);
    await ctx.watch();
  }
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
}
