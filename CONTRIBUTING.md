# Contributing to @kb-labs/devlink

Thank you for helping improve `@kb-labs/devlink`! This guide explains how to set up your environment, propose changes, and work with our CI and release flows.

## Principles

- **Automation first**: prefer codified, repeatable processes.
- **Consistency over variety**: align with existing conventions and KB Labs ecosystem.
- **Small, focused changes**: easier to review and ship.
- **User experience matters**: DevLink is a developer tool — make it delightful.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Git
- Yalc (installed globally): `npm i -g yalc`

### Install

```bash
pnpm i
```

### Useful scripts

```bash
pnpm build         # build all packages
pnpm dev           # watch mode for all packages
pnpm lint          # run ESLint
pnpm lint:fix      # run ESLint with auto-fix
pnpm test          # run Vitest tests
pnpm test:coverage # run tests with coverage
pnpm test:watch    # run tests in watch mode
pnpm type-check    # run TypeScript type checking
pnpm format        # format with Prettier
pnpm format:check  # check formatting
pnpm check         # run lint + type-check + tests
pnpm ci            # full CI pipeline (clean + build + check)
pnpm clean         # remove build artifacts
pnpm clean:all     # remove node_modules and build artifacts
```

## Project structure

```
kb-labs-devlink/
├── packages/
│   └── core/                    # @kb-labs/devlink-core
│       ├── src/
│       │   ├── discovery/       # Package discovery logic
│       │   ├── graph/           # Dependency graph utilities
│       │   ├── policy/          # Version policy engine
│       │   ├── state/           # State management
│       │   ├── clean/           # Cleanup utilities
│       │   ├── rollback/        # Rollback functionality
│       │   ├── types/           # Shared type definitions
│       │   └── utils/           # Helper utilities
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       └── vitest.config.ts
├── docs/
│   └── adr/                     # Architecture Decision Records
├── .github/
│   └── workflows/               # CI/CD workflows
└── .kb/
    └── devkit/
        └── agents/              # AI agent definitions (synced from DevKit)
├── README.md
├── CONTRIBUTING.md
├── package.json
├── tsconfig.json
├── eslint.config.js
├── prettierrc.json
└── vitest.config.ts
```

## Development workflow

### 1. Create a feature branch

```bash
git checkout -b feat/my-feature
# or
git checkout -b fix/bug-description
# or
git checkout -b chore/task-description
```

### 2. Make your changes

- Keep changes focused and atomic
- Write tests for new functionality
- Update documentation as needed
- Follow existing code patterns

### 3. Test locally

```bash
# Run the full check suite
pnpm check

# Or run individual checks
pnpm lint
pnpm type-check
pnpm test
```

### 4. Commit your changes

Use conventional commit messages:

```bash
git commit -m "feat: add discovery caching"
git commit -m "fix: resolve version comparison bug"
git commit -m "docs: update CLI usage examples"
git commit -m "chore: update dependencies"
```

Commit types:

- `feat:` — new features
- `fix:` — bug fixes
- `docs:` — documentation changes
- `refactor:` — code refactoring
- `test:` — test additions or changes
- `chore:` — maintenance tasks
- `perf:` — performance improvements

### 5. Open a pull request

- Keep PRs focused (ideally < 300 lines)
- Include a clear description of what and why
- Link related issues if they exist
- Ensure CI passes

## Core Package Development

### Working on @kb-labs/devlink-core

The core package contains all the business logic for DevLink. When adding features:

1. **Add types first** in `src/types/types.ts`
2. **Implement logic** in the appropriate module (`discovery/`, `graph/`, etc.)
3. **Export from index** via `src/index.ts`
4. **Write tests** alongside your implementation
5. **Update documentation** in README and JSDoc comments

### Module guidelines

Each module should:

- Export a clear, focused API
- Include comprehensive JSDoc comments
- Have corresponding tests
- Follow functional programming principles where possible
- Avoid side effects (except in I/O operations)

