export interface WorkflowStepContract {
  id: string;
  commandId: string;
  produces?: string[];
}

export interface WorkflowContract {
  id: string;
  description?: string;
  produces?: string[];
  steps: WorkflowStepContract[];
}

export type WorkflowContractsMap = Record<string, WorkflowContract>;

