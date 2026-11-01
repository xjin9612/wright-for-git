// UI 端對端測試宿主：真實的 dist/*.js 與真實 git，VS Code API 以假物件代替，webview 由 Playwright（Chromium）載入。
// 無法涵蓋的部分（原生 diff 編輯器、快捷鍵、主題、檔案總管選單等）列在 docs/TESTING.md 手動測試。
'use strict';
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
/** 主題：dark（預設）、light、hc（高對比）；CSS 變數取近似 VS Code 內建主題的值 */
const THEMES = {
  dark: { css: 'theme-dark.css', body: 'vscode-dark' },
  light: { css: 'theme-light.css', body: 'vscode-light' },
  hc: { css: 'theme-hc.css', body: 'vscode-high-contrast' },
};
let theme = THEMES.dark;

// ---------- 假的 vscode 模組 ----------

/** 每次 launch 重設；測試透過它檢查 extension 呼叫了什麼、預先排好對話框的回答 */
const calls = {};
function resetCalls() {
  for (const k of Object.keys(calls)) delete calls[k];
  Object.assign(calls, {
    commands: {},
    executed: [],
    errors: [],
    warnings: [],
    infos: [],
    status: [],
    quickPicks: [],
    /** showQuickPick 的回答：依序取用，函式（item => boolean）或 undefined（取消）；沒排時選第一項 */
    picks: [],
    /** showInputBox 的回答；沒排時取消 */
    inputs: [],
    inputErrors: [],
    /** modal 確認框的回答：true 按確認、false 取消；沒排時按確認 */
    modal: [],
    providers: {},
    panels: [],
    watchers: [],
    config: {},
    configListeners: [],
    console: [],
    clipboard: undefined,
  });
}
resetCalls();

class Uri {
  constructor(scheme, p, query = '') {
    this.scheme = scheme;
    this.path = p;
    this.query = query;
  }
  static file(p) {
    return new Uri('file', p);
  }
  static parse(s) {
    return new Uri('https', s);
  }
  static joinPath(u, ...parts) {
    return new Uri(u.scheme, path.join(u.path, ...parts));
  }
  get fsPath() {
    return this.path;
  }
  with(c) {
    return new Uri(c.scheme ?? this.scheme, c.path ?? this.path, c.query ?? this.query);
  }
  toString() {
    return `${this.scheme}:${this.path}?${this.query}`;
  }
}

const fmt = (s, ...a) => s.replace(/\{(\d+)\}/g, (_, i) => a[i]);
const modalAnswer = (o, ok) => (o && typeof o === 'object' && o.modal ? (calls.modal.length ? (calls.modal.shift() ? ok : undefined) : ok) : undefined);

