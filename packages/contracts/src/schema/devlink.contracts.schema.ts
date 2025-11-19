import { z } from 'zod';

// -----------------------------------------------------------------------------
// Plan schemas (shared between CLI and REST contracts)
// -----------------------------------------------------------------------------

const LinkActionKindSchema = z.enum(['link-local', 'use-npm', 'use-workspace', 'unlink']);

const PlanEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: z.enum(['dep', 'dev', 'peer']),
  action: z
    .object({
      kind: LinkActionKindSchema,
      reason: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
});

const PlanNodeSchema = z.object({
  id: z.string(),
  version: z.string().optional(),
  repo: z.string().nullable().optional(),
  dir: z.string().nullable().optional(),
  relativeDir: z.string().nullable().optional(),
  workspace: z.boolean(),
  actionCounts: z.object({
    total: z.number(),
    byKind: z.record(z.string(), z.number()),
  }),
  dependencyCounts: z.object({
    incoming: z.number(),
    outgoing: z.number(),
    incomingByType: z.object({
      dep: z.number(),
      dev: z.number(),
      peer: z.number(),
    }),
    outgoingByType: z.object({
      dep: z.number(),
      dev: z.number(),
      peer: z.number(),
    }),
  }),
  hasLocalPackage: z.boolean(),
});

const InfoPanelSectionSchema = z.object({
  title: z.string(),
  data: z.unknown(),
  format: z.enum(['json', 'text', 'keyvalue']).optional(),
  collapsible: z.boolean().optional(),
});

const InfoPanelDataSchema = z.object({
  sections: z.array(InfoPanelSectionSchema),
});

const CardDataSchema = z.object({
  title: z.string(),
  content: z.string(),
  status: z.enum(['ok', 'warn', 'error', 'info']).optional(),
  icon: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const CardListDataSchema = z.object({
  cards: z.array(CardDataSchema),
});

const ChartPointSchema = z.object({
  x: z.union([z.string(), z.number()]),
  y: z.number(),
});

const ChartSeriesSchema = z.object({
  name: z.string(),
  points: z.array(ChartPointSchema),
});

export type TreeNode = {
  id: string;
  label: string;
  icon?: string;
  children?: TreeNode[];
};

const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    children: z.array(TreeNodeSchema).optional(),
  }),
);

const DependencyTableRowSchema = z.object({
  package: z.string(),
  repo: z.string(),
  version: z.string(),
  scope: z.string(),
  actions: z.number(),
  actionKinds: z.string(),
  outgoingDeps: z.number(),
  incomingDeps: z.number(),
});

export const DevlinkPlanWidgetsSchema = z.object({
  overview: z.object({
    infoPanel: InfoPanelDataSchema,
    actionsChart: z.array(ChartSeriesSchema),
    diagnostics: CardListDataSchema,
  }),
  dependencies: z.object({
    repoTree: TreeNodeSchema,
    packagesTable: z.array(DependencyTableRowSchema),
  }),
});

const PlanSummarySchema = z.object({
  rootDir: z.string(),
  mode: z.string(),
  packageCount: z.number(),
  actionCount: z.number(),
  actionsByKind: z.record(z.string(), z.number()),
  cycleCount: z.number(),
  diagnosticsCount: z.number(),
});

const PlanMetaSchema = z.object({
  sourcePath: z.string(),
  hash: z.string(),
  lastModified: z.string().nullable(),
  generatedAt: z.string(),
});

export const DevlinkPlanSchema = z.object({
  nodes: z.array(PlanNodeSchema),
  edges: z.array(PlanEdgeSchema),
  cycles: z.array(z.array(z.string())),
  summary: PlanSummarySchema,
  diagnostics: z.array(z.string()),
  meta: PlanMetaSchema,
  widgets: DevlinkPlanWidgetsSchema,
});

export const PlanErrorSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});

export const PlanWidgetResponseSchema = z.union([
  InfoPanelDataSchema,
  z.array(ChartSeriesSchema),
  CardListDataSchema,
  TreeNodeSchema,
  z.array(DependencyTableRowSchema),
]);

export const PlanViewSchema = z.enum([
  'overview',
  'overview.actions',
  'overview.diagnostics',
  'dependencies.tree',
  'dependencies.table',
]);

export const DevlinkPlanRequestSchema = z
  .object({
    cwd: z.string().optional(),
    view: PlanViewSchema.optional(),
  })
  .strict();

