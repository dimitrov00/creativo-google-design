import type { BarberId, LocalDate } from '@core/primitives';
import type { AnalyticsSpan } from './analytics-period.data';

/**
 * What the `staffAnalytics` callable is asked for — flat (Law 6): the scope
 * and the period's first day and span. `scopeBarberId: null` is the shop for
 * an admin and the caller's own barber record for a barber; the period is
 * rebuilt with `AnalyticsPeriod.of`, which refuses a first day that is not a
 * Monday or a 1st.
 */
export type AnalyticsCall = {
  readonly scopeBarberId: BarberId | null;
  readonly fromLocalDate: LocalDate;
  readonly analyticsSpan: AnalyticsSpan;
};
