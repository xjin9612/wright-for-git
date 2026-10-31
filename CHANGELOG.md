# Changelog

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