export const DevlinkPlanResponseSchema = z.union([
  DevlinkPlanSchema,
  PlanWidgetResponseSchema,
  PlanErrorSchema,
]);

// -----------------------------------------------------------------------------
// Status schemas
// -----------------------------------------------------------------------------

const StatusUndoSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  type: z.enum(['apply', 'freeze']).nullable(),
  backupTs: z.string().nullable(),
});

const StatusContextSchema = z.object({
  rootDir: z.string(),
  mode: z.enum(['local', 'yalc', 'workspace', 'auto', 'remote', 'unknown']),
  modeSource: z.enum(['plan', 'lock', 'inferred', 'unknown']),
  lastOperation: z.enum(['apply', 'freeze', 'none']),
  lastOperationTs: z.string().nullable(),
  lastOperationAgeMs: z.number().nullable(),
  preflightNeeded: z.boolean(),
  undo: StatusUndoSchema,
});

const LockEntrySchema = z.object({
  consumer: z.string(),
  dep: z.string(),
  source: z.string().optional(),
});

const LockStatsSchema = z.object({
  exists: z.boolean(),
  schemaVersion: z.number().optional(),
  consumers: z.number(),
  deps: z.number(),
  sources: z.record(z.string(), z.number()),
  generatedAt: z.string().nullable(),
  entries: z.array(LockEntrySchema).optional(),
});

const DiffEntrySchema = z.object({
  consumer: z.string(),
  name: z.string(),
  section: z.enum(['dependencies', 'devDependencies', 'peerDependencies']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  lock: z.string().optional(),
  manifest: z.string().optional(),
});

const ConsumerDiffSchema = z.object({
  added: z.array(DiffEntrySchema),
  updated: z.array(DiffEntrySchema),
  removed: z.array(DiffEntrySchema),
  mismatched: z.array(DiffEntrySchema),
});

const ManifestDiffSchema = z.object({
  summary: z.object({
    added: z.number(),
    updated: z.number(),
    removed: z.number(),
    mismatched: z.number(),
  }),
  byConsumer: z.record(z.string(), ConsumerDiffSchema),
  samples: z.object({
    added: z.array(DiffEntrySchema),
    updated: z.array(DiffEntrySchema),
    removed: z.array(DiffEntrySchema),
    mismatched: z.array(DiffEntrySchema),
  }),
});

const HealthWarningSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  evidence: z.string().optional(),
  examples: z.array(z.string()).optional(),
  suggestionId: z.string().optional(),
});

const ActionSuggestionSchema = z.object({
  id: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  description: z.string(),
  impact: z.enum(['safe', 'disruptive']),
});

const ArtifactInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().optional(),
  modified: z.union([z.string(), z.date()]).optional(),
  description: z.string(),
});

const StatusTimingsSchema = z
  .object({
    readFs: z.number().optional(),
    readLock: z.number().optional(),
    diff: z.number().optional(),
    warnings: z.number().optional(),
    total: z.number().optional(),
  })
  .passthrough();

export const DevlinkStatusCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    context: StatusContextSchema,
    lock: LockStatsSchema,
    diff: ManifestDiffSchema,
    warnings: z.array(HealthWarningSchema),
    suggestions: z.array(ActionSuggestionSchema),
    artifacts: z.array(ArtifactInfoSchema),
    timings: StatusTimingsSchema.optional(),
  })
  .passthrough();

// -----------------------------------------------------------------------------
// CLI command input schemas
// -----------------------------------------------------------------------------

const dryRunFlags = {
  'dry-run': z.boolean().optional(),
  dryRun: z.boolean().optional(),
} as const;

export const DevlinkPlanCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    container: z.boolean().optional(),
    mode: z.enum(['npm', 'local', 'auto']).optional(),
    roots: z.string().optional(),
    strict: z.boolean().optional(),
  })
  .passthrough();

export const DevlinkPlanCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    plan: DevlinkPlanSchema.nullable().optional(),
    diagnostics: z.array(z.string()).optional(),
    timings: z.record(z.string(), z.number()).optional(),
    totalTime: z.number().optional(),
  })
  .passthrough();

export const DevlinkApplyCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    yes: z.boolean().optional(),
    ...dryRunFlags,
  })
  .passthrough();

export const DevlinkApplyCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    executed: z.number().optional(),
    skipped: z.number().optional(),
    errors: z.number().optional(),
    diagnostics: z.array(z.string()).optional(),
    needsInstall: z.boolean().optional(),
    timing: z.number().optional(),
  })
  .passthrough();

