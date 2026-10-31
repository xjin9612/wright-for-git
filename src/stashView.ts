// Stash 檢視（側邊欄）：列出各 repo 的 stash、展開看檔案、點檔案看 diff；
// 右鍵 Apply／Pop／Drop／Unstash as Branch，標題列 Stash Changes…
import * as path from 'node:path';
import * as vscode from 'vscode';
import { revisionUri } from './diffProvider';
import type { GitRepository } from './git/repository';
import type { WorkbenchViewProvider } from './provider';
import type { ChangedFile, StashInfo } from './shared/protocol';
import { t } from './i18n';
import { confirm } from './dialogs';


interface RepoNode {
  kind: 'repo';
  root: string;
  name: string;
  stashes: StashInfo[];
}
interface StashNode {
  kind: 'stash';
  root: string;
  repoName: string;
  stash: StashInfo;
}
interface FileNode {
  kind: 'file';
  root: string;
  stash: StashInfo;
  file: ChangedFile & { untracked?: boolean };
}
type Node = RepoNode | StashNode | FileNode;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 「On main: msg」→「msg」；「WIP on main: abc123 subject」→「WIP: subject」 */
export function stashLabel(message: string): string {
  const wip = /^WIP on [^:]+: [0-9a-f]+ (.*)$/.exec(message);
  if (wip) return `WIP: ${wip[1]}`;
  const on = /^On [^:]+: (.*)$/.exec(message);
  return on ? on[1] : message;
}

function relativeTime(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{0} min ago', Math.floor(s / 60));
  if (s < 86400) return t('{0} h ago', Math.floor(s / 3600));
  return t('{0} d ago', Math.floor(s / 86400));
}

