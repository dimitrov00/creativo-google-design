import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsCall,
  type AnalyticsReport,
} from '@core/components';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { AnalyticsCacheKey, AnalyticsCachePorts } from '@core/ports';
import { storageReason } from './storage-reason';

/** Every key of this cache starts here — what a clear sweeps. */
const PREFIX = 'creativo.analytics/';
/** This definition's entries; an older version's are never read, and swept on a write. */
const VERSION_PREFIX = `${PREFIX}${ANALYTICS_DEFINITION_VERSION}/`;
/** The order the entries were written in, oldest first — the cap's memory. */
const ORDER_KEY = `${PREFIX}order`;
/** How many reports the device keeps (`docs/designs/staff-analytics.md`, Cache). */
export const ANALYTICS_CACHE_CAPACITY = 6;
/** The scope segment of a shop report's key. */
const SHOP_SCOPE = 'shop';

/**
 * The storage key of one cached report —
 * `creativo.analytics/<definitionVersion>/<uid>/<scope>/<period>`: the
 * scope a barber id or `shop`, the period its span and first day
 * (`MONTH-2026-09-01`). Each segment URI-encoded, so no id can reach into
 * another segment.
 */
export function analyticsCacheStorageKey(key: AnalyticsCacheKey): string {
  const scope = key.scopeBarberId ?? SHOP_SCOPE;
  const period = `${key.analyticsSpan}-${key.fromLocalDate}`;
  return `${VERSION_PREFIX}${[key.userId, scope, period]
    .map(encodeURIComponent)
    .join('/')}`;
}

/**
 * THE STAFF «АНАЛИЗИ» REPORT CACHE in `localStorage` — `ANALYTICS_CACHE_PORTS`
 * (`docs/designs/staff-analytics.md`, The screen · Cache). What the screen
 * paints in the tap's first frame while the callable answers.
 *
 * - **Figures and day rows only.** A report is written with its seat rows
 *   emptied: they name the visits of the scoped barber, and a device keeps
 *   none of that past the page (the risk table: a cached row outliving an
 *   erasure).
 * - **At most {@link ANALYTICS_CACHE_CAPACITY} entries**, the least
 *   recently WRITTEN dropped first; the write order lives under one key of
 *   its own. A write also sweeps every entry of an older definition.
 * - **Read through the report's own decoder** (`AnalyticsCall.decodeReport`)
 *   and its definition version: a value that is no report of this
 *   definition is deleted and answers `REPOSITORY_MALFORMED`.
 * - **Every storage access is in a try/catch** — a private window, a quota
 *   or a disabled storage answers a `RepositoryError`, never a throw.
 */
export const localStorageAnalyticsCachePorts = (): AnalyticsCachePorts => ({
  readCachedReport: (key) => {
    const storageKey = analyticsCacheStorageKey(key);
    let raw: string | null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch (cause) {
      return Result.err(
        RepositoryError.readFailed(storageKey, storageReason(cause)),
      );
    }
    if (raw === null) return Result.ok(null);
    const report = decoded(raw);
    if (report !== null) return Result.ok(report);
    try {
      localStorage.removeItem(storageKey);
      writeOrder(readOrder().filter((held) => held !== storageKey));
    } catch {
      // Nothing more to do: the read already answers that there is no report.
    }
    return Result.err(
      RepositoryError.malformed(
        storageKey,
        'the stored value is no analytics report of this definition',
      ),
    );
  },

  writeCachedReport: (key, report) => {
    const storageKey = analyticsCacheStorageKey(key);
    const kept: AnalyticsReport = { ...report, reportSeatRows: [] };
    try {
      sweepOlderDefinitions();
      localStorage.setItem(storageKey, JSON.stringify(kept));
      const order = [
        ...readOrder().filter((held) => held !== storageKey),
        storageKey,
      ];
      while (order.length > ANALYTICS_CACHE_CAPACITY) {
        const dropped = order.shift();
        if (dropped !== undefined) localStorage.removeItem(dropped);
      }
      writeOrder(order);
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        RepositoryError.writeFailed(storageKey, storageReason(cause)),
      );
    }
  },

  clearCachedReports: () => {
    try {
      for (const held of keysUnder(PREFIX)) localStorage.removeItem(held);
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        RepositoryError.writeFailed(PREFIX, storageReason(cause)),
      );
    }
  },
});

/** The stored text as a report of THIS definition, or `null`. */
function decoded(raw: string): AnalyticsReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const report = AnalyticsCall.decodeReport(parsed);
  return report.ok &&
    report.value.reportDefinitionVersion === ANALYTICS_DEFINITION_VERSION
    ? report.value
    : null;
}

/** The write order, oldest first — only this definition's keys; anything unreadable is no order. Throws what the storage throws. */
function readOrder(): string[] {
  const raw = localStorage.getItem(ORDER_KEY);
  if (raw === null) return orphans([]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const order = Array.isArray(parsed)
    ? parsed.filter(
        (held): held is string =>
          typeof held === 'string' && held.startsWith(VERSION_PREFIX),
      )
    : [];
  return orphans(order);
}

/**
 * The order with every entry it does not name put first — an entry written
 * while the order could not be (a quota between the two writes) counts as
 * the oldest, so the cap still holds.
 */
function orphans(order: readonly string[]): string[] {
  const named = new Set(order);
  const stray = keysUnder(VERSION_PREFIX).filter((held) => !named.has(held));
  return [...stray, ...order];
}

function writeOrder(order: readonly string[]): void {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order));
}

/** Every entry of an older definition goes — it would never be read again. */
function sweepOlderDefinitions(): void {
  for (const held of keysUnder(PREFIX)) {
    if (held !== ORDER_KEY && !held.startsWith(VERSION_PREFIX)) {
      localStorage.removeItem(held);
    }
  }
}

/** Every storage key under `prefix`, read before any is removed. */
function keysUnder(prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const held = localStorage.key(i);
    if (held !== null && held.startsWith(prefix)) keys.push(held);
  }
  return keys;
}
