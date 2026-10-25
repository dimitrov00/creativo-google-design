import type { Page } from './page.data';
import type { PageKey } from './page-key.data';

/*
 * What one read of a newest-first page decided (`PagingSystem.nextCursor`)
 * — its tag and the answer it types, built from a finished `Page`
 * (`page.data.ts`) over a `PageKey` (`page-key.data.ts`). Moved out of
 * `paging.system.ts` (pass D, S-21; D-7.4: a tag dictionary and the union it
 * types are components; L-2: the two shapes have readers outside this file,
 * so each has its own), values unchanged.
 */

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
   * `PagingSystem.sameInstantBoundary`.
   */
  Tied: 'TIED',
} as const;
export type PageStep = (typeof PageStep)[keyof typeof PageStep];

/** The finished page, under a name the namespace below can reach. */
type FinishedPage<R, K extends PageKey> = Page<R, K>;

/** What `PagingSystem.nextCursor` decided, discriminated by `pageStep`. */
export type PageStepResult<R, K extends PageKey> =
  PageStepResult.Page<R, K> | PageStepResult.Tied<R, K>;

export const PageStepResult = {
  /** The page is cut here. */
  page<R, K extends PageKey>(
    rows: readonly R[],
    cursor: K | null,
  ): PageStepResult.Page<R, K> {
    return { pageStep: PageStep.Page, rows, cursor };
  },

  /** The page must take the instant `boundary` whole. */
  tied<R, K extends PageKey>(
    boundary: K,
    newer: readonly R[],
  ): PageStepResult.Tied<R, K> {
    return { pageStep: PageStep.Tied, boundary, newer };
  },
} as const;

export namespace PageStepResult {
  export type Page<R, K extends PageKey> = {
    readonly pageStep: typeof PageStep.Page;
  } & FinishedPage<R, K>;
  export type Tied<R, K extends PageKey> = {
    readonly pageStep: typeof PageStep.Tied;
    /** The instant the page must take whole. */
    readonly boundary: K;
    /** The read's rows strictly newer than the boundary, in read order. */
    readonly newer: readonly R[];
  };
}
