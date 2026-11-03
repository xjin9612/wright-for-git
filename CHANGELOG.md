# Changelog

## Unreleased

### Changed files
- `Ctrl+C` in a changed-files tree (commit details, stashes, push and unstash dialogs) copies the selected file's name; on a folder it copies the folder's path in the repository, on a repository row the repository name
- `F4` in the log's commit details and the Commit window's stash files opens the selected file from the working tree (like Jump to Source). Rebind it in Keyboard Shortcuts: *Git Workbench: Open Selected File in Changed Files*
- Context menu on files in the log's commit details (also with the Menu key or `Shift+F10`): Show Diff, Open File, Open Repository Version (the file as of that commit, read-only), Copy File Name, Copy Path

### Commit window
- Open File opens a regular tab instead of a preview, so opening several files no longer replaces the previous one; a file that no longer exists shows a status-bar message

### Commit log
- Opening the log starts at the top of the list, like IntelliJ: the last selected commit (or HEAD) is still selected and shown in the details, but the list no longer scrolls to it
- *Go to HEAD* button in the toolbar selects HEAD and scrolls to it
- The settings (gear) has a *Keyboard shortcuts* link that opens Keyboard Shortcuts filtered to Git Workbench, e.g. to rebind `F4`

### Branches
- The Branches view options (group by, favorites only) use the eye icon like the other view options; the gear stays for options that change what a command does, like the Commit window's commit options
- In the side bar, the Branches view options menu opens below its button instead of covering the toolbar

### Loading
- Opening the log in a large workspace no longer shows a blank panel while repositories are found and read: the log shows *Loading repositories…*, VS Code's progress bar runs at the top of the panel and on its tab, and the side-bar Branches shows *Loading…*. The Commit window shows VS Code's progress bar on its first load

### Pop-ups
- With many entries (or a short panel), the User filter's input box was squeezed to a thin line, and menu items could get shorter; inputs and items now keep their height and only the list scrolls
- A menu opened from a button that doesn't fit below it (Paths with many repositories) now scrolls below the button instead of moving up and covering the filter bar
- Menus, the User filter's list and the custom date range now close when you click outside the panel (the editor, another view) or start typing there; they used to stay open
- The Paths menu's *Ctrl+Click to show only that repository* hint moved under the search box, like the User filter's hint, and no longer scrolls away at the end of a long list

### Keyboard
- Keys a Git Workbench panel handles itself (such as `Shift+F10` for the context menu, arrows, `Enter`) no longer also run a VS Code shortcut bound to the same key — e.g. with an IntelliJ keymap, `Shift+F10` used to open the menu and the Run Task list at once

## 1.3.0

### Side bar
- Two Activity Bar icons instead of one: **Commit** (the Commit window) and **Git History**, which shows the Branches tree in the side bar and opens the log below it. While the side-bar Branches is showing, the log hides its own Branches pane so the commit list gets the full width; switch the side bar to something else and the pane comes back. Selecting a branch, the context menu, the toolbar, favorites and options all work as in the log's pane
- The Commit icon no longer opens the log panel
- The Repositories view is gone; its checkboxes duplicated the Paths filter, which now has Show All Repositories and a search box

### Commit log
- Branch and Paths menus have a search box: type to narrow the list (remote branches and tags show their type), `↑` `↓` to move, `Enter` to pick (`Ctrl+Enter` in Paths shows only that repository), `Esc` clears the search first
- `Ctrl+C` with several commits selected copies all of their hashes (it used to copy only one), like Copy N Revision Numbers in the context menu