const vscode = {
  Uri,
  Disposable: Object.assign(
    class {
      constructor(f) {
        this.dispose = f;
      }
    },
    { from: (...d) => ({ dispose: () => d.forEach((x) => x.dispose()) }) },
  ),
  FilePermission: { Readonly: 1 },
  FileSystemError: { NoPermissions: () => new Error('NoPermissions'), FileNotFound: () => new Error('FileNotFound') },
  RelativePattern: class {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  ProgressLocation: { Notification: 15, SourceControl: 1, Window: 10 },
  FileType: { File: 1, Directory: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
  TreeItem: class {
    constructor(label, state) {
      this.label = label;
      this.collapsibleState = state;
    }
  },
  ThemeIcon: Object.assign(
    class {
      constructor(id) {
        this.id = id;
      }
    },
    { File: { id: 'file' }, Folder: { id: 'folder' } },
  ),
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  MarkdownString: class {
    constructor(v) {
      this.value = v;
    }
  },
  EventEmitter: class {
    constructor() {
      this.l = [];
      this.event = (f) => {
        this.l.push(f);
        return { dispose() {} };
      };
    }
    fire(v) {
      this.l.forEach((f) => f(v));
    }
    dispose() {}
  },
  ViewColumn: { Active: -1, Beside: -2, One: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  l10n: { t: fmt },
  env: {
    language: 'en',
    clipboard: { writeText: async (t) => (calls.clipboard = t) },
    openExternal: async (u) => (calls.opened = (calls.opened || []).concat([String(u.path ?? u)])),
  },
  extensions: { getExtension: () => undefined },
  window: {
    registerWebviewViewProvider: (id, p) => {
      calls.providers[id] = p;
      return { dispose() {} };
    },
    showErrorMessage: async (m, o) => {
      calls.errors.push(m + (o && o.detail ? ` | ${o.detail}` : ''));
      return undefined;
    },
    showInformationMessage: async (m, o, ok) => {
      calls.infos.push(m);
      return modalAnswer(o, ok);
    },
    showWarningMessage: async (m, o, ok) => {
      calls.warnings.push(m);
      return modalAnswer(o, ok);
    },
    showQuickPick: async (items) => {
      const list = await items;
      calls.quickPicks.push(list.map((i) => (typeof i === 'string' ? i : i.label)));
      const next = calls.picks.length ? calls.picks.shift() : (x) => x === list[0];
      return next ? list.find(next) : undefined;
    },
    showInputBox: async (o) => {
      const v = calls.inputs.shift();
      if (v !== undefined && o && o.validateInput) {
        const err = await o.validateInput(v);
        if (err) {
          calls.inputErrors.push(err);
          return undefined;
        }
      }
      return v;
    },
    setStatusBarMessage: (m) => {
      calls.status.push(m);
      return { dispose() {} };
    },
    withProgress: async (_o, fn) => fn({ report: () => undefined }),
    createWebviewPanel: (viewType, title) => {
      const panel = {
        viewType,
        title,
        disposed: false,
        _onMsg: null,
        _onDispose: [],
        _post: async () => {},
        webview: {
          html: '',
          cspSource: '',
          asWebviewUri: (u) => u,
          postMessage: async (m) => panel._post(m),
          onDidReceiveMessage: (h) => {
            panel._onMsg = h;
            return { dispose() {} };
          },
        },
        reveal() {},
        onDidDispose: (h) => {
          panel._onDispose.push(h);
          return { dispose() {} };
        },
        dispose() {
          panel.disposed = true;
          panel._onDispose.forEach((h) => h());
        },
      };
      calls.panels.push(panel);
      return panel;
    },
    createTreeView: (id) => {
      calls.trees = calls.trees || {};
      calls.trees[id] = true;
      return {
        selection: [],
        onDidChangeVisibility: () => ({ dispose() {} }),
        onDidChangeCheckboxState: (h) => {
          calls.treeCheckbox = h;
          return { dispose() {} };
        },
        dispose() {},
      };
    },
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    /** Git 主控台：記錄到 calls.console（[層級, 文字]） */
    createOutputChannel: (name) => {
      const line = (level) => (text) => calls.console.push([level, text]);
      return { name, info: line('info'), trace: line('trace'), debug: line('debug'), warn: line('warn'), error: line('error'), append() {}, appendLine: line('info'), show: () => (calls.consoleShown = true), clear() {}, dispose() {} };
    },
    get activeTextEditor() {
      return calls.activeEditor;
    },
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  },
  workspace: {
    workspaceFolders: [],
    fs: { stat: async (u) => ({ type: fs.statSync(u.fsPath).isDirectory() ? 2 : 1 }) },
    getConfiguration: (section) => ({
      get: (k, d) => {
        const key = section ? `${section}.${k}` : k;
        return key in calls.config ? calls.config[key] : d;
      },
      // 模擬目前版本的 VS Code：設定都已註冊（預設值 false）
      inspect: (k) => {
        const key = section ? `${section}.${k}` : k;
        return { key, defaultValue: false, globalValue: calls.config[key] };
      },
      update: async (k, v) => {
        const key = section ? `${section}.${k}` : k;
        calls.config[key] = v;
        // 與 VS Code 相同：寫入設定後通知 onDidChangeConfiguration
        for (const h of calls.configListeners) await h({ affectsConfiguration: (s) => key === s || key.startsWith(`${s}.`) });
      },
    }),
    createFileSystemWatcher: (pattern) => {
      const w = { pattern, handlers: [], onDidChange: (h) => w.handlers.push(h), onDidCreate: (h) => w.handlers.push(h), onDidDelete: (h) => w.handlers.push(h), dispose() {} };
      calls.watchers.push(w);
      return w;
    },
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    registerFileSystemProvider: (scheme, p) => {
      calls.fsProvider = p;
      return { dispose() {} };
    },
    onDidChangeConfiguration: (h) => {
      calls.configListeners.push(h);
      return { dispose() {} };
    },
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: (id, fn) => {
      calls.commands[id] = fn;
      return { dispose() {} };
    },
    executeCommand: async (...a) => {
      calls.executed.push(a);
      return undefined;
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'vscode' ? 'vscode' : origResolve.call(this, req, ...rest);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };

// ---------- playground 與 git ----------

/** 這次執行建立的暫存資料夾；測試結束時刪除 */
const tempDirs = [];
process.on('exit', () => {
  for (const d of tempDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows 上偶爾有檔案仍被 git 佔用：留給系統清理暫存資料夾
    }
  }
});

/** 在暫存資料夾建立 playground（docs/TESTING.md 描述的內容），回傳其路徑 */
function makePlayground() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-ui-'));
  tempDirs.push(dir);
  const root = path.join(dir, 'playground');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-playground.mjs'), root], { stdio: 'ignore' });
  return root;
}

/** 在 repo 中執行 git，回傳去掉頭尾空白的輸出 */
function git(cwd, ...args) {
  // 固定英文輸出：使用者的 git 可能是中文介面（Windows 的 Git 依系統語言翻譯訊息）
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' } }).trim();
}

/** workspace 下的 repo（深度 2 以內，含巢狀） */
function findRepos(dir, depth = 0) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((e) => e.name === '.git')) out.push(dir);
  if (depth < 2) for (const e of entries) if (e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules') out.push(...findRepos(path.join(dir, e.name), depth + 1));
  return out;
}

/** 模擬另一台電腦推送一筆 commit */
function remotePush(playground, repo) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-playground.mjs'), 'remote-push', repo, playground], { stdio: 'ignore' });
}

// ---------- webview 頁面 ----------

const pageHtml = (script, extraHead) => `<!DOCTYPE html><html><head><style>:root{${fs.readFileSync(path.join(__dirname, theme.css), 'utf8')}}</style><style>${fs.readFileSync(path.join(ROOT, 'media', 'webview.css'), 'utf8')}</style></head>
<body class="${theme.body}"><div id="app"></div>${extraHead}<script>
let __s = null; window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__host(m), getState: () => __s, setState: (s) => { __s = s; } });
</script><script>${fs.readFileSync(path.join(DIST, script), 'utf8')}</script></body></html>`;

/** 從 extension 產生的 HTML 取出 JSON 設定（語系、對話框參數） */
const jsonTag = (html, id) => new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html)?.[1];

