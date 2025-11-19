/**
 * @module @kb-labs/devlink-core/manifest
 * Manifest v2 declaration for DevLink CLI
 */

import type { ManifestV2 } from '@kb-labs/plugin-manifest';
import { pluginContractsManifest } from '@kb-labs/devlink-contracts';
import type { DevlinkPlanView } from '@kb-labs/devlink-contracts/schema';

const contracts = pluginContractsManifest;
const restApiBasePath = contracts.api?.rest?.basePath ?? '/v1/plugins/devlink';
const planRouteContract = contracts.api?.rest?.routes?.['devlink.rest.plan'];
const manifestArtifacts = Object.values(contracts.artifacts).map((artifact) => ({
  id: artifact.id,
  pathTemplate: artifact.pathPattern,
  description: artifact.description ?? '',
}));

const planRouteIdForView = (view: DevlinkPlanView) => `plan?view=${view}`;

const overviewView: DevlinkPlanView = 'overview';
const overviewActionsView: DevlinkPlanView = 'overview.actions';
const dependenciesTreeView: DevlinkPlanView = 'dependencies.tree';
const dependenciesTableView: DevlinkPlanView = 'dependencies.table';

export const manifest: ManifestV2 = {
  schema: 'kb.plugin/2',
  id: '@kb-labs/devlink',
  version: '0.1.0',
  display: {
    name: 'DevLink',
    description: 'Workspace dependency linking, freezing, and automation toolkit for KB Labs',
    tags: ['devlink', 'workspace', 'linking', 'automation'],
  },
  rest: {
    basePath: restApiBasePath,
    routes: [
      {
        method: (planRouteContract?.method ?? 'GET') as 'GET',
        path: planRouteContract?.path ?? '/plan',
        input: {
          zod: './rest/schemas/plan-schema.js#PlanRequestSchema',
        },
        output: {
          zod: './rest/schemas/plan-schema.js#PlanResponseSchema',
        },
        handler: './rest/handlers/plan-handler.js#handlePlan',
        permissions: {
          fs: {
            mode: 'read',
            allow: ['.kb/devlink/last-plan.json', '.kb/devlink/lock.json'],
            deny: ['**/*.key', '**/*.secret'],
          },
          net: 'none',
          env: {
            allow: ['KB_LABS_REPO_ROOT', 'KB_LABS_WORKSPACE_ROOT'],
          },
          capabilities: [],
          quotas: {
            timeoutMs: 10000,
            memoryMb: 128,
            cpuMs: 5000,
          },
        },
      },
    ],
  },
  studio: {
    widgets: [
      {
        id: 'devlink.overview',
        kind: 'infopanel',
        title: 'Plan Overview',
        description: 'Summary of the latest DevLink plan with key metrics and metadata.',
        data: {
          source: {
            type: 'rest',
            routeId: planRouteIdForView(overviewView),
            method: 'GET',
          },
          schema: {
            $ref: 'kb.v1.studio.InfoPanel',
          },
        },
        options: {
          layout: 'sections',
          defaultCollapsed: true,
        },
        order: 0,
      },
      {
        id: 'devlink.actions',
        kind: 'chart',
        title: 'Action Breakdown',
        description: 'Distribution of plan actions grouped by kind.',
        data: {
          source: {
            type: 'rest',
            routeId: planRouteIdForView(overviewActionsView),
            method: 'GET',
          },
          schema: {
            $ref: 'kb.v1.studio.ChartSeriesList',
          },
        },
        options: {
          showLegend: false,
          height: 280,
        },
        order: 1,
      },
      {
        id: 'devlink.dependencies',
        kind: 'tree',
        title: 'Dependency Map',
        description: 'Workspace and external packages organised by repository.',
        data: {
          source: {
            type: 'rest',
            routeId: planRouteIdForView(dependenciesTreeView),
            method: 'GET',
          },
          schema: {
            $ref: 'kb.v1.studio.TreeNode',
          },
        },
        options: {
          expanded: ['repo:Workspace'],
          showIcons: false,
        },
        order: 2,
      },
      {
        id: 'devlink.packages',
        kind: 'table',
        title: 'Package Details',
        description: 'Table view of packages involved in the latest plan.',
        data: {
          source: {
            type: 'rest',
            routeId: planRouteIdForView(dependenciesTableView),
            method: 'GET',
          },
          schema: {
            $ref: 'kb.v1.studio.GenericTableRows',
          },
        },
        options: {
          pageSize: 20,
          sortable: true,
          stickyHeader: false,
        },
        order: 3,
      },
    ],
    menus: [
      {
        id: 'devlink-overview',
        label: 'DevLink · Overview',
        target: '/plugins/devlink/overview',
        order: 0,
      },
      {
        id: 'devlink-actions',
        label: 'DevLink · Actions',
        target: '/plugins/devlink/actions',
        order: 1,
      },
      {
        id: 'devlink-dependencies',
        label: 'DevLink · Dependencies',
        target: '/plugins/devlink/dependencies',
        order: 2,
      },
      {
        id: 'devlink-packages',
        label: 'DevLink · Packages',
        target: '/plugins/devlink/packages',
        order: 3,
      },
    ],
    layouts: [],
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
  artifacts: manifestArtifacts,
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
        handler: './cli/plan#run',
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
        handler: './cli/apply#run',
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
        handler: './cli/status#run',
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
        handler: './cli/freeze#run',
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
        handler: './cli/undo#run',
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
        handler: './cli/switch#run',
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
        handler: './cli/update#run',
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
        handler: './cli/watch#run',
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
        handler: './cli/clean#run',
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
        handler: './cli/backups#run',
      },
    ],
  },
};

export default manifest;

