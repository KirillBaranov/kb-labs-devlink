import type { CommandModule } from './types';
import { 
  listBackups, 
  cleanupOldBackups, 
  setBackupProtection, 
  matchPartialTimestamp 
} from '../utils/backup-manager';
import { box, keyValue, formatTiming, safeSymbols } from '@kb-labs/shared-cli-ui';
import { colors } from '@kb-labs/shared-cli-ui';
import { readJson } from '../utils/fs';
import { join } from 'path';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const jsonMode = !!flags.json;
  
  try {
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
    const list = !!flags.list;
    const showTimestamp = flags.show as string | undefined;
    const protectTimestamp = flags.protect as string | undefined;
    const unprotectTimestamp = flags.unprotect as string | undefined;
    const cleanup = !!flags.cleanup;
    const dryRun = !!(flags['dry-run'] || flags.dryRun);
    
    // List backups
    if (list) {
      const backups = await listBackups(cwd, { validate: true });
      
      if (jsonMode) {
        ctx.presenter.json({
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
          ctx.presenter.write('No backups found');
          return 0;
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
        
        ctx.presenter.write(box('DevLink Backups', lines));
      }
      
      return 0;
    }
    
    // Show backup details
    if (showTimestamp) {
      const backups = await listBackups(cwd, { validate: false });
      const backup = backups.find(b => b.timestamp.includes(showTimestamp));
      
      if (!backup) {
        ctx.presenter.error(`Backup not found: ${showTimestamp}`);
        return 1;
      }
      
      if (jsonMode) {
        ctx.presenter.json({
          ok: true,
          backup: backup.metadata || null
        });
      } else {
        const md = backup.metadata;
        if (!md) {
          ctx.presenter.error(`Backup metadata not available: ${backup.timestamp}`);
          return 1;
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
        
        ctx.presenter.write(box(`Backup: ${backup.timestamp}`, info));
      }
      
      return 0;
    }
    
    // Protect backup
    if (protectTimestamp) {
      const backups = await listBackups(cwd, { validate: false });
      const backup = backups.find(b => b.timestamp.includes(protectTimestamp));
      
      if (!backup) {
        ctx.presenter.error(`Backup not found: ${protectTimestamp}`);
        return 1;
      }
      
      const success = await setBackupProtection(cwd, backup.timestamp, true);
      
      if (!success) {
        ctx.presenter.error('Failed to protect backup');
        return 1;
      }
      
      if (jsonMode) {
        ctx.presenter.json({ ok: true, protected: true });
      } else {
        ctx.presenter.write(`${safeSymbols.success} Backup protected: ${backup.timestamp}`);
      }
      
      return 0;
    }
    
    // Unprotect backup
    if (unprotectTimestamp) {
      const backups = await listBackups(cwd, { validate: false });
      const backup = backups.find(b => b.timestamp.includes(unprotectTimestamp));
      
      if (!backup) {
        ctx.presenter.error(`Backup not found: ${unprotectTimestamp}`);
        return 1;
      }
      
      const success = await setBackupProtection(cwd, backup.timestamp, false);
      
      if (!success) {
        ctx.presenter.error('Failed to unprotect backup');
        return 1;
      }
      
      if (jsonMode) {
        ctx.presenter.json({ ok: true, protected: false });
      } else {
        ctx.presenter.write(`${safeSymbols.success} Backup unprotected: ${backup.timestamp}`);
      }
      
      return 0;
    }
    
    // Cleanup backups
    if (cleanup) {
      const result = await cleanupOldBackups(cwd, undefined, dryRun);
      
      if (jsonMode) {
        ctx.presenter.json({
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
        
        ctx.presenter.write(box('Cleanup Backups', summary));
        
        if (result.removed.length > 0) {
          ctx.presenter.write('');
          ctx.presenter.write(colors.warning('Removed:'));
          result.removed.forEach(b => 
            ctx.presenter.write(`  ${safeSymbols.success} ${b.timestamp}`)
          );
        }
        
        if (result.skippedProtected.length > 0) {
          ctx.presenter.write('');
          ctx.presenter.write(colors.warning('Protected (not removed):'));
          result.skippedProtected.forEach(b => 
            ctx.presenter.write(`  ${safeSymbols.success} ${b.timestamp}`)
          );
        }
      }
      
      return 0;
    }
    
    // Default: show help-like summary
    if (jsonMode) {
      ctx.presenter.json({ 
        ok: true, 
        message: 'Use --list, --show, --protect, --unprotect, or --cleanup' 
      });
    } else {
      ctx.presenter.write('DevLink Backup Management');
      ctx.presenter.write('');
      ctx.presenter.write('Available operations:');
      ctx.presenter.write('  --list              List all backups');
      ctx.presenter.write('  --show <timestamp>  Show backup details');
      ctx.presenter.write('  --protect <ts>      Mark backup as protected');
      ctx.presenter.write('  --unprotect <ts>    Unmark backup as protected');
      ctx.presenter.write('  --cleanup           Clean old backups');
      ctx.presenter.write('  --dry-run           Dry-run mode for cleanup');
    }
    
    return 0;
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (jsonMode) {
      ctx.presenter.json({ ok: false, error: errorMessage });
    } else {
      ctx.presenter.error(errorMessage);
    }
    return 1;
  }
};

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

