import type { ApiContract } from './types/api.js';
import type { ArtifactContractsMap } from './types/artifacts.js';
import type { CommandContractsMap } from './types/commands.js';
import type { WorkflowContractsMap } from './types/workflows.js';
import type { ContractsSchemaId } from './version.js';

export interface PluginContracts {
  schema: ContractsSchemaId;
  pluginId: string;
  contractsVersion: string;
  artifacts: ArtifactContractsMap;
  commands?: CommandContractsMap;
  workflows?: WorkflowContractsMap;
  api?: ApiContract;
}

export type { ApiContract, RestApiContract, RestRouteContract, SchemaReference } from './types/api.js';
export type { ArtifactKind, ArtifactContractsMap, PluginArtifactContract, ArtifactExample } from './types/artifacts.js';
export type { CommandContract, CommandContractsMap } from './types/commands.js';
export type { WorkflowContract, WorkflowContractsMap, WorkflowStepContract } from './types/workflows.js';

