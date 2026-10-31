// 編輯器分頁對話框的進入點：依 extension 放進 HTML 的設定畫出對應的對話框
import type { ToWebview } from '../shared/protocol';
import { showConfirm } from './confirmDialog';
import { handlePushMessage, openPushDialog } from './pushDialog';
import { post } from './vscodeApi';

interface DialogConfig {
  kind: 'push';
  args: { roots: string[]; branch?: string; upTo?: { root: string; hash: string } };
}

const node = document.getElementById('dialog-config');
const config = node?.textContent ? (JSON.parse(node.textContent) as DialogConfig | null) : null;
document.body.classList.add('dialog-page');

if (config?.kind === 'push') {
  openPushDialog({
    ...config.args,
    embedded: true,
    onOpenDiff: (root, hash, parent, file) => post({ type: 'openDiff', root, hash, parent, file }),
  });
}

window.addEventListener('message', (ev: MessageEvent<ToWebview>) => {
  const m = ev.data;
  switch (m.type) {
    case 'pushPreview':
    case 'pushCommitFiles':
    case 'pushStatus':
      handlePushMessage(m);
      break;
    case 'confirm':
      showConfirm(m);
      break;
  }
});