export class StashTree implements vscode.TreeDataProvider<Node> {
  static readonly viewId = 'gitWorkbench.stashes';
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private watchers: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly provider: WorkbenchViewProvider) {}

  refresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emitter.fire(undefined), 200);
  }

  /** 依目前的 repository 清單監看 refs/stash 與其 reflog（drop 非最上層的 stash 只會改 reflog） */
  rewatch(repos: GitRepository[]): void {
    this.watchers.forEach((d) => d.dispose());
    this.watchers = [];
    for (const repo of repos) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(repo.commonDir), '{refs/stash,logs/refs/stash}'));
      const fire = () => this.refresh();
      w.onDidChange(fire);
      w.onDidCreate(fire);
      w.onDidDelete(fire);
      this.watchers.push(w);
    }
    this.refresh();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.watchers.forEach((d) => d.dispose());
    this.emitter.dispose();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'repo') {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.stashes.length);
      item.iconPath = new vscode.ThemeIcon('repo');
      item.contextValue = 'stashRepo';
      item.id = `repo:${node.root}`;
      return item;
    }
    if (node.kind === 'stash') {
      const s = node.stash;
      const item = new vscode.TreeItem(stashLabel(s.message), vscode.TreeItemCollapsibleState.Collapsed);
      item.description = [s.branch, relativeTime(s.time)].filter(Boolean).join(' · ');
      item.tooltip = new vscode.MarkdownString(
        `**${s.ref}** · ${new Date(s.time * 1000).toLocaleString()}\n\n${s.message.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`)}`,
      );
      item.iconPath = new vscode.ThemeIcon('git-stash');
      item.contextValue = 'stash';
      item.id = `stash:${node.root}:${s.hash}`;
      return item;
    }
    const f = node.file;
    const item = new vscode.TreeItem(vscode.Uri.file(path.join(node.root, f.path)), vscode.TreeItemCollapsibleState.None);
    item.label = path.basename(f.path);
    const dir = path.dirname(f.path);
    item.description = [dir === '.' ? '' : dir, f.untracked ? t('untracked') : ''].filter(Boolean).join(' · ');
    item.tooltip = `${f.status} ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}`;
    item.iconPath = vscode.ThemeIcon.File;
    item.contextValue = 'stashFile';
    item.command = { command: 'gitWorkbench.stash.openFile', title: t('Show Diff'), arguments: [node] };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const repos = (await this.provider.repositories()).map((r) => ({ summary: r, repo: this.provider.getRepository(r.root) }));
      const nodes = await Promise.all(
        repos.map(async ({ summary, repo }): Promise<RepoNode | undefined> => {
          if (!repo) return undefined;
          const stashes = await repo.listStashes().catch(() => []);
          return { kind: 'repo', root: repo.root, name: summary.name, stashes };
        }),
      );
      const withStashes = nodes.filter((n): n is RepoNode => !!n && n.stashes.length > 0);
      // 只有一個 repo（或只有一個 repo 有 stash）時直接列 stash
      if (repos.length === 1 || withStashes.length === 1) return withStashes.flatMap((n) => n.stashes.map((stash) => ({ kind: 'stash' as const, root: n.root, repoName: n.name, stash })));
      return withStashes;
    }
    if (node.kind === 'repo') return node.stashes.map((stash) => ({ kind: 'stash', root: node.root, repoName: node.name, stash }));
    if (node.kind === 'stash') {
      const repo = this.provider.getRepository(node.root);
      const files = repo ? await repo.getStashFiles(node.stash).catch(() => []) : [];
      return files.map((file) => ({ kind: 'file', root: node.root, stash: node.stash, file }));
    }
    return [];
  }
}

export function registerStash(context: vscode.ExtensionContext, provider: WorkbenchViewProvider): StashTree {
  const tree = new StashTree(provider);
  const view = vscode.window.createTreeView(StashTree.viewId, { treeDataProvider: tree, showCollapseAll: true });

  const repoOf = (node: StashNode): GitRepository | undefined => provider.getRepository(node.root);
  /** 執行 stash 操作後重新整理（log 的 refs 不受影響，但工作區可能變了） */
  const run = async (node: StashNode, fn: (repo: GitRepository, ref: string) => Promise<void>, success: (ref: string) => string) => {
    const repo = repoOf(node);
    if (!repo) return;
    // stash@{n} 會隨其他 stash 的新增／刪除而位移：以 hash 找出目前的編號，找不到就不動作
    const current = (await repo.listStashes().catch(() => [])).find((x) => x.hash === node.stash.hash);
    if (!current) {
      void vscode.window.showWarningMessage(t('{0}: this stash no longer exists.', node.repoName));
      tree.refresh();
      return;
    }
    try {
      await fn(repo, current.ref);
      vscode.window.setStatusBarMessage(`$(check) ${success(current.ref)}`, 4000);
    } catch (e) {
      const msg = errorMessage(e);
      // apply／pop 衝突：git 已把衝突寫進工作區，stash 仍保留
      if (/conflict/i.test(msg)) {
        const open = t('Open Source Control');
        const answer = await vscode.window.showWarningMessage(t('{0}: the stash was applied with conflicts. Resolve them in Source Control; the stash was kept.', node.repoName), open);
        if (answer === open) await vscode.commands.executeCommand('workbench.view.scm');
      } else {
        void vscode.window.showErrorMessage(`${node.repoName}: ${msg}`);
      }
    }
    tree.refresh();
    await provider.refresh(true);
  };

  /** 從選取或右鍵取得 stash 節點 */
  const stashNode = (arg: unknown): StashNode | undefined => {
    const n = (arg ?? view.selection[0]) as Node | undefined;
    return n?.kind === 'stash' ? n : undefined;
  };

  // 只有 repository 清單改變時才重建 watcher（onDidChange 在每次 refs／HEAD 變動都會觸發）
  let watchedKey = '';
  const sync = () => {
    const repos = provider.repositoryList();
    const key = repos.map((r) => r.root).join('\n');
    if (key === watchedKey) return;
    watchedKey = key;
    tree.rewatch(repos);
  };
  sync();

  context.subscriptions.push(
    tree,
    view,
    provider.onDidChange(sync),
    vscode.commands.registerCommand('gitWorkbench.stash.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('gitWorkbench.stash.apply', async (arg?: unknown) => {
      const n = stashNode(arg);
      if (n) await run(n, (r, ref) => r.stashApply(ref), (ref) => t('Applied {0}', ref));
    }),
    vscode.commands.registerCommand('gitWorkbench.stash.applyIndex', async (arg?: unknown) => {
      const n = stashNode(arg);
      if (n) await run(n, (r, ref) => r.stashApply(ref, { index: true }), (ref) => t('Applied {0}', ref));
    }),
    vscode.commands.registerCommand('gitWorkbench.stash.pop', async (arg?: unknown) => {
      const n = stashNode(arg);
      if (n) await run(n, (r, ref) => r.stashApply(ref, { pop: true }), (ref) => t('Popped {0}', ref));
    }),
    vscode.commands.registerCommand('gitWorkbench.stash.drop', async (arg?: unknown) => {
      const n = stashNode(arg);
      if (!n) return;
      const ok = t('Drop');
      if (!(await confirm(t('Drop {0}? Its changes will be lost.', n.stash.ref), { detail: `${n.repoName}\n${n.stash.message}`, ok, kind: 'danger' }))) return;
      await run(n, (r, ref) => r.stashDrop(ref), (ref) => t('Dropped {0}', ref));
    }),
    vscode.commands.registerCommand('gitWorkbench.stash.branch', async (arg?: unknown) => {
      const n = stashNode(arg);
      const repo = n && repoOf(n);
      if (!n || !repo) return;
      const name = await vscode.window.showInputBox({
        title: t('Unstash as Branch'),
        prompt: t('Creates the branch at the commit the stash was made on, applies the stash there and drops it.'),
        validateInput: async (v) => (!v.trim() || (await repo.isValidRefName(v.trim(), 'branch')) ? undefined : t('Not a valid branch name.')),
      });
      if (name?.trim()) await run(n, (r, ref) => r.stashBranch(name.trim(), ref), () => t('Created and checked out {0}', name.trim()));
    }),
    vscode.commands.registerCommand('gitWorkbench.stash.save', async () => {
      const repos = await provider.repositories();
      let root: string | undefined = repos[0]?.root;
      if (repos.length > 1) {
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({ label: r.name, description: r.branch, root: r.root })),
          { placeHolder: t('Stash changes in which repository?') },
        );
        root = pick?.root;
      }
      const repo = root ? provider.getRepository(root) : undefined;
      if (!repo) return;
      const mode = await vscode.window.showQuickPick(
        [
          { label: t('Tracked files'), description: t('Modified and staged files'), untracked: false, keepIndex: false },
          { label: t('Include untracked files'), description: '--include-untracked', untracked: true, keepIndex: false },
          { label: t('Keep staged changes'), description: t('Stash everything but leave the index as is (--keep-index)'), untracked: false, keepIndex: true },
        ],
        { placeHolder: t('What to stash') },
      );
      if (!mode) return;
      if (!(await repo.hasChanges(mode.untracked))) {
        void vscode.window.showInformationMessage(t('There are no local changes to stash.'));
        return;
      }
      const message = await vscode.window.showInputBox({ title: t('Stash Changes'), prompt: t('Message (optional)') });
      if (message === undefined) return;
      try {
        await repo.stashPush(message, mode.untracked, mode.keepIndex);
        vscode.window.setStatusBarMessage(`$(check) ${t('Changes stashed')}`, 4000);
      } catch (e) {
        void vscode.window.showErrorMessage(errorMessage(e));
      }
      tree.refresh();
      await provider.refresh(true);
    }),
    vscode.commands.registerCommand('gitWorkbench.stash.openFile', async (node: FileNode) => {
      const { stash, file, root } = node;
      const base = stash.parents[0];
      const left = file.untracked || file.status === 'A' ? revisionUri(root, '', file.path) : revisionUri(root, base, file.oldPath ?? file.path);
      const rightRef = file.untracked ? stash.parents[2] : file.status === 'D' ? '' : stash.hash;
      const right = revisionUri(root, rightRef, file.path);
      await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(file.path)} (${stash.ref})`, { preview: true });
    }),
  );
  return tree;
}
