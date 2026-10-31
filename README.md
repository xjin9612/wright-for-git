# Git Workbench

[![CI](https://github.com/xjin9612/vscode-git-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/xjin9612/vscode-git-workbench/actions/workflows/ci.yml)

English | [繁體中文](README.zh-TW.md)

An IntelliJ-style Git log for VS Code. **Branches tree | Commit log with graph | Changed files + commit details** — three linked panes in the bottom panel, with first-class support for workspaces that contain many repositories.

![Git Workbench](docs/images/screenshot.png)

## Features

- **Branches** — Local / Remote / Tags tree, grouped into folders by `/` (`feature/…`, `fix/…`). Search, jump to the current branch, expand / collapse all. Click a branch to filter the log; double-click to check it out.
- **Commit log**
  - Commit graph with colored lanes and a HEAD marker
  - Ref labels: matching local and remote branches are merged into one label (`origin & main`), plus tags and detached HEAD
  - Filters: text or hash (regex and match-case toggles), Branch, User (supports `me`), Paths. Multiple values are separated by `|` or new lines; `Enter` completes, `Ctrl+Enter` applies
  - Highlights: Conventional Commits type coloring (`feat`, `fix`, `docs`…), bold for your own commits, dimmed merge commits
  - Columns: Author (`*` when author ≠ committer), Date, Hash — toggle them from the 👁 menu
  - Virtual scrolling with streamed loading; tested with 100,000 commits
  - Context menu: copy hash / subject, checkout revision, new branch / tag, cherry-pick, revert, reset (soft / mixed / hard), compare with the working tree
- **Sync** — Fetch in the Branches toolbar, Pull and Push in the log toolbar. Push always opens a Push Commits dialog listing what will be pushed; Force Push (`--force-with-lease`) is in the dialog's drop-down. Push All up to Here… pushes only up to a chosen commit. Local branches show ↑ahead ↓behind in the Branches tree
- **Changed files** — tree with compacted folders and file counts; added in green, modified in blue, deleted in gray. Double-click (or `Enter`) opens VS Code's native diff.
- **Commit details** — full message, author / committer, refs, and the branches that contain the commit
- **Open it your way** — Git Workbench icon in the Activity Bar, "Git Log" in the status bar, or `Alt+9`
- **Show Git History** from the Explorer or editor context menu — jumps to the file's repository and filters by its path
- Refreshes automatically when branches, tags or HEAD change

## Multiple repositories

- Scans each workspace folder for repositories (`gitWorkbench.scanDepth`, `gitWorkbench.scanExclude`), including folders that are not repositories and repositories nested inside other repositories
- Commits from all repositories are merged by time into one log; each repository gets its own graph lanes and a color strip on the left (hover to see its name)
- **Paths** filter: the first level selects repositories; with a single repository selected you can drill into its folders (like IntelliJ's multi-root Paths filter)
- The **Repositories** view in the side bar stays in sync with the Paths filter
- Branches with the same name across repositories are merged into a single entry — double-click to check it out in all of them at once
- Fetch / Pull / Push run on every repository visible under the Paths filter, with one combined summary

## Keyboard (in the log)

| Key | Action |
|---|---|
| `↑` `↓` `PageUp` `PageDown` `Home` `End` | Move the selection |
| `Ctrl+C` | Copy the selected commit hash |
| `Ctrl+F` | Focus the search box |
| `Esc` (in the search box) | Clear the text filter |
| `Alt+9` (anywhere) | Show the Git log |

## Settings

| Setting | Default | Description |
|---|---|---|
| `gitWorkbench.maxCommits` | `50000` | Maximum number of commits loaded (total across repositories, up to 200000) |
| `gitWorkbench.autoRefresh` | `true` | Refresh when refs or HEAD change |
| `gitWorkbench.scanDepth` | `3` | How many folder levels below each workspace folder are scanned for repositories |
| `gitWorkbench.scanExclude` | `node_modules`, `target`, … | Folder names skipped while scanning |

## Installation

Download the `.vsix` from [Releases](https://github.com/xjin9612/vscode-git-workbench/releases), then run **Extensions: Install from VSIX…** in VS Code. Reload the window after installing or updating.

Requires VS Code 1.90 or later and Git on your `PATH` (or configured through the built-in Git extension).

## Development

```bash
npm install
npm run build       # build dist/
npm run typecheck   # type-check the extension and the webview
npm test            # unit and integration tests (requires git)
npm run package     # create the .vsix
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

### Releasing

1. Bump `version` in `package.json` and add a matching section at the top of `CHANGELOG.md` (`## 1.1.0`) — it becomes the release notes
2. Commit, then tag and push: `git tag v1.1.0 && git push origin v1.1.0`
3. GitHub Actions (`.github/workflows/release.yml`) checks the version, runs the tests, packages the `.vsix`, and publishes a GitHub Release using that CHANGELOG section as the notes

The release fails if the tag does not match `package.json` or the CHANGELOG has no section for the version. Versions containing `-` (e.g. `v1.1.0-beta.1`) are published as pre-releases.

### Architecture

```
src/
  extension.ts        entry point: registers the webview view, read-only file system and commands
  provider.ts         webview view: repository management, messaging, auto refresh, checkout
  sidebar.ts          Repositories view in the Activity Bar and the status bar item
  diffProvider.ts     git-workbench: read-only file system serving file contents at a revision for vscode.diff
  gitExtension.ts     git path and state events from the built-in Git extension
  git/                runs the git CLI and parses its output (no vscode dependency, directly testable)
  shared/             shared by extension and webview: message protocol, graph layout, ref labels, trees
  webview/            the three-pane UI (plain TypeScript + Canvas, no framework)
media/webview.css     styles; every color comes from VS Code theme variables
```

## License

[MIT](LICENSE)

Inspired by the Git tool window in IntelliJ IDEA. Not affiliated with or endorsed by JetBrains.
