# wavework

wavework is a versioned Claude Code pipeline for beads repos. It runs `/next-task`-style work as waves of parallel sub-agents, with independent review, red-before-green test-first implementation and a findings backlog for problems found out of scope.

**Status: pre-release.** The package currently contains only the CLI skeleton (`--version`, `--help`). The `init`, `update` and `dashboard` commands are not implemented yet.

## Requirements

- Node.js 22 or newer
- A git repository that uses [beads](https://github.com/steveyegge/beads) (`bd`) for task tracking
- [Claude Code](https://claude.com/claude-code)

## License

MIT. See [LICENSE](LICENSE).
