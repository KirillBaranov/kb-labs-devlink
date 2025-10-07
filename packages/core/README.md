# @kb-labs/devlink-core

[![npm version](https://img.shields.io/npm/v/@kb-labs/devlink-core.svg?style=flat-square)](https://www.npmjs.com/package/@kb-labs/devlink-core)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![ESM](https://img.shields.io/badge/Module-ESM-purple.svg?style=flat-square)](https://nodejs.org/api/esm.html)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](../../LICENSE)

Core engine for **KB Labs DevLink** — the local linking and orchestration layer for multi-repository ecosystems.  
It automates package discovery, dependency graphing, plan generation, and version freezing across workspaces and repositories.

---

## 🚀 Overview

`@kb-labs/devlink-core` provides the low-level primitives used by the KB Labs DevLink CLI.  
It enables developers to:

- Discover local packages and their dependency graph.
- Compute linking plans (`auto`, `local`, or `npm` mode).
- Freeze or unfreeze dependency states.
- Track changes across repositories with persistent state snapshots.

This package focuses on automation, reproducibility, and deterministic linking — reducing manual setup to **zero**.

---

## 📦 Key Modules

| Module      | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `discovery` | Scans repositories and detects local packages with dependencies.    |
| `graph`     | Provides helper functions for dependency graph traversal.           |
| `policy`    | Defines version pinning, upgrade, and prerelease policies.          |
| `state`     | Loads and saves DevLink state snapshots (`.kb/devlink/state.json`). |
| `clean`     | Cleans temporary files, backup folders, and lockfiles.              |
| `rollback`  | Restores previous DevLink states from backups.                      |
| `types`     | Shared type definitions for all DevLink packages.                   |
| `utils`     | Helper utilities for file system, hashing, and logging.             |

---

## 🧩 Usage Example

```ts
import {
  discover,
  computePlan,
  freezeToLock,
  saveState,
} from "@kb-labs/devlink-core";

// 1. Discover local packages
const state = await discover({ roots: ["/path/to/repo"] });
await saveState(state);

// 2. Generate linking plan
const plan = computePlan(state, "auto", {
  pin: "exact",
  upgrade: "none",
  prerelease: "block",
});

// 3. Freeze plan to lockfile
const lock = freezeToLock(plan);
console.log(lock);
```

---

## 🧠 Design Principles

- **Deterministic**: reproducible linking across machines and CI.
- **Composable**: CLI is just a thin wrapper; all logic lives here.
- **Isolated**: never mutates node_modules directly.
- **Observable**: everything produces explicit state and plan files under `.kb/devlink`.

---

## 🧰 CLI Integration

This core package is used by `@kb-labs/devlink-cli`, which provides commands:

| Command    | Description                              |
| ---------- | ---------------------------------------- |
| `scan`     | Discover and save package graph.         |
| `plan`     | Generate linking plan.                   |
| `freeze`   | Create a lockfile (npm-pinned).          |
| `unfreeze` | Remove lockfile and revert to auto-mode. |
| `status`   | Show current devlink state.              |
| `clean`    | Remove temporary data and caches.        |
| `rollback` | Restore previous state snapshot.         |

---

## 🧩 Architecture Flow

Below is a high-level overview of the DevLink core pipeline:

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

Each phase is modular and can be invoked independently via the DevLink CLI or consumed programmatically.  
The output of every phase is a typed structure (`Graph`, `Plan`, `Lock`, `State`) stored under `.kb/devlink/`.

---

## 📖 API Reference

### Discovery

```ts
import { discover } from "@kb-labs/devlink-core";

interface DiscoveryOptions {
  roots: string[]; // Repository root paths to scan
  exclude?: string[]; // Patterns to exclude
  include?: string[]; // Patterns to include
}

const packages = await discover(options);
```

### Graph

```ts
import { buildGraph, traverseGraph } from "@kb-labs/devlink-core";

// Build dependency graph
const graph = buildGraph(packages);

// Traverse graph (depth-first)
traverseGraph(graph, (node) => {
  console.log(node.name, node.dependencies);
});
```

### Policy

```ts
import { applyPolicy } from "@kb-labs/devlink-core";

interface Policy {
  pin: "exact" | "caret" | "tilde" | "none";
  upgrade: "none" | "patch" | "minor" | "major";
  prerelease: "allow" | "block" | "only";
}

const plan = applyPolicy(graph, policy);
```

### State

```ts
import { saveState, loadState } from "@kb-labs/devlink-core";

// Save state to .kb/devlink/state.json
await saveState(state);

// Load state from disk
const state = await loadState();
```

### Clean

```ts
import { clean } from "@kb-labs/devlink-core";

// Remove temporary files and caches
await clean({ includeBackups: false });
```

### Rollback

```ts
import { rollback } from "@kb-labs/devlink-core";

// Restore previous state from backup
await rollback({ target: "previous" });
```

---

## 🧪 Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test --coverage
```

---

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev

# Type-check
pnpm type-check

# Lint
pnpm lint
```

---

## 📁 Project Structure

```
src/
├── discovery/          # Package discovery logic
│   ├── discovery.ts
│   └── index.ts
├── graph/              # Dependency graph utilities
│   ├── graph.ts
│   └── index.ts
├── policy/             # Version policy engine
│   ├── policy.ts
│   └── index.ts
├── state/              # State management
│   └── index.ts
├── clean/              # Cleanup utilities
│   ├── clean.ts
│   └── index.ts
├── rollback/           # Rollback functionality
│   ├── rollback.ts
│   └── index.ts
├── types/              # Shared type definitions
│   ├── types.ts
│   └── index.ts
├── utils/              # Helper utilities
│   ├── fs.ts           # File system helpers
│   ├── hash.ts         # Hashing utilities
│   └── logger.ts       # Logging utilities
└── index.ts            # Main entry point
```

---

## 🚀 Features

- **Auto-discovery**: Automatically scans repositories and detects local packages
- **Smart linking**: Intelligent linking strategies based on dependency graph
- **Version policies**: Configurable version pinning and upgrade rules
- **State tracking**: Persistent state snapshots for reproducibility
- **Rollback support**: Restore previous states from backups
- **Type-safe**: Full TypeScript support with strict types
- **Fast**: Optimized for PNPM workspaces and large monorepos
- **Observable**: Explicit state files show what's happening

---

## 🔗 Related Packages

- [`@kb-labs/devlink`](../../) — Monorepo root with documentation
- `@kb-labs/devlink-cli` — Command-line interface (coming soon)

---

## 📄 License

MIT © 2025 KB Labs — Built for automated developer ecosystems.