function watchPage(page) {
  const log = [];
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  return log;
}

/** 把 webview view（Log 面板、提交視窗）接到一個 Playwright 頁面 */
async function attachWebviewView(browser, provider, script, viewport) {
  const page = await browser.newPage({ viewport });
  const log = watchPage(page);
  let onMsg = () => undefined;
  const visibility = [];
  /** extension 送到這個 webview 的訊息類型計數（測試用來等「重新整理完成」） */
  const posted = {};
  const view = {
    visible: true,
    description: '',
    webview: {
      options: {},
      html: '',
      cspSource: '',
      asWebviewUri: (u) => u,
      postMessage: async (m) => {
        await page.evaluate((msg) => window.postMessage(msg, '*'), m).catch(() => undefined);
        posted[m.type] = (posted[m.type] ?? 0) + 1;
        return true;
      },
      onDidReceiveMessage: (h) => {
        onMsg = h;
        return { dispose() {} };
      },
    },
    onDidChangeVisibility: (h) => {
      visibility.push(h);
      return { dispose() {} };
    },
    onDidDispose: () => ({ dispose() {} }),
    show() {},
  };
  provider.resolveWebviewView(view, {}, { isCancellationRequested: false });
  await page.exposeFunction('__host', (m) => onMsg(m));
  const l10n = jsonTag(view.webview.html, 'l10n-bundle') ?? '{}';
  await page.setContent(pageHtml(script, `<script type="application/json" id="l10n-bundle">${l10n}</script>`));
  return { page, log, view, posted };
}

/**
 * 啟動 extension 與 Log 面板。
 * @param {string} workspace playground 路徑
 * @param {{ config?: Record<string, unknown>, language?: string, width?: number, height?: number, theme?: 'dark' | 'light' | 'hc' }} [opts]
 */
