/**
 * @module @kb-labs/devlink-cli/manifest
 * Manifest v2 declaration for DevLink CLI
 */

import { createManifestV2 } from '@kb-labs/plugin-manifest';
import { pluginContractsManifest } from '@kb-labs/devlink-contracts';

export const manifest = createManifestV2<typeof pluginContractsManifest>({
  schema: 'kb.plugin/2',
  id: '@kb-labs/devlink',
  version: '0.2.0',
  display: {
    name: 'DevLink',
    description: 'Workspace dependency linking, freezing, and automation toolkit for KB Labs',
    tags: ['devlink', 'workspace', 'linking', 'automation'],
  },
  capabilities: ['fs.read', 'fs.write'],
  permissions: {
    fs: {
      mode: 'readWrite',
      allow: [
        '.kb/devlink/**',
        '**/package.json',
        '**/pnpm-workspace.yaml',
        '**/pnpm-lock.yaml',
        '**/package-lock.json',
        '**/yalc.lock',
        '**/.yalc/**',
      ],
      deny: ['**/*.key', '**/*.secret', '**/.git/**'],
    },
    net: 'none',
    env: {
      allow: ['NODE_ENV', 'PATH', 'KB_DEVLINK_LOG_LEVEL', 'KB_DEVLINK_IGNORE_SCRIPTS', 'KB_DEVLINK_NO_OPTIONAL'],
    },
    quotas: {
      timeoutMs: 600000,
      memoryMb: 512,
      cpuMs: 300000,
    },
    capabilities: ['fs.read', 'fs.write'],
    artifacts: {
      read: [
        {
          from: 'self',
          paths: ['.kb/devlink/**'],
        },
      ],
      write: [
        {
          to: 'self',
          paths: ['.kb/devlink/**'],
        },
      ],
    },
  },
  dependencies: [
    {
      id: '@kb-labs/devlink-core',
      version: '^0.1.0',
    },
    {
      id: '@kb-labs/shared-cli-ui',
      version: '*',
      optional: true,
    },
  ],
  cli: {
    commands: [
      {
        id: 'devlink:plan',
        group: 'devlink',
        describe: 'Plan workspace linking operations',
        longDescription: 'Analyze workspace structure and plan linking operations for packages',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'container',
            type: 'boolean',
            description: 'Treat current directory as a workspace container and scan child repositories',
          },
          {
            name: 'mode',
            type: 'string',
            description: 'Scan mode (npm, local, auto)',
            choices: ['npm', 'local', 'auto'],
          },
          {
            name: 'roots',
            type: 'string',
            description: 'Comma-separated workspace roots to include',
          },
          {
            name: 'strict',
            type: 'boolean',
            description: 'Fail when workspace dependencies are missing',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output diagnostics in JSON format',
          },
        ],
        examples: ['kb devlink plan', 'kb devlink plan --mode local --strict', 'kb devlink plan --container --json'],
        handler: './commands/plan.js#run',
      },
      {
        id: 'devlink:apply',
        group: 'devlink',
        describe: 'Apply workspace linking operations',
        longDescription: 'Execute planned linking operations to set up workspace dependencies',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'yes',
            type: 'boolean',
            alias: 'y',
            description: 'Skip confirmation prompts',
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Show what would be applied without making changes',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
          },
        ],
        examples: ['kb devlink apply', 'kb devlink apply --dry-run', 'kb devlink apply --yes --json'],
        handler: './commands/apply.js#run',
      },
      {
        id: 'devlink:status',
        group: 'devlink',
        describe: 'Show workspace linking status',
        longDescription: 'Display current status of workspace linking and dependencies',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
          },
          {
            name: 'verbose',
            type: 'boolean',
            description: 'Show detailed dependency information',
          },
          {
            name: 'sources',
            type: 'boolean',
            description: 'Show dependency sources breakdown',
          },
          {
            name: 'diff',
            type: 'boolean',
            description: 'Show detailed diff information',
          },
          {
            name: 'roots',
            type: 'string',
            description: 'Comma-separated workspace roots filter',
          },
          {
            name: 'consumer',
            type: 'string',
            description: 'Show status for a specific consumer only',
          },
          {
            name: 'warning-level',
            type: 'string',
            description: 'Minimum warning level to display (info, warn, error)',
          },
        ],
        examples: [
          'kb devlink status',
          'kb devlink status --json',
          'kb devlink status --verbose',
          'kb devlink status --sources --diff',
        ],
        handler: './commands/status.js#run',
      },
      {
        id: 'devlink:freeze',
        group: 'devlink',
        describe: 'Freeze current workspace state',
        longDescription: 'Lock current workspace dependencies to prevent automatic changes',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Show what would be frozen without making changes',
          },
          {
            name: 'merge',
            type: 'boolean',
            description: 'Merge with existing lock file',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
          },
        ],
        examples: [
          'kb devlink freeze',
          'kb devlink freeze --dry-run',
          'kb devlink freeze --merge',
        ],
        handler: './commands/freeze.js#run',
      },
      {
        id: 'devlink:undo',
        group: 'devlink',
        describe: 'Undo last apply operation',
        longDescription: 'Rollback the last devlink apply operation',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Show what would be undone without making changes',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
          },
        ],
        examples: ['kb devlink undo', 'kb devlink undo --dry-run'],
        handler: './commands/undo.js#run',
      },
      {
        id: 'devlink:switch',
        group: 'devlink',
        describe: 'Switch workspace mode',
        longDescription: 'Switch between npm, local, and auto dependency resolution modes',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'mode',
            type: 'string',
            description: 'Target mode (npm, local, auto)',
            choices: ['npm', 'local', 'auto'],
            required: true,
          },
          {
            name: 'yes',
            type: 'boolean',
            alias: 'y',
            description: 'Skip confirmation prompts',
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Show what would be switched without making changes',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
          },
        ],
        examples: ['kb devlink switch --mode local', 'kb devlink switch --mode npm --yes --dry-run'],
        handler: './commands/switch.js#run',
      },
      {
        id: 'devlink:update',
        group: 'devlink',
        describe: 'Update workspace dependencies',
        longDescription: 'Update workspace dependencies and relink packages',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'mode',
            type: 'string',
            description: 'Update mode (npm, local, auto)',
            choices: ['npm', 'local', 'auto'],
            default: 'auto',
          },
          {
            name: 'yes',
            type: 'boolean',
            alias: 'y',
            description: 'Skip confirmation prompts',
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Show what would be updated without making changes',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
          },
        ],
        examples: ['kb devlink update', 'kb devlink update --mode local --dry-run --yes'],
        handler: './commands/update.js#run',
      },
      {
        id: 'devlink:watch',
        group: 'devlink',
        describe: 'Watch and auto-rebuild workspace',
        longDescription: 'Watch for changes and automatically rebuild/relink packages',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'mode',
            type: 'string',
            description: 'Watch mode (npm, local, auto)',
            choices: ['npm', 'local', 'auto'],
            default: 'auto',
          },
          {
            name: 'verbose',
            type: 'boolean',
            alias: 'v',
            description: 'Verbose output',
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Show what would be watched without starting file watchers',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output initial state in JSON format',
          },
        ],
        examples: [
          'kb devlink watch',
          'kb devlink watch --mode local --verbose',
          'kb devlink watch --dry-run',
        ],
        handler: './commands/watch.js#run',
      },
      {
        id: 'devlink:clean',
        group: 'devlink',
        describe: 'Clean workspace artifacts',
        longDescription: 'Remove temporary files, caches, and stale artifacts from workspace',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'hard',
            type: 'boolean',
            description: 'Also remove lock file',
          },
          {
            name: 'deep',
            type: 'boolean',
            description: 'Deep clean including global yalc store',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
          },
        ],
        examples: [
          'kb devlink clean',
          'kb devlink clean --hard',
          'kb devlink clean --deep',
          'kb devlink clean --hard --deep',
        ],
        handler: './commands/clean.js#run',
      },
      {
        id: 'devlink:backups',
        group: 'devlink',
        describe: 'Manage devlink backups',
        longDescription: 'List, show, protect, and restore devlink backups',
        flags: [
          {
            name: 'cwd',
            type: 'string',
            description: 'Working directory',
          },
          {
            name: 'list',
            type: 'boolean',
            alias: 'l',
            description: 'List all backups',
          },
          {
            name: 'show',
            type: 'string',
            description: 'Show details of specific backup',
          },
          {
            name: 'protect',
            type: 'string',
            description: 'Mark backup as protected',
          },
          {
            name: 'unprotect',
            type: 'string',
            description: 'Unmark backup as protected',
          },
          {
            name: 'cleanup',
            type: 'boolean',
            description: 'Run cleanup with retention policy',
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Dry-run mode for cleanup',
          },
          {
            name: 'json',
            type: 'boolean',
            description: 'Output results in JSON format',
          },
        ],
        examples: [
          'kb devlink backups --list',
          'kb devlink backups --show 2025-10-30T20-25-33',
          'kb devlink backups --protect 2025-10-30T20-25-33',
          'kb devlink backups --cleanup',
        ],
        handler: './commands/backups.js#run',
      },
    ],
  },
});

export default manifest;

