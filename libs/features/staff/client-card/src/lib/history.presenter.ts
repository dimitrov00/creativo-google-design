import {
  HistoryNote,
  type ShopNow,
  VisitGrain,
  VisitPerspective,
} from '@core/components';
import type {
  Appointment,
  ClientMoneyRecord,
  ClientStatsRecord,
} from '@core/entities';
import type {
  AppointmentId,
  CustomerId,
  TimeZone,
  UserId,
} from '@core/primitives';
import { ClientStatsSystem, VisitListSystem } from '@core/systems';
import { type VisitRowVm, visitRowOf } from '@creativo/features/shared/visits';
import { formatCents, formatCount } from '@creativo/ui/wall-clock';
import type { ClientCardCatalog } from './client-card.contracts';

import {
  HistoryCellId,
  type HistoryCellVm,
  type HistoryFactsVm,
  type HistorySpendVm,
} from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';

/*
 * «ПОСЕЩЕНИЯ» — what the staff history's rows and facts are made of
 * (client-card-redesign §3.6; revision 3 §2.5 reads them through
 * `visits-page.presenter.ts`): the rows' input and the year-grain builder
 * (`historyRows`, the store's own list), the stats cells and the footnote.
 * The rows are the shared builder's (`visitRowOf`, staff perspective), so
 * the card never words a visit apart from «Моите часове». The built page's
 * year sections and its foot went with its body in W4.
 */

/** HC — the open figures: visits, the interval, and no-shows and cancellations only when there are any. */
export function historyCells(
  stats: ClientStatsRecord | null,
  words: ClientCardWords,
): readonly HistoryCellVm[] {
  const lang = words.lang;
  const history = words.history;
  const visits = stats?.lifetimeVisitsCompleted ?? 0;
  const cells: HistoryCellVm[] = [
    {
      id: HistoryCellId.Visits,
      value: formatCount(visits, lang),
      caption: history.visits(visits),
    },
  ];
  if (stats?.avgCadenceDays != null) {
    cells.push({
      id: HistoryCellId.Cadence,
      value: history.intervalValue(
        ClientStatsSystem.cadenceWeeks(stats.avgCadenceDays),
      ),
      unit: history.intervalUnit,
      caption: history.interval,
    });
  }
  const noShows = stats?.lifetimeNoShows ?? 0;
  if (noShows > 0) {
    cells.push({
      id: HistoryCellId.NoShows,
      value: formatCount(noShows, lang),
      caption: history.noShows(noShows),
    });
  }
  const cancelled = stats?.lifetimeClientCancels ?? 0;
  if (cancelled > 0) {
    cells.push({
      id: HistoryCellId.Cancelled,
      value: formatCount(cancelled, lang),
      caption: history.cancelled(cancelled),
    });
  }
  return cells;
}

/**
 * HD — the footnote beside the filter: «Първо посещение» before the first
 * worked visit, «Без неявявания и откази от клиента» when both are zero, and
 * the ‹admin› spend (never read for anyone else). The zero line names whose
 * cancellations it counts (R35: the client's only), since a shop's own
 * cancellation still shows struck in the list below it.
 */
export function historyFacts(
  stats: ClientStatsRecord | null,
  money: ClientMoneyRecord | null,
  words: ClientCardWords,
): HistoryFactsVm {
  let spend: HistorySpendVm | null = null;
  if (money !== null) {
    const value = formatCents(
      money.lifetimeSpendCents,
      money.currency,
      words.lang,
    );
    spend = { value, sentence: words.history.spend(value) };
  }
  return {
    note: historyNoteWords(ClientStatsSystem.historyNote(stats), words),
    spend,
  };
}

/**
 * HD's note as words — which one is `ClientStatsSystem.historyNote`'s:
 * «Първо посещение», «Без неявявания и откази от клиента», or none.
 */
export function historyNoteWords(
  note: HistoryNote,
  words: ClientCardWords,
): string | null {
  switch (note) {
    case HistoryNote.FirstVisit:
      return words.head.firstVisit;
    case HistoryNote.Clean:
      return words.history.noRisk;
    case HistoryNote.None:
      return null;
  }
}

export interface HistoryRowsInput {
  readonly appointments: readonly Appointment[];
  /** The account the card is open on — whose own words a row quotes. */
  readonly subjectUserId: UserId;
  /**
   * Its client RECORD (D29) — whose seats, outcome and share a row tells;
   * `null` when the account has no record yet (then no visit is theirs).
   */
  readonly subjectCustomerId: CustomerId | null;
  readonly currentAppointmentId: AppointmentId | null;
  /**
   * "Now" on the shop's wall clock (Law 7.3), derived ONCE by the store;
   * `null` while the shop's zone is pending — then there are no rows yet.
   */
  readonly now: ShopNow | null;
  /** The zone `now` was read in (a photo's day falls back to it); `null` as `now` is. */
  readonly timeZone: TimeZone | null;
  /** Each visit's own photos, counted (`countByAppointment`); a visit it does not name has none. */
  readonly photoCounts: ReadonlyMap<AppointmentId, number>;
  /** False for a sysadmin viewer: the client's own words stay off the rows (R15). */
  readonly clientWords: boolean;
  readonly catalog: ClientCardCatalog;
  readonly words: ClientCardWords;
}

/** Every loaded visit as a staff row, each visit once (pages never overlap, but a refresh may); none before "now" is known. */
export function historyRows(input: HistoryRowsInput): readonly VisitRowVm[] {
  const { now, timeZone } = input;
  if (now === null || timeZone === null) return [];
  return VisitListSystem.distinctById(input.appointments).map((appointment) =>
    visitRowOf(
      appointment,
      {
        perspective: VisitPerspective.Staff,
        grain: VisitGrain.Year,
        subjectUserId: input.subjectUserId,
        subjectCustomerId: input.subjectCustomerId,
        currentAppointmentId: input.currentAppointmentId,
        now,
        timeZone,
        locale: input.words.lang,
        photoCount: input.photoCounts.get(appointment.id) ?? 0,
        words: input.words.visits,
        clientWords: input.clientWords,
      },
      input.catalog,
    ),
  );
}
