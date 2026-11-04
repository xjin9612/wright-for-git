# Contributing

English | [繁體中文](CONTRIBUTING.zh-TW.md)

## Development

```bash
npm install
npm run build       # build dist/
npm run typecheck   # type-check the extension and the webview
npm test            # unit and integration tests (requires git)
npm run test:ui     # UI end-to-end tests in Chromium (downloads Chromium on the first run)
npm run test:vscode # tests inside a real VS Code (downloads VS Code on the first run)
npm run bench:vscode # log loading benchmark on a large repository (see docs/TESTING.md)
npm run package     # create the .vsix
npm run check       # all of the above except the benchmark, in order, stopping at the first failure
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

Testing is split into unit, UI, real VS Code and manual layers; see [docs/TESTING.md](docs/TESTING.md) (in Traditional Chinese) for what each covers and for the sample repositories used in manual tests:

```bash
node scripts/make-playground.mjs        # sample repositories for the manual checklist
node scripts/make-shelf-fixture.mjs init # repositories for Shelf manual tests
node scripts/make-icon.mjs               # regenerate media/icon.png from assets/icon.svg
```

## Releasing

1. Bump `version` in `package.json` (**version rule**: `major.minor.patch` only; an even minor is a regular release, an odd minor is a pre-release — e.g. `1.4.0` regular, `1.5.0` pre-release) and add a matching section at the top of `CHANGELOG.md` (`## 1.2.0`; changes in progress go under `## Unreleased` — rename it when releasing) — it becomes the release notes
2. Commit, then tag and push: `git tag v1.2.0 && git push origin v1.2.0`
3. GitHub Actions (`.github/workflows/release.yml`) checks the version, runs the tests, packages the `.vsix`, and publishes a GitHub Release using that CHANGELOG section as the notes

The release fails if the tag does not match `package.json` or the CHANGELOG has no section for the version. The version rule is checked by `scripts/check-version.mjs` (in CI and on release): versions containing `-` (e.g. `1.4.0-beta.1`) fail because the VS Code Marketplace does not support them; an odd minor is published as a pre-release.

## Architecture

```
src/
  extension.ts        entry point: registers the webview views, read-only file system and commands
  provider.ts         Git log webview view: repository management, messaging, auto refresh, checkout
  commitView.ts       Commit window webview view: working-tree changes, changelists, commit
  branchesView.ts     side-bar Branches webview view: relays the log's branch state and actions
  dialogPanel.ts      dialogs opened as editor tabs: Push, Unstash, hunk selection, interactive rebase, conflicts, three-way merge
  conflicts.ts        merge conflicts: conflict list, three-way merge, accept a side, mark as resolved
  actions.ts          branch, commit and push actions shared by the panel and the dialogs
  dialogs.ts          confirm dialogs shown inside the log panel (VS Code modal as fallback)
  stashView.ts        stash actions shared by the Commit window and the Explorer menu
  explorerCommands.ts Explorer context menu: compare with branch or tag, stash, unstash
  gitConsole.ts       Git Console: logs every git command to the Output panel
  optimize.ts         Optimize Repository command (writes the commit-graph)
  shelf.ts            Shelf across repositories: shelve, unshelve, rename, delete, patch export and import
  fileTreeFocus.ts    focused changed-files tree and its selected file, for F4 and other rebindable keys
  util.ts             small helpers without a vscode dependency
  settingsBridge.ts   in-panel settings popup
  modules.ts          "module" grouping (nearest folder with a project file)
  i18n.ts             UI language (follows VS Code or wright.language)
  sidebar.ts          status bar item and the Show All Repositories command
  diffProvider.ts     wright: read-only file system serving file contents at a revision for vscode.diff
  gitExtension.ts     git path and state events from the built-in Git extension
  testApi.ts          state and actions exposed to the real VS Code tests only
  git/                runs the git CLI, parses its output, three-way merge (no vscode dependency, directly testable)
  shared/             shared by extension and webview: message protocol, graph layout, linear-branch collapsing, ref labels, trees
  webview/            the log panel, side-bar Branches, Commit window and dialog UIs (plain TypeScript + Canvas, no framework)
media/webview.css     styles; every color comes from VS Code theme variables
```
