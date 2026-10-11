import {
  PersonalRecordKind,
  type PersonalRecord,
} from '../components/personal-record.data';
import type { AppointmentId } from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';

/*
 * «РЕКОРДИ» (client-card-revision-3 §2.3.4, §4.8; `records.presenter.ts`
 * `featuredOf`/`yearsOf`, `medals.presenter.ts` `recordsOf`/`recordSetOn`/
 * `isNewRecord`) — the account's personal bests in the cards' order, the
 * day each was set, which is new, which leads the page, and the worked
 * visits by the shop's year. Numbers, kinds and day keys: the words, the
 * figures and the covers are the template's. Shop-day arithmetic only (T8).
 */

/** One worked visit of the person's, by the shop day it began on. */
export type RecordVisit = {
  /** A visit listed twice is counted once. */
  readonly appointmentId: AppointmentId;
  readonly localDate: LocalDate;
};

/** One bar of «По години». */
export type RecordYear = {
  readonly year: number;
  readonly count: number;
  /** The best year's count: what every bar is measured against. */
  readonly best: number;
  /** The record year: the account's own where it is one of the best, else the first that got there. */
  readonly record: boolean;
};

/** The cards' order: the records a page draws, in it. */
const RECORD_ORDER: readonly PersonalRecordKind[] = [
  PersonalRecordKind.LongestRhythm,
  PersonalRecordKind.MostVisitsInYear,
  PersonalRecordKind.FavouriteService,
  PersonalRecordKind.FirstVisit,
];

/** How long a record is «Нов рекорд»: set within this many days of the shop's today. */
const NEW_RECORD_DAYS = 30;

/** «По години» says something from the second year on: one bar is «Общо посещения» again. */
const YEARS_MIN = 2;

export const RecordsSystem = {
  RECORD_ORDER,
  NEW_RECORD_DAYS,
  YEARS_MIN,

  /** The account's records in the cards' order; the longest run only while the shop runs a rhythm. */
  ordered<R extends PersonalRecord>(
    records: readonly R[],
    rhythm: boolean,
  ): readonly R[] {
    const out: R[] = [];
    for (let i = 0; i < RECORD_ORDER.length; i++) {
      const kind = RECORD_ORDER[i] as PersonalRecordKind;
      if (kind === PersonalRecordKind.LongestRhythm && !rhythm) continue;
      for (let k = 0; k < records.length; k++) {
        const record = records[k] as R;
        if (record.personalRecordKind === kind) {
          out.push(record);
          break;
        }
      }
    }
    return out;
  },

  /**
   * The day a record was set: a run by its last visit, the first visit by
   * its day, a year by its last day (today while it is still running); a
   * favourite has none.
   */
  setOn(record: PersonalRecord, today: LocalDate): LocalDate | null {
    switch (record.personalRecordKind) {
      case PersonalRecordKind.LongestRhythm:
      case PersonalRecordKind.FirstVisit:
        return record.on;
      case PersonalRecordKind.MostVisitsInYear: {
        if (record.year === null) return null;
        const end = LocalDate.fromEpochDay(
          LocalDate.epochDayOf(record.year, 12, 31),
        );
        return end > today ? today : end;
      }
      default:
        return null;
    }
  },

  /**
   * «Нов рекорд»: set in the last `NEW_RECORD_DAYS` days of the shop's
   * today — a best that was beaten, so never the first visit nor a
   * favourite, and never the year still running.
   */
  isNew(record: PersonalRecord, today: LocalDate): boolean {
    if (
      record.personalRecordKind === PersonalRecordKind.FirstVisit ||
      record.personalRecordKind === PersonalRecordKind.FavouriteService
    ) {
      return false;
    }
    if (
      record.personalRecordKind === PersonalRecordKind.MostVisitsInYear &&
      record.year !== null &&
      String(record.year) === today.slice(0, 4)
    ) {
      return false;
    }
    const on = RecordsSystem.setOn(record, today);
    if (on === null) return false;
    const age = LocalDate.daysBetween(on, today);
    return age >= 0 && age <= NEW_RECORD_DAYS;
  },

  /**
   * The index of the record set most recently — the page's one hero
   * figure; a record without a day is the newest only where no other has
   * one, and the cards' order (the order given) breaks a tie. `null` for
   * no record.
   */
  newest(records: readonly PersonalRecord[], today: LocalDate): number | null {
    let best: number | null = null;
    let bestOn = '';
    for (let i = 0; i < records.length; i++) {
      const on = RecordsSystem.setOn(records[i] as PersonalRecord, today) ?? '';
      if (best === null || on > bestOn) {
        best = i;
        bestOn = on;
      }
    }
    return best;
  },

  /**
   * «По години»: the worked visits counted by the shop's year, newest
   * first, each against the best; a year between two others without a
   * visit is a bar of nought. `null` with fewer than `YEARS_MIN` years in
   * the run. The record year is `stampedYear` (the account's «Най-много за
   * година») where it is one of the best, else the earliest of the best.
   */
  years(
    visits: readonly RecordVisit[],
    stampedYear: number | null,
  ): readonly RecordYear[] | null {
    const counts = new Map<number, number>();
    const seen = new Set<string>();
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i] as RecordVisit;
      if (seen.has(visit.appointmentId)) continue;
      seen.add(visit.appointmentId);
      const year = LocalDate.parts(visit.localDate).year;
      counts.set(year, (counts.get(year) ?? 0) + 1);
      if (year < first) first = year;
      if (year > last) last = year;
    }
    if (counts.size === 0 || last - first + 1 < YEARS_MIN) return null;
    let best = 0;
    for (const count of counts.values()) if (count > best) best = count;
    let earliestBest: number | null = null;
    for (let year = first; year <= last; year++) {
      if (counts.get(year) === best) {
        earliestBest = year;
        break;
      }
    }
    const recordYear =
      stampedYear !== null && counts.get(stampedYear) === best
        ? stampedYear
        : earliestBest;
    const out: RecordYear[] = [];
    for (let year = last; year >= first; year--) {
      out.push({
        year,
        count: counts.get(year) ?? 0,
        best,
        record: year === recordYear,
      });
    }
    return out;
  },
} as const;