async function launch(workspace, opts = {}) {
  const { chromium } = require('playwright');
  resetCalls();
  theme = THEMES[opts.theme ?? 'dark'];
  Object.assign(calls.config, opts.config ?? {});
  vscode.env.language = opts.language ?? 'en';
  vscode.workspace.workspaceFolders = [{ uri: Uri.file(workspace), name: path.basename(workspace), index: 0 }];
  for (const k of Object.keys(require.cache)) if (k.startsWith(DIST)) delete require.cache[k];
  const ext = require(path.join(DIST, 'extension.js'));
  const store = new Map();
  const memento = { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => void store.set(k, v), keys: () => [...store.keys()] };
  const ctx = {
    subscriptions: [],
    extensionUri: Uri.file(ROOT),
    extensionPath: ROOT,
    extension: { id: 'xjin9612.vscode-git-workbench' },
    workspaceState: memento,
    globalState: { ...memento, setKeysForSync() {} },
  };
  const testApi = await ext.activate(ctx);
  const browser = await chromium.launch();
  const log = await attachWebviewView(browser, calls.providers['gitWorkbench.log'], 'webview.js', { width: opts.width ?? 1400, height: opts.height ?? 520 });
  const page = log.page;
  await page.waitForFunction(() => document.querySelectorAll('.log-row').length > 0 && !document.querySelector('.progress.active'), null, { timeout: 30000 });
  const extraPages = [];
  current = {
    repos: () => findRepos(workspace),
    pages: () => [['Log', page], ...extraPages.filter(([, p]) => !p.isClosed())],
  };

  return {
    browser,
    page,
    /** Log 面板的 webview（可檢查 extension 產生的 HTML） */
    logView: log.view,
    log: log.log,
    calls,
    vscode,
    ctx,
    /** 擴充功能啟用時回傳的測試用介面（src/testApi.ts） */
    api: testApi,
    /** 開啟提交視窗 */
    async commitView(viewport = { width: 420, height: 760 }) {
      const v = await attachWebviewView(browser, calls.providers['gitWorkbench.commit'], 'commit.js', viewport);
      extraPages.push(['提交視窗', v.page]);
      await v.page.waitForSelector('.commit-tree .tree-row, .commit-tree .empty-text');
      return v;
    },
    /** 最新開啟的編輯器分頁對話框（Push、取消儲藏、逐段選取、rebase） */
    async lastPanel(viewport = { width: 1100, height: 640 }) {
      const panel = calls.panels[calls.panels.length - 1];
      if (!panel) throw new Error('沒有開啟的對話框分頁');
      const p = await browser.newPage({ viewport });
      const plog = watchPage(p);
      extraPages.push(['對話框分頁', p]);
      await p.exposeFunction('__host', (m) => panel._onMsg(m));
      panel._post = async (m) => {
        await p.evaluate((msg) => window.postMessage(msg, '*'), m).catch(() => undefined);
      };
      const extra = `<script type="application/json" id="l10n-bundle">${jsonTag(panel.webview.html, 'l10n-bundle') ?? '{}'}</script><script type="application/json" id="dialog-config">${jsonTag(panel.webview.html, 'dialog-config') ?? 'null'}</script>`;
      await p.setContent(pageHtml('dialog.js', extra));
      return { page: p, log: plog, panel };
    },
    /** 執行已註冊的指令 */
    run(id, ...args) {
      const fn = calls.commands[id];
      if (!fn) throw new Error(`指令未註冊：${id}`);
      return fn(...args);
    },
    /** 設定變更（如語系）並通知 extension */
    async setConfig(key, value) {
      calls.config[key] = value;
      for (const h of calls.configListeners) await h({ affectsConfiguration: (k) => key === k || key.startsWith(`${k}.`) });
    },
    /**
     * 等 Log 上方的進行中操作列出現或消失：持續觸發重新整理（真實 VS Code 由檔案監看觸發），
     * Windows 上 git 較慢，不能只等固定時間。
     */
    async waitOps(visible) {
      await until(async () => {
        for (const w of calls.watchers) for (const h of w.handlers) h(Uri.file(workspace));
        await page.waitForTimeout(800);
        return (await page.locator(visible ? '.log-ops:not(.hidden)' : '.log-ops.hidden').count()) > 0;
      }, 40000, 0);
    },
    /** 模擬檔案系統變動（觸發自動重新整理） */
    fireWatchers(uri) {
      for (const w of calls.watchers) for (const h of w.handlers) h(uri ?? Uri.file(workspace));
    },
    async close() {
      current = undefined;
      await browser.close();
      for (const d of ctx.subscriptions) {
        try {
          d.dispose?.();
        } catch {
          // 忽略
        }
      }
    },
  };
}

