# Configuration: `.claude/wavework.json`

wavework reads one JSON file from the repository root. Unknown keys are rejected at every level, and all problems are reported together as `<json.path>: <reason>`. A complete example is [`examples/shipir.wavework.json`](../examples/shipir.wavework.json).

Minimal valid config:

```json
{
  "baseBranch": "main",
  "checks": [
    { "name": "app", "dir": ".", "whenPaths": ["src/"], "focused": "npm test", "full": "npm test" }
  ]
}
```

## Fields

| Path | Type | Required | Default |
|---|---|---|---|
| `baseBranch` | string | yes | none |
| `worktree.pathPattern` | string | no | `"../{repo}-{unit}"` |
| `worktree.branchPattern` | string | no | `"{prefix}/{unit}-{slug}"` |
| `checks` | array of areas, at least one | yes | none |
| `models.planning` | string | no | `"opus"` |
| `models.orchestration` | string | no | `"opus"` |
| `models.implementers.default` | string | no | `"sonnet"` |
| `models.implementers.rules` | map model name to text | no | haiku and sonnet rules (see `DEFAULTS` in `src/config.mjs`) |
| `tracker.kind` | `"beads"` | no | `"beads"` |
| `tracker.idPrefix` | bead ID prefix, e.g. `"shipr"` | no | derived by the code map checker from `.beads/` |
| `codeMap.path` | string, a `.md` file or a folder | required if `codeMap` is present | `codeMap` omitted |
| `codeMap.maxDescription` | integer 20 to 1000, folder layout only | no | `160` |
| `uiSkill.name` | string | required if `uiSkill` is present | `uiSkill` omitted |
| `uiSkill.appliesTo` | array of path prefixes, at least one | required if `uiSkill` is present | |
| `findings.epicTitles` | map category to epic title | no | four categories, see below |
| `attribution.allowAiTrailer` | boolean | no | `false` |
| `dashboard.enabled` | boolean | no | `true` |
| `dashboard.port` | integer 1024 to 65535 | no | `4690` |
| `dashboard.tokensFile` | repo-relative path to a `.css` file | no | omitted |

All strings must be non-empty.

### `baseBranch`

Branch that work branches from and is pushed back to. Example: `"dev"`.

### `worktree`

Each run works in its own git worktree. Patterns use placeholders in braces.

- `pathPattern`: allowed placeholders `{repo}` (repository directory name) and `{unit}` (epic or bead ID). Must contain `{unit}`. Example: `"../{repo}-{unit}"`.
- `branchPattern`: allowed placeholders `{prefix}` (`epic` or `task`), `{unit}` and `{slug}` (2 to 5 lowercase words from the title). Must contain `{unit}`. Example: `"{prefix}/{unit}-{slug}"`.

Any other placeholder is an error.

### `checks`

One entry per area of the codebase with its own test commands. Area names must be unique.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Unique area name, e.g. `"backend"` |
| `dir` | string | yes | Directory commands run from, relative to the repo root (no leading `/`, no `..` segments; `.` is fine) |
| `whenPaths` | array of strings, at least one | yes | Path prefixes relative to the repo root (no leading `/`, no `..` or `.` segments such as `./x`); `.` alone means the whole repo; the area counts as changed when a changed file path starts with one |
| `focused` | string | yes | Command for the changed part only |
| `full` | string | yes | Command for the whole area |
| `lint` | string | no | Lint command |
| `build` | string | no | Build command |
| `e2e` | string | no | Browser or end-to-end command |

### `models`

Which model each role uses (Claude Code model aliases such as `opus`, `sonnet`, `haiku`). `implementers.default` is used when no rule picks another; `implementers.rules` maps a model name to the text that says when to use it. Example:

```json
"implementers": { "default": "sonnet", "rules": { "haiku": "Small, low-risk changes only." } }
```

When `rules` is given it replaces the default rules entirely.

### `tracker`

`kind` must be `"beads"`, the only supported tracker.

