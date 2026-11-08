import type { DayFigures } from '@core/components';
import type { BarberAnalyticsDayId } from '@core/primitives';

/** The identity slice of a stored day: its document id, the busy key's text. */
export type BarberAnalyticsDayMeta = {
  readonly id: BarberAnalyticsDayId;
};

/**
 * One PAST barber-day's figures — `analyticsDays/{busyKey}` (staff analytics
 * v2, «The day document»): written for every past calendar day of every
 * barber record, zeros included, by the appointment and departure triggers
 * (`writeAnalyticsDay`) or the recompute; never by the callable, never read
 * by a client directly. The document is this minus `id` (Law 5): the
 * `DayRow` the answer carries, the counts, the service rows, the hour
 * buckets and the computation's stamp, every one at the root (Law 6).
 *
 * No client name, no seat row, no `locationId` and no zone (Law 7.2): one
 * document per barber-day across locations — "past" is judged at every
 * stretch location, while the chair-time partition inside keeps the first
 * stretch's clock. `purgeAt` is the adapter's TTL stamp outside the type
 * (`RetentionGroup.AnalyticsDays`, UTC midnight of `localDate` + 400 days).
 */
export type BarberAnalyticsDay = BarberAnalyticsDayMeta & DayFigures;
