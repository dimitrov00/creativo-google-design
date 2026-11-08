import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsComparison,
  AnalyticsSpan,
  type AnalyticsReport,
} from '@core/components';
import { BarberId, LocalDate, UserId } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import type { AnalyticsCacheKey } from '@core/ports';
import {
  analyticsReportFixture,
  deepFreeze,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  ANALYTICS_CACHE_CAPACITY,
  analyticsCacheStorageKey,
  localStorageAnalyticsCachePorts,
} from './local-storage-analytics-cache.adapter';

const IVAN = UserId.of('dev-staff-ivan');
const SEPTEMBER = unwrapOk(LocalDate.parse('2026-09-01'));

function keyOf(overrides: Partial<AnalyticsCacheKey> = {}): AnalyticsCacheKey {
  return {
    userId: IVAN,
    scopeBarberId: BarberId.of('ivan'),
    analyticsSpan: AnalyticsSpan.Month,
    fromLocalDate: SEPTEMBER,
    toLocalDate: null,
    analyticsComparison: AnalyticsComparison.Previous,
    ...overrides,
  };
}

/** The n-th month before September 2026, as a key. */
function monthKey(back: number): AnalyticsCacheKey {
  return keyOf({ fromLocalDate: LocalDate.addMonths(SEPTEMBER, -back) });
}

