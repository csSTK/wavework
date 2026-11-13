# Lock file

`wavework init` and `wavework update` record what they wrote in `.claude/wavework.lock.json`. Commit it. `update` uses it to tell files wavework wrote (safe to overwrite) from files you edited (kept).

```json
{
  "lockVersion": 1,
  "version": "0.1.0",
  "files": {
    "skills/next-task/SKILL.md": "<sha256 hex of the rendered content>",
    "scripts/red-green-check.sh": "<sha256 hex>"
  },
  "hooks": [
    { "event": "PreToolUse", "entry": { "matcher": "Bash", "hooks": [{ "type": "command", "command": "..." }] } }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `lockVersion` | Format of this file, currently `1`. An unknown value is an error. |
| `version` | wavework version that last ran. |
| `files` | Path relative to `.claude/` (`/`-separated) to the sha256 of the content wavework last wrote, or of the last version you accepted. |
| `hooks` | The entries wavework added to `.claude/settings.json` (the hook definitions come from `templates/settings/hooks.json`; entries under `features.<name>` count only while the config enables that feature, currently `dashboard`). `event` is the key under `hooks`, `entry` one element of its array. |

`wavework.json`, `wavework.lock.json` and `settings.json` are never listed in `files`: wavework does not write the first, writes the other two itself.

## Rules for `update`

For each rendered file, compared with the lock hash `L`, the file on disk `D` and the new content `N`:

| Situation | Action |
| --- | --- |
| `D` missing, `L` present | Recreate it (`restore`). |
| `D` missing, no `L` | Write it (`create`). |
| `D` equals `N` | Nothing to write; lock set to `N`. |
| `D` equals `L` (untouched) | Overwrite with `N`, lock set to `N`. |
| `D` differs from `L`, and `N` equals `L` | You edited it, upstream did not change: keep silently. |
| `D` differs from `L`, `N` differs | Keep your file, write `<file>.wavework-new` with `N`, report it, exit code 2. The lock keeps `L`, so it is reported again on every update until you resolve it (merge, then delete the `.wavework-new` file; make the file equal `N`, or revert it to the old content). |
| File exists, no `L` (not written by wavework) | Treated as edited: keep, `.wavework-new`, exit 2. |

Files in the lock that the new version no longer renders: gone from disk, dropped from the lock; `D` equals `L`, deleted (empty directories under `.claude/` are removed); edited, kept and reported (exit 2), lock entry kept.

Hooks: entries are compared by content (key order ignored). `update` adds defined entries that are missing and removes the entries listed in `hooks` that are no longer defined. Entries you added, and owned entries you changed afterwards, are never touched. An owned entry you changed or removed is not re-added; every `update` reports it as `hook <event>: owned entry changed locally, not re-added` (exit code 0). To silence it, delete that entry from `hooks` in `.claude/wavework.lock.json`. When no owned entry is left, an emptied event (and an emptied `hooks` object) is removed.

A `.wavework-new` file that still exists keeps its file reported even when `N` equals `L` and nothing changed upstream: that is how files from `init --adopt` stay reported until resolved.

## `init --adopt`

`wavework init --adopt` starts from a repository that already has hand-written files at the target paths. It uses the same plan as `update` with an empty lock, except for files that exist with different content: those are kept, `<file>.wavework-new` gets the rendered content `N`, and the lock records the hash of `N` (not of the file). The result for each rendered file:

| Situation | Action |
| --- | --- |
| `D` missing | Write it (`create`). |
| `D` equals `N` | Keep, lock `N`. A script with the right content but the wrong exec bit gets the bit fixed (`mode`). |
| `D` differs from `N` | Keep your file untouched, write `<file>.wavework-new`, list it with a `+N -M` line summary, lock `N`, exit code 2. |

The `+N -M` summary counts lines, so a CRLF file against the LF rendered version shows every line as changed; `, whitespace/newline only` marks files that differ only in the trailing newline, and `, upper bound` marks very large differences where the count is not exact.

Because the lock holds `N`, a later `update` sees `D` differs from `L` with `N` equal to `L`; a surviving `.wavework-new` makes it report the file again (exit 2). Merge into your file and delete the `.wavework-new`, or make the file equal `N`, and the reports stop. The same path safety applies, the whole plan is checked before anything is written, and `--dry-run` writes nothing. `--adopt` refuses an existing lock and, without `.claude/wavework.json`, requires `--config <file>`.

`--dry-run` prints the plan, writes nothing and returns the same exit code.

## Safety

Every path from the templates and from the lock must be a plain relative path below `.claude/`: no `..`, `.` or empty segments, no leading `/`, no drive letters or backslashes, and not one of the three reserved files. Neither `.claude/` nor any existing component on the way may be a symlink (also not one pointing inside `.claude/`), and files are replaced via a temporary file plus rename, never written through a link. The whole plan is checked before anything is written, so a bad path or a tampered lock fails the run (exit 1) with the repository unchanged.
