# Changelog

## Unreleased

### Commit window
- New Commit view in the Git Workbench side bar (`Alt+0`), next to Repositories, modeled on IntelliJ's Commit tool window. It works alongside VS Code's Source Control and never touches your staging area: only the checked files are committed, through a temporary index
- Changes, Unversioned Files, Ignored Files and Merge Conflicts in one tree with checkboxes; group by directory, repository or module (the nearest folder with a `package.json`, `pom.xml`, `go.mod`, … ); tree or flat; file-type icons
- Partial commits: Select Changes to Commit… picks individual hunks of a file (shown as `2/5 changes`); Commit Whole File goes back to the full file
- Commit, Commit and Push…, Amend last commit (loads the previous message), Sign-off, Skip Git hooks; `Ctrl+Enter` commits. Committing across several repositories creates one commit per repository with the same message
- Context menu: Show Diff, Open File, Rollback… (restores modified and deleted files to HEAD; added files go back to unversioned; asks first), Add to .gitignore, Copy Path, Move to Another Changelist…
- Changelists: create, rename, delete, set the active one; new changes go to the active changelist. Stored per workspace
- Stash tab: the stash list of every repository with its files (double-click for the diff); Apply, Apply with Index, Pop, Unstash as Branch…, Drop, Clear All Stashes…; Stash Changes… from the toolbar. This replaces the separate Stashes view

### Sync
- Fetch in the Branches toolbar; Pull and Push in the log toolbar. Pull follows your `pull.rebase` setting
- Push opens a Push Commits dialog in an editor tab (drag it to another group or a new window): each repository's target (`branch → remote : branch`, editable), the commits to push and their changed files (double-click for the diff), and a Push tags option (`--follow-tags`)
- Force Push (with lease) lives in the dialog's Push drop-down and asks for confirmation; the lease is bound to the remote state shown in the dialog, and it never uses a plain `--force`
- A branch that is not on the remote yet is marked New and gets its upstream set on the first push; a remote branch with commits you don't have is flagged before you push
- Push All up to Here… in the commit context menu pushes only up to the selected commit
- In multi-repository workspaces, Fetch, Pull and Push cover every repository visible under the Paths filter, one after another, with a single combined summary
- Local branches show ↑ahead ↓behind their upstream in the Branches tree, or `gone` when the upstream was deleted

### Branches
- Toolbar in IntelliJ's order: hide pane, New Branch, Update Selected, Delete, Compare with Current, Show Diff with Working Tree, Fetch, show only favorites, Navigate Log to Branch Head, options, expand / collapse all
- Options: group by directory, group by repository, show tags, navigate the log when a branch is selected
- In multi-repository workspaces each branch shows which repositories have it (up to three names, otherwise a count)
- Context menu: Checkout, New Branch from…, Compare with Current, Show Diff with Working Tree, Show in Log, Show in New Tab, Merge into Current, Rebase Current onto, Update, Push…, Rename…, Delete, Push Tag…
- Deleting an unmerged branch asks before forcing; deleting a remote branch or a tag always asks first
- Same-name branches across repositories are handled in one go
- Favorites: star a branch to pin it to the top of its group; the ★ toolbar button shows only favorites (`main` / `master` are favorites by default)

### Commit log
- Branch filter is a cascading menu like IntelliJ's: Select…, HEAD, favorites, then Local / Remote / Tags submenus; click the star to add or remove a favorite without closing the menu
- Paths filter: check repositories under Roots (`Ctrl+click` shows only that one), or Select Folders… to pick folders across several repositories
- Click the color strip to show or hide a repository-name column
- Selecting a commit dims the rows outside its path, so the line of history it belongs to stands out
- Select several commits with `Ctrl` / `Shift` (or `Shift+↑↓`, `Ctrl+A`): the right pane shows their combined changes, and the context menu can copy their hashes or cherry-pick / revert them in one go
- Context menu: New Branch…, New Tag… (optionally annotated), Cherry-Pick, Revert Commit (asks for the mainline parent on merge commits), Reset Current Branch to Here… (soft / mixed / hard; hard asks first and warns about uncommitted changes), Compare with Local, Interactively Rebase from Here…
- Interactive rebase in an editor tab: pick, reword (edit the message in place), edit, squash, fixup, drop; reorder by dragging or `Alt+↑↓`; single-key shortcuts. Local changes are stashed and restored automatically
- While a rebase, merge, cherry-pick or revert is in progress, a bar above the log offers Continue, Skip and Abort
- Issue numbers in commit messages become links: `#123` opens the issue on the repository's remote (GitHub, GitLab, …) by default; `gitWorkbench.issueLinks` replaces this with your own patterns (e.g. `PROJ-123` → your tracker)
- On conflicts, offers to open Source Control to resolve them, or to abort
- Date filter: last 24 hours / 7 / 30 / 90 days / year, or a custom period
- A hint appears when the Branch filter leaves out the current branch, with one-click Show HEAD / Show all branches
- Text and User filters now draw a simplified graph that links each result to its nearest matching ancestor
- Author, Date and Hash columns can be resized by dragging their left edge (double-click to reset)
- Several log tabs, each with its own filters: 👁 → New Log Tab, or Show in New Tab on a branch

### Changed files
- Group by directory, repository or module from the 👁 menu; switch between tree and flat list; file-type icons
- In a diff opened from the log, step to the previous / next changed file from the editor title bar or with `Ctrl+Alt+PageUp` / `Ctrl+Alt+PageDown`

### Explorer and editor
- Explorer context menu → Git Workbench: Show History, Compare with Branch or Tag…, Stash Changes…, Unstash Changes…
- Unstash Changes opens a dialog in an editor tab: pick a stash, see its files, Apply / Pop / Drop / Clear, or unstash as a branch
- Editor context menu: Toggle Git Blame, which switches VS Code's built-in blame annotations

### Other
- English and Traditional Chinese UI. The new `gitWorkbench.language` setting switches the panel, dialogs and messages independently of the VS Code display language (`auto` follows VS Code)
- Confirmations triggered from the panel or a dialog tab (delete, force push, hard reset, checkout a tag or revision, rollback, …) are shown inside it in the same style as the Push dialog; destructive actions use a red button with Cancel focused
- `@vscode/vsce` is now a dev dependency, so CI no longer downloads it on every run
- New commands: Git Workbench: Fetch / Pull / Push… / Stash Changes… / Unstash Changes… / Show Commit Window / Toggle Git Blame / Previous Changed File / Next Changed File

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
