/**
 * What one read of a newest-first page decided — the field `pageStep`, the
 * ONLY source of these strings.
 */
export const PageStep = {
  /** The page is cut: its rows and the cursor the next page resumes from. */
  Page: 'PAGE',
  /**
   * The read's last row and the extra one share one instant: the page must
   * take that whole instant, so the caller reads every row AT it (and
   * whether anything is older) and finishes with
   * {@link PagingSystem.sameInstantBoundary}.
   */
  Tied: 'TIED',
} as const;
export type PageStep = (typeof PageStep)[keyof typeof PageStep];

/**
 * A page key: the stored value a page is ordered and resumed by. GENERIC and
 * OPAQUE on purpose (flatten-spec §3.9): the system only compares keys, so
 * the typed cursor — `beforeUtcMs: UtcEpochMs` on `PageClientHistory`, a
 * journal sequence on `PageClientJournal` — belongs to the caller's port,
 * never to this system.
 */
export type PageKey = string | number;

/** A finished page: its rows, newest first, and where the next one resumes (`null`: nothing older). */
export type Page<R, K extends PageKey> = {
  readonly rows: readonly R[];
  readonly cursor: K | null;
};

/** What {@link PagingSystem.nextCursor} decided, discriminated by `pageStep`. */
export type PageStepResult<R, K extends PageKey> =
  | ({ readonly pageStep: typeof PageStep.Page } & Page<R, K>)
  | {
      readonly pageStep: typeof PageStep.Tied;
      /** The instant the page must take whole. */
      readonly boundary: K;
      /** The read's rows strictly newer than the boundary, in read order. */
      readonly newer: readonly R[];
    };

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
  /** A page size the reader honours: a whole number, at least one. */
  pageSize(limit: number): number {
    return Math.max(1, Math.floor(limit));
  },

  /**
   * The page a newest-first read of `pageSize + 1` rows makes. Fewer rows
   * than the extra one: the last page, no cursor. The extra row at another
   * instant: the first `pageSize` rows, resuming below the last one's key.
   * The extra row at the same instant: {@link PageStep.Tied}.
   */
  nextCursor<R, K extends PageKey>(
    read: readonly R[],
    pageSize: number,
    keyOf: (row: R) => K,
  ): PageStepResult<R, K> {
    if (read.length <= pageSize) {
      return { pageStep: PageStep.Page, rows: read, cursor: null };
    }
    const boundary = keyOf(read[pageSize - 1] as R);
    if (keyOf(read[pageSize] as R) !== boundary) {
      return {
        pageStep: PageStep.Page,
        rows: read.slice(0, pageSize),
        cursor: boundary,
      };
    }
    const newer: R[] = [];
    for (let i = 0; i < read.length; i++) {
      const row = read[i] as R;
      if (keyOf(row) > boundary) newer.push(row);
    }
    return { pageStep: PageStep.Tied, boundary, newer };
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
