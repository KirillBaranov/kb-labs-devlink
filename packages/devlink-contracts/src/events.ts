/**
 * @module @kb-labs/devlink-contracts/events
 * DevLink event types and event emitter
 */

import { EventEmitter } from 'node:events';

/**
 * Base event structure for all DevLink events
 */
export interface DevLinkBaseEvent {
  kind: string;
  timestamp: string;
  schemaVersion: string;
}

/**
 * Watch ready event - emitted when watch system is ready
 */
export interface DevLinkWatchReadyEvent extends DevLinkBaseEvent {
  kind: 'devlink.watch.ready';
  providers: Array<{ name: string; dir: string }>;
  consumers: Array<{ name: string; dir: string }>;
}

/**
 * Watch stopped event - emitted when watch system stops
 */
export interface DevLinkWatchStoppedEvent extends DevLinkBaseEvent {
  kind: 'devlink.watch.stopped';
}

/**
 * Preflight event - emitted during preflight checks
 */
export interface DevLinkPreflightEvent extends DevLinkBaseEvent {
  kind: 'devlink.preflight';
  providers: Array<{ name: string; dir: string; mode: string }>;
  consumers: Array<{ name: string; dir: string }>;
}

/**
 * Config error event - emitted when configuration errors occur
 */
export interface DevLinkConfigErrorEvent extends DevLinkBaseEvent {
  kind: 'devlink.config.error';
  packageName: string;
  error: string;
}

/**
 * Info skipped (no change) event - emitted when rebuild is skipped
 */
export interface DevLinkInfoSkippedEvent extends DevLinkBaseEvent {
  kind: 'devlink.info.skipped_no_change';
  provider: string;
  reason: string;
}

/**
 * Dry run event - emitted during dry-run mode
 */
export interface DevLinkDryRunEvent extends DevLinkBaseEvent {
  kind: 'devlink.dryrun';
  providers: Array<{ name: string; dir: string; buildCmd: string; watchPaths: string[] }>;
  consumers: Array<{ name: string; dir: string; deps: string[] }>;
}

/**
 * Union type of all DevLink events
 */
export type AllDevLinkEvents =
  | DevLinkWatchReadyEvent
  | DevLinkWatchStoppedEvent
  | DevLinkPreflightEvent
  | DevLinkConfigErrorEvent
  | DevLinkInfoSkippedEvent
  | DevLinkDryRunEvent;

/**
 * DevLink Event Emitter
 *
 * Wraps events with optional JSON formatting for structured output.
 * Used by DevLinkWatcher to emit standardized events.
 */
export class DevLinkEventEmitter {
  private json: boolean;
  private silent: boolean;

  /**
   * Create a new DevLinkEventEmitter
   *
   * @param json - Whether to output events as JSON
   * @param silent - Whether to suppress event output
   */
  constructor(json: boolean, silent: boolean) {
    this.json = json;
    this.silent = silent;
  }

  /**
   * Emit a DevLink event
   *
   * @param event - The event to emit
   */
  emitEvent(event: AllDevLinkEvents): void {
    if (this.silent) {
      return;
    }

    if (this.json) {
      console.log(JSON.stringify(event, null, 2));
    }
    // If not JSON, events are handled by logger in the watch system
  }
}
