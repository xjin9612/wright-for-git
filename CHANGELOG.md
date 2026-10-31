# Changelog

## Unreleased

### Sync
- Fetch in the Branches toolbar; Pull and Push in the log toolbar. Pull follows your `pull.rebase` setting
- Push opens a Push Commits dialog first: each repository's target (`branch → remote : branch`, editable), the commits to push and their changed files (double-click for the diff), and a Push tags option (`--follow-tags`)
- Force Push (with lease) lives in the dialog's Push drop-down and asks for confirmation; it never uses a plain `--force`
- A branch that is not on the remote yet is marked New and gets its upstream set on the first push; a remote branch with commits you don't have is flagged before you push
- Push All up to Here… in the commit context menu pushes only up to the selected commit
- In multi-repository workspaces, Fetch, Pull and Push cover every repository visible under the Paths filter, one after another, with a single combined summary
- Local branches show ↑ahead ↓behind their upstream in the Branches tree, or `gone` when the upstream was deleted

### Branches
- Context menu: Checkout, New Branch from…, Compare with Current, Show in Log, Show in New Tab, Merge into Current, Rebase Current onto, Update, Push…, Rename…, Delete, Push Tag…
- Deleting an unmerged branch asks before forcing; deleting a remote branch or a tag always asks first
- Same-name branches across repositories are handled in one go
- Favorites: star a branch to pin it to the top of its group; the ★ toolbar button shows only favorites (`main` / `master` are favorites by default)

### Commit log
- Select several commits with `Ctrl` / `Shift` (or `Shift+↑↓`, `Ctrl+A`): the right pane shows their combined changes, and the context menu can copy their hashes or cherry-pick / revert them in one go
- Context menu: New Branch…, New Tag… (optionally annotated), Cherry-Pick, Revert Commit (asks for the mainline parent on merge commits), Reset Current Branch to Here… (soft / mixed / hard; hard asks first and warns about uncommitted changes), Compare with Local
- On conflicts, offers to open Source Control to resolve them, or to abort
- Date filter: last 24 hours / 7 / 30 / 90 days / year, or a custom period
- A hint appears when the Branch filter leaves out the current branch, with one-click Show HEAD / Show all branches
- Text and User filters now draw a simplified graph that links each result to its nearest matching ancestor
- Author, Date and Hash columns can be resized by dragging their left edge (double-click to reset)
- Several log tabs, each with its own filters: 👁 → New Log Tab, or Show in New Tab on a branch

### Stashes
- New Stashes view in the side bar: list per repository, expand to see the files (including untracked ones), click a file for the diff
- Apply, Apply with Index, Pop, Drop, Unstash as Branch…; Stash Changes… with an optional message and a choice of tracked only, including untracked, or keeping staged changes

### Changed files
- Switch between tree and flat list; file-type icons
- In a diff opened from the log, step to the previous / next changed file from the editor title bar or with `Ctrl+Alt+PageUp` / `Ctrl+Alt+PageDown`

### Other
- The panel UI follows the VS Code display language (English and Traditional Chinese)
- `@vscode/vsce` is now a dev dependency, so CI no longer downloads it on every run
- New commands: Git Workbench: Fetch / Pull / Push… / Stash Changes… / Previous Changed File / Next Changed File

## 1.0.0

First release.

### Tool window
- Git panel at the bottom: Branches | Commit log | Changed files + commit details — three linked, resizable, collapsible panes
- Open it from the Git Workbench icon in the Activity Bar, "Git Log" in the status bar, or `Alt+9`
- Follows the VS Code theme (light and dark)

### Branches
- Local / Remote / Tags tree, grouped into folders by `/`; search, jump to the current branch, expand / collapse all
- Click to filter the log, double-click to check out (a remote branch creates a tracking branch)

### Commit log
- Commit graph with colored lanes and a HEAD marker
- Ref labels: matching local and remote branches merged into one label (`origin & main`), tags, detached HEAD
- Filters: text or hash (regex, match case), Branch, User (supports `me`), Paths
- Highlights: Conventional Commits type coloring, bold for your own commits, dimmed merge commits
- Columns: Author (`*` when author ≠ committer), Date, Hash
- Virtual scrolling with streamed loading; context menu to copy hash / subject and check out a revision

### Changed files and details
- Changed files tree (added in green, modified in blue, deleted in gray); double-click opens VS Code's native diff
- Full message, author / committer, refs, and the branches that contain the commit

### Multiple repositories
- Scans workspace folders for repositories (configurable depth and exclusions), including folders that are not repositories and repositories nested inside other repositories
- Commits from all repositories merged by time; each repository gets its own graph lanes and a color strip
- Paths filter: select repositories first; with a single repository you can drill into folders
- Same-name branches are merged; double-click checks them out in every repository at once
- The Repositories view in the side bar stays in sync with the Paths filter

### Other
- "Show Git History" from the Explorer and editor context menus
- Refreshes automatically when branches, tags or HEAD change
