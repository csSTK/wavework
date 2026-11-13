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
| `codeMap.path` | string | required if `codeMap` is present | `codeMap` omitted |
| `uiSkill.name` | string | required if `uiSkill` is present | `uiSkill` omitted |
| `uiSkill.appliesTo` | array of path prefixes, at least one | required if `uiSkill` is present | |
| `findings.epicTitles` | map category to epic title | no | four categories, see below |
| `attribution.allowAiTrailer` | boolean | no | `false` |

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
| `dir` | string | yes | Directory commands run from, relative to the repo root |
| `whenPaths` | array of strings, at least one | yes | Path prefixes relative to the repo root (no leading `/`, no `..` segments); the area counts as changed when a changed file path starts with one |
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

### `codeMap` (optional)

`path`: file listing one line per source file that implementers keep current. Example: `"docs/CODE_MAP.md"`. Omit the whole object if the repo has no code map.

### `uiSkill` (optional)

A skill implementers must read before touching UI. `name`: the skill name, `appliesTo`: path prefixes it covers. Example: `{ "name": "apple-design", "appliesTo": ["frontend/"] }`.

### `findings.epicTitles`

Maps a finding category (any key) to the title of its standing epic. Defaults: `security` "Findings: Security & authorization", `bugs` "Findings: Bugs & correctness", `tests` "Findings: Tests & CI stability", `quality` "Findings: Code quality, UI & docs". Categories you give override the default title; the others keep theirs.

### `attribution`

`allowAiTrailer`: `false` (default) means commits and PRs carry no AI attribution trailers. Set `true` to allow them.

## API

`src/config.mjs` exports `validateConfig(raw)` (pure), `loadConfig(repoRoot)` (reads `.claude/wavework.json`, errors name the file) and `DEFAULTS`.