describe('localStorageAnalyticsCachePorts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spells the key creativo.analytics/<version>/<uid>/<scope>/<SPAN>-<from>-<to|none>-<COMPARISON>, the shop as «shop»', () => {
    expect(analyticsCacheStorageKey(keyOf())).toBe(
      'creativo.analytics/2/dev-staff-ivan/ivan/MONTH-2026-09-01-none-PREVIOUS',
    );
    expect(
      analyticsCacheStorageKey(
        keyOf({
          scopeBarberId: null,
          analyticsSpan: AnalyticsSpan.Week,
          fromLocalDate: unwrapOk(LocalDate.parse('2026-09-28')),
        }),
      ),
    ).toBe(
      'creativo.analytics/2/dev-staff-ivan/shop/WEEK-2026-09-28-none-PREVIOUS',
    );
    // A CUSTOM range carries its last day, so two ranges from one day never share an entry.
    expect(
      analyticsCacheStorageKey(
        keyOf({
          analyticsSpan: AnalyticsSpan.Custom,
          fromLocalDate: unwrapOk(LocalDate.parse('2026-09-07')),
          toLocalDate: unwrapOk(LocalDate.parse('2026-09-20')),
        }),
      ),
    ).toBe(
      'creativo.analytics/2/dev-staff-ivan/ivan/CUSTOM-2026-09-07-2026-09-20-PREVIOUS',
    );
    expect(
      analyticsCacheStorageKey(
        keyOf({
          analyticsSpan: AnalyticsSpan.Year,
          fromLocalDate: unwrapOk(LocalDate.parse('2026-01-01')),
        }),
      ),
    ).toBe(
      'creativo.analytics/2/dev-staff-ivan/ivan/YEAR-2026-01-01-none-PREVIOUS',
    );
    // A segment can never reach into the next one.
    expect(analyticsCacheStorageKey(keyOf({ userId: UserId.of('a/b') }))).toBe(
      'creativo.analytics/2/a%2Fb/ivan/MONTH-2026-09-01-none-PREVIOUS',
    );
  });

  it('answers null when nothing is cached', () => {
    const ports = localStorageAnalyticsCachePorts();
    expect(unwrapOk(ports.readCachedReport(keyOf()))).toBeNull();
  });

  it('reads back what it wrote — figures and day rows, never the seat rows', () => {
    const ports = localStorageAnalyticsCachePorts();
    const report = deepFreeze(analyticsReportFixture());
    expect(report.reportSeatRows.length).toBeGreaterThan(0);

    unwrapOk(ports.writeCachedReport(keyOf(), report));

    const stored = localStorage.getItem(analyticsCacheStorageKey(keyOf()));
    expect(stored).not.toBeNull();
    // Seat rows name the barber's visits: not a byte of them on the device.
    expect(stored).not.toContain('a-1');
    expect(JSON.parse(stored ?? '{}').reportSeatRows).toEqual([]);

    const read = unwrapOk(ports.readCachedReport(keyOf()));
    expect(read).toEqual({ ...report, reportSeatRows: [] });
    expect(read?.reportDayRows).toEqual(report.reportDayRows);
    // The report it was handed is untouched.
    expect(report.reportSeatRows.length).toBeGreaterThan(0);
  });

  it('keeps every account, scope and period apart', () => {
    const ports = localStorageAnalyticsCachePorts();
    unwrapOk(ports.writeCachedReport(keyOf(), analyticsReportFixture()));

    expect(
      unwrapOk(ports.readCachedReport(keyOf({ userId: UserId.of('other') }))),
    ).toBeNull();
    expect(
      unwrapOk(ports.readCachedReport(keyOf({ scopeBarberId: null }))),
    ).toBeNull();
    expect(
      unwrapOk(
        ports.readCachedReport(keyOf({ analyticsSpan: AnalyticsSpan.Week })),
      ),
    ).toBeNull();
    // Two CUSTOM ranges from the same first day are two entries.
    const custom = (to: string) =>
      keyOf({
        analyticsSpan: AnalyticsSpan.Custom,
        toLocalDate: unwrapOk(LocalDate.parse(to)),
      });
    unwrapOk(
      ports.writeCachedReport(custom('2026-09-14'), analyticsReportFixture()),
    );
    expect(
      unwrapOk(ports.readCachedReport(custom('2026-09-14'))),
    ).not.toBeNull();
    expect(unwrapOk(ports.readCachedReport(custom('2026-09-21')))).toBeNull();
    expect(
      unwrapOk(
        ports.readCachedReport(
          keyOf({ analyticsComparison: AnalyticsComparison.SameLastYear }),
        ),
      ),
    ).toBeNull();
  });

  it(`keeps at most ${ANALYTICS_CACHE_CAPACITY} reports, the least recently written dropped first`, () => {
    const ports = localStorageAnalyticsCachePorts();
    const report = analyticsReportFixture();
    for (let back = 0; back < ANALYTICS_CACHE_CAPACITY; back++) {
      unwrapOk(ports.writeCachedReport(monthKey(back), report));
    }
    // Rewriting the oldest makes it the newest.
    unwrapOk(ports.writeCachedReport(monthKey(0), report));
    unwrapOk(ports.writeCachedReport(monthKey(6), report));

    const entries = Object.keys(localStorage).filter((key) =>
      key.startsWith('creativo.analytics/2/'),
    );
    expect(entries).toHaveLength(ANALYTICS_CACHE_CAPACITY);
    // Month 1 back was the least recently written.
    expect(unwrapOk(ports.readCachedReport(monthKey(1)))).toBeNull();
    expect(unwrapOk(ports.readCachedReport(monthKey(0)))).not.toBeNull();
    expect(unwrapOk(ports.readCachedReport(monthKey(6)))).not.toBeNull();
  });

  it('counts an entry the order does not name as the oldest, so the cap still holds', () => {
    const ports = localStorageAnalyticsCachePorts();
    const report = analyticsReportFixture();
    localStorage.setItem(
      analyticsCacheStorageKey(monthKey(9)),
      JSON.stringify({ ...report, reportSeatRows: [] }),
    );
    for (let back = 0; back < ANALYTICS_CACHE_CAPACITY; back++) {
      unwrapOk(ports.writeCachedReport(monthKey(back), report));
    }
    expect(unwrapOk(ports.readCachedReport(monthKey(9)))).toBeNull();
  });

  it('deletes a stored value that is no report of this definition and answers Result.err REPOSITORY_MALFORMED', () => {
    const ports = localStorageAnalyticsCachePorts();
    const storageKey = analyticsCacheStorageKey(keyOf());
    // A PR 4a entry: version 2, but without the missing-days count.
    const pr4a = Object.fromEntries(
      Object.entries(analyticsReportFixture()).filter(
        ([field]) => field !== 'reportMissingDays',
      ),
    );
    for (const raw of [
      '{not json',
      JSON.stringify({ reportTakingsCents: 'lots' }),
      JSON.stringify({
        ...analyticsReportFixture(),
        reportDefinitionVersion: ANALYTICS_DEFINITION_VERSION + 1,
      }),
      JSON.stringify(pr4a),
    ]) {
      localStorage.setItem(storageKey, raw);
      expect(unwrapErr(ports.readCachedReport(keyOf())).errorCode).toBe(
        RepositoryErrorCode.Malformed,
      );
      expect(localStorage.getItem(storageKey)).toBeNull();
    }
  });

  it('never reads a v1 entry (VERSION_PREFIX is this definition’s), and sweeps an older definition’s entries on a write', () => {
    const ports = localStorageAnalyticsCachePorts();
    expect(ANALYTICS_DEFINITION_VERSION).toBe(2);
    const v1 =
      'creativo.analytics/1/dev-staff-ivan/ivan/MONTH-2026-09-01-PREVIOUS';
    const v0 =
      'creativo.analytics/0/dev-staff-ivan/ivan/MONTH-2026-09-01-PREVIOUS';
    localStorage.setItem(v1, JSON.stringify(analyticsReportFixture()));
    localStorage.setItem(v0, '{}');
    // Nothing under this definition's prefix: no cache, whatever v1 held.
    expect(unwrapOk(ports.readCachedReport(keyOf()))).toBeNull();
    unwrapOk(ports.writeCachedReport(keyOf(), analyticsReportFixture()));
    expect(localStorage.getItem(v1)).toBeNull();
    expect(localStorage.getItem(v0)).toBeNull();
    expect(
      localStorage.getItem(analyticsCacheStorageKey(keyOf())),
    ).not.toBeNull();
  });

  it('clears every analytics entry and nothing else', () => {
    const ports = localStorageAnalyticsCachePorts();
    localStorage.setItem('staff-schedule-show-free-time', 'true');
    unwrapOk(ports.writeCachedReport(keyOf(), analyticsReportFixture()));
    unwrapOk(
      ports.writeCachedReport(
        keyOf({ userId: UserId.of('other') }),
        analyticsReportFixture(),
      ),
    );

    unwrapOk(ports.clearCachedReports());

    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith('creativo.analytics/'),
      ),
    ).toEqual([]);
    expect(localStorage.getItem('staff-schedule-show-free-time')).toBe('true');
  });

  it('answers a storage that throws as a RepositoryError — never a throw', () => {
    const ports = localStorageAnalyticsCachePorts();
    const quota = new DOMException('quota', 'QuotaExceededError');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota;
    });
    const written = ports.writeCachedReport(keyOf(), analyticsReportFixture());
    expect(unwrapErr(written).errorCode).toBe(RepositoryErrorCode.WriteFailed);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(unwrapErr(ports.readCachedReport(keyOf())).errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );

    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('disabled');
    });
    vi.spyOn(Storage.prototype, 'length', 'get').mockReturnValue(1);
    expect(unwrapErr(ports.clearCachedReports()).errorCode).toBe(
      RepositoryErrorCode.WriteFailed,
    );
  });

  it('a report it reads keeps the type it was written as', () => {
    const ports = localStorageAnalyticsCachePorts();
    const report: AnalyticsReport = analyticsReportFixture({
      reportHeroPreviousCents: null,
      reportEmptiestLocalDate: null,
    });
    unwrapOk(ports.writeCachedReport(keyOf(), report));
    expect(unwrapOk(ports.readCachedReport(keyOf()))).toEqual({
      ...report,
      reportSeatRows: [],
    });
  });
});
