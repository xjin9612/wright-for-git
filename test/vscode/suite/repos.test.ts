// 儲存庫清單與 Paths 篩選同步
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { api, repoPath, test, until } from './harness';

const API = repoPath('api-server');
const same = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();

test('只勾 api-server：記錄的 repo 篩選與儲存庫清單同步；全部勾回來恢復', async () => {
  const a = await api();
  // 篩選要等記錄面板的 webview 套用後回報，面板要開著
  await vscode.commands.executeCommand('wright.show');
  const all = await a.repositories();
  const apiRoot = all.find((r) => same(r.root, API))!.root;
  await a.setRepositoriesVisible([apiRoot]);
  await until(() => a.logFilter().roots.length === 1 && same(a.logFilter().roots[0], API), '記錄只顯示 api-server');
  const visible = (await a.repositories()).filter((r) => r.visible).map((r) => r.name);
  assert.deepEqual(visible, ['api-server']);
  await a.setRepositoriesVisible(all.map((r) => r.root));
  await until(() => a.logFilter().roots.length === 0, '記錄顯示全部 repo');
  assert.ok((await a.repositories()).every((r) => r.visible));
});
