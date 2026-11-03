// VS Code webview API 包裝
import type { ToExtension } from '../shared/protocol';

interface VsCodeApi<S> {
  postMessage(msg: unknown): void;
  getState(): S | undefined;
  setState(state: S): void;
}

declare function acquireVsCodeApi<S>(): VsCodeApi<S>;

const api = acquireVsCodeApi<unknown>();

// webview 的按鍵會轉給 VS Code 比對快速鍵（所以 F4 這類自訂快速鍵在 webview 內也有效）。
// webview 已處理的按鍵（preventDefault）不再往外傳，避免同一個按鍵兩邊都動作：
// 例如使用者把 Shift+F10 綁成「執行工作」時，右鍵選單和工作清單會同時跳出來。
// VS Code 的轉送監聽掛在 window（冒泡階段），在 document 攔下即可；延後註冊，讓各頁面掛在 document 的處理先執行。
setTimeout(() => {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) e.stopPropagation();
  });
});

export function post(msg: ToExtension): void {
  api.postMessage(msg);
}

export function loadState<S>(): S | undefined {
  return api.getState() as S | undefined;
}

export function saveState<S>(state: S): void {
  api.setState(state);
}
