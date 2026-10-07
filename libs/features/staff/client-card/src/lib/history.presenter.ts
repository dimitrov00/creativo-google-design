import {
  type Appointment,
  type ClientMoneyRecord,
  type ClientStatsRecord,
  Money,
  formatMoney,
} from '@creativo/application/booking';
import { type VisitRowVm, visitRowOf } from '@creativo/features/shared/visits';
import type { ClientCardCatalog } from './client-card.contracts';
import { figure } from './client-card.format';
import type {
  HistoryCellVm,
  HistoryFactsVm,
  HistorySpendVm,
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

/** The page size of a history read (§3.6 HF). */
export const HISTORY_PAGE_SIZE = 30;

/** Fewer rows than this left by a filter fetches more pages on the same tap (§3.6). */
export const FILTER_REFILL_ROWS = 10;

/** …up to this many pages at once. */
export const FILTER_REFILL_PAGES = 3;

/** Weeks, from the stats' mean days between worked visits — at least one. */
export function cadenceWeeks(avgCadenceDays: number): number {
  return Math.max(1, Math.round(avgCadenceDays / 7));
}

/** HC — the open figures: visits, the interval, and no-shows and cancellations only when there are any. */
export function historyCells(
  stats: ClientStatsRecord | null,
  words: ClientCardWords,
): readonly HistoryCellVm[] {
  const lang = words.lang;
  const history = words.history;
  const visits = stats?.lifetime.visitsCompleted ?? 0;
  const cells: HistoryCellVm[] = [
    {
      id: 'visits',
      value: figure(visits, lang),
      caption: history.visits(visits),
    },
  ];
  if (stats?.avgCadenceDays != null) {
    cells.push({
      id: 'cadence',
      value: history.intervalValue(cadenceWeeks(stats.avgCadenceDays)),
      unit: history.intervalUnit,
      caption: history.interval,
    });
  }
  const noShows = stats?.lifetime.noShows ?? 0;
  if (noShows > 0) {
    cells.push({
      id: 'noShows',
      value: figure(noShows, lang),
      caption: history.noShows(noShows),
    });
  }
  const cancelled = stats?.lifetime.clientCancels ?? 0;
  if (cancelled > 0) {
    cells.push({
      id: 'cancelled',
      value: figure(cancelled, lang),
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
  const visits = stats?.lifetime.visitsCompleted ?? 0;
  const clean =
    (stats?.lifetime.noShows ?? 0) === 0 &&
    (stats?.lifetime.clientCancels ?? 0) === 0;
  let spend: HistorySpendVm | null = null;
  if (money !== null) {
    const amount = Money.fromMinorUnitsAndCode(
      money.lifetimeSpendMinor,
      money.currencyCode,
    );
    if (amount.isSuccess()) {
      const value = formatMoney(amount.value, words.lang);
      spend = { value, sentence: words.history.spend(value) };
    }
  }
  return {
    note:
      visits === 0
        ? words.head.firstVisit
        : clean
          ? words.history.noRisk
          : null,
    spend,
  };
}

export interface HistoryRowsInput {
  readonly appointments: readonly Appointment[];
  readonly subjectUserId: string;
  readonly currentAppointmentId: string | null;
  readonly nowMs: number;
  /** Each visit's own photos, counted (`countByAppointment`); a visit it does not name has none. */
  readonly photoCounts: ReadonlyMap<string, number>;
  /** False for a sysadmin viewer: the client's own words stay off the rows (R15). */
  readonly clientWords: boolean;
  readonly catalog: ClientCardCatalog;
  readonly words: ClientCardWords;
}

/** Every loaded visit as a staff row, each visit once (pages never overlap, but a refresh may). */
export function historyRows(input: HistoryRowsInput): readonly VisitRowVm[] {
  const seen = new Set<string>();
  return input.appointments.flatMap((appointment) => {
    const id = appointment.id.value;
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      visitRowOf(
        appointment,
        {
          perspective: 'staff',
          grain: 'year',
          subjectUserId: input.subjectUserId,
          currentAppointmentId: input.currentAppointmentId,
          nowMs: input.nowMs,
          locale: input.words.lang,
          photoCount: input.photoCounts.get(id) ?? 0,
          words: input.words.visits,
          clientWords: input.clientWords,
        },
        input.catalog,
      ),
    ];
  });
}
