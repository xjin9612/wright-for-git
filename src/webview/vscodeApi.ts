// VS Code webview API 包裝
import type { ToExtension } from '../shared/protocol';

interface VsCodeApi<S> {
  postMessage(msg: unknown): void;
  getState(): S | undefined;
  setState(state: S): void;
}

declare function acquireVsCodeApi<S>(): VsCodeApi<S>;

const api = acquireVsCodeApi<unknown>();

export function post(msg: ToExtension): void {
  api.postMessage(msg);
}

export function loadState<S>(): S | undefined {
  return api.getState() as S | undefined;
}

export function saveState<S>(state: S): void {
  api.setState(state);
}
