// 合併衝突處理（對應 IntelliJ 的 Conflicts 對話框與三方合併）：衝突清單分頁、三方合併分頁、整個檔案採用某一邊、標記已解決
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConfirmHost, confirm } from './dialogs';
import type { DialogPanels, Reply } from './dialogPanel';
import { merge3, splitText } from './git/merge3';
import type { GitRepository } from './git/repository';
import { showGitError } from './gitConsole';
import { plural, t } from './i18n';
import type { WorkbenchViewProvider } from './provider';
import { isContentConflict, type ConflictFile, type MergeArgs, type RepoState, type ToExtension } from './shared/protocol';

type Operation = NonNullable<RepoState['operation']>;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** UTF-8 文字才能逐行合併；含 NUL 或不是合法 UTF-8 時視為二進位 */
function decodeText(buf: Buffer | undefined): string | undefined {
  if (!buf) return '';
  if (buf.subarray(0, 8000).includes(0)) return undefined;
  try {
    const body = buf.subarray(0, 3).equals(UTF8_BOM) ? buf.subarray(3) : buf;
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return undefined;
  }
}

/** 仍有衝突標記的行（<<<<<<< 與 >>>>>>>；======= 在一般文字中也常見，不列入） */
const MARKERS = /^(<{7}|>{7})( |$)/m;

export function opName(op: Operation): string {
  return { rebase: t('Rebase'), merge: t('Merge'), 'cherry-pick': t('Cherry-Pick'), revert: t('Revert') }[op];
}

export class ConflictResolver {
  constructor(
    private readonly provider: WorkbenchViewProvider,
    private readonly dialogs: DialogPanels,
  ) {}

  /** 衝突變動後（解決、採用一邊）：更新 Log、提交視窗、衝突清單 */
  onChanged: (() => void) | undefined;

  private repo(root: string): GitRepository | undefined {
    return this.provider.getRepository(root);
  }

  /** 各 repo 的衝突檔案 */
  async data(): Promise<{ root: string; name: string; operation?: Operation; files: ConflictFile[] }[]> {
    const out: { root: string; name: string; operation?: Operation; files: ConflictFile[] }[] = [];
    for (const s of await this.provider.repositories()) {
      const repo = this.repo(s.root);
      if (!repo) continue;
      const files = (await repo.getWorkingChanges().catch(() => []))
        .filter((c) => c.kind === 'conflict')
        .map((c) => ({ path: c.path, conflict: c.conflict ?? 'both-modified' }));
      const operation = await repo.operationInProgress().catch(() => undefined);
      if (files.length > 0 || operation) out.push({ root: s.root, name: s.name, operation, files });
    }
    return out;
  }

  // ---------- 衝突清單分頁 ----------

  openList(root?: string): void {
    this.dialogs.open('conflicts', t('Conflicts'), { kind: 'conflicts', args: { root } }, (m, reply, host) => this.handleList(m, reply, host));
  }

  private async handleList(m: ToExtension, reply: Reply, host: ConfirmHost): Promise<void> {
    switch (m.type) {
      case 'conflictsLoad':
        reply({ type: 'conflictsData', repos: await this.data() });
        return;
      case 'conflictAction':
        await this.act(m.items, m.action, host);
        return;
      case 'openMerge':
        await this.openMerge(m.root, m.path);
        return;
      case 'operation':
        await this.provider.runOperation(m.root, m.action, m.expected);
        await this.changed();
        return;
    }
  }

  /** 通知已開啟的衝突清單重新載入 */
  private async refreshList(): Promise<void> {
    if (this.dialogs.isOpen('conflicts')) this.dialogs.postTo('conflicts', { type: 'conflictsData', repos: await this.data() });
  }

  private async changed(): Promise<void> {
    await this.provider.refresh(true);
    await this.refreshList();
    this.onChanged?.();
  }

  // ---------- 整個檔案採用某一邊、標記已解決 ----------

  async act(items: { root: string; path: string }[], action: 'ours' | 'theirs' | 'resolved', host?: ConfirmHost): Promise<void> {
    const byRoot = new Map<string, string[]>();
    for (const x of items) byRoot.set(x.root, [...(byRoot.get(x.root) ?? []), x.path]);
    const touched: string[] = [];
    for (const [root, paths] of byRoot) {
      const repo = this.repo(root);
      if (!repo) continue;
      // 以目前實際的衝突為準（畫面可能已過期）
      const live = new Set(await repo.conflictedPaths());
      const list = paths.filter((p) => live.has(p));
      if (list.length === 0) continue;
      try {
        if (action === 'resolved') {
          const { promises: fsp } = await import('node:fs');
          const marked: string[] = [];
          for (const p of list) {
            const text = await fsp.readFile(path.join(root, p), 'utf8').catch(() => '');
            if (MARKERS.test(text)) marked.push(p);
          }
          if (marked.length > 0) {
            const ok = await confirm(plural(marked.length, '{0} file still contains conflict markers. Mark it as resolved anyway?', '{0} files still contain conflict markers. Mark them as resolved anyway?'), { detail: marked.join('\n'), ok: t('Mark as Resolved'), kind: 'warning' }, host);
            if (!ok) continue;
          }
          await repo.markConflictResolved(list);
        } else {
          await repo.acceptConflictSide(list, action);
        }
        touched.push(root);
      } catch (e) {
        void showGitError(errorMessage(e));
      }
    }
    await this.changed();
    // 不等使用者回應通知，呼叫端（右鍵選單、衝突清單）不會因此卡住
    for (const root of touched) void this.offerContinue(root);
  }