### Other
- Declares that it needs a trusted workspace, with the reason shown in Restricted Mode (it runs git, and a repository's Git config and hooks can run commands)

## 1.2.0

### Commit log
- Collapse Linear Branches / Expand Linear Branches in the 👁 menu, like IntelliJ's Graph Options: long runs of branch commits fold into one `⋯ N commits` row drawn with a dotted line. The branch's newest and oldest commits stay visible, the main line (HEAD's first-parent history) and commits with a branch or tag are never folded, and only runs of at least 3 commits are folded. Click the row (or press `Enter`) to expand it; click a branch line, or use Collapse Linear Branch in the context menu, to fold one run. Jumping to a folded commit expands its run

### Large repositories
- New command **Git Workbench: Optimize Repository (speed up history)** writes git's commit-graph (`--changed-paths`), which makes the first screen of the log about 6× faster and file path filters about 5× faster in a 100,000-commit repository. It is never suggested automatically; see "Large repositories" in the README

### Other
- `npm run bench:vscode` measures log loading in a generated 100,000-commit repository inside a real VS Code, with and without a commit-graph
- Tests that run inside a real VS Code (`npm run test:vscode`): native diffs, commands, file watching and the built-in Git integration, in CI on Windows and Linux and on the minimum supported version 1.90.0
- Annotate with Git Blame (toggle) on VS Code older than 1.96 (which has no built-in blame) now says so instead of failing with a settings error
- Paths → Select… can be used with the keyboard: `↑` `↓` move, `→` expands or enters a folder, `←` collapses or goes up, `Space` checks; `↓` in the filter box moves into the list
- Accepting a side of a conflict no longer waits for the "all conflicts are resolved" notification to be dismissed

## 1.1.0

### Commit window
- New Commit view in the Git Workbench side bar (`Alt+0`), next to Repositories, modeled on IntelliJ's Commit tool window. It works alongside VS Code's Source Control and never touches your staging area: only the checked files are committed, through a temporary index
- Changes, Unversioned Files, Ignored Files and Merge Conflicts in one tree with checkboxes; group by directory, repository or module (the nearest folder with a `package.json`, `pom.xml`, `go.mod`, … ); tree or flat; file-type icons
- Partial commits: Select Changes to Commit… picks individual hunks of a file (shown as `2/5 changes`); Commit Whole File goes back to the full file
- Commit, Commit and Push…, Amend last commit (loads the previous message), Sign-off, Skip Git hooks; `Ctrl+Enter` commits. Committing across several repositories creates one commit per repository with the same message
- Context menu: Show Diff, Open File, Rollback… (restores modified and deleted files to HEAD; added files go back to unversioned; asks first), Add to .gitignore, Copy Path, Move to Another Changelist…
- Changelists: create, rename, delete, set the active one; new changes go to the active changelist. Stored per workspace
- Stash tab: the stash list of every repository with its files, grouped by directory, repository or module like the log, untracked files listed separately (double-click for the diff); Apply, Apply with Index, Pop, Unstash as Branch…, Drop, Clear All Stashes…; Stash Changes… from the toolbar. This replaces the separate Stashes view

### Sync
- Fetch in the Branches toolbar; Pull and Push in the log toolbar. Pull follows your `pull.rebase` setting
- Push opens a Push Commits dialog in an editor tab (drag it to another group or a new window): each repository's target (`branch → remote : branch`, editable), the commits to push and their changed files as a tree grouped by directory, repository or module like the log (double-click for the diff; the grouping is remembered), and a Push tags option (`--follow-tags`)
- The dialog opens with all commits of the first repository selected, so the file tree shows everything you are about to push combined into net changes; click a repository row to see all of its commits again, a commit to see just that one, or `Ctrl` / `Shift`-click to combine several
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
- While a rebase, merge, cherry-pick or revert is in progress, a bar above the log offers Continue, Skip and Abort (Abort asks first)
- Issue numbers in commit messages become links: `#123` opens the issue on the repository's remote (GitHub, GitLab, …) by default; `gitWorkbench.issueLinks` replaces this with your own patterns (e.g. `PROJ-123` → your tracker)
- On conflicts, offers Resolve Conflicts… or Abort
- Date filter: last 24 hours / 7 / 30 / 90 days / year, or a custom period
- A hint appears when the Branch filter leaves out the current branch, with one-click Show HEAD / Show all branches
- Text and User filters now draw a simplified graph that links each result to its nearest matching ancestor
- Author, Date and Hash columns can be resized by dragging their left edge (double-click to reset)
- Several log tabs, each with its own filters: 👁 → New Log Tab, or Show in New Tab on a branch

### Merge conflicts
- Resolve conflicts the IntelliJ way, for merge, rebase, cherry-pick, revert and stash conflicts alike
- The Conflicts tab lists every repository's conflicted files with what each side did (Modified / Added / Deleted); Accept Yours, Accept Theirs, or Merge… a file. When a repository has no conflicts left, a Continue button finishes the merge, rebase or cherry-pick
- The Merge tab shows Yours, Result and Theirs side by side. Each change has ≫ (apply) and ✕ (ignore); applying both sides of a conflict keeps both, yours first. Line by Line gives every line of a conflict its own ≫ ✕. The Result column is editable, and applying a change again replaces what you typed. Apply Non-Conflicting Changes, previous / next change (`F7` / `Shift+F7`), undo / redo for clicks and typing alike (`Ctrl+Z` / `Ctrl+Shift+Z`), Apply with `Ctrl+Enter`; Open in VS Code Merge Editor is one click away
- Files that are not UTF-8 text can still be resolved by accepting one side
- The Commit window's Merge Conflicts group shows the kind of conflict (both modified, deleted by them, …), has a Resolve… link, and its context menu offers Merge…, Resolve Conflicts…, Accept Yours, Accept Theirs and Mark as Resolved (asks first when the file still has conflict markers); double-click opens the merge
- The bar above the log shows the number of conflicts and a Resolve Conflicts… link, also for stash conflicts where no operation is in progress
- New command: Git Workbench: Resolve Conflicts…

### Changed files
- Group by directory, repository or module from the 👁 menu; switch between tree and flat list; file-type icons
- In a diff opened from the log, step to the previous / next changed file with the ← → buttons in the editor title bar (separate from VS Code's own ↑↓ for changes) or with `Ctrl+Alt+PageUp` / `Ctrl+Alt+PageDown`; the tab title shows the position, like `1/5`

### Git console
- Every git command Git Workbench runs is written to the Output panel's **Git Workbench** channel, like IntelliJ's Git Console: the repository, the full command line, how long it took, and git's own output (for example `To origin … main -> main`)
- Failed commands are logged as errors with the exit code and git's error text; error notifications have a **Show Git Console** button
- Read-only queries (log, status, …) are logged at the Trace level, so they stay out of the way until you set the channel's log level to Trace
- Open it from the log panel's title bar or with **Git Workbench: Show Git Console**

### Explorer and editor
- Explorer context menu → Git Workbench: Show History, Compare with Branch or Tag…, Stash Changes…, Unstash Changes…
- Unstash Changes opens a dialog in an editor tab: pick a stash, see its files (grouped like the log, untracked files listed separately), Apply / Pop / Drop / Clear, or unstash as a branch
- Editor context menu: Toggle Git Blame, which switches VS Code's built-in blame annotations

### Accessibility and look
- Menus work from the keyboard: `Shift+F10` or the Menu key opens the context menu of the selected row, arrows and `Home` / `End` move, `→` / `←` open and close submenus, `Enter` runs, `Esc` closes; shortcuts are shown next to menu items
- Changed files show a status letter (`A`, `M`, `D`, `R`, `U`, `!`) at the end of the row, so the status no longer depends on color alone
- File status colors come from the theme's git decoration colors, the same as the Explorer and Source Control
- High contrast themes get borders and outlines for hover, selection, menus and dialogs; lists show a keyboard focus outline; the loading bar stops when reduced motion is on
- File icons are single-color line icons by file kind; graph and repository colors are darker in light themes
- Commit type highlighting colors only `feat`, `fix` and `revert`; other types use the secondary text color
- Empty states offer the next step: Clear filters when nothing matches, Refresh in an empty Commit window, Stash Changes… in an empty Stash tab
- Dialog buttons follow the platform order (on Windows the primary button comes first)

### Other
- English and Traditional Chinese UI. The new `gitWorkbench.language` setting switches the panel, dialogs and messages independently of the VS Code display language (`auto` follows VS Code)
- Confirmations triggered from the panel or a dialog tab (delete, force push, hard reset, checkout a tag or revision, rollback, …) are shown inside it in the same style as the Push dialog; destructive actions use a red button with Cancel focused
- The gear in the Git log's and the Commit window's title bar opens a settings popover right in the panel: language (Follow VS Code / English / 繁體中文), max commits, repository scan depth and auto refresh take effect immediately; links lead to the issue link rules and all settings
- `@vscode/vsce` is now a dev dependency, so CI no longer downloads it on every run
- UI end-to-end tests (`npm run test:ui`, Playwright) run in CI on Windows and Linux
- New commands: Git Workbench: Fetch / Pull / Push… / Stash Changes… / Unstash Changes… / Show Commit Window / Toggle Git Blame / Open Settings / Show Git Console / Resolve Conflicts… / Previous Changed File / Next Changed File

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
