<p align="center">
  <img src="media/icon.png" width="96" height="96" alt="Wright for Git">
</p>

<h1 align="center">Wright for Git</h1>

<p align="center"><strong>IntelliJ-style Git tool windows for VS Code, built for workspaces with many repositories.</strong></p>

<p align="center">
  <a href="https://github.com/xjin9612/wright-for-git/releases/latest"><img src="https://img.shields.io/github/v/release/xjin9612/wright-for-git" alt="Latest release"></a>
  <a href="https://github.com/xjin9612/wright-for-git/actions/workflows/ci.yml"><img src="https://github.com/xjin9612/wright-for-git/actions/workflows/ci.yml/badge.svg" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="#privacy-and-security"><img src="https://img.shields.io/badge/data%20collected-none-brightgreen" alt="No data collected"></a>
</p>

<p align="center">English | <a href="README.zh-TW.md">繁體中文</a></p>

See every repository in your workspace in one Git log with a real commit graph, and filter it by branch, author, path or date. Commit only the files and hunks you check, without touching the staging area, and organize work in changelists. Shelve changes across several repositories at once, rebase interactively, and resolve conflicts in a three-way merge view. If you know IntelliJ's Git tool window, you already know how to use it.

![The Git log: Branches tree, a commit graph merging two repositories, and the changed files and details of the selected commit](docs/screenshots/en/1-log.png)

## Install