  /** 這個 repo 的衝突都解決了：提示繼續進行中的操作（衝突清單開著時由清單上的按鈕處理） */
  private async offerContinue(root: string): Promise<void> {
    if (this.dialogs.isOpen('conflicts')) return;
    const repo = this.repo(root);
    if (!repo || (await repo.conflictedPaths()).length > 0) return;
    const op = await repo.operationInProgress();
    if (!op) return;
    const name = (await this.provider.repositories()).find((r) => r.root === root)?.name ?? path.basename(root);
    const go = t('Continue {0}', opName(op));
    const answer = await vscode.window.showInformationMessage(t('{0}: all conflicts are resolved.', name), go);
    if (answer === go) {
      await this.provider.runOperation(root, 'continue', op);
      await this.changed();
    }
  }

  // ---------- 三方合併分頁 ----------

  async openMerge(root: string, filePath: string): Promise<void> {
    const repo = this.repo(root);
    if (!repo) return;
    const conflict = (await repo.getWorkingChanges()).find((c) => c.kind === 'conflict' && c.path === filePath);
    if (!conflict) {
      void vscode.window.showInformationMessage(t('{0} has no conflicts.', filePath));
      await this.changed();
      return;
    }
    // 一邊刪除、一邊修改：沒有可以逐段合併的內容，改到衝突清單選「採用我的／他們的」
    if (!isContentConflict(conflict.conflict)) {
      this.openList(root);
      return;
    }
    const [versions, labels] = await Promise.all([repo.conflictVersions(filePath), repo.conflictLabels()]);
    const texts = [decodeText(versions.base), decodeText(versions.ours), decodeText(versions.theirs)];
    const binary = texts.some((x) => x === undefined);
    const [base, ours, theirs] = texts.map((x) => splitText(x ?? ''));
    const bom = !!versions.ours?.subarray(0, 3).equals(UTF8_BOM);
    const args: MergeArgs = {
      root,
      path: filePath,
      oursLabel: labels.ours,
      theirsLabel: labels.theirs,
      binary: binary || undefined,
      eol: ours.lines.length > 0 ? ours.eol : theirs.eol,
      finalNewline: ours.lines.length > 0 ? ours.finalNewline : theirs.finalNewline,
      segments: binary ? [] : merge3(base.lines, ours.lines, theirs.lines),
    };
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    this.dialogs.open('merge', t('Merge: {0}', name), { kind: 'merge', args }, async (m, _reply, host, close) => {
      switch (m.type) {
        case 'mergeApply': {
          if (m.root !== root || m.path !== filePath) return;
          if (m.unresolved > 0 && !(await confirm(t('{0} changes are not resolved yet. Save the result and mark the file as resolved anyway?', m.unresolved), { ok: t('Apply'), kind: 'warning' }, host))) return;
          if (MARKERS.test(m.text) && !(await confirm(plural(1, '{0} file still contains conflict markers. Mark it as resolved anyway?', '{0} files still contain conflict markers. Mark them as resolved anyway?'), { detail: filePath, ok: t('Mark as Resolved'), kind: 'warning' }, host))) return;
          try {
            await repo.saveMergeResult(filePath, Buffer.concat([bom ? UTF8_BOM : Buffer.alloc(0), Buffer.from(m.text, 'utf8')]));
            close();
            vscode.window.setStatusBarMessage(`$(check) ${t('Resolved {0}', filePath)}`, 4000);
          } catch (e) {
            void showGitError(errorMessage(e));
            return;
          }
          await this.changed();
          await this.offerContinue(root);
          return;
        }
        case 'conflictAction':
          if (!m.items.every((x) => x.root === root && x.path === filePath)) return;
          close();
          await this.act(m.items, m.action, host);
          return;
        case 'mergeOpenEditor': {
          if (m.root !== root || m.path !== filePath) return;
          close();
          await this.openInMergeEditor(root, filePath);
          return;
        }
      }
    });
  }

  /** 改用 VS Code 內建的合併編輯器（內建 Git 擴充的指令）；無法開啟時直接開檔案 */
  async openInMergeEditor(root: string, filePath: string): Promise<void> {
    const uri = vscode.Uri.file(path.join(root, filePath));
    try {
      await vscode.commands.executeCommand('git.openMergeEditor', uri);
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }
}
