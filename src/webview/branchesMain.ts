// 側邊欄 Branches（活動列「Git 歷程」）：與 Log 左欄相同的分支樹。
// 要顯示的 repository、目前篩選與偏好都以 Log 為準（經 extension 轉送）；這裡的操作再轉回 Log。
import type { BranchesEvent, BranchesSync, ToWebview } from '../shared/protocol';
import { refMenuItems, runBranchToolbar, type BranchHost } from './branchActions';
import { BranchesPane } from './branchesPane';
import { el, showMenu } from './dom';
import { t } from './l10n';
import { post } from './vscodeApi';

let sync: BranchesSync | undefined;
/** 上次套用的 Branch 篩選；只在它改變時移動選取（避免蓋掉使用者用方向鍵移動的位置） */
let lastSelected: string | undefined | null = null;

const send = (event: BranchesEvent) => post({ type: 'branchesEvent', event });
const sendPrefs = () => send({ kind: 'prefs', prefs: pane.prefs() });
const visible = () => sync?.states ?? [];

const host: BranchHost = {
  showInLog: (ref) => send({ kind: 'select', ref: ref.name }),
  showInNewTab: (ref) => send({ kind: 'newTab', ref: ref.name }),
  navigate: (ref) => send({ kind: 'navigate', ref: ref.name }),
  isFavorite: (ref) => pane.isFavorite(ref),
  toggleFavorite: (ref) => pane.toggleFavorite(ref),
  visibleRepos: visible,
};

const pane = new BranchesPane(
  {
    onSelect: (ref) => send({ kind: 'select', ref }),
    onCheckout: (ref, roots) => post({ type: 'checkout', ref, roots }),
    onToolbarAction: (action, ref) => runBranchToolbar(action, ref, host),
    onContextMenu: (ref, x, y) => showMenu(x, y, refMenuItems(ref, host)),
    onFetch: () => post({ type: 'sync', action: 'fetch', roots: visible().map((r) => r.root) }),
    onCollapsePane: () => undefined,
    onExpandedChange: sendPrefs,
    onOptionsChange: sendPrefs,
    onFavoritesChange: sendPrefs,
  },
  undefined,
  undefined,
  false,
  undefined,
  'sidebar',
);

// 收到 Log 的第一次同步前顯示「載入中」（Log 找 repo 期間側邊欄不再一片空白）
const empty = el('div', { className: 'empty-text', text: t('Loading…') });
const app = document.getElementById('app')!;
app.className = 'branches-app';
app.append(empty, pane.element);
pane.element.classList.add('hidden');

window.addEventListener('message', (ev: MessageEvent<ToWebview>) => {
  const m = ev.data;
  if (m.type !== 'branchesSync') return;
  sync = m.sync;
  pane.setPrefs(m.sync.prefs);
  pane.setRepos(m.sync.states);
  if (m.sync.selected !== lastSelected) {
    lastSelected = m.sync.selected;
    pane.setSelectedRef(m.sync.selected);
  }
  empty.textContent = m.sync.message ?? '';
  empty.classList.toggle('hidden', !m.sync.message);
  pane.element.classList.toggle('hidden', !!m.sync.message);
});

post({ type: 'ready' });