- **VS Code Marketplace**: search for *Wright for Git* in the Extensions view, or run `ext install xjin9612.wright-for-git` from Quick Open (`Ctrl+P`)
- **Open VSX** (VSCodium, Cursor and others): [xjin9612/wright-for-git](https://open-vsx.org/extension/xjin9612/wright-for-git)
- **VSIX**: download it from [Releases](https://github.com/xjin9612/wright-for-git/releases), then run *Extensions: Install from VSIX…*

Then press `Alt+9` for the Git log or `Alt+0` for the Commit window, or click the *Git History* and *Commit* icons in the Activity Bar. Requires VS Code 1.90 or later and Git. See the [changelog](CHANGELOG.md) for what's new.

> Upgrading from Git Workbench? It was renamed to Wright for Git in 1.4.0 and installs as a new extension. Uninstall Git Workbench and copy your `gitWorkbench.*` settings to `wright.*`.

## Highlights

### All your repositories in one log

Commits from every repository in the workspace are merged by time into one log, each with its own graph lanes and color strip. Branches with the same name across repositories become one entry, so you can check out `feature/login` everywhere with a double-click. The Paths filter narrows the log to some repositories or folders, and Fetch, Pull and Push run on the repositories you're looking at.

### A Commit window that leaves your staging area alone

Check the files to commit, or pick single hunks of a file. Group changes into changelists, commit to several repositories with one message, amend, sign off, or Commit and Push. Commits go through a temporary index, so whatever you staged in VS Code's Source Control stays as it was.

![The Commit window with two changelists, one file partly selected, and the commit message box](docs/screenshots/en/2-commit.png)

### Shelve changes across repositories

Set changes aside without committing, from several repositories as one entry. Unshelve all or some of the files later, into a changelist of your choice. Shelves are kept inside the repositories, not in the stash list, and can be exported to `.patch` files that `git apply` and IntelliJ understand.

![Unshelving: picking files from two repositories and the changelist to put them in](docs/screenshots/en/3-shelf.gif)

### Interactive rebase by dragging

Reorder commits by dragging them or with `Alt+↑↓`, and pick, reword, edit, squash, fixup or drop each one. While a rebase, merge or cherry-pick is in progress, a bar above the log offers Continue, Skip and Abort.

![Dragging a commit to a new position in the interactive rebase tab, then squashing it](docs/screenshots/en/4-rebase.gif)

### Merge conflicts in a three-way view

The Conflicts tab lists every conflicted file with Accept Yours, Accept Theirs and Merge…. The Merge tab shows yours, an editable result and theirs side by side; take changes with ≫ and ✕, per change or per line, then apply and continue.

![The three-way merge tab with one conflict resolved and one left](docs/screenshots/en/5-merge.png)

## All features

**Git log**
- Commit graph with colored lanes; local and remote branches at the same commit share one label
- Filters: text or hash (with regex and match case), Branch, User (`me` for you), Paths (repositories and folders), Date
- Several log tabs, each with its own filters
- Select several commits to see their combined changes, then cherry-pick or revert them together
- Context menu: checkout, new branch or tag, cherry-pick, revert, reset, push up to here, compare with the working tree, interactively rebase from here
- Collapse long runs of branch commits into one `⋯ N commits` row
- Issue numbers in commit messages become links
- Fast on large repositories: 50,000 commits of a 100,000-commit repository load in about a second

**Branches**
- Local, Remote and Tags, grouped into folders by `/` or by repository, with ↑ahead ↓behind counts
- Click a branch to filter the log, double-click to check it out
- Star favorites to pin them, or show only favorites
- New branch, compare with current, merge, rebase, update, push, rename, delete

**Commit window**
- Commit checked files or single hunks; changelists; unversioned and ignored files
- Group by directory, repository or module
- Amend, sign-off, skip hooks, Commit and Push…
- Rollback changes, add files to `.gitignore`
- Stash tab: every repository's stashes, with their files and diffs

**Shelf**
- Shelve selected files or hunks across repositories, or keep a copy in the working tree
- Unshelve all, some files, or several entries in a row; conflicts open the conflict list
- Rename, delete, export to and import from `.patch` files

**Changed files**
- Tree or flat list, grouped by directory, repository or module
- Double-click opens VS Code's diff; ← → in the diff's title bar step through the files
- Open File (`F4`), Open Repository Version, Copy File Name (`Ctrl+C`), Copy Path
- Select In (`Alt+F1`): reveal the file in the Explorer view or File Explorer / Finder, or open a terminal in its folder

**Sync**
- Fetch, Pull, and a Push dialog that lists what will be pushed from each repository
- Force Push with lease; push only up to a chosen commit

**Elsewhere in VS Code**
- Explorer context menu: Show Git History, Compare with Branch or Tag…, Stash Changes…, Unstash Changes…, Import Patch to Shelf…
- Toggle Git Blame from the editor context menu
- Git console: every git command and its output in the Output panel's *Wright* channel
- English and Traditional Chinese interface

## Keyboard shortcuts

In the Git log:

| Key | Action |
|---|---|
| `↑` `↓` `PageUp` `PageDown` `Home` `End` | Move the selection |
| `Shift+↑↓`, `Ctrl`/`Shift`+click, `Ctrl+A` | Select several commits |
| `Ctrl+C` | Copy the selected commit hashes |
| `Ctrl+F` | Focus the search box |
| `Esc` (in the search box) | Clear the text filter |
| `Shift+F10` or the Menu key | Open the context menu |

In a changed-files tree:

| Key | Action |
|---|---|
| `Enter` | Show the diff |
| `F4` | Open the file from the working tree |
| `Alt+F1` | Select In: Explorer view, File Explorer / Finder, or terminal |
| `Ctrl+C` | Copy the file name (a folder: its path in the repository) |

Anywhere in VS Code, changeable in *Keyboard Shortcuts* (search for *Wright*):

| Key | Action |
|---|---|
| `Alt+9` | Show the Git log |
| `Alt+0` | Show the Commit window |
| `Ctrl+Alt+PageUp` / `Ctrl+Alt+PageDown` (in a diff) | Previous / next changed file |
| `F4` (in a changed-files tree) | Open the selected file |
| `Alt+F1` (in a changed-files tree) | Select In |

In the Commit window, `Ctrl+Enter` in the message box commits.

## Settings

Most settings can be changed from the gear in the Git log's or the Commit window's title bar and take effect right away.

| Setting | Default | Description |
|---|---|---|
| `wright.maxCommits` | `50000` | Maximum number of commits loaded (total across repositories, up to 200000) |
| `wright.autoRefresh` | `true` | Refresh when refs or HEAD change |
| `wright.defaultFavoriteBranches` | `["main", "master"]` | Favorite branches (local and remote) until you star or unstar one in the workspace; `[]` for none |
| `wright.scanDepth` | `3` | How many folder levels below each workspace folder are scanned for repositories |
| `wright.scanExclude` | `node_modules`, `target`, … | Folder names skipped while scanning |
| `wright.language` | `auto` | Language of the panel, dialogs and messages: `auto` (follow VS Code), `en`, `zh-tw` |
| `wright.issueLinks` | `[]` | Turn issue numbers in commit messages into links, e.g. `{ "pattern": "PROJ-(\\d+)", "url": "https://tracker.example.com/browse/PROJ-$1" }`. `$1`… are capture groups, `{repo}` is the repository's web URL. When empty, `#123` links to the remote's issues page |

## Privacy and security

Wright for Git collects no data and has no telemetry. It runs the `git` command line on your computer and connects to the network only when you fetch, pull or push, through git itself. Issue links open in your browser only when you click them.

It needs a trusted workspace: a repository's Git configuration and hooks can run any command, so the extension stays off in Restricted Mode. Commits from the Commit window never change your staging area, and actions that can lose work, such as a hard reset, force push, discarding changes or deleting a branch, ask first.

## FAQ

**Does it replace VS Code's Source Control?**<br>
No, both work side by side on the same repositories. The Commit window commits through its own temporary index, so it doesn't change what you staged in Source Control.

**I staged a file in Source Control, but it wasn't committed.**<br>
The Commit window commits the files and hunks checked in it, not the staging area. Check the file in the Commit window.

**Where are shelves kept? Are they pushed?**<br>
Each repository keeps its part of a shelf under `refs/wright/shelf/`. A normal `git push` doesn't push them, and they don't show up in `git stash list`. Use *Export Patch…* to move a shelf to another computer.

**How do I change `F4`, `Alt+F1`, `Alt+9` or `Alt+0`?**<br>
Click the gear in the Git log's title bar → *Keyboard shortcuts*, or search for *Wright* in *Keyboard Shortcuts*.

**The log is slow in a very large repository.**<br>
Run *Wright: Optimize Repository (speed up history)* from the Command Palette. It writes Git's commit-graph file (`git commit-graph write --reachable --changed-paths`): in a 100,000-commit repository the first screen appeared in about 0.1 s instead of 0.6 s, and filtering by a file path took about 0.2 s instead of 1.2 s. It only adds a file under `.git/objects/info`, changes no commits or files, and isn't pushed; deleting the file undoes it.

**Some of my repositories don't show up.**<br>
Repositories are found up to `wright.scanDepth` folder levels below each workspace folder (3 by default), skipping the folders in `wright.scanExclude`. Raise the depth or add the folder to the workspace.

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/xjin9612/wright-for-git/issues). Building, testing, releasing and the source layout are described in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

Inspired by the Git tool window in IntelliJ IDEA. Not affiliated with or endorsed by JetBrains.
