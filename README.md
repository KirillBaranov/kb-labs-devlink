# KB Labs DevLink

> Automate switching cross-repo dependencies between `link:` (local dev) and `^version` (npm/CI) across all KB Labs monorepos.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9+-orange.svg)](https://pnpm.io/)

**The problem it solves:** KB Labs spans 18 monorepos with 90+ packages. Cross-repo dependencies use `link:` for local development but must be `^version` when committed. Manually editing 534 entries across 55 files before every push is error-prone and slow.

**The solution:** One command switches all of them. Git hooks do it automatically.

---

## Quick start

```bash
# See what would change (without touching anything)
pnpm kb devlink plan

# Switch all cross-repo deps to npm versions
pnpm kb devlink switch --mode=npm

# Switch back to local link: for development
pnpm kb devlink switch --mode=local

# Undo the last switch
pnpm kb devlink undo
```

---

## How it works

DevLink scans the root `pnpm-workspace.yaml`, walks all 18 submodule monorepos, builds a map of every `@kb-labs/*` package with its `link:` path and npm version. It then rewrites `dependencies`, `devDependencies`, and `peerDependencies` in every `package.json` that references a cross-repo package.

**Before switch (local mode):**
```json
"@kb-labs/sdk": "link:../kb-labs-sdk/packages/sdk"
```

**After switch (npm mode):**
```json
"@kb-labs/sdk": "^1.2.0"
```

Only packages **published to npm** are managed — private packages (`"private": true`) and packages not found in the registry are left untouched.

---

## Commands

### `devlink switch`

Switches all cross-repo dependencies to the target mode.

```bash
pnpm kb devlink switch --mode=local      # link: paths for local dev
pnpm kb devlink switch --mode=npm        # ^version for CI/commit

# Preview without touching files
pnpm kb devlink switch --mode=npm --dry-run

# Limit to specific monorepos
pnpm kb devlink switch --mode=npm --repos=kb-labs-cli,kb-labs-core

# JSON output
pnpm kb devlink switch --mode=npm --json
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--mode` | `local\|npm` | required | Target mode |
| `--dry-run` | boolean | false | Preview only, no writes |
| `--repos` | string | all | Comma-separated list of monorepos to scope |
| `--json` | boolean | false | Machine-readable output |
| `--ttl` | number | 24 | npm registry cache TTL in hours |

**What happens:**
1. Discovers all 18 monorepos via `pnpm-workspace.yaml`
2. Checks npm registry for each package (cached 24h in `.kb/cache/`)
3. Builds a plan of all changes
4. Creates a backup of all affected `package.json` files
5. Applies changes atomically
6. Saves state to `.kb/devlink/state.json`

---

### `devlink status`

Shows current state of all cross-repo dependencies.

```bash
pnpm kb devlink status
pnpm kb devlink status --json     # for scripts/hooks
```

**Output:**
```
┌── DevLink — Status
│
│ Current mode
│  Mode: local
│  Last applied: 2026-02-24T13:27:43.522Z
│
│ Dependency counts
│  link: (local)   : 534
│  npm (^version)  : 366
│  workspace:*     : 1245
│
└── OK Success / 2ms
```

---

### `devlink plan`

Shows exactly what `switch` would change, without touching anything.

```bash
pnpm kb devlink plan              # preview opposite mode
pnpm kb devlink plan --mode=npm   # explicit target mode
pnpm kb devlink plan --json       # machine-readable
```

Groups changes by monorepo and shows `from → to` for each dependency:

```
kb-labs-cli (12 deps)
  @kb-labs/sdk: link:../kb-labs-sdk/packages/sdk → ^1.2.0  ×8 files
  @kb-labs/shared: link:../kb-labs-shared/packages/shared → ^0.3.1  ×4 files

kb-labs-core (6 deps)
  @kb-labs/contracts: link:../kb-labs-contracts → ^2.0.0  ×6 files
```

---

### `devlink undo`

Restores the previous state from the last backup. No arguments needed.

```bash
pnpm kb devlink undo
```

Reads `.kb/devlink/backups/<last-id>/` and copies all backed-up `package.json` files back to their original locations. Updates state to the mode that was active before the backup.

---

### `devlink backups`

Lists all available backups and allows restoring a specific one.

```bash
# List all backups
pnpm kb devlink backups

# Restore a specific backup by ID
pnpm kb devlink backups --restore 1771938550173-r3x7a
```

Backups are stored in `.kb/devlink/backups/` and created automatically before every `switch`.

---

### `devlink freeze`

Saves the current dependency state to `.kb/devlink/lock.json`. Useful for CI to verify state hasn't drifted.

```bash
pnpm kb devlink freeze
pnpm kb devlink freeze --json
```

---

## Git hooks automation

DevLink ships with git hooks that automate the switching workflow. The hooks are managed by **devkit-sync** and distributed to all 18 monorepos automatically.

### How it works

**`pre-commit`** — runs before every `git commit` in any submodule:
1. Finds the kb-labs root by walking up directories
2. Checks if already in npm mode (skips if yes — instant on 2nd+ commit)
3. Switches to npm mode (first commit in a session only)

**`post-push`** — runs after every `git push`:
1. Checks if currently in npm mode
2. Restores to local mode + clears plugin cache

### Typical session

```
$ git commit -m "feat: add something"
[devlink] switching to npm mode...
✓ Switched to npm mode (534 changes)
[main abc1234] feat: add something

$ git commit -m "fix: typo"
# Hook detects npm mode → skips instantly
[main def5678] fix: typo

$ git push origin main
# post-push hook
[devlink] restoring local mode after push...
✓ Undo: restored 55 files
```

### Hook source

Hooks live in `kb-labs-devkit/scripts/hooks/` and are synced to all repos via:

```bash
pnpm --filter @kb-labs/devkit run devkit:sync
# or in any subrepo:
pnpm devkit:sync
```

New developers get hooks automatically on `pnpm install` (via `postinstall → devkit:sync`).

---

## Package structure

```
kb-labs-devlink/
├── packages/
│   ├── devlink-contracts/      # Zod schemas + TypeScript types
│   │   └── src/
│   │       ├── schema.ts       # DevlinkMode, DevlinkPlan, DevlinkBackup, ...
│   │       ├── flags.ts        # CLI flag definitions
│   │       └── index.ts
│   ├── devlink-core/           # Business logic (no CLI deps)
│   │   └── src/
│   │       ├── discovery/      # Monorepo scanning, package map building
│   │       ├── plan/           # Change planning (buildPlan, groupByMonorepo)
│   │       ├── apply/          # Writing changes to package.json
│   │       ├── state/          # state.json + lock.json management
│   │       ├── backup/         # Backup create/list/restore
│   │       └── npm/            # npm registry check with caching
│   └── devlink-cli/            # CLI commands + plugin manifest
│       └── src/
│           ├── manifest.ts     # KB Labs plugin registration
│           └── cli/commands/
│               ├── switch.ts
│               ├── status.ts
│               ├── plan.ts
│               ├── undo.ts
│               ├── backups.ts
│               └── freeze.ts
```

---

## State files

All state is stored under `.kb/devlink/` in the kb-labs root (gitignored):

| File | Contents |
|------|----------|
| `.kb/devlink/state.json` | Current mode, last applied timestamp |
| `.kb/devlink/lock.json` | Frozen snapshot (from `devlink freeze`) |
| `.kb/devlink/backups/<id>/` | Per-backup directory with copied `package.json` files + `meta.json` |

---

## npm registry caching

To avoid slow registry lookups on every switch, DevLink caches which packages are published to npm.

- Cache TTL: **24 hours** (default), configurable via `--ttl <hours>`
- Cache location: `.kb/cache/` (uses platform `useCache()` API)
- Reset: `pnpm kb plugins clear-cache` also clears this cache

If a package is not found in the registry, it's excluded from switching (stays as-is). This prevents accidentally setting `^version` for packages that aren't published yet.

---

## Build

```bash
cd kb-labs-devlink

# Build all packages in order
pnpm -r --filter ./packages/... run build

# Or individually
pnpm --filter @kb-labs/devlink-contracts run build
pnpm --filter @kb-labs/devlink-core run build
pnpm --filter @kb-labs/devlink-cli run build

# Register with CLI
pnpm kb plugins clear-cache

# Verify
pnpm kb devlink --help
```

---

## License

MIT © KB Labs
