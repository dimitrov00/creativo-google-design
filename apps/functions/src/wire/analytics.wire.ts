import { AnalyticsSpan, Roles } from '@core/components';
import { AnalyticsError } from '@core/errors';
import {
  BarberId,
  LocalDate,
  Result,
  StoredFields,
  Tag,
} from '@core/primitives';
import type { StaffAnalyticsCommand } from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import { idOf, payloadOf, type WireRequest } from './wire-read';

/**
 * THE STAFF ANALYTICS WIRE (`docs/designs/staff-analytics.md`) —
 * `staffAnalytics` `{ scopeBarberId: string | null, fromLocalDate,
 * analyticsSpan: 'WEEK' | 'MONTH' }` → the report. A signed-in caller
 * (`ANALYTICS_UNAUTHENTICATED`) whose TOKEN claims a role that reads
 * analytics (`Roles.readsAnalytics` — the cheap first gate, else
 * `ANALYTICS_FORBIDDEN`); the pipeline judges the STORED roles after it,
 * so a demoted or blocked account is refused there whatever its token
 * still says. Every field is re-read through its smart constructor, the
 * first unreadable one named (`ANALYTICS_INVALID_INPUT`); whether the first
 * day is a week's or a month's is the pipeline's question
 * (`AnalyticsPeriod.of`). The transport operation id the web adds is not
 * read: a report changes nothing.
 */
export function decodeStaffAnalytics(
  request: WireRequest,
): Result<StaffAnalyticsCommand, EdgeError> {
  const caller = callerUserId(request);
  if (caller === null) {
    return Result.err(AnalyticsError.unauthenticated());
  }
  if (!Roles.readsAnalytics(callerKnownRoles(request))) {
    return Result.err(AnalyticsError.forbidden());
  }
  const payload = payloadOf(request);
  const invalid = (field: string) =>
    Result.err(AnalyticsError.invalidInput(field));
  // The shop (an admin) or the caller's own record (a barber) is `null`;
  // an absent field reads as the same.
  const sentScope = StoredFields.field(payload, 'scopeBarberId') ?? null;
  const scopeBarberId =
    sentScope === null ? null : idOf(sentScope, BarberId.parse);
  if (sentScope !== null && scopeBarberId === null) {
    return invalid('scopeBarberId');
  }
  const fromLocalDate = idOf(
    StoredFields.field(payload, 'fromLocalDate'),
    LocalDate.parse,
  );
  if (fromLocalDate === null) return invalid('fromLocalDate');
  const analyticsSpan = StoredFields.field(payload, 'analyticsSpan');
  if (!Tag.has(AnalyticsSpan, analyticsSpan)) return invalid('analyticsSpan');
  return Result.ok({
    callerUserId: caller,
    scopeBarberId,
    fromLocalDate,
    analyticsSpan,
  });
}