Example structure:

```ts
/**
 * Discovers local packages in the given directories.
 * @param options - Discovery configuration options
 * @returns Promise resolving to discovered packages
 */
export async function discover(options: DiscoveryOptions): Promise<Package[]> {
  // Implementation
}
```

## Testing

### Test structure

Tests are colocated with source files:

```
src/
├── discovery/
│   ├── discovery.ts
│   └── discovery.test.ts
```

### Writing tests

- **Unit tests**: Test individual functions in isolation
- **Integration tests**: Test module interactions
- **E2E tests**: Test complete workflows (coming soon)

Example test:

```ts
import { describe, it, expect } from "vitest";
import { discover } from "./discovery";

describe("discover", () => {
  it("should find packages in workspace", async () => {
    const packages = await discover({ roots: ["./fixtures/workspace"] });
    expect(packages).toHaveLength(3);
  });

  it("should handle missing directories gracefully", async () => {
    const packages = await discover({ roots: ["./nonexistent"] });
    expect(packages).toEqual([]);
  });
});
```

### Running tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# Specific file
pnpm test discovery.test.ts
```

## DevKit Integration

This project uses `@kb-labs/devkit` for shared tooling configurations. Key points:

- **Configurations**: ESLint, Prettier, Vitest, TypeScript, and GitHub Actions are managed by DevKit
- **Local configs**: Act as thin wrappers over DevKit configurations
- **Updates**: When DevKit is updated, run `pnpm install` to get the latest configurations
- **Customization**: For project-specific rules, extend DevKit configs rather than overriding them

### DevKit Commands

```bash
pnpm devkit:sync    # Sync DevKit configurations (runs automatically on install)
pnpm devkit:check   # Check if sync is needed
pnpm devkit:force   # Force sync (overwrites existing configs)
pnpm devkit:help    # Show help and available options
```

### Synced Assets

The following assets are synced from DevKit:

- **AI Agents** → `.kb/devkit/agents/` — Standardized AI agent definitions (synced from DevKit)
- **Cursor Rules** → `.cursorrules` — Cursor IDE configuration
- **VS Code Settings** → `.vscode/settings.json` — Editor configuration (optional)

To update agents after DevKit changes:

```bash
pnpm devkit:sync
```

## AI Agents

This project includes standardized AI agents synced from DevKit. Each agent is defined in the `.kb/devkit/agents/` directory:

- **DevKit Maintainer** — Enforces unified tooling and DevKit standards
- **Test Generator** — Generates and maintains unit tests
- **Docs Drafter** — Drafts and updates documentation
- **Release Manager** — Manages releases and changelogs

When contributing to DevLink:

- Use agents to accelerate development
- Agents are synced from DevKit via `pnpm devkit:sync`
- Product-specific agents can be added to `.kb/<product>/agents/` if needed

> **Note:** `.kb` is the common ecosystem folder. `devkit` is the product namespace. Each product decides what to store in their namespace.

## Architecture Decision Records (ADR)

For significant architectural decisions, create an ADR:

1. Copy the template: `cp docs/adr/0000-template.md docs/adr/NNNN-my-decision.md`
2. Fill in the sections: Context, Decision, Consequences
3. Number sequentially (e.g., `0001`, `0002`, etc.)
4. Include in your PR

ADRs help document the "why" behind design choices and provide context for future contributors.

### Architecture Decision Requirements

- For significant architectural changes, add an ADR in `docs/adr/`
- Follow the ADR template in `docs/adr/0000-template.md`
- Include required metadata (Date, Status, Deciders, **Last Reviewed**, **Tags**)
- **Last Reviewed** date is required and should be updated periodically
- **Tags** are mandatory (minimum 1, maximum 5 tags from approved list)
- See [Documentation Standard](./docs/DOCUMENTATION.md) for ADR format requirements

## Branching model

- `main` is the default branch
- Use short-lived feature branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`
- Keep branches focused on a single concern
- Rebase before merging to keep history clean

