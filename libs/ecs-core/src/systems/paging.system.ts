import { type Page, type PageKey, PageStepResult } from '@core/components';

/**
 * PagingSystem — the SAME-INSTANT BOUNDARY RULE of a newest-first history
 * (`libs/infrastructure/firestore/src/lib/client-history-reader.adapter.ts`,
 * protected by `client-history-reader.adapter.integration.spec.ts:156`),
 * moved out of the adapter. The cursor is the key (stored start) of a
 * page's oldest row, and a query resumes strictly BELOW it, so a page must
 * never end between two rows sharing one instant: the second could never be
 * read. The adapter reads one row more than the page to know whether
 * anything older is left; when that extra row starts at the page's last
 * instant, the page takes the whole instant (a visit cancelled and booked
 * again for the same minute is two appointments). Keys and ids only — the
 * queries stay in the adapter.
 */
export const PagingSystem = {
  /**
   * A page size the reader honours: a whole number, at least one. A
   * non-finite `limit` passes through as `NaN`/`Infinity` on purpose — a
   * reader that relies on its query refusing one (`appointments.adapter.ts`'s
   * `limit(NaN)` → `readFailed`) keeps that answer; {@link PagingSystem.pageSizeOf}
   * is the total form.
   */
  pageSize(limit: number): number {
    return Math.max(1, Math.floor(limit));
  },

  /**
   * A whole page size of at least one, WHATEVER was asked — a non-finite
   * `raw` (`NaN`, `±Infinity`) reads as one (pass C, P-33: the adapters'
   * three `Number.isFinite(raw) ? pageSize(raw) : 1` guards, homed here).
   */
  pageSizeOf(raw: number): number {
    return Number.isFinite(raw) ? PagingSystem.pageSize(raw) : 1;
  },

  /**
   * The page a newest-first read of `pageSize + 1` rows makes. Fewer rows
   * than the extra one: the last page, no cursor. The extra row at another
   * instant: the first `pageSize` rows, resuming below the last one's key.
   * The extra row at the same instant: `PageStep.Tied`.
   */
  nextCursor<R, K extends PageKey>(
    read: readonly R[],
    pageSize: number,
    keyOf: (row: R) => K,
  ): PageStepResult<R, K> {
    if (read.length <= pageSize) {
      return PageStepResult.page<R, K>(read, null);
    }
    const boundary = keyOf(read[pageSize - 1] as R);
    if (keyOf(read[pageSize] as R) !== boundary) {
      return PageStepResult.page(read.slice(0, pageSize), boundary);
    }
    const newer: R[] = [];
    for (let i = 0; i < read.length; i++) {
      const row = read[i] as R;
      if (keyOf(row) > boundary) newer.push(row);
    }
    return PageStepResult.tied(boundary, newer);
  },

  /**
   * The page that takes a tied instant whole: the read's newer rows, then
   * EVERY row at the boundary, newest id first (a stable order the store
   * itself does not give), resuming below the boundary only when something
   * older exists.
   */
  sameInstantBoundary<R, K extends PageKey>(
    newer: readonly R[],
    tied: readonly R[],
    idOf: (row: R) => string,
    olderExists: boolean,
    boundary: K,
  ): Page<R, K> {
    const atBoundary = [...tied].sort((a, b) => {
      const x = idOf(a);
      const y = idOf(b);
      return x < y ? 1 : x > y ? -1 : 0;
    });
    return {
      rows: [...newer, ...atBoundary],
      cursor: olderExists ? boundary : null,
    };
  },
} as const;
