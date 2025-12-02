/**
 * Analytics event types for DevLink
 * Centralized constants to prevent typos and enable type safety
 */

/**
 * Event type prefixes by command
 */
export const ANALYTICS_PREFIX = {
  PLAN: 'devlink.plan',
  APPLY: 'devlink.apply',
  STATUS: 'devlink.status',
  FREEZE: 'devlink.freeze',
  UNDO: 'devlink.undo',
  SWITCH: 'devlink.switch',
  UPDATE: 'devlink.update',
  WATCH: 'devlink.watch',
  CLEAN: 'devlink.clean',
  BACKUPS: 'devlink.backups',
} as const;

/**
 * Event lifecycle suffixes
 */
export const ANALYTICS_SUFFIX = {
  STARTED: 'started',
  FINISHED: 'finished',
} as const;

/**
 * DevLink analytics event types
 */
export const ANALYTICS_EVENTS = {
  // Plan events
  PLAN_STARTED: `${ANALYTICS_PREFIX.PLAN}.${ANALYTICS_SUFFIX.STARTED}`,
  PLAN_FINISHED: `${ANALYTICS_PREFIX.PLAN}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Apply events
  APPLY_STARTED: `${ANALYTICS_PREFIX.APPLY}.${ANALYTICS_SUFFIX.STARTED}`,
  APPLY_FINISHED: `${ANALYTICS_PREFIX.APPLY}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Status events
  STATUS_STARTED: `${ANALYTICS_PREFIX.STATUS}.${ANALYTICS_SUFFIX.STARTED}`,
  STATUS_FINISHED: `${ANALYTICS_PREFIX.STATUS}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Freeze events
  FREEZE_STARTED: `${ANALYTICS_PREFIX.FREEZE}.${ANALYTICS_SUFFIX.STARTED}`,
  FREEZE_FINISHED: `${ANALYTICS_PREFIX.FREEZE}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Undo events
  UNDO_STARTED: `${ANALYTICS_PREFIX.UNDO}.${ANALYTICS_SUFFIX.STARTED}`,
  UNDO_FINISHED: `${ANALYTICS_PREFIX.UNDO}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Switch events
  SWITCH_STARTED: `${ANALYTICS_PREFIX.SWITCH}.${ANALYTICS_SUFFIX.STARTED}`,
  SWITCH_FINISHED: `${ANALYTICS_PREFIX.SWITCH}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Update events
  UPDATE_STARTED: `${ANALYTICS_PREFIX.UPDATE}.${ANALYTICS_SUFFIX.STARTED}`,
  UPDATE_FINISHED: `${ANALYTICS_PREFIX.UPDATE}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Watch events
  WATCH_STARTED: `${ANALYTICS_PREFIX.WATCH}.${ANALYTICS_SUFFIX.STARTED}`,
  WATCH_FINISHED: `${ANALYTICS_PREFIX.WATCH}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Clean events
  CLEAN_STARTED: `${ANALYTICS_PREFIX.CLEAN}.${ANALYTICS_SUFFIX.STARTED}`,
  CLEAN_FINISHED: `${ANALYTICS_PREFIX.CLEAN}.${ANALYTICS_SUFFIX.FINISHED}`,

  // Backups events
  BACKUPS_STARTED: `${ANALYTICS_PREFIX.BACKUPS}.${ANALYTICS_SUFFIX.STARTED}`,
  BACKUPS_FINISHED: `${ANALYTICS_PREFIX.BACKUPS}.${ANALYTICS_SUFFIX.FINISHED}`,
} as const;

/**
 * Type helper for analytics event types
 */
export type AnalyticsEventType = typeof ANALYTICS_EVENTS[keyof typeof ANALYTICS_EVENTS];

/**
 * Actor configuration for DevLink analytics
 */
export const ANALYTICS_ACTOR = {
  type: 'agent' as const,
  id: 'devlink-cli',
} as const;

