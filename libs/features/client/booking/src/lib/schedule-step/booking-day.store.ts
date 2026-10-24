import { Injectable, type Signal, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  type Observable,
  combineLatest,
  distinctUntilChanged,
  of,
  switchMap,
} from 'rxjs';
import { SCHEDULING_READ_PORTS } from '@creativo/infrastructure/firebase-app';
import type { CapacityMonthId, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { CapacityEntry } from '@core/components';
import {
  BookingCartSystem,
  type DayDocs,
  type DayDocsKey,
} from '@core/systems';
import { observeCapacityEntries, observeDayDocs } from '@core/pipelines';

/** One exact day's documents, or why they could not be read. */
export type DayDocsResult = Result<DayDocs, RepositoryError>;

/** The capacity month documents' entries, or why they could not be read. */
export type CapacityEntriesResult = Result<
  readonly CapacityEntry[],
  RepositoryError
>;

/**
 * The booking flow's live shop-day reads — the ONE booking file that wires
 * the `@core/pipelines` streams (`observeDayDocs`, `observeCapacityEntries`)
 * over `SCHEDULING_READ_PORTS` (Law 8.2: a store, not a component, consumes
 * a pipeline). The schedule step and its time sheet hand it the signal of
 * WHICH documents they need and read back the documents as a signal; the
 * arrangements are still derived from them in their own `computed()`s by the
 * systems. Provided with the booking flow (`ClientBooking`).
 *
 * Each method is `toSignal` over `toObservable`, so — like those two — it is
 * called in an injection context (a field initializer): the listeners live
 * and die with the component that asked.
 */
@Injectable()
export class BookingDayStore {
  private readonly scheduling = inject(SCHEDULING_READ_PORTS);

  /**
   * The `capacity/{YYYY-MM}` months' entries, live — `null` while no range
   * is asked, or until the first answer.
   */
  capacityEntries(
    months: Signal<readonly CapacityMonthId[] | null>,
  ): Signal<CapacityEntriesResult | null> {
    return toSignal(
      toObservable(months).pipe(
        // STRUCTURAL identity, not object identity. The month list is minted
        // fresh per recompute, and `switchMap` on raw identity answered every
        // no-op recompute by tearing down and re-billing the whole listener
        // set — the single largest avoidable read cost in the app.
        // Re-subscribe only when the MONTHS genuinely change.
        distinctUntilChanged((a, b) => (a ?? []).join() === (b ?? []).join()),
        switchMap((list) =>
          list === null
            ? of(null)
            : observeCapacityEntries(this.scheduling, list),
        ),
      ),
      { initialValue: null },
    );
  }

  /**
   * One day's raw documents, live — re-subscribed only when WHICH documents
   * changes. `null` while no day is asked, or until the first answer.
   */
  dayDocs(key: Signal<DayDocsKey | null>): Signal<DayDocsResult | null> {
    return toSignal(
      toObservable(key).pipe(
        // Structural identity, the capacity stream's own: re-subscribing on a
        // no-op recompute re-bills this day's whole read.
        distinctUntilChanged((a, b) => BookingCartSystem.sameDayDocsKey(a, b)),
        switchMap((asked) =>
          asked === null ? of(null) : observeDayDocs(this.scheduling, asked),
        ),
      ),
      { initialValue: null },
    );
  }

  /**
   * Several exact days' raw documents, live, once all of them have
   * answered — re-subscribed only when WHICH documents changes. `null` while
   * no days are asked, or until every day has answered.
   */
  daysDocs(
    keys: Signal<readonly DayDocsKey[] | null>,
  ): Signal<readonly DayDocsResult[] | null> {
    return toSignal(
      toObservable(keys).pipe(
        // The capacity stream's structural guard, one key at a time.
        distinctUntilChanged((a, b) =>
          a === null || b === null
            ? a === b
            : a.length === b.length &&
              a.every((asked, index) =>
                BookingCartSystem.sameDayDocsKey(asked, b.at(index) ?? null),
              ),
        ),
        switchMap((asked): Observable<readonly DayDocsResult[] | null> => {
          if (asked === null) return of(null);
          // `combineLatest([])` completes without emitting; no day is no answer.
          if (asked.length === 0) return of([]);
          return combineLatest(
            asked.map((one) => observeDayDocs(this.scheduling, one)),
          );
        }),
      ),
      { initialValue: null },
    );
  }
}