/** webview 端的錯誤（console.error、未捕捉例外） */
const pageErrors = (log) => log.filter((l) => /^\[(error|pageerror)\]/.test(l));

/** 目前 launch 的狀態，逾時時印出，方便判斷卡在哪一步 */
let current;
async function diagnose() {
  if (!current) return '';
  const out = [];
  const tail = (a, n = 5) => a.slice(-n).map((x) => `    ${String(x).slice(0, 300)}`).join('\n');
  for (const dir of current.repos()) {
    try {
      out.push(`  git status（${path.basename(dir)}）：${git(dir, 'status', '--porcelain', '-b').split('\n').join(' | ')}`);
    } catch (e) {
      out.push(`  git status（${path.basename(dir)}）失敗：${String(e.message).split('\n')[0]}`);
    }
  }
  if (calls.errors?.length) out.push(`  錯誤通知：\n${tail(calls.errors)}`);
  if (calls.warnings?.length) out.push(`  警告通知：\n${tail(calls.warnings)}`);
  const cons = (calls.console ?? []).filter(([l]) => l === 'info' || l === 'warn' || l === 'error').map(([l, t]) => `${l} ${t}`);
  if (cons.length) out.push(`  Git 主控台最後幾行：\n${tail(cons, 8)}`);
  if (calls.picks?.length) out.push(`  尚未用到的 QuickPick 回答：${calls.picks.length} 個`);
  for (const [name, pg] of current.pages()) {
    try {
      const state = await pg.evaluate(() => ({
        menu: [...document.querySelectorAll('.context-menu .menu-item')].map((e) => e.textContent.trim()).slice(0, 12),
        confirm: document.querySelector('.confirm-dialog')?.innerText.replace(/\s+/g, ' ').slice(0, 200),
        progress: !!document.querySelector('.progress.active'),
        ops: document.querySelector('.log-ops:not(.hidden)')?.innerText.replace(/\s+/g, ' ').slice(0, 200),
      }));
      out.push(`  頁面 ${name}：選單=${state.menu.length ? state.menu.join('／') : '無'}；確認框=${state.confirm ?? '無'}；載入中=${state.progress}${state.ops ? `；進行中操作=${state.ops}` : ''}`);
    } catch {
      // 頁面已關閉
    }
  }
  return out.length ? `診斷：\n${out.join('\n')}` : '';
}

/** 等條件成立（輪詢）；逾時時附上診斷資訊 */
async function until(fn, timeout = 20000, interval = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = undefined; // 條件中的 git 指令暫時失敗（例如 upstream 尚未設定）視為還沒成立
    }
    if (v) return v;
    if (Date.now() > end) throw new Error(`等待逾時（${timeout / 1000} 秒）\n${await diagnose()}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** 反覆執行 fn（含 assert）直到不再丟出錯誤；逾時時丟出最後一次的錯誤。用於非同步載入的畫面 */
async function eventually(fn, timeout = 30000, interval = 200) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() > end) throw e;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}

/** 列的文字（換行改空白） */
const texts = async (locator) => (await locator.allInnerTexts()).map((t) => t.replace(/\s*\n\s*/g, ' ').trim());

/**
 * Log 中標題含 text 的列。列是重複使用的節點，捲動後同一個節點可能換成別的 commit，
 * 所以先捲到可見、等重繪後再重新定位。
 */
async function logRow(page, text) {
  const find = () => page.locator('.log-row:visible', { hasText: text }).first();
  await find().scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  return find();
}

/** 點選單項目（選單在 mousedown 時觸發） */
async function menu(page, label, level) {
  const scope = level === undefined ? page.locator('.context-menu') : page.locator(`.context-menu[data-level="${level}"]`);
  const item = scope.locator('.menu-item', { hasText: label }).first();
  // 選單可能因重新整理而關閉：找不到時附上診斷，而不是只等到 Playwright 逾時
  await item.waitFor({ state: 'visible', timeout: 10000 }).catch(async () => {
    throw new Error(`找不到選單項目「${label}」\n${await diagnose()}`);
  });
  await item.dispatchEvent('mousedown');
}

module.exports = { launch, makePlayground, git, remotePush, pageErrors, until, eventually, texts, menu, logRow, ROOT };
