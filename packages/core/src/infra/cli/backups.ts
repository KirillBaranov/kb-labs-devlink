import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import {
  listBackups,
  cleanupOldBackups,
  setBackupProtection
} from '../backup/backup-manager';
import { keyValue, safeSymbols } from '@kb-labs/shared-cli-ui';
import { colors } from '@kb-labs/shared-cli-ui';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';

type DevlinkBackupsFlags = {
  cwd: { type: 'string'; description?: string };
  list: { type: 'boolean'; description?: string; default?: boolean };
  show: { type: 'string'; description?: string };
  protect: { type: 'string'; description?: string };
  unprotect: { type: 'string'; description?: string };
  cleanup: { type: 'boolean'; description?: string; default?: boolean };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean };
  dryRun: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkBackupsResult = CommandResult & {
  operation?: string;
  backupsCount?: number;
  protectedCount?: number;
  removedCount?: number;
  keptCount?: number;
};

export const run = defineCommand<DevlinkBackupsFlags, DevlinkBackupsResult>({
  name: 'devlink:backups',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    list: {
      type: 'boolean',
      description: 'List all backups',
      default: false,
    },
    show: {
      type: 'string',
      description: 'Show backup details',
    },
    protect: {
      type: 'string',
      description: 'Mark backup as protected',
    },
    unprotect: {
      type: 'string',
      description: 'Unmark backup as protected',
    },
    cleanup: {
      type: 'boolean',
      description: 'Clean old backups',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview changes without executing',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview changes without executing',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output diagnostics in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.BACKUPS_STARTED,
    finishEvent: ANALYTICS_EVENTS.BACKUPS_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : process.cwd();
    const list = !!flags.list;
    const showTimestamp = flags.show;
    const protectTimestamp = flags.protect;
    const unprotectTimestamp = flags.unprotect;
    const cleanup = !!flags.cleanup;
    const dryRun = !!(flags['dry-run'] || flags.dryRun);
    const jsonMode = !!flags.json;

    // Determine operation type
    const operation = list ? 'list' :
      showTimestamp ? 'show' :
      protectTimestamp ? 'protect' :
      unprotectTimestamp ? 'unprotect' :
      cleanup ? 'cleanup' : 'help';

    // List backups
    if (list) {
      const backups = await listBackups(cwd, { validate: true });

      if (jsonMode) {
        ctx.output?.json({
          ok: true,
          count: backups.length,
          backups: backups.map(b => ({
            timestamp: b.timestamp,
            type: b.type,
            age: b.age,
            isProtected: b.isProtected,
            valid: b.valid,
            consumersCount: b.consumersCount,
            depsCount: b.depsCount,
          }))
        });
      } else {
        if (backups.length === 0) {
          ctx.output?.write('No backups found');
          return {
            ok: true,
            operation,
            backupsCount: 0,
          };
        }

        const lines: string[] = [];
        lines.push('Backups:');
        lines.push('');

        for (const backup of backups) {
          const protectedBadge = backup.isProtected ? ` ${colors.warning('🔒')}` : '';
          const validBadge = backup.valid ? '' : ` ${colors.error('⚠️')}`;
          const age = formatAge(backup.age);
          lines.push(`  ${colors.info(backup.timestamp)}${protectedBadge}${validBadge} - ${age} (${backup.type})`);
        }

        const { ui } = ctx.output!;
        ctx.output?.write(ui.box('DevLink Backups', lines));
      }

      return {
        ok: true,
        operation,
        backupsCount: backups.length,
        protectedCount: backups.filter(b => b.isProtected).length,
      };
    }

    // Show backup details
    if (showTimestamp) {
      const backups = await listBackups(cwd, { validate: false });
      const backup = backups.find(b => b.timestamp.includes(showTimestamp));

      if (!backup) {
        ctx.output?.error(new Error(`Backup not found: ${showTimestamp}`));
        return {
          ok: false,
          operation,
        };
      }

      if (jsonMode) {
        ctx.output?.json({
          ok: true,
          backup: backup.metadata || null
        });
      } else {
        const md = backup.metadata;
        if (!md) {
          ctx.output?.error(new Error(`Backup metadata not available: ${backup.timestamp}`));
          return {
            ok: false,
            operation,
          };
        }

        const info = keyValue({
          'Timestamp': md.timestamp,
          'Type': md.type,
          'Mode': md.mode,
          'DevLink Version': md.devlinkVersion,
          'Protected': md.isProtected ? 'Yes' : 'No',
          'Age': formatAge(backup.age),
          'Files': md.counts.manifests,
          'Dependencies': md.counts.deps,
          'Git Commit': md.git?.commit || 'N/A',
          'Git Branch': md.git?.branch || 'N/A',
          'Git Dirty': md.git?.dirty ? 'Yes' : 'No',
          'Node Version': md.node?.nodeVersion || 'N/A',
          'PNPM Version': md.node?.pnpmVersion || 'N/A',
          'Total Size': formatBytes(md.sizes.totalBytes),
        });

        const { ui } = ctx.output!;
        ctx.output?.write(ui.box(`Backup: ${backup.timestamp}`, info));
      }

      return {
        ok: true,
        operation,
      };
    }

    // Protect backup
    if (protectTimestamp) {
      const backups = await listBackups(cwd, { validate: false });
      const backup = backups.find(b => b.timestamp.includes(protectTimestamp));

      if (!backup) {
        ctx.output?.error(new Error(`Backup not found: ${protectTimestamp}`));
        return {
          ok: false,
          operation,
        };
      }

      const success = await setBackupProtection(cwd, backup.timestamp, true);

      if (!success) {
        ctx.output?.error(new Error('Failed to protect backup'));
        return {
          ok: false,
          operation,
        };
      }

      if (jsonMode) {
        ctx.output?.json({ ok: true, protected: true });
      } else {
        ctx.output?.write(`${safeSymbols.success} Backup protected: ${backup.timestamp}`);
      }

      return {
        ok: true,
        operation,
      };
    }

    // Unprotect backup
    if (unprotectTimestamp) {
      const backups = await listBackups(cwd, { validate: false });
      const backup = backups.find(b => b.timestamp.includes(unprotectTimestamp));

      if (!backup) {
        ctx.output?.error(new Error(`Backup not found: ${unprotectTimestamp}`));
        return {
          ok: false,
          operation,
        };
      }

      const success = await setBackupProtection(cwd, backup.timestamp, false);

      if (!success) {
        ctx.output?.error(new Error('Failed to unprotect backup'));
        return {
          ok: false,
          operation,
        };
      }

      if (jsonMode) {
        ctx.output?.json({ ok: true, protected: false });
      } else {
        ctx.output?.write(`${safeSymbols.success} Backup unprotected: ${backup.timestamp}`);
      }

      return {
        ok: true,
        operation,
      };
    }

    // Cleanup backups
    if (cleanup) {
      const result = await cleanupOldBackups(cwd, undefined, dryRun);

      if (jsonMode) {
        ctx.output?.json({
          ok: true,
          removed: result.removed.length,
          kept: result.kept.length,
          protected: result.skippedProtected.length,
          dryRun
        });
      } else {
        const summary = keyValue({
          'Removed': result.removed.length,
          'Kept': result.kept.length,
          'Protected': result.skippedProtected.length,
          'Dry Run': dryRun ? 'Yes' : 'No',
        });

        const { ui } = ctx.output!;
        ctx.output?.write(ui.box('Cleanup Backups', summary));

        if (result.removed.length > 0) {
          ctx.output?.write('');
          ctx.output?.write(colors.warning('Removed:'));
          result.removed.forEach(b =>
            ctx.output?.write(`  ${safeSymbols.success} ${b.timestamp}`)
          );
        }

        if (result.skippedProtected.length > 0) {
          ctx.output?.write('');
          ctx.output?.write(colors.warning('Protected (not removed):'));
          result.skippedProtected.forEach(b =>
            ctx.output?.write(`  ${safeSymbols.success} ${b.timestamp}`)
          );
        }
      }

      return {
        ok: true,
        operation,
        removedCount: result.removed.length,
        keptCount: result.kept.length,
        protectedCount: result.skippedProtected.length,
      };
    }

    // Default: show help-like summary
    if (jsonMode) {
      ctx.output?.json({
        ok: true,
        message: 'Use --list, --show, --protect, --unprotect, or --cleanup'
      });
    } else {
      ctx.output?.write('DevLink Backup Management');
      ctx.output?.write('');
      ctx.output?.write('Available operations:');
      ctx.output?.write('  --list              List all backups');
      ctx.output?.write('  --show <timestamp>  Show backup details');
      ctx.output?.write('  --protect <ts>      Mark backup as protected');
      ctx.output?.write('  --unprotect <ts>    Unmark backup as protected');
      ctx.output?.write('  --cleanup           Clean old backups');
      ctx.output?.write('  --dry-run           Dry-run mode for cleanup');
    }

    return {
      ok: true,
      operation,
    };
  },
});

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else {
    return 'just now';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

