// 唯讀檔案系統：提供某個 revision 的檔案內容給 vscode.diff
// 以原始位元組回傳，讓 VS Code 依 files.encoding／自動偵測解碼（Big5 等非 UTF-8 檔案才不會亂碼）
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GitRepository } from './git/repository';

export const SCHEME = 'wright';

interface Query {
  root: string;
  ref: string;
  path: string;
}

export function revisionUri(root: string, ref: string, relPath: string): vscode.Uri {
  const query: Query = { root, ref, path: relPath };
  // path 帶上檔名，讓編輯器能正確判斷語言與顯示標題
  return vscode.Uri.file(path.join(root, relPath)).with({ scheme: SCHEME, query: JSON.stringify(query) });
}

function parseQuery(uri: vscode.Uri): Query | undefined {
  try {
    const q = JSON.parse(uri.query) as Partial<Query>;
    if (typeof q.root !== 'string' || typeof q.ref !== 'string' || typeof q.path !== 'string') return undefined;
    return q as Query;
  } catch {
    return undefined;
  }
}

export class RevisionFileSystem implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  constructor(private readonly getRepo: (root: string) => GitRepository | undefined) {}

  private async read(uri: vscode.Uri): Promise<Uint8Array> {
    const q = parseQuery(uri);
    const repo = q && this.getRepo(q.root);
    if (!q || !repo) return new Uint8Array();
    // showFile 只接受 commit hash 作為 ref，其餘一律回傳空內容
    return repo.showFile(q.ref, q.path);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const data = await this.read(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: data.byteLength, permissions: vscode.FilePermission.Readonly };
  }

  readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return this.read(uri);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}