export const DevlinkStatusCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    verbose: z.boolean().optional(),
    sources: z.boolean().optional(),
    diff: z.boolean().optional(),
    roots: z.string().optional(),
    consumer: z.string().optional(),
    warningLevel: z.string().optional(),
  })
  .passthrough();

export const DevlinkFreezeCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    merge: z.boolean().optional(),
    ...dryRunFlags,
  })
  .passthrough();

export const DevlinkFreezeCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    operation: z.literal('freeze').optional(),
    summary: z
      .object({
        packagesLocked: z.number().optional(),
        dependencies: z.number().optional(),
        pinStrategy: z.string().optional(),
        backupDir: z.string().nullable().optional(),
      })
      .optional(),
    timings: z
      .object({
        discovery: z.number().optional(),
        plan: z.number().optional(),
        freeze: z.number().optional(),
        total: z.number().optional(),
      })
      .passthrough()
      .optional(),
    diagnostics: z.array(z.string()).optional(),
  })
  .passthrough();

export const DevlinkUndoCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    ...dryRunFlags,
  })
  .passthrough();

export const DevlinkUndoCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    operation: z.literal('undo').optional(),
    summary: z
      .object({
        reverted: z.number().optional(),
        operationType: z.string().nullable().optional(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    timings: z.record(z.string(), z.number()).optional(),
    diagnostics: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();

export const DevlinkSwitchCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    mode: z.enum(['npm', 'local', 'auto']).optional(),
    yes: z.boolean().optional(),
    ...dryRunFlags,
  })
  .passthrough();

export const DevlinkSwitchCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    operation: z.literal('switch').optional(),
    summary: z
      .object({
        mode: z.string().optional(),
        switched: z.number().optional(),
        skipped: z.number().optional(),
        errors: z.number().optional(),
      })
      .passthrough()
      .optional(),
    timings: z
      .object({
        discovery: z.number().optional(),
        plan: z.number().optional(),
        apply: z.number().optional(),
        total: z.number().optional(),
      })
      .passthrough()
      .optional(),
    diagnostics: z.array(z.string()).optional(),
  })
  .passthrough();

export const DevlinkUpdateCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    mode: z.enum(['npm', 'local', 'auto']).optional(),
    yes: z.boolean().optional(),
    ...dryRunFlags,
  })
  .passthrough();

export const DevlinkUpdateCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    operation: z.literal('update').optional(),
    summary: z
      .object({
        updated: z.number().optional(),
        skipped: z.number().optional(),
        errors: z.number().optional(),
      })
      .passthrough()
      .optional(),
    timings: z
      .object({
        discovery: z.number().optional(),
        plan: z.number().optional(),
        apply: z.number().optional(),
        total: z.number().optional(),
      })
      .passthrough()
      .optional(),
    diagnostics: z.array(z.string()).optional(),
  })
  .passthrough();

export const DevlinkWatchCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    mode: z.enum(['npm', 'local', 'auto']).optional(),
    verbose: z.boolean().optional(),
    ...dryRunFlags,
  })
  .passthrough();

export const DevlinkWatchCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    operation: z.literal('watch').optional(),
    summary: z
      .object({
        mode: z.string().optional(),
        verbose: z.boolean().optional(),
        watching: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    timings: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

export const DevlinkCleanCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    hard: z.boolean().optional(),
    deep: z.boolean().optional(),
  })
  .passthrough();

export const DevlinkCleanCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    removed: z.array(z.string()).optional(),
    hard: z.boolean().optional(),
    deep: z.boolean().optional(),
    timing: z.number().optional(),
  })
  .passthrough();

export const DevlinkBackupsCommandInputSchema = z
  .object({
    cwd: z.string().min(1).optional(),
    json: z.boolean().optional(),
    list: z.boolean().optional(),
    show: z.string().optional(),
    protect: z.string().optional(),
    unprotect: z.string().optional(),
    cleanup: z.boolean().optional(),
    ...dryRunFlags,
  })
  .passthrough();

export const DevlinkBackupsCommandOutputSchema = z
  .object({
    ok: z.boolean(),
  })
  .passthrough();

// Re-export plan schema for command outputs that embed it
export type DevlinkPlan = z.infer<typeof DevlinkPlanSchema>;
export type DevlinkPlanView = z.infer<typeof PlanViewSchema>;

