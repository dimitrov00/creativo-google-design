import { Injectable, inject } from '@angular/core';
import { collection, getDocs } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result, fail } from '@creativo/domain/kernel';
import {
  type IsoDate,
  LOYALTY_CATALOG_COLLECTIONS,
  type LoyaltyCatalog,
  type LoyaltyCatalogDocuments,
  type LoyaltyCatalogReader,
  loyaltyCatalogFromDocuments,
  sofiaDayOf,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';

type CatalogRead = Promise<Result<LoyaltyCatalog, RepositoryError>>;

/**
 * THE SESSION'S COPY of the catalogue: one read, the day it was made on,
 * and the way to drop it.
 *
 * It lives in the root injector, not in the reader, because two adapters
 * meet in it and every lazily loaded adapter is created in an injector of
 * its own (`provideLazyPort`): the reader that fills it, and the rhythm's
 * repository, which drops it after a publish so the next card of the same
 * session reads the rule that was just written
 * (client-card-revision-3.md §4.4).
 */
@Injectable({ providedIn: 'root' })
export class LoyaltyCatalogSession {
  private held: { readonly read: CatalogRead; readonly day: IsoDate } | null =
    null;

  /** The read kept for `day`, if any: a read of another day is no answer for this one. */
  readOn(day: IsoDate): CatalogRead | null {
    return this.held?.day === day ? this.held.read : null;
  }

  keep(read: CatalogRead, day: IsoDate): void {
    this.held = { read, day };
  }

  /** Forgets `read`, unless a newer one took its place meanwhile. */
  drop(read: CatalogRead): void {
    if (this.held?.read === read) this.held = null;
  }

  /**
   * Forgets whatever is kept: the next call reads again. A read still in
   * flight answers whoever already waits on it and is kept for nobody.
   */
  invalidate(): void {
    this.held = null;
  }
}

/**
 * The published loyalty catalogue: its six collections read once, then
 * parsed and validated as ONE model (`loyaltyCatalogFromDocuments` →
 * `LoyaltyCatalog.create`), so a season can never be drawn around a family
 * that is not there.
 *
 * The rhythm's rules arrive as their HEADS (`streakDefinitions/{id}`: the
 * version in force and at most one that waits), which the catalogue holds
 * as `streakSchedules` and resolves by date whenever it is asked. A rule's
 * `versions` are a subcollection: a collection read never returns them,
 * and they are the admin page's, not a card's.
 *
 * Memoised for the session AND THE DAY: the catalogue changes when the
 * shop publishes, not while a card is open, and every card and page reads
 * the same one. Three things end the memo:
 *
 * - a failed read is not kept: the next call reads again, and callers
 *   asking while a read is in flight share it;
 * - the shop's day turning (Europe/Sofia): a tab left open past midnight
 *   reads again, so a rule another session published is seen by the
 *   next day at the latest;
 * - `invalidate()`, called after a publish in this session. Other open
 *   sessions see the new rule when they reload, or on the next day.
 */
@Injectable()
export class FirestoreLoyaltyCatalogReader implements LoyaltyCatalogReader {
  private readonly db = inject(FIREBASE_FIRESTORE);
  private readonly session = inject(LoyaltyCatalogSession);

  getCatalog(): Promise<Result<LoyaltyCatalog, RepositoryError>> {
    const today = sofiaDayOf(new Date());
    const kept = this.session.readOn(today);
    if (kept !== null) return kept;

    const read = this.read();
    this.session.keep(read, today);
    void read.then((result) => {
      if (result.isFailure()) this.session.drop(read);
    });
    return read;
  }

  /** Drops the session's copy: the next `getCatalog()` reads the collections again. */
  invalidate(): void {
    this.session.invalidate();
  }

  private async read(): Promise<Result<LoyaltyCatalog, RepositoryError>> {
    try {
      const [
        badgeCategories,
        badgeSeries,
        seasons,
        tierDefinitions,
        rewardsCatalog,
        streakDefinitions,
      ] = await Promise.all(
        LOYALTY_CATALOG_COLLECTIONS.map(async (name) => {
          const snapshot = await getDocs(collection(this.db, name));
          return Object.fromEntries(
            snapshot.docs.map((entry) => [entry.id, entry.data()]),
          );
        }),
      );
      const documents: LoyaltyCatalogDocuments = {
        badgeCategories: badgeCategories ?? {},
        badgeSeries: badgeSeries ?? {},
        seasons: seasons ?? {},
        tierDefinitions: tierDefinitions ?? {},
        rewardsCatalog: rewardsCatalog ?? {},
        streakDefinitions: streakDefinitions ?? {},
      };
      return loyaltyCatalogFromDocuments(documents);
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read the loyalty catalogue', error),
      );
    }
  }
}
