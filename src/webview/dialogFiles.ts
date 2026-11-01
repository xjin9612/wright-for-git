// 編輯器分頁對話框（Push、取消儲藏）右側的變更檔案：與記錄右欄相同的檔案樹，可依目錄／儲存庫／模組分組
import { el, iconButton } from './dom';
import { FileTree, type FileGrouping, type FileTreeOptions } from './fileTree';
import { t } from './l10n';
import { post } from './vscodeApi';

export interface DialogFiles {
  pane: HTMLElement;
  tree: FileTree;
  setTitle(text: string): void;
}

/** extension 放在對話框設定裡的偏好（存在 globalState，關掉分頁再開仍保留） */
let prefs: Record<string, unknown> = {};
export function setDialogPrefs(p: Record<string, unknown> | undefined): void {
  prefs = p ?? {};
}

/** key 區分不同對話框各自記住的分組方式 */
export function dialogFilesPane(key: string, opts: Omit<FileTreeOptions, 'grouping' | 'onGroupChange'>): DialogFiles {
  const prefKey = `fileGrouping.${key}`;
  const saved = prefs[prefKey] as FileGrouping | undefined;
  const tree = new FileTree({
    ...opts,
    // 一次只看一個 commit／儲藏，預設依目錄分組、不另分儲存庫
    grouping: saved ?? { directory: true, repository: false, module: false },
    onGroupChange: (g) => {
      prefs[prefKey] = g;
      post({ type: 'dialogPref', key: prefKey, value: g });
    },
  });
  tree.element.classList.add('push-files');
  const title = el('div', { className: 'push-files-title muted', text: t('Changed files') });
  const bar = el(
    'div',
    { className: 'pane-toolbar push-files-toolbar' },
    iconButton('diff', t('Show diff (Enter)'), () => tree.openSelected()),
    tree.groupButton,
    title,
    el('div', { className: 'toolbar-spacer' }),
    iconButton('expand-all', t('Expand all'), () => tree.expandAll()),
    iconButton('collapse-all', t('Collapse all'), () => tree.collapseAll()),
  );
  return {
    pane: el('div', { className: 'push-files-pane' }, bar, tree.element),
    tree,
    setTitle(text: string) {
      title.textContent = text;
      title.title = text;
    },
  };
}
