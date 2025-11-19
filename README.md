# KB Labs DevLink (@kb-labs/devlink)

> **Developer linker and ecosystem orchestrator for KB Labs.** A fast and flexible tool that automates local package linking, version sync, and publishing across multiple repositories using Yalc and PNPM — optimized for solo and team workflows.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18.18.0+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.0.0+-orange.svg)](https://pnpm.io/)

## 🎯 Vision

KB Labs DevLink is a developer linker and ecosystem orchestrator for KB Labs. It automates local package linking, version sync, and publishing across multiple repositories using Yalc and PNPM, optimized for solo and team workflows.

The project solves the problem of manual, error-prone package linking across multiple repositories in a local development environment by providing automated discovery, policy enforcement, state management, and team workflows. Instead of manually linking packages with `pnpm link` or `yalc`, developers can use `kb devlink plan` and `kb devlink apply` to automatically link packages based on dependency graphs and policies.

This project is part of the **@kb-labs** ecosystem and integrates seamlessly with Core, CLI, Release Manager, and all other KB Labs tools.

## 🚀 Quick Start

### Installation

```bash
pnpm add -D @kb-labs/devlink
# or
npm i -D @kb-labs/devlink
```

### Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

### Basic Usage

#### 1. Check Status

```bash
# Show current linking state
kb devlink status

# Check for drift from saved state
kb devlink status --check
```

#### 2. Generate Linking Plan

```bash
# Auto mode: smart linking based on local availability
kb devlink plan

# Local mode: force all packages to use local versions
kb devlink plan --mode=local

# NPM mode: use registry versions only
kb devlink plan --mode=npm
```

The plan shows what will be linked, where, and at what version.

#### 3. Apply the Plan

```bash
# Link packages according to the plan
kb devlink apply

# Or skip confirmation prompts (for CI/CD)
kb devlink apply --yes
```

#### 4. Freeze State (Optional)

```bash
# Create a lockfile for reproducible linking
kb devlink freeze
```

#### 5. Watch for Changes (Optional)

```bash
# Start watch mode for automatic rebuild & refresh
kb devlink watch

# Watch detects changes → rebuilds providers → refreshes consumers
```

#### 6. Rollback if Needed

```bash
# Undo last operation
kb devlink undo

# Or list all backups and restore a specific one
kb devlink backups --list
kb devlink undo --backup=2025-10-30T20-25-33
```

## ✨ Features

- **Auto-Discovery**: Automatically scans repositories and detects local packages with dependencies
- **Smart Linking**: Intelligent linking strategies (`auto`, `local`, `npm`) with dependency graph analysis
- **Watch Mode**: Live file watching with automatic rebuild and consumer refresh — zero manual steps
- **Version Management**: Policy-driven version pinning, upgrades, and prerelease handling
- **State Tracking**: Persistent state snapshots and rollback capabilities
- **Yalc Integration**: Leverages Yalc for reliable local package publishing
- **PNPM Optimized**: Built specifically for PNPM workspaces and monorepos
- **Safety Features**: Git dirty detection, automatic backups, confirmation prompts, dry-run mode

## 📁 Repository Structure

```
kb-labs-devlink/
├── packages/                # Core packages
│   └── core/                # Core engine (discovery, graph, planning, state management)
├── docs/                    # Documentation
│   └── adr/                 # Architecture Decision Records
└── scripts/                 # Utility scripts
```

### Directory Descriptions

- **`packages/core/`** - Core engine for discovery, graph building, planning, and state management
- **`docs/`** - Documentation including ADRs and guides
- **`scripts/`** - Utility scripts for development and maintenance

## 📦 Packages

| Package | Description |
|---------|-------------|
| [@kb-labs/devlink-core](./packages/core/) | Core engine: discovery, graph, planning, state management, watch mode, and CLI integration |

### Package Details

**@kb-labs/devlink-core** provides the complete DevLink engine:
- **Discovery**: Scans repositories and detects local packages with dependencies
- **Graph Building**: Builds dependency DAG and computes relations
- **Planning**: Generates linking plans with policy enforcement
- **State Management**: Persistent state snapshots with rollback capabilities
- **Watch Mode**: Live file watching with automatic rebuild and refresh
- **CLI Integration**: Manifest v2-driven registration via `packages/core/src/manifest.v2.ts`

## 🛠️ Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development mode for all packages |
| `pnpm build` | Build all packages |
| `pnpm build:clean` | Clean and build all packages |
| `pnpm test` | Run all tests |
| `pnpm test:coverage` | Run tests with coverage reporting |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Lint all code |
| `pnpm lint:fix` | Fix linting issues |
| `pnpm format` | Format code with Prettier |
| `pnpm type-check` | TypeScript type checking |
| `pnpm check` | Run lint, type-check, and tests |
| `pnpm ci` | Full CI pipeline (clean, build, check) |
| `pnpm clean` | Clean build artifacts |
| `pnpm clean:all` | Clean all node_modules and build artifacts |

## 📋 Development Policies

- **Code Style**: ESLint + Prettier, TypeScript strict mode
- **Testing**: Vitest with comprehensive test coverage
- **Versioning**: SemVer with automated releases through Changesets
- **Architecture**: Document decisions in ADRs (see `docs/adr/`)
- **Design Principles**: Deterministic, composable, isolated, observable, safe, fast

## 🔧 Requirements

- **Node.js**: >= 18.18.0
- **pnpm**: >= 9.0.0

## ⚙️ Configuration

### DevLink Configuration

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

### Core Concepts

#### Discovery Phase

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

#### Linking Modes

- **`auto`** (default): Smart mode - uses `workspace:` for same-monorepo packages, `link:` for cross-repo packages
- **`local`**: Forces all dependencies to use local versions with `link:` protocol (fails if not found)
- **`workspace`**: Uses `workspace:` protocol for local packages, falls back to npm for others
- **`npm`**: Uses only npm registry versions (no local linking)

#### Version Policies

Control how versions are handled during linking:

- **Pin**: `exact`, `caret`, `tilde`, `none`
- **Upgrade**: `none`, `patch`, `minor`, `major`
- **Prerelease**: `allow`, `block`, `only`

Example:
```bash
# Pin exact versions, no upgrades, block prereleases
kb devlink plan --pin=exact --upgrade=none --prerelease=block

# Allow caret ranges, upgrade to latest minor, allow prereleases
kb devlink plan --pin=caret --upgrade=minor --prerelease=allow
```

#### State Management

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

#### Safety Features

DevLink includes built-in safety mechanisms to prevent accidental data loss:

- **Git Dirty Detection**: Warns when uncommitted changes exist in `package.json` or lockfiles (respects `.gitignore`)
- **Automatic Backups**: Creates timestamped backups before mutating files with full metadata
- **Confirmation Prompts**: Blocks operations unless `--yes` flag is provided (in CI/CD)
- **Dry Run Mode**: Preview changes without executing (`--dry-run`)
- **Undo Support**: Restore previous state with `kb devlink undo`
- **Backup Management**: List, show, protect, and restore from any backup with `kb devlink backups`

## 🏗️ Architecture

### Architecture Flow

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

## 💻 CLI Commands

| Command | Description |
|---------|-------------|
| `kb devlink scan [roots...]` | Discover packages and build dependency graph |
| `kb devlink plan` | Generate linking plan based on current state |
| `kb devlink apply` | Apply linking plan (uses Yalc under the hood) |
| `kb devlink switch` | Switch between linking modes |
| `kb devlink update` | Update dependencies and relink packages |
| `kb devlink watch` | Watch providers and auto-rebuild/refresh consumers |
| `kb devlink freeze` | Create lockfile for reproducible linking |
| `kb devlink status` | Show current linking state |
| `kb devlink undo` | Restore previous state from backup |
| `kb devlink backups` | Manage backup snapshots |
| `kb devlink clean` | Remove temporary files and caches |
| `kb devlink clean --hard` | Also remove lock file |
| `kb devlink clean --deep` | Deep clean including global yalc store |

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
```

## 💡 Use Cases

- **Multi-repo development**: Work on multiple interdependent repositories simultaneously
- **Library development**: Test library changes in consuming applications locally
- **Monorepo workflows**: Manage dependencies across workspace packages
- **Version testing**: Test different version combinations before publishing
- **Team coordination**: Share reproducible linking states via lockfiles
- **CI/CD integration**: Validate linking plans in continuous integration

## ⚖️ Comparison

### DevLink vs Yalc

| Aspect | DevLink | Yalc |
|--------|---------|------|
| **Purpose** | High-level orchestrator with discovery, linking policies, and state tracking | Low-level package linker for local testing |
| **Automation** | Full — scans, plans, freezes, and rolls back automatically | Manual — requires explicit link/unlink |
| **State & Policies** | Maintains `.kb/devlink/state.json` and version policies | No state or version management |
| **Integration** | Works with PNPM, DevKit, and KB Labs Studio | Standalone utility |

> DevLink uses Yalc under the hood but extends it with orchestration, analytics, and reproducibility.

### DevLink vs pnpm link

| Aspect | DevLink | pnpm link |
|--------|---------|-----------|
| **Scope** | Cross-repository linking and version sync | Single-workspace symbolic linking |
| **Governance** | Centralized policy engine | None |
| **CI/CD Integration** | Deterministic builds with lock-state tracking | Local-only linking |
| **Reversibility** | Rollback and drift detection | No rollback mechanism |

### DevLink vs npm/yarn link

| Aspect | DevLink | npm/yarn link |
|--------|---------|---------------|
| **Ecosystem** | PNPM-first, monorepo and polyrepo friendly | Legacy monorepo linking |
| **Workflow** | Declarative (`devlink plan`, `devlink freeze`) | Manual linking |
| **State** | Persisted lock and state files | None |
| **Safety** | Version-aware, rollback-safe | Can break dependency tree |

## 📚 Documentation

- [Documentation Standard](./docs/DOCUMENTATION.md) - Full documentation guidelines
- [Contributing Guide](./CONTRIBUTING.md) - How to contribute
- [`@kb-labs/devlink-contracts` Guide](./packages/contracts/README.md) - Public API manifest and schemas
- [Architecture Decisions](./docs/adr/) - ADRs for this project

**Guides:**
- [Watch Mode Guide](./docs/WATCH.md) - Complete guide to live watching and automatic rebuild

## 🔗 Related Packages

### Dependencies

- [@kb-labs/core](https://github.com/KirillBaranov/kb-labs-core) - Core utilities

### Used By

- All KB Labs projects for local package linking
- [@kb-labs/release-manager](https://github.com/KirillBaranov/kb-labs-release-manager) - Release orchestration

### Ecosystem

- [KB Labs](https://github.com/KirillBaranov/kb-labs) - Main ecosystem repository
- [`@kb-labs/devlink-contracts`](./packages/contracts/README.md) - Canonical contract definitions (CLI, REST, Studio, artifacts)

## ❓ FAQ

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

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and contribution process.

## 📄 License

MIT © KB Labs

---

**See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and contribution process.**
