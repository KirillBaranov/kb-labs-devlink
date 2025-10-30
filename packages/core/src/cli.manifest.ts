/**
 * Devlink CLI manifest
 */

// Local type definition to avoid external dependencies
type CommandManifest = {
  manifestVersion: '1.0';
  id: string;
  aliases?: string[];
  group: string;
  describe: string;
  longDescription?: string;
  requires?: string[];
  flags?: FlagDefinition[];
  examples?: string[];
  loader: () => Promise<{ run: any }>;
};

type FlagDefinition = {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  alias?: string;
  default?: any;
  description?: string;
  choices?: string[];
  required?: boolean;
};

export const commands: CommandManifest[] = [
  {
    manifestVersion: '1.0',
    id: 'devlink:plan',
    group: 'devlink',
    describe: 'Plan workspace linking operations',
    longDescription: 'Analyze workspace structure and plan linking operations for packages',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
      },
      {
        name: 'verbose',
        type: 'boolean',
        alias: 'v',
        description: 'Verbose output',
      },
    ],
    examples: [
      'kb devlink plan',
      'kb devlink plan --verbose',
    ],
    loader: async () => import('./cli/plan'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:apply',
    group: 'devlink',
    describe: 'Apply workspace linking operations',
    longDescription: 'Execute planned linking operations to set up workspace dependencies',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
      },
      {
        name: 'force',
        type: 'boolean',
        alias: 'f',
        description: 'Force apply even if conflicts exist',
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
    examples: [
      'kb devlink apply',
      'kb devlink apply --force',
    ],
    loader: async () => import('./cli/apply'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:status',
    group: 'devlink',
    describe: 'Show workspace linking status',
    longDescription: 'Display current status of workspace linking and dependencies',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
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
    ],
    examples: [
      'kb devlink status',
      'kb devlink status --json',
      'kb devlink status --verbose',
      'kb devlink status --sources --diff',
    ],
    loader: async () => import('./cli/status'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:freeze',
    group: 'devlink',
    describe: 'Freeze current workspace state',
    longDescription: 'Lock current workspace dependencies to prevent automatic changes',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
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
    ],
    examples: [
      'kb devlink freeze',
      'kb devlink freeze --dry-run',
      'kb devlink freeze --merge',
    ],
    loader: async () => import('./cli/freeze'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:undo',
    group: 'devlink',
    describe: 'Undo last apply operation',
    longDescription: 'Rollback the last devlink apply operation',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
      },
      {
        name: 'dry-run',
        type: 'boolean',
        description: 'Show what would be undone without making changes',
      },
    ],
    examples: [
      'kb devlink undo',
      'kb devlink undo --dry-run',
    ],
    loader: async () => import('./cli/undo'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:switch',
    group: 'devlink',
    describe: 'Switch workspace mode',
    longDescription: 'Switch between npm, local, and auto dependency resolution modes',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
      },
      {
        name: 'mode',
        type: 'string',
        description: 'Target mode (npm, local, auto)',
        choices: ['npm', 'local', 'auto'],
        required: true,
      },
      {
        name: 'force',
        type: 'boolean',
        alias: 'f',
        description: 'Force switch even if conflicts exist',
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
    ],
    examples: [
      'kb devlink switch --mode local',
      'kb devlink switch --mode npm --force',
    ],
    loader: async () => import('./cli/switch'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:update',
    group: 'devlink',
    describe: 'Update workspace dependencies',
    longDescription: 'Update workspace dependencies and relink packages',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
      },
      {
        name: 'mode',
        type: 'string',
        description: 'Update mode (npm, local, auto)',
        choices: ['npm', 'local', 'auto'],
        default: 'auto',
      },
      {
        name: 'dry-run',
        type: 'boolean',
        description: 'Show what would be updated without making changes',
      },
    ],
    examples: [
      'kb devlink update',
      'kb devlink update --mode local --dry-run',
    ],
    loader: async () => import('./cli/update'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:watch',
    group: 'devlink',
    describe: 'Watch and auto-rebuild workspace',
    longDescription: 'Watch for changes and automatically rebuild/relink packages',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
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
    ],
    examples: [
      'kb devlink watch',
      'kb devlink watch --mode local --verbose',
    ],
    loader: async () => import('./cli/watch'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:clean',
    group: 'devlink',
    describe: 'Clean workspace artifacts',
    longDescription: 'Remove temporary files, caches, and stale artifacts from workspace',
    requires: ['@kb-labs/devlink-core@^0.1.0'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: undefined,
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
    loader: async () => import('./cli/clean'),
  },
];
