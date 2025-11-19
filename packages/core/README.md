# @kb-labs/devlink-core

Core engine for KB Labs DevLink — local linking and orchestration layer for multi-repository ecosystems.

## Vision & Purpose

**@kb-labs/devlink-core** provides the core engine for KB Labs DevLink. It automates package discovery, dependency graphing, plan generation, and version freezing across workspaces and repositories.

### Core Goals

- **Package Discovery**: Discover local packages and their dependency graph
- **Linking Plans**: Compute linking plans (auto, local, or npm mode)
- **Version Freezing**: Freeze or unfreeze dependency states
- **State Tracking**: Track changes across repositories with persistent state snapshots

## Package Status

- **Version**: 0.1.0
- **Stage**: Stable
- **Status**: Production Ready ✅

## Architecture

### High-Level Overview

```
DevLink Core
    │
    ├──► Discovery
    ├──► Graph
    ├──► Policy
    ├──► State
    ├──► Clean
    ├──► Rollback
    ├──► CLI
    ├──► REST
    └──► Studio
```

### Key Components

1. **Discovery** (`discovery/`): Scans repositories and detects local packages
2. **Graph** (`graph/`): Dependency graph utilities
3. **Policy** (`policy/`): Version pinning, upgrade, and prerelease policies
4. **State** (`state/`): Loads and saves DevLink state snapshots
5. **Clean** (`clean/`): Cleans temporary files, backup folders, and lockfiles
6. **Rollback** (`rollback/`): Restores previous DevLink states from backups
7. **CLI** (`cli/`): CLI command implementations
8. **REST** (`rest/`): REST API handlers
9. **Studio** (`studio/`): Studio widget implementations

## ✨ Features

- **Auto-discovery**: Automatically scans repositories and detects local packages
- **Smart linking**: Intelligent linking strategies based on dependency graph
- **Version policies**: Configurable version pinning and upgrade rules
- **State tracking**: Persistent state snapshots for reproducibility
- **Rollback support**: Restore previous states from backups
- **Type-safe**: Full TypeScript support with strict types
- **Fast**: Optimized for PNPM workspaces and large monorepos
- **Observable**: Explicit state files show what's happening

## 📦 API Reference

### Main Exports

#### Discovery

- `discover`: Discover local packages and their dependency graph

#### Graph

- `buildGraph`: Build dependency graph
- `traverseGraph`: Traverse graph (depth-first)

#### Policy

- `applyPolicy`: Apply version policy rules

#### State

- `saveState`: Save state to `.kb/devlink/state.json`
- `loadState`: Load state from disk

#### Clean

- `clean`: Remove temporary files and caches

#### Rollback

- `rollback`: Restore previous state from backup

## 🔧 Configuration

### Configuration Options

All configuration via function parameters and kb-labs.config.json.

## 🔗 Dependencies

### Runtime Dependencies

- `@kb-labs/analytics-sdk-node` (`link:../../../kb-labs-analytics/packages/analytics-sdk-node`): Analytics SDK
- `@kb-labs/core-workspace` (`link:../../../kb-labs-core/packages/core`): Core workspace
- `@kb-labs/devlink-contracts` (`link:../contracts`): DevLink contracts
- `@kb-labs/plugin-manifest` (`link:../../../kb-labs-plugin/packages/manifest`): Plugin manifest
- `@kb-labs/shared-cli-ui` (`link:../../../kb-labs-shared/packages/cli-ui`): Shared CLI UI
- `chokidar` (`^4.0.0`): File watching
- `glob` (`^11.0.0`): File pattern matching
- `minimatch` (`^10.0.0`): Pattern matching
- `p-queue` (`^8.0.0`): Promise queue
- `zod` (`^4.0.0`): Schema validation

### Development Dependencies

- `@kb-labs/devkit` (`link:../../../kb-labs-devkit`): DevKit presets
- `@types/node` (`^24.7.0`): Node.js types
- `tsup` (`^8`): TypeScript bundler
- `tsx` (`^4.20.5`): TypeScript execution
- `vitest` (`^3`): Test runner

## 🧪 Testing

### Test Structure

```
src/__tests__/
├── api.facade.spec.ts
├── artifacts.spec.ts
├── auto-mode.spec.ts
├── cleanup.spec.ts
├── discovery.sibling-repos.spec.ts
├── e2e.devlink.spec.ts
└── preflight.spec.ts
```

### Test Coverage

- **Current Coverage**: ~75%
- **Target Coverage**: 90%

## 📈 Performance

### Performance Characteristics

- **Time Complexity**: O(n) for discovery, O(n log n) for graph building
- **Space Complexity**: O(n) where n = number of packages
- **Bottlenecks**: Large repository scanning

## 🔒 Security

### Security Considerations

- **Path Validation**: Path validation for file operations
- **Input Validation**: Input validation via schemas

### Known Vulnerabilities

- None

## 🐛 Known Issues & Limitations

### Known Issues

- None currently

### Limitations

- **Repository Size**: Performance degrades with very large repositories
- **Link Types**: Fixed link types (auto/local/npm)

### Future Improvements

- **More Link Types**: Additional link types
- **Performance**: Optimize for very large repositories

## 🔄 Migration & Breaking Changes

### Migration from Previous Versions

No breaking changes in current version (0.1.0).

### Breaking Changes in Future Versions

- None planned

## 📚 Examples

### Example 1: Discover Packages

```typescript
import { discover, saveState } from '@kb-labs/devlink-core';

const state = await discover({ roots: ['/path/to/repo'] });
await saveState(state);
```

### Example 2: Generate Linking Plan

```typescript
import { computePlan } from '@kb-labs/devlink-core';

const plan = computePlan(state, 'auto', {
  pin: 'exact',
  upgrade: 'none',
  prerelease: 'block',
});
```

### Example 3: Freeze Plan to Lockfile

```typescript
import { freezeToLock } from '@kb-labs/devlink-core';

const lock = freezeToLock(plan);
console.log(lock);
```

## 🤝 Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## 📄 License

MIT © KB Labs
