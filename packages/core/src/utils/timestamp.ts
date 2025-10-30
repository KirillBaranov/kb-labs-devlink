/**
 * Timestamp utilities for unified backup format
 */

/**
 * Create filesystem-safe ISO timestamp
 * Format: YYYY-MM-DDTHH-mm-ss-SSSZ (colons replaced with dashes)
 * Example: 2025-10-19T13-31-39-029Z
 */
export function createBackupTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

/**
 * Parse backup timestamp (supports both old and new formats)
 * Returns normalized ISO format and legacy flag
 */
export function parseBackupTimestamp(ts: string): {
  date: Date | null;
  normalized: string;
  isLegacy: boolean;
} {
  try {
    // Old format: 2025-10-19__13-32-18-119Z (double underscore, no T)
    if (ts.includes("__")) {
      // Convert: 2025-10-19__13-32-18-119Z → 2025-10-19T13:32:18.119Z
      const parts = ts.replace("Z", "").split("__");
      if (parts.length !== 2) {
        return { date: null, normalized: ts, isLegacy: true };
      }

      const datePart = parts[0]; // 2025-10-19
      const timePart = parts[1]; // 13-32-18-119
      
      if (!timePart) {
        return { date: null, normalized: ts, isLegacy: true };
      }
      
      const timeSegments = timePart.split("-"); // [13, 32, 18, 119]

      if (timeSegments.length < 3) {
        return { date: null, normalized: ts, isLegacy: true };
      }

      const hh = timeSegments[0];
      const mm = timeSegments[1];
      const ss = timeSegments[2];
      const ms = timeSegments[3] || "000";

      const isoString = `${datePart}T${hh}:${mm}:${ss}.${ms}Z`;
      const date = new Date(isoString);

      return {
        date: isNaN(date.getTime()) ? null : date,
        normalized: isoString.replace(/:/g, "-"),
        isLegacy: true,
      };
    }

    // New format: 2025-10-19T13-31-39-029Z (already filesystem-safe)
    // Convert to standard ISO for Date parsing
    const isoString = ts.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
    const date = new Date(isoString);

    return {
      date: isNaN(date.getTime()) ? null : date,
      normalized: ts,
      isLegacy: false,
    };
  } catch {
    return { date: null, normalized: ts, isLegacy: false };
  }
}

/**
 * Find backup by partial timestamp (prefix matching)
 * Returns single match, array of matches, or null
 */
export function matchPartialTimestamp(
  partial: string,
  candidates: string[]
): { match: string | null; candidates: string[] } {
  const matches = candidates.filter((ts) => ts.startsWith(partial));

  if (matches.length === 0) {
    return { match: null, candidates: [] };
  }
  
  if (matches.length === 1) {
    return { match: matches[0] || null, candidates: [] };
  }
  
  return { match: null, candidates: matches }; // Multiple matches
}

/**
 * Format timestamp age for display
 */
export function formatTimestampAge(ts: string): string {
  const parsed = parseBackupTimestamp(ts);
  if (!parsed.date) {return "unknown";}

  const ageMs = Date.now() - parsed.date.getTime();
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {return `${days}d ago`;}
  if (hours > 0) {return `${hours}h ago`;}
  if (minutes > 0) {return `${minutes}m ago`;}
  return `${seconds}s ago`;
}

