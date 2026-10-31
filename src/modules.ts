// 「模組」分組：VS Code 沒有 IntelliJ 的模組概念，這裡以「最近一個含專案檔的資料夾」當作模組
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

const MANIFESTS = ['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'composer.json', 'Gemfile', 'mix.exs', 'pubspec.yaml', 'CMakeLists.txt'];
const MANIFEST_EXT = ['.csproj', '.fsproj', '.vbproj', '.sln'];

/** 依 repo 快取資料夾是否為模組根目錄；每次重新整理建立新的實例 */
export class ModuleResolver {
  private readonly cache = new Map<string, boolean>();

  constructor(private readonly root: string) {}

  private isModuleDir(rel: string): boolean {
    const hit = this.cache.get(rel);
    if (hit !== undefined) return hit;
    const abs = path.join(this.root, rel);
    let result = MANIFESTS.some((m) => existsSync(path.join(abs, m)));
    if (!result) {
      try {
        result = readdirSync(abs).some((f) => MANIFEST_EXT.some((ext) => f.endsWith(ext)));
      } catch {
        result = false;
      }
    }
    this.cache.set(rel, result);
    return result;
  }

  /** 檔案所屬模組（相對 repo 根目錄的資料夾，'' 表示 repo 根目錄）；找不到時回傳 undefined */
  moduleOf(relPath: string): string | undefined {
    let dir = path.posix.dirname(relPath.replace(/\/$/, ''));
    for (;;) {
      const rel = dir === '.' ? '' : dir;
      if (this.isModuleDir(rel)) return rel;
      if (rel === '') return undefined;
      dir = path.posix.dirname(rel);
    }
  }
}
