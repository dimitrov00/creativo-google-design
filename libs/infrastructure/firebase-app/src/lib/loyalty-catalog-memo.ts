import { InjectionToken } from '@angular/core';
import type { LocalDate, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { LoyaltyCatalog } from '@core/ports';

/** One read of the loyalty catalogue, as `LoadLoyaltyCatalog` answers it. */
export type LoyaltyCatalogRead = Promise<
  Result<LoyaltyCatalog, RepositoryError>
>;

/**
 * THE SESSION'S COPY of the loyalty catalogue (flip-3 plan F3-10): one read,
 * the shop day it was made on, and the way to drop it — a record of
 * closures over one held value, never a class, and NOT a port: it is web
 * wiring, so it is declared here and never in `@core/ports`.
 *
 * It lives behind the ROOT token {@link LOYALTY_CATALOG_MEMO} because two
 * lazily loaded bundles meet in it, each built by a factory of its own
 * (`provideLazyPort`): the catalogue's read (`loyaltyCatalogReadPorts`),
 * which fills it, and the rhythm's publish ports (`streakPublishPorts`,
 * over the callable client), which drop it after a write lands so the
 * next card of the same session reads the rule that was just written
 * (client-card-revision-3.md §4.4). Eager and SDK-free, so `app.config.ts`
 * reaches it without pulling the Firestore chunk.
 */
export type LoyaltyCatalogMemo = {
  /** The read kept for `day`, if any: a read of another day is no answer for this one. */
  readonly readOn: (day: LocalDate) => LoyaltyCatalogRead | null;
  /** Keeps `read` as `day`'s copy, in place of whatever was kept. */
  readonly keep: (read: LoyaltyCatalogRead, day: LocalDate) => void;
  /** Forgets `read`, unless a newer one took its place meanwhile. */
  readonly drop: (read: LoyaltyCatalogRead) => void;
  /**
   * Forgets whatever is kept: the next call reads again. A read still in
   * flight answers whoever already waits on it and is kept for nobody.
   */
  readonly invalidate: () => void;
};

/** A fresh, empty memo — the root token's factory, and a spec's. */
export function loyaltyCatalogMemo(): LoyaltyCatalogMemo {
  let held: {
    readonly read: LoyaltyCatalogRead;
    readonly day: LocalDate;
  } | null = null;
  return {
    readOn: (day) => (held !== null && held.day === day ? held.read : null),
    keep: (read, day) => {
      held = { read, day };
    },
    drop: (read) => {
      if (held !== null && held.read === read) held = null;
    },
    invalidate: () => {
      held = null;
    },
  };
}

/**
 * The session's one catalogue memo, in the root injector — shared by the
 * `LOYALTY_CATALOG_READ_PORTS` and `STREAK_PUBLISH_PORTS` rows of
 * `app.config.ts` (`inj.get(LOYALTY_CATALOG_MEMO)`).
 */
export const LOYALTY_CATALOG_MEMO = new InjectionToken<LoyaltyCatalogMemo>(
  'LOYALTY_CATALOG_MEMO',
  { providedIn: 'root', factory: loyaltyCatalogMemo },
);
