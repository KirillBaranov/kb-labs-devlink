import type { PluginContracts } from './types';
import { contractsSchemaId, contractsVersion } from './version';

export const pluginContractsManifest: PluginContracts = {
  schema: contractsSchemaId,
  pluginId: '@kb-labs/devlink',
  contractsVersion,
  artifacts: {
    'devlink.plan.latest': {
      id: 'devlink.plan.latest',
      kind: 'json',
      description: 'Latest computed DevLink plan snapshot.',
      pathPattern: '.kb/devlink/last-plan.json',
      schemaRef: '@kb-labs/devlink-contracts/schema#DevlinkPlanResponseSchema',
    },
    'devlink.journal.apply': {
      id: 'devlink.journal.apply',
      kind: 'json',
      description: 'Execution journal for the most recent devlink apply run.',
      pathPattern: '.kb/devlink/last-apply.json',
    },
    'devlink.journal.freeze': {
      id: 'devlink.journal.freeze',
      kind: 'json',
      description: 'Execution journal for the most recent devlink freeze run.',
      pathPattern: '.kb/devlink/last-freeze.json',
    },
    'devlink.backups.metadata': {
      id: 'devlink.backups.metadata',
      kind: 'json',
      description: 'Backup metadata files stored per timestamp under .kb/devlink/backups.',
      pathPattern: '.kb/devlink/backups/{ts}/metadata.json',
    },
  },
  commands: {
    'devlink:plan': {
      id: 'devlink:plan',
      description: 'Plan workspace linking operations.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkPlanCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkPlanCommandOutputSchema',
        format: 'zod',
      },
      produces: ['devlink.plan.latest'],
      examples: [
        'kb devlink plan',
        'kb devlink plan --mode local --strict',
        'kb devlink plan --container --json',
      ],
    },
    'devlink:apply': {
      id: 'devlink:apply',
      description: 'Apply the latest plan to mutate dependencies.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkApplyCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkApplyCommandOutputSchema',
        format: 'zod',
      },
      produces: ['devlink.journal.apply'],
      examples: ['kb devlink apply', 'kb devlink apply --dry-run', 'kb devlink apply --yes --json'],
    },
    'devlink:status': {
      id: 'devlink:status',
      description: 'Report current workspace linking status.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkStatusCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkStatusCommandOutputSchema',
        format: 'zod',
      },
      examples: ['kb devlink status', 'kb devlink status --json', 'kb devlink status --diff --sources'],
    },
    'devlink:freeze': {
      id: 'devlink:freeze',
      description: 'Freeze current dependency state into lock files.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkFreezeCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkFreezeCommandOutputSchema',
        format: 'zod',
      },
      produces: ['devlink.journal.freeze'],
      examples: ['kb devlink freeze', 'kb devlink freeze --dry-run', 'kb devlink freeze --merge'],
    },
    'devlink:undo': {
      id: 'devlink:undo',
      description: 'Undo the latest devlink apply operation.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkUndoCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkUndoCommandOutputSchema',
        format: 'zod',
      },
      examples: ['kb devlink undo', 'kb devlink undo --dry-run'],
    },
    'devlink:switch': {
      id: 'devlink:switch',
      description: 'Switch dependency mode (npm, local, auto) and apply the resulting plan.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkSwitchCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkSwitchCommandOutputSchema',
        format: 'zod',
      },
      produces: ['devlink.plan.latest', 'devlink.journal.apply'],
      examples: ['kb devlink switch --mode local', 'kb devlink switch --mode npm --yes --dry-run'],
    },
    'devlink:update': {
      id: 'devlink:update',
      description: 'Update dependencies according to the selected mode.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkUpdateCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkUpdateCommandOutputSchema',
        format: 'zod',
      },
      produces: ['devlink.plan.latest', 'devlink.journal.apply'],
      examples: ['kb devlink update', 'kb devlink update --mode local --dry-run --yes'],
    },
    'devlink:watch': {
      id: 'devlink:watch',
      description: 'Watch the workspace and auto-apply plan deltas.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkWatchCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkWatchCommandOutputSchema',
        format: 'zod',
      },
      produces: ['devlink.plan.latest', 'devlink.journal.apply'],
      examples: ['kb devlink watch', 'kb devlink watch --mode local --verbose'],
    },
    'devlink:clean': {
      id: 'devlink:clean',
      description: 'Clean DevLink artifacts and caches.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkCleanCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkCleanCommandOutputSchema',
        format: 'zod',
      },
      examples: ['kb devlink clean', 'kb devlink clean --hard --deep'],
    },
    'devlink:backups': {
      id: 'devlink:backups',
      description: 'List, inspect, and manage DevLink backups.',
      input: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkBackupsCommandInputSchema',
        format: 'zod',
      },
      output: {
        ref: '@kb-labs/devlink-contracts/schema#DevlinkBackupsCommandOutputSchema',
        format: 'zod',
      },
      produces: ['devlink.backups.metadata'],
      examples: ['kb devlink backups --list', 'kb devlink backups --show 2025-10-30T20-25-33'],
    },
  },
  workflows: {
    'devlink.workflow.switch': {
      id: 'devlink.workflow.switch',
      description: 'Switch workspace dependency mode via plan and apply pipeline.',
      produces: ['devlink.plan.latest', 'devlink.journal.apply'],
      steps: [
        {
          id: 'devlink.workflow.switch.plan',
          commandId: 'devlink:plan',
          produces: ['devlink.plan.latest'],
        },
        {
          id: 'devlink.workflow.switch.apply',
          commandId: 'devlink:apply',
          produces: ['devlink.journal.apply'],
        },
      ],
    },
    'devlink.workflow.update': {
      id: 'devlink.workflow.update',
      description: 'Update workspace dependencies using plan and apply pipeline.',
      produces: ['devlink.plan.latest', 'devlink.journal.apply'],
      steps: [
        {
          id: 'devlink.workflow.update.plan',
          commandId: 'devlink:plan',
          produces: ['devlink.plan.latest'],
        },
        {
          id: 'devlink.workflow.update.apply',
          commandId: 'devlink:apply',
          produces: ['devlink.journal.apply'],
        },
      ],
    },
    'devlink.workflow.freeze': {
      id: 'devlink.workflow.freeze',
      description: 'Freeze workspace state while persisting plan and freeze journal.',
      produces: ['devlink.plan.latest', 'devlink.journal.freeze'],
      steps: [
        {
          id: 'devlink.workflow.freeze.plan',
          commandId: 'devlink:plan',
          produces: ['devlink.plan.latest'],
        },
        {
          id: 'devlink.workflow.freeze.freeze',
          commandId: 'devlink:freeze',
          produces: ['devlink.journal.freeze'],
        },
      ],
    },
  },
  api: {
    rest: {
      basePath: '/v1/plugins/devlink',
      routes: {
        'devlink.rest.plan': {
          id: 'devlink.rest.plan',
          method: 'GET',
          path: '/plan',
          description: 'Return the latest DevLink plan or derived widget views.',
          request: {
            ref: '@kb-labs/devlink-contracts/schema#DevlinkPlanRequestSchema',
            format: 'zod',
          },
          response: {
            ref: '@kb-labs/devlink-contracts/schema#DevlinkPlanResponseSchema',
            format: 'zod',
          },
          produces: ['devlink.plan.latest'],
        },
      },
    },
  },
};

