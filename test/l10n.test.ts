// 翻譯完整性：程式中用到的 t()／plural() 字串都有繁中翻譯；package.json 的 %key% 在兩個 nls 檔都存在
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** 單引號字串字面值 → 實際內容 */
const unquote = (s: string) => s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));

test('t()／plural() 的字串都在 bundle.l10n.zh-tw.json', () => {
  const bundle = JSON.parse(readFileSync(path.join(ROOT, 'l10n', 'bundle.l10n.zh-tw.json'), 'utf8')) as Record<string, string>;
  const missing = new Set<string>();
  let found = 0;
  // 單引號或雙引號的字串字面值；樣板字串（`…`）不能翻譯，另外檢查
  const str = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;
  const tCall = new RegExp(String.raw`\bt\(\s*${str}`, 'g');
  const pluralCall = new RegExp(String.raw`\bplural\([^,]+,\s*${str}\s*,\s*${str}`, 'g');
  const templateCall = /\b(?:t|plural)\(\s*(?:[^,()]+,\s*)?`/g;
  for (const file of sources(path.join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(tCall)) {
      found++;
      const key = m[1] ?? m[2];
      if (!(unquote(key) in bundle)) missing.add(`${path.relative(ROOT, file)}: ${key}`);
    }
    for (const m of text.matchAll(pluralCall)) {
      for (const k of [m[1] ?? m[2], m[3] ?? m[4]]) if (!(unquote(k) in bundle)) missing.add(`${path.relative(ROOT, file)}: ${k}`);
    }
    for (const m of text.matchAll(templateCall)) missing.add(`${path.relative(ROOT, file)}: 樣板字串無法翻譯：${m[0]}`);
  }
  assert.ok(found > 300, `只找到 ${found} 個 t() 呼叫，比對規則可能失效`);
  assert.deepEqual([...missing], []);
});

test('package.json 的 %key% 在 package.nls.json 與 package.nls.zh-tw.json 都有', () => {
  const pkg = readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  const keys = [...pkg.matchAll(/"%([^"%]+)%"/g)].map((m) => m[1]);
  for (const f of ['package.nls.json', 'package.nls.zh-tw.json']) {
    const nls = JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')) as Record<string, string>;
    assert.deepEqual(
      keys.filter((k) => !(k in nls)),
      [],
      f,
    );
  }
});

test('打包設定包含所有 webview bundle', () => {
  const ignore = readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
  const build = readFileSync(path.join(ROOT, 'esbuild.mjs'), 'utf8');
  const outputs = [...build.matchAll(/outfile:\s*'dist\/([^']+\.js)'/g)].map((m) => m[1]);
  assert.ok(outputs.length >= 4, `outfile 數量：${outputs.length}`);
  assert.match(ignore, /!dist\/\*\.js/);
});