`idPrefix` (optional): the prefix of your bead IDs, with or without the trailing `-` (`"shipr"` for `shipr-abc1`; stored as `shipr-`). Only the code map checker uses it (it must not find bead IDs in code map entries). Without it the checker reads the prefix at run time from `.beads/config.yaml` (an uncommented `issue-prefix:`), else from the first ID in `.beads/issues.jsonl`, and skips the rule when it finds none. Set it when your repo has neither.

### `codeMap` (optional)

Lets agents find files without reading the whole codebase. Omit the whole object if the repo has no code map. `path` is repo-relative (no leading `/`, no `..` segments) and selects one of two layouts:

- **File layout:** `path` ends in `.md`, e.g. `"docs/CODE_MAP.md"`. One file with one line per source file (`path: what it is`) that implementers keep current. Nothing is checked and no script is installed; the rendered skills are the same as in 0.1.x.
- **Folder layout:** `path` does not end in `.md`, e.g. `"docs/code-map"`. The folder holds one map file per module (any depth) and an `index.md` that maps path prefixes to those files. Agents read the index, open only the module file for their path, and update its lines in the same change; each entry is one line `- <path>[, <path>...]: <description>` of at most `maxDescription` characters. `init` and `update` require `<path>/index.md` (a real folder and file, no symlinks) and fail with `codeMap.path "...": must contain index.md` otherwise; the path may only contain letters, digits, `.`, `_`, `-` and `/`, and `.` itself is not allowed. The folder layout also installs `.claude/scripts/code-map-check.mjs`; `next-task-finish` runs it and fixes violations before committing, `next-task-review` runs it read-only. Switching the layout in the config and running `update` adds or removes the script (a locally edited copy is kept for review).

A path without `.md` is always a folder: in 0.1.2 an extension-less single file such as `"docs/CODE_MAP"` was accepted, now `update` fails until you add the `.md` suffix.

`maxDescription` (folder layout only, default 160): the longest description the checker accepts and the skills tell agents to write. Using it with a `.md` path is an error.

The checker (`node .claude/scripts/code-map-check.mjs [dir] [--id-prefix p-] [--max N]`) enforces, per entry: description length, no bead ID (see `tracker.idPrefix`), every path exists with exact case (`{A,B}` braces and `*`, `?`, `**` globs allowed; the path must be normalized and inside the repository), no path listed twice; per folder: every map file is linked from `index.md` and every index link exists. Exit code 0 ok, 1 violations printed as `file:line: message`, 2 usage error.

### `uiSkill` (optional)

A skill implementers must read before touching UI. `name`: the skill name, `appliesTo`: repo-relative path prefixes it covers (no leading `/`, no `..` segments). Example: `{ "name": "apple-design", "appliesTo": ["frontend/"] }`.

### `findings.epicTitles`

Maps a finding category (any key) to the title of its standing epic. Defaults: `security` "Findings: Security & authorization", `bugs` "Findings: Bugs & correctness", `tests` "Findings: Tests & CI stability", `quality` "Findings: Code quality, UI & docs". Categories you give override the default title; the others keep theirs.

### `attribution`

`allowAiTrailer`: `false` (default) means commits and PRs carry no AI attribution trailers. Set `true` to allow them.

### `dashboard`

The pipeline dashboard (see [dashboard.md](dashboard.md)). `enabled: false` leaves out the `Record:` lines in the skills, the runtime in `.claude/wavework/dashboard/` and its two hooks; `update` removes what an earlier run installed. `port`: where the server listens (127.0.0.1 only). `tokensFile`: a CSS file of your design tokens (no leading `/`, no `..` or `.` segments, no backslash, must end in `.css`) that the UI loads after its neutral default theme. Example: `{ "port": 4690, "tokensFile": "frontend/src/shared/styles/tokens.css" }`.

## API

`src/config.mjs` exports `validateConfig(raw)` (pure), `loadConfig(repoRoot)` (reads `.claude/wavework.json`, errors name the file) and `DEFAULTS`.