## Pull requests

### Before opening a PR

- [ ] Run `pnpm check` locally
- [ ] Update relevant documentation
- [ ] Add/update tests for new functionality
- [ ] Write clear commit messages
- [ ] Ensure no linter errors

### PR guidelines

- Keep PRs focused and under ~300 lines where possible
- Include a brief summary of what and why
- Link related issues if they exist
- Use the PR template if provided
- Respond to review feedback promptly

### PR review process

1. Automated CI checks run (lint, type-check, tests, build)
2. Maintainers review code and provide feedback
3. Address feedback and update PR
4. Once approved, PR is merged to `main`

## CI/CD

This project uses GitHub Actions for CI/CD:

- **Pull Request**: Runs lint, type-check, tests, and build
- **Main branch**: Runs full CI pipeline
- **Releases**: Automated via tags (e.g., `v0.1.0`)

### CI Workflow

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Setup Node + pnpm
      - Install dependencies
      - Lint (ESLint)
      - Type-check (TypeScript)
      - Test (Vitest)
      - Build (tsup)
```

### Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create and push a tag: `git tag v0.1.0 && git push origin v0.1.0`
4. GitHub Actions creates a release and publishes to npm (if configured)

## Code style

- **ESM-first**: All code uses ES modules
- **Node 20 baseline**: Target Node.js 20+ features
- **TypeScript**: Strict mode enabled
- **Functional style**: Prefer pure functions and immutability
- **Explicit over clever**: Readable code > concise code

### Style rules (enforced by ESLint/Prettier)

- No semicolons
- Single quotes
- 100 character line width
- 2-space indentation
- Trailing commas in multiline

### Naming conventions

- **Files**: kebab-case (`discovery.ts`, `graph-utils.ts`)
- **Functions**: camelCase (`computeGraph`, `applyPolicy`)
- **Types**: PascalCase (`Package`, `LinkPlan`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_DEPTH`, `DEFAULT_MODE`)

## Performance considerations

DevLink needs to handle large monorepos efficiently:

- **Minimize I/O**: Cache file system reads where possible
- **Parallel operations**: Use `Promise.all` for independent tasks
- **Lazy loading**: Don't load data until needed
- **Memory management**: Stream large files instead of loading into memory
- **Benchmark**: Measure performance of critical paths

## Security

- Do not commit secrets or tokens
- Use GitHub Environments/Secrets for sensitive data
- Report vulnerabilities privately to the maintainers
- Validate user input in CLI commands
- Sanitize file paths to prevent directory traversal

## Documentation

Keep documentation up to date:

- **README.md**: User-facing documentation and quick start
- **CONTRIBUTING.md**: This file — contributor guidelines
- **ADRs**: Architectural decision records for significant choices
- **JSDoc**: Inline documentation for all exported functions
- **Examples**: Practical examples in README and tests

### Documentation style

- Use clear, concise language
- Include code examples
- Explain the "why" not just the "what"
- Keep examples up to date with code changes
- Use diagrams for complex concepts

## Governance

- Maintainers have final review authority
- Breaking changes require:
  - Clear migration notes in README and CHANGELOG
  - Version bump (major version for breaking changes)
  - Deprecation warnings in previous version (if possible)
- Feature decisions consider:
  - User needs and feedback
  - Alignment with KB Labs ecosystem
  - Maintenance burden
  - Performance impact

## Getting help

- **Questions?** Open a GitHub Discussion
- **Bugs?** Open a GitHub Issue
- **Ideas?** Open a GitHub Discussion or Issue
- **PRs?** Always welcome!

## Release notes

### Version 0.1.0 (Current)

Initial release with core functionality:

- Package discovery
- Dependency graph analysis
- Linking plan generation
- State management
- Rollback support

## Questions

Open a GitHub Discussion or issue. PRs welcome!

---

**See [Documentation Standard](./docs/DOCUMENTATION.md) for complete documentation guidelines.**
