import { PersonalRecord, PersonalRecordKind } from '@core/components';
import type { Appointment } from '@core/entities';
import {
  type AppointmentId,
  type CustomerId,
  LocalDate,
  type ServiceId,
} from '@core/primitives';
import { ClientStatsSystem, SubjectVisitOutcome } from './client-stats.system';

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

/**
 * The glance's quiet records line, in its order (`glance.presenter.ts`
 * `RECORD_LINE_ORDER`): the favourite, the best year, the first visit —
 * never the longest run, which is the wallet's and the records page's.
 */
const GLANCE_LINE_ORDER: readonly PersonalRecordKind[] = [
  PersonalRecordKind.FavouriteService,
  PersonalRecordKind.MostVisitsInYear,
  PersonalRecordKind.FirstVisit,
];

export const RecordsSystem = {
  RECORD_ORDER,
  NEW_RECORD_DAYS,
  YEARS_MIN,
  GLANCE_LINE_ORDER,

  /**
   * A record that holds something to show (`medals.presenter.ts`
   * `recordCardVm`), per kind: a run of more than nought (its day may be
   * unknown — held, shown without one); a best year of more than nought
   * that names its year; a favourite of more than nought that names its
   * service (whether the catalogue still names it is the edge's); a first
   * visit that names its day.
   */
  isHeld(record: PersonalRecord): boolean {
    switch (record.personalRecordKind) {
      case PersonalRecordKind.LongestRhythm:
        return record.value > 0;
      case PersonalRecordKind.MostVisitsInYear:
        return record.value > 0 && record.year !== null;
      case PersonalRecordKind.FavouriteService:
        return record.value > 0 && record.serviceId !== null;
      case PersonalRecordKind.FirstVisit:
        return record.on !== null;
    }
  },

  /**
   * «Обичайни услуги» says something beyond the favourite: one of the
   * usual services (`usual` — those the catalogue still names, the edge's
   * cut) is not the favourite (`favourite`, `null` = none).
   */
  usualBeyondFavourite(
    usual: readonly ServiceId[],
    favourite: ServiceId | null,
  ): boolean {
    for (let i = 0; i < usual.length; i++) {
      if (usual[i] !== favourite) return true;
    }
    return false;
  },

  /**
   * «По години» over the loaded history: `null` unless the loaded pages
   * are the client's WHOLE history (`complete`) — a year is never
   * under-counted. Composes {@link RecordsSystem.years} over this client
   * RECORD's own WORKED visits (`ClientStatsSystem.subjectVisitOf`, D29) by
   * the shop day, the record year being the account's stamped «Най-много
   * за година».
   */
  yearsOfHistory(
    customerId: CustomerId,
    appointments: readonly Appointment[],
    records: readonly PersonalRecord[],
    complete: boolean,
  ): readonly RecordYear[] | null {
    if (!complete) return null;
    const worked: RecordVisit[] = [];
    for (let i = 0; i < appointments.length; i++) {
      const appointment = appointments[i] as Appointment;
      const visit = ClientStatsSystem.subjectVisitOf(customerId, appointment);
      if (
        visit === null ||
        visit.outcome.subjectVisitOutcome !== SubjectVisitOutcome.Worked
      ) {
        continue;
      }
      worked.push({
        appointmentId: appointment.id,
        localDate: visit.localDate,
      });
    }
    const stamped =
      PersonalRecord.find(records, PersonalRecordKind.MostVisitsInYear)?.year ??
      null;
    return RecordsSystem.years(worked, stamped);
  },

  /**
   * The glance's records line: at most `limit` records in
   * {@link GLANCE_LINE_ORDER}, each the account's one of its kind, a
   * favourite only where it names a service the catalogue still knows
   * (`knownServiceIds`) and a first visit only where it names its day.
   */
  glanceLine(
    records: readonly PersonalRecord[],
    knownServiceIds: ReadonlySet<ServiceId>,
    limit: number,
  ): readonly PersonalRecord[] {
    const out: PersonalRecord[] = [];
    for (let i = 0; i < GLANCE_LINE_ORDER.length && out.length < limit; i++) {
      const record = PersonalRecord.find(
        records,
        GLANCE_LINE_ORDER[i] as PersonalRecordKind,
      );
      if (record === null) continue;
      if (
        record.personalRecordKind === PersonalRecordKind.FavouriteService &&
        (record.serviceId === null || !knownServiceIds.has(record.serviceId))
      ) {
        continue;
      }
      if (
        record.personalRecordKind === PersonalRecordKind.FirstVisit &&
        record.on === null
      ) {
        continue;
      }
      out.push(record);
    }
    return out;
  },

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
