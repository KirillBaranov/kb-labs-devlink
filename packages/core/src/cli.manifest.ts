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
    requires: ['@kb-labs/devlink-core'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: process.cwd(),
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
    loader: async () => import('./cli/plan.js'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:apply',
    group: 'devlink',
    describe: 'Apply workspace linking operations',
    longDescription: 'Execute planned linking operations to set up workspace dependencies',
    requires: ['@kb-labs/devlink-core'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: process.cwd(),
      },
      {
        name: 'force',
        type: 'boolean',
        alias: 'f',
        description: 'Force apply even if conflicts exist',
      },
    ],
    examples: [
      'kb devlink apply',
      'kb devlink apply --force',
    ],
    loader: async () => import('./cli/apply.js'),
  },
  {
    manifestVersion: '1.0',
    id: 'devlink:status',
    group: 'devlink',
    describe: 'Show workspace linking status',
    longDescription: 'Display current status of workspace linking and dependencies',
    requires: ['@kb-labs/devlink-core'],
    flags: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory',
        default: process.cwd(),
      },
      {
        name: 'json',
        type: 'boolean',
        description: 'Output in JSON format',
      },
    ],
    examples: [
      'kb devlink status',
      'kb devlink status --json',
    ],
    loader: async () => import('./cli/status.js'),
  },
];
