// 與 VS Code 內建 Git 擴充套件整合：取得 git 執行檔路徑與已開啟的 repository
import * as vscode from 'vscode';

/** 內建 Git 擴充套件 API 的最小型別（只宣告用到的部分） */
interface BuiltinGitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: { readonly onDidChange: vscode.Event<void> };
}
interface BuiltinGitApi {
  readonly git: { readonly path: string };
  readonly repositories: BuiltinGitRepository[];
  readonly onDidOpenRepository: vscode.Event<BuiltinGitRepository>;
}
interface BuiltinGitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): BuiltinGitApi;
}

export async function getBuiltinGitApi(): Promise<BuiltinGitApi | undefined> {
  const ext = vscode.extensions.getExtension<BuiltinGitExtension>('vscode.git');
  if (!ext) return undefined;
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return exports.enabled ? exports.getAPI(1) : undefined;
  } catch {
    return undefined;
  }
}

/** 優先使用內建 Git 擴充套件設定的 git 路徑，找不到時退回 PATH 上的 git */
export async function resolveGitPath(): Promise<string> {
  const api = await getBuiltinGitApi();
  return api?.git.path || 'git';
}

/** repository 狀態變動事件（branch 切換、commit、fetch 等）；沒有內建 Git 時回傳 undefined */
export async function onRepositoryChange(root: string, listener: () => void): Promise<vscode.Disposable | undefined> {
  const api = await getBuiltinGitApi();
  if (!api) return undefined;
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  const target = norm(root);
  const subs: vscode.Disposable[] = [];
  const attach = (r: BuiltinGitRepository) => {
    if (norm(r.rootUri.fsPath) === target) subs.push(r.state.onDidChange(listener));
  };
  api.repositories.forEach(attach);
  subs.push(api.onDidOpenRepository(attach));
  return vscode.Disposable.from(...subs);
}

export async function builtinRepositoryRoots(): Promise<string[]> {
  const api = await getBuiltinGitApi();
  return api?.repositories.map((r) => r.rootUri.fsPath) ?? [];
}
