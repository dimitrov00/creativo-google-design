import { AnalyticsComparison, AnalyticsSpan, Roles } from '@core/components';
import { AnalyticsError } from '@core/errors';
import {
  BarberId,
  LocalDate,
  LocationId,
  MonthKey,
  PriceCents,
  Result,
  StoredFields,
  Tag,
} from '@core/primitives';
import type {
  SetAnalyticsGoalCommand,
  StaffAnalyticsCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import {
  idOf,
  idsOf,
  operationIdOf,
  payloadOf,
  type WireRequest,
} from './wire-read';

/** At most this many barber records or locations in one scope — a shop's whole roster, with room. */
const SCOPE_MAX = 64;

/**
 * THE STAFF ANALYTICS WIRE (`docs/designs/staff-analytics-v2.md`, The
 * callable v2 contract) — `staffAnalytics` `{ scopeBarberIds: string[],
 * scopeLocationIds: string[] (sets since the owner's review 2026-11-09;
 * absent reads as none, at most 64 each),
 * fromLocalDate, toLocalDate: string | null, analyticsSpan: 'DAY' | 'WEEK' |
 * 'MONTH' | 'YEAR' | 'CUSTOM', analyticsComparison: 'PREVIOUS' }` → the
 * report. A signed-in caller (`ANALYTICS_UNAUTHENTICATED`) whose TOKEN
 * claims a role that reads analytics (`Roles.readsAnalytics` — the cheap
 * first gate, else `ANALYTICS_FORBIDDEN`); the pipeline judges the STORED
 * roles after it, so a demoted or blocked account is refused there whatever
 * its token still says. Every field is re-read through its smart
 * constructor, the first unreadable one named (`ANALYTICS_INVALID_INPUT`):
 * `toLocalDate` is a day or `null` (an absent field reads as `null`) —
 * whether a `to` belongs to the span, like whether the first day is its
 * span's first, is the pipeline's question (`AnalyticsPeriod.of`);
 * `SAME_LAST_YEAR` is named by the contract and refused the same way in v2,
 * and so is an absent comparison (the web always sends one). The transport
 * operation id the web adds is not read: a report changes nothing.
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
  // The barber records named — none is the shop (an admin) or the
  // caller's own record (a barber); an absent field reads as none.
  const scopeBarberIds = idsOf(
    StoredFields.field(payload, 'scopeBarberIds'),
    BarberId.parse,
    SCOPE_MAX,
  );
  if (scopeBarberIds === null) return invalid('scopeBarberIds');
  // The locations named (an admin's); whether the caller may name them is
  // the pipeline's question (`locationScopeOf`).
  const scopeLocationIds = idsOf(
    StoredFields.field(payload, 'scopeLocationIds'),
    LocationId.parse,
    SCOPE_MAX,
  );
  if (scopeLocationIds === null) return invalid('scopeLocationIds');
  const fromLocalDate = idOf(
    StoredFields.field(payload, 'fromLocalDate'),
    LocalDate.parse,
  );
  if (fromLocalDate === null) return invalid('fromLocalDate');
  // The last day: a `CUSTOM` range's; `null` (or absent) on every other span.
  const sentTo = StoredFields.field(payload, 'toLocalDate') ?? null;
  const toLocalDate = sentTo === null ? null : idOf(sentTo, LocalDate.parse);
  if (sentTo !== null && toLocalDate === null) return invalid('toLocalDate');
  const analyticsSpan = StoredFields.field(payload, 'analyticsSpan');
  if (!Tag.has(AnalyticsSpan, analyticsSpan)) return invalid('analyticsSpan');
  const analyticsComparison = StoredFields.field(
    payload,
    'analyticsComparison',
  );
  if (
    !Tag.has(AnalyticsComparison, analyticsComparison) ||
    analyticsComparison === AnalyticsComparison.SameLastYear
  ) {
    return invalid('analyticsComparison');
  }
  return Result.ok({
    callerUserId: caller,
    scopeBarberIds,
    scopeLocationIds,
    fromLocalDate,
    toLocalDate,
    analyticsSpan,
    analyticsComparison,
  });
}

/**
 * THE GOAL WIRE (staff analytics v2 PR 6) — `setAnalyticsGoal`
 * `{ scopeBarberId: string | null, goalMonth: 'YYYY-MM', goalLowCents,
 * goalHighCents, operationId }` → `{ goalKey, goalSetAtUtcMs }`. The same
 * two gates as the report's (signed in, a token role that reads analytics —
 * the pipeline judges the STORED roles and the scope after it), then every
 * field through its primitive's guard, the first unreadable one named
 * (`ANALYTICS_INVALID_INPUT`): the month through `MonthKey.parse`, each
 * bound a price (`PriceCents.is` — a whole number of cents, `0` included:
 * whether the range IS a range is the pipeline's question,
 * `AnalyticsGoal.rangeOf`, answered `ANALYTICS_GOAL_INVALID_RANGE`). The
 * transport operation id is read (`operationIdOf`) — a goal is written and
 * its audit row is keyed by it; absent or malformed is `null`, never refused.
 */
export function decodeSetAnalyticsGoal(
  request: WireRequest,
): Result<SetAnalyticsGoalCommand, EdgeError> {
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
  const sentScope = StoredFields.field(payload, 'scopeBarberId') ?? null;
  const scopeBarberId =
    sentScope === null ? null : idOf(sentScope, BarberId.parse);
  if (sentScope !== null && scopeBarberId === null) {
    return invalid('scopeBarberId');
  }
  const goalMonth = idOf(
    StoredFields.field(payload, 'goalMonth'),
    MonthKey.parse,
  );
  if (goalMonth === null) return invalid('goalMonth');
  // Both `null` (or absent) removes the month's goal; the pipeline refuses
  // one bound without the other.
  const goalLowCents = StoredFields.field(payload, 'goalLowCents') ?? null;
  if (goalLowCents !== null && !PriceCents.is(goalLowCents)) {
    return invalid('goalLowCents');
  }
  const goalHighCents = StoredFields.field(payload, 'goalHighCents') ?? null;
  if (goalHighCents !== null && !PriceCents.is(goalHighCents)) {
    return invalid('goalHighCents');
  }
  return Result.ok({
    callerUserId: caller,
    scopeBarberId,
    goalMonth,
    goalLowCents,
    goalHighCents,
    operationId: operationIdOf(payload, 'operationId'),
  });
}
