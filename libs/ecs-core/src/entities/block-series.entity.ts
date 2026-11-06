import type { RecurrenceRule } from '@core/components';
import type {
  BarberId,
  BlockSeriesId,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
} from '@core/primitives';

/**
 * The identity slice of a chair's repeating block: which chair, filed at
 * which shop, over which minutes of each day, from which day — and the days
 * it has WRITTEN (`localDates`, in order, never past
 * `RecurrenceRule.MAX_OCCURRENCES`; a series that never ends keeps only the
 * days from today on, written ahead a rolling horizon). A day's blocked
 * range belongs to the series while its day is listed here and its minutes
 * are the series' (`BlockSeriesSystem.memberOf`); a day moved alone leaves
 * the list, as Google Calendar's «this event» does.
 */
export type BlockSeriesMeta = {
  readonly id: BlockSeriesId;
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
  readonly startLocalDate: LocalDate;
  readonly localDates: readonly LocalDate[];
};

/**
 * A chair's repeating block — `blockSeries/{id}`, staff-only (owner,
 * 2026-11-06: "a lunch break is a recurring blocker"). The days' public
 * effect stays on `scheduleExceptions` (§9 D16(b): the effect is the record
 * clients may read); this is the staff's memory of which days belong
 * together, so an edit can reach «this and the following» and a series
 * that never ends can be written ahead. Flat (Law 6): the identity slice
 * intersected with the rule's own flat slices.
 */
export type BlockSeries = BlockSeriesMeta & RecurrenceRule;
