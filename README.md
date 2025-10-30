# @kb-labs/devlink

[![npm version](https://img.shields.io/npm/v/@kb-labs/devlink.svg?style=flat-square)](https://www.npmjs.com/package/@kb-labs/devlink)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![ESM](https://img.shields.io/badge/Module-ESM-purple.svg?style=flat-square)](https://nodejs.org/api/esm.html)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)

Developer linker and ecosystem orchestrator for KB Labs. A fast and flexible tool that automates local package linking, version sync, and publishing across multiple repositories using Yalc and PNPM — optimized for solo and team workflows.

## Features

- **Auto-Discovery** ![Discovery](https://img.shields.io/badge/Discovery-Automatic-green.svg?style=flat-square): Automatically scans repositories and detects local packages with dependencies.
- **Smart Linking** ![Linking](https://img.shields.io/badge/Linking-Smart-blue.svg?style=flat-square): Intelligent linking strategies (`auto`, `local`, `npm`) with dependency graph analysis.
- **Watch Mode** 🆕 ![Watch](https://img.shields.io/badge/Watch-Live-brightgreen.svg?style=flat-square): Live file watching with automatic rebuild and consumer refresh — zero manual steps.
- **Version Management** ![Versions](https://img.shields.io/badge/Versions-Managed-orange.svg?style=flat-square): Policy-driven version pinning, upgrades, and prerelease handling.
- **State Tracking** ![State](https://img.shields.io/badge/State-Tracked-purple.svg?style=flat-square): Persistent state snapshots and rollback capabilities.
- **Yalc Integration** ![Yalc](https://img.shields.io/badge/Yalc-Integrated-red.svg?style=flat-square): Leverages Yalc for reliable local package publishing.
- **PNPM Optimized** ![PNPM](https://img.shields.io/badge/PNPM-Optimized-yellow.svg?style=flat-square): Built specifically for PNPM workspaces and monorepos.

## Why DevLink?

Working across multiple repositories in a local development environment can be challenging:

- **Manual linking** is error-prone and time-consuming
- **Version mismatches** between linked packages cause hard-to-debug issues
- **State management** across repos requires careful coordination
- **Team workflows** need reproducible linking strategies

DevLink solves these problems by providing:

✅ **Zero-config discovery** — automatically finds and links packages  
✅ **Deterministic linking** — reproducible across machines and CI  
✅ **Policy enforcement** — version rules applied consistently  
✅ **Observable state** — explicit state files show what's linked where  
✅ **Team-friendly** — share linking plans via lockfiles

## Install

```bash
pnpm add -D @kb-labs/devlink
# or
npm i -D @kb-labs/devlink
```

## Quick start

### 1. Check status

```bash
# Show current linking state
kb devlink status

# Check for drift from saved state
kb devlink status --check
```

### 2. Generate linking plan

```bash
# Auto mode: smart linking based on local availability
kb devlink plan

# Local mode: force all packages to use local versions
kb devlink plan --mode=local

# NPM mode: use registry versions only
kb devlink plan --mode=npm
```

The plan shows what will be linked, where, and at what version.

### 3. Apply the plan

```bash
# Link packages according to the plan
kb devlink apply

# Or skip confirmation prompts (for CI/CD)
kb devlink apply --yes
```

### 4. Freeze state (optional)

```bash
# Create a lockfile for reproducible linking
kb devlink freeze
```

### 5. Watch for changes (optional)

```bash
# Start watch mode for automatic rebuild & refresh
kb devlink watch

# Watch detects changes → rebuilds providers → refreshes consumers
```

### 6. Rollback if needed

```bash
# Undo last operation
kb devlink undo

# Or list all backups and restore a specific one
kb devlink backups --list
kb devlink undo --backup=2025-10-30T20-25-33
```

## Core Concepts

### Discovery Phase

DevLink scans repositories to build a dependency graph:

```
┌──────────────────────┐
│   discovery phase    │
│  scan repositories   │
│  detect packages     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│     graph phase      │
│ build dependency DAG │
│ compute relations    │
└──────────────────────┘
```

### Linking Modes

- **`auto`** (default): Smart mode - uses `workspace:` for same-monorepo packages, `link:` for cross-repo packages
- **`local`**: Forces all dependencies to use local versions with `link:` protocol (fails if not found)
- **`workspace`**: Uses `workspace:` protocol for local packages, falls back to npm for others
- **`npm`**: Uses only npm registry versions (no local linking)

### Version Policies

Control how versions are handled during linking:

- **Pin**: `exact`, `caret`, `tilde`, `none`
- **Upgrade**: `none`, `patch`, `minor`, `major`
- **Prerelease**: `allow`, `block`, `only`

Example:

```bash
# Pin exact versions, no upgrades, block prereleases
devlink plan --pin=exact --upgrade=none --prerelease=block

# Allow caret ranges, upgrade to latest minor, allow prereleases
devlink plan --pin=caret --upgrade=minor --prerelease=allow
```

### State Management

All DevLink operations produce explicit state files under `.kb/devlink/`:

```
.kb/devlink/
├── state.json           # Current package graph and discovery results
├── plan.json            # Generated linking plan (before execution)
├── lock.json            # Frozen state (for reproducibility)
├── last-apply.json      # Journal of last operation (for undo)
└── backups/             # Timestamped backups of package.json files
    └── 2025-10-11T18-54-53.261Z/
        ├── packages/a/package.json
        └── packages/b/package.json
```

### Safety Features

DevLink includes built-in safety mechanisms to prevent accidental data loss:

- **Git Dirty Detection**: Warns when uncommitted changes exist in `package.json` or lockfiles (respects `.gitignore`)
- **Automatic Backups**: Creates timestamped backups before mutating files with full metadata
- **Confirmation Prompts**: Blocks operations unless `--yes` flag is provided (in CI/CD)
- **Dry Run Mode**: Preview changes without executing (`--dry-run`)
- **Undo Support**: Restore previous state with `kb devlink undo`
- **Backup Management**: List, show, protect, and restore from any backup with `kb devlink backups`

Example warning:
```bash
⚠️  Uncommitted changes detected in: packages/a/package.json (and 2 more)
   DevLink will modify package.json files. Consider committing first.
   Use --yes to skip this warning and proceed anyway.
```

## Architecture Flow

```
      ┌──────────────────────┐
      │   discovery phase    │
      │  scan repositories   │
      │  detect packages     │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │     graph phase      │
      │ build dependency DAG │
      │ compute relations    │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │      plan phase      │
      │ generate link plan   │
      │ apply policy rules   │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │     freeze phase     │
      │  lock versions & io  │
      │   produce .kb lock   │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │      persist         │
      │ save state snapshot  │
      │ track drift & diffs  │
      └──────────────────────┘
```

## CLI Commands

| Command                   | Description                                   |
| ------------------------- | --------------------------------------------- |
| `kb devlink scan [roots...]` | Discover packages and build dependency graph  |
| `kb devlink plan`            | Generate linking plan based on current state  |
| `kb devlink apply`           | Apply linking plan (uses Yalc under the hood) |
| `kb devlink switch`          | Switch between linking modes                  |
| `kb devlink update`          | Update dependencies and relink packages       |
| `kb devlink watch`           | 🆕 Watch providers and auto-rebuild/refresh consumers |
| `kb devlink freeze`          | Create lockfile for reproducible linking      |
| `kb devlink status`          | Show current linking state                    |
| `kb devlink undo`            | Restore previous state from backup            |
| `kb devlink backups`         | Manage backup snapshots                       |
| `kb devlink clean`           | Remove temporary files and caches             |
| `kb devlink clean --hard`    | Also remove lock file                          |
| `kb devlink clean --deep`    | Deep clean including global yalc store         |

### CLI Options

```bash
# Linking modes
--mode=auto          # Smart linking (default)
--mode=local         # Force local only
--mode=npm           # Force npm registry only

# Version policies
--pin=exact          # Exact version pinning
--pin=caret          # Caret ranges (^1.2.3)
--pin=tilde          # Tilde ranges (~1.2.3)
--pin=none           # No version constraints

--upgrade=none       # No version upgrades (default)
--upgrade=patch      # Allow patch upgrades
--upgrade=minor      # Allow minor upgrades
--upgrade=major      # Allow major upgrades

--prerelease=block   # Block prerelease versions (default)
--prerelease=allow   # Allow prereleases
--prerelease=only    # Only use prereleases

# Safety options
--yes                # Skip confirmation prompts (for CI/CD)
--dry-run            # Show what would happen without executing

# Other options
--verbose            # Detailed output
--json               # JSON output for scripting
--force              # Force operation even with warnings
```

## Packages

This monorepo includes:

| Package                                    | Description                                               |
| ------------------------------------------ | --------------------------------------------------------- |
| [`@kb-labs/devlink-core`](./packages/core) | Core engine: discovery, graph, planning, state management |
| `@kb-labs/devlink-cli`                     | Command-line interface (coming soon)                      |

## Use Cases

- **Multi-repo development**: Work on multiple interdependent repositories simultaneously
- **Library development**: Test library changes in consuming applications locally
- **Monorepo workflows**: Manage dependencies across workspace packages
- **Version testing**: Test different version combinations before publishing
- **Team coordination**: Share reproducible linking states via lockfiles
- **CI/CD integration**: Validate linking plans in continuous integration

## Design Principles

- **Deterministic**: Reproducible linking across machines and CI
- **Composable**: CLI is a thin wrapper; all logic in `@kb-labs/devlink-core`
- **Isolated**: Never mutates `node_modules` directly; uses Yalc
- **Observable**: Everything produces explicit state and plan files
- **Safe**: Built-in preflight checks, backups, and confirmation prompts
- **Fast**: Optimized for PNPM workspaces and large monorepos

## ⚖️ Comparison

### DevLink vs Yalc

| Aspect               | DevLink                                                                      | Yalc                                       |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| **Purpose**          | High-level orchestrator with discovery, linking policies, and state tracking | Low-level package linker for local testing |
| **Automation**       | Full — scans, plans, freezes, and rolls back automatically                   | Manual — requires explicit link/unlink     |
| **State & Policies** | Maintains `.kb/devlink/state.json` and version policies                      | No state or version management             |
| **Integration**      | Works with PNPM, DevKit, and KB Labs Studio                                  | Standalone utility                         |

> DevLink uses Yalc under the hood but extends it with orchestration, analytics, and reproducibility.

---

### DevLink vs pnpm link

| Aspect                | DevLink                                       | pnpm link                         |
| --------------------- | --------------------------------------------- | --------------------------------- |
| **Scope**             | Cross-repository linking and version sync     | Single-workspace symbolic linking |
| **Governance**        | Centralized policy engine                     | None                              |
| **CI/CD Integration** | Deterministic builds with lock-state tracking | Local-only linking                |
| **Reversibility**     | Rollback and drift detection                  | No rollback mechanism             |

---

### DevLink vs npm/yarn link

| Aspect        | DevLink                                        | npm/yarn link             |
| ------------- | ---------------------------------------------- | ------------------------- |
| **Ecosystem** | PNPM-first, monorepo and polyrepo friendly     | Legacy monorepo linking   |
| **Workflow**  | Declarative (`devlink plan`, `devlink freeze`) | Manual linking            |
| **State**     | Persisted lock and state files                 | None                      |
| **Safety**    | Version-aware, rollback-safe                   | Can break dependency tree |

---

## Configuration

Create `.devlink.config.json` in your project root to customize behavior:

```json
{
  "roots": ["~/projects/repo-a", "~/projects/repo-b"],
  "mode": "auto",
  "policy": {
    "pin": "exact",
    "upgrade": "none",
    "prerelease": "block"
  },
  "exclude": ["node_modules", "dist"],
  "include": ["packages/*"]
}
```

## DevKit Integration

This project uses `@kb-labs/devkit` for shared tooling configurations:

- **TypeScript**: `@kb-labs/devkit/tsconfig/node.json`
- **ESLint**: `@kb-labs/devkit/eslint/node.js`
- **Prettier**: `@kb-labs/devkit/prettier/index.json`
- **Vitest**: `@kb-labs/devkit/vitest/node.js`
- **Tsup**: `@kb-labs/devkit/tsup/node.js`

To sync DevKit assets:

```bash
pnpm devkit:sync
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more details on DevKit integration.

## Architecture Decision Records (ADR)

This project follows architectural decision records to document important design decisions.

See [`docs/adr/`](./docs/adr/) for the full list of ADRs.

## Examples

### Example 1: Basic workflow

```bash
# Check current status
kb devlink status

# Generate and apply linking plan
kb devlink plan
kb devlink apply --yes

# Check what's linked
kb devlink status
```

### Example 2: Multi-repo development

```bash
# Generate plan with exact versions
kb devlink plan --pin=exact

# Apply the plan (with safety confirmation)
kb devlink apply

# Freeze for reproducibility
kb devlink freeze
```

### Example 3: Active development with watch mode

```bash
# Link packages in local mode
kb devlink apply --mode local

# Start watching for changes
kb devlink watch

# Now edit any provider package
# → Watch detects change → rebuilds → refreshes consumers
# → All automatic! ✨

# Watch specific packages only
kb devlink watch --providers "@kb-labs/cli-*"

# See what would be watched (dry run)
kb devlink watch --dry-run
```

See [docs/WATCH.md](./docs/WATCH.md) for complete watch mode documentation.

### Example 4: CI/CD Integration

```bash
# In CI, skip confirmation prompts
kb devlink apply --yes

# Or use dry-run to validate without executing
kb devlink plan --dry-run

# Restore from lock file in CI
kb devlink apply --from-lock --yes
```

### Example 6: Testing prerelease versions

```bash
# Allow prerelease versions
kb devlink plan --prerelease=allow --upgrade=minor

# Apply and test
kb devlink apply

# Rollback if needed
kb devlink rollback
```

### Example 7: Managing backups

```bash
# List all backups
kb devlink backups --list

# Show details of a specific backup
kb devlink backups --show 2025-10-30T20-25-33

# Protect an important backup from cleanup
kb devlink backups --protect 2025-10-30T20-25-33

# Restore from a specific backup (if you need to go back further than undo)
kb devlink undo --backup=2025-10-30T20-25-33

# Run cleanup to remove old backups (keeps protected ones)
kb devlink backups --cleanup
```

## FAQ

### General

- **Why DevLink instead of just using Yalc?** — DevLink adds auto-discovery, policy enforcement, state management, and team workflows on top of Yalc.
- **Does this work with npm/yarn?** — DevLink is optimized for PNPM, but core concepts could be adapted.
- **Can I use this in CI?** — Yes! Use `kb devlink freeze` to create a lockfile, then `kb devlink apply --yes` in CI for reproducible linking.
- **What about security?** — DevLink only operates on local filesystems and doesn't make network calls (except via Yalc).

### Workflow

- **How do I update links after code changes?** — Use `kb devlink watch` for automatic rebuild and refresh. Or manually: rebuild your package and consumers will pick up changes (if using link: mode) or run `yalc update`.
- **Can I mix local and npm packages?** — Yes! Use `auto` mode to link local packages when available and fall back to npm for others.
- **How do I share linking state with my team?** — Use `kb devlink freeze` to create a lockfile, commit it, and teammates can `kb devlink apply` to replicate your setup.
- **What is watch mode?** — `kb devlink watch` monitors provider packages, rebuilds them on changes, and automatically refreshes consumers. See [docs/WATCH.md](./docs/WATCH.md) for details.

### Troubleshooting

- **Links not working?** — Run `kb devlink status --check` to see if state has drifted.
- **Version conflicts?** — Use `--pin=exact` to force exact versions, or adjust upgrade policy.
- **Need to start fresh?** — Run `kb devlink clean` to remove all DevLink state, then re-scan.
- **Stale artifacts?** — Run `kb devlink clean --deep` to remove yalc artifacts and protocol conflicts.
- **Blocked by git warnings?** — Commit your changes or use `--yes` to proceed anyway.
- **Need to restore a backup?** — Use `kb devlink backups --list` to see all backups, then `kb devlink undo` to restore the latest, or `kb devlink undo --backup=timestamp` for a specific backup.

## Documentation

- **[Watch Mode Guide](./docs/WATCH.md)** — Complete guide to live watching and automatic rebuild
- **[Architecture Decision Records](./docs/adr/)** — Design decisions and rationale
  - [ADR-0022: Watch Mode Implementation](./docs/adr/0022-watch-mode-implementation.md)
  - [ADR-0010: Local Linking and Watch Pipeline](./docs/adr/0010-local-linkind-and-watch-pipelin.md)
  - [ADR-0009: Core Architecture](./docs/adr/0009-core-architecture.md)
- **[Contributing Guide](./CONTRIBUTING.md)** — Guidelines for contributors

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT © 2025 KB Labs — Built for automated developer ecosystems.
