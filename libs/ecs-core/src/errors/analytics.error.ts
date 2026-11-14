import type { BarberId, LocalDate, LocationId } from '@core/primitives';

/**
 * Staff analytics' refusals (`docs/designs/staff-analytics.md`, Errors) —
 * the `staffAnalytics` callable answers one of these instead of a report.
 * Flat structs discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with
 * the `ANALYTICS_` prefix; the screen words each as `errors.<errorCode>`.
 *
 * The visibility table decides most of them. WHO may ask for which scope
 * is judged on the caller's STORED account against the owner's
 * permissions, and refused as an `AccessError` (staff permissions P6):
 * no staff member, nobody has `ANALYTICS`, or own only.
 */
export const AnalyticsErrorCode = {
  /** The callable was reached without a signed-in session. */
  Unauthenticated: 'ANALYTICS_UNAUTHENTICATED',
  /** A barber whose account no admin has linked to a barber record yet. */
  BarberNotLinked: 'ANALYTICS_BARBER_NOT_LINKED',
  /** A period more than 12 months back, starting after today, or a `CUSTOM` range longer than `AnalyticsPeriod.CUSTOM_MAX_DAYS`. */
  PeriodOutOfRange: 'ANALYTICS_PERIOD_OUT_OF_RANGE',
  /** The requested scope names an id that is not a barber record. */
  ScopeUnknown: 'ANALYTICS_SCOPE_UNKNOWN',
  /** An admin's location scope names no listed location (ADR 2026-11-09). */
  LocationUnknown: 'ANALYTICS_LOCATION_UNKNOWN',
  /**
   * A malformed request: a field missing or of the wrong type, a period
   * start that is not its span's first day, a `toLocalDate` on a span other
   * than `CUSTOM` (or none on `CUSTOM`, or one before the start), or the
   * refused `SAME_LAST_YEAR` comparison.
   */
  InvalidInput: 'ANALYTICS_INVALID_INPUT',
  /**
   * A goal set for a scope that is not the caller's own (PR 6): a barber's
   * month goal is the barber's alone — an admin names the shop's, or, when
   * their own account is linked to the record, their own.
   */
  GoalForbidden: 'ANALYTICS_GOAL_FORBIDDEN',
  /**
   * A goal range that is no range (PR 6): a bound that is not a positive
   * whole number of cents, a high bound under the low one, or a month other
   * than the current or the next on the shop's clock — `field` names the
   * offending one (`goalLowCents`, `goalHighCents`, `goalMonth`).
   */
  GoalInvalidRange: 'ANALYTICS_GOAL_INVALID_RANGE',
} as const;
export type AnalyticsErrorCode =
  (typeof AnalyticsErrorCode)[keyof typeof AnalyticsErrorCode];

export type AnalyticsError =
  | AnalyticsError.Unauthenticated
  | AnalyticsError.BarberNotLinked
  | AnalyticsError.PeriodOutOfRange
  | AnalyticsError.ScopeUnknown
  | AnalyticsError.LocationUnknown
  | AnalyticsError.InvalidInput
  | AnalyticsError.GoalForbidden
  | AnalyticsError.GoalInvalidRange;

export const AnalyticsError = {
  unauthenticated(): AnalyticsError.Unauthenticated {
    return { errorCode: AnalyticsErrorCode.Unauthenticated };
  },
  barberNotLinked(): AnalyticsError.BarberNotLinked {
    return { errorCode: AnalyticsErrorCode.BarberNotLinked };
  },
  periodOutOfRange(fromLocalDate: LocalDate): AnalyticsError.PeriodOutOfRange {
    return { errorCode: AnalyticsErrorCode.PeriodOutOfRange, fromLocalDate };
  },
  scopeUnknown(barberId: BarberId): AnalyticsError.ScopeUnknown {
    return { errorCode: AnalyticsErrorCode.ScopeUnknown, barberId };
  },
  locationUnknown(locationId: LocationId): AnalyticsError.LocationUnknown {
    return { errorCode: AnalyticsErrorCode.LocationUnknown, locationId };
  },
  invalidInput(field: string): AnalyticsError.InvalidInput {
    return { errorCode: AnalyticsErrorCode.InvalidInput, field };
  },
  goalForbidden(): AnalyticsError.GoalForbidden {
    return { errorCode: AnalyticsErrorCode.GoalForbidden };
  },
  goalInvalidRange(field: string): AnalyticsError.GoalInvalidRange {
    return { errorCode: AnalyticsErrorCode.GoalInvalidRange, field };
  },
} as const;

export namespace AnalyticsError {
  export type Unauthenticated = {
    readonly errorCode: typeof AnalyticsErrorCode.Unauthenticated;
  };
  export type BarberNotLinked = {
    readonly errorCode: typeof AnalyticsErrorCode.BarberNotLinked;
  };
  export type PeriodOutOfRange = {
    readonly errorCode: typeof AnalyticsErrorCode.PeriodOutOfRange;
    /** The refused period's first day — before the reach, after today, or the start of a `CUSTOM` range over the cap. */
    readonly fromLocalDate: LocalDate;
  };
  export type ScopeUnknown = {
    readonly errorCode: typeof AnalyticsErrorCode.ScopeUnknown;
    /** The id that named no barber record. */
    readonly barberId: BarberId;
  };
  export type LocationUnknown = {
    readonly errorCode: typeof AnalyticsErrorCode.LocationUnknown;
    /** The id that named no listed location. */
    readonly locationId: LocationId;
  };
  export type InvalidInput = {
    readonly errorCode: typeof AnalyticsErrorCode.InvalidInput;
    /** The request field at fault: `scopeBarberId`, `scopeLocationId`, `fromLocalDate`, `toLocalDate`, `analyticsSpan` or `analyticsComparison`. */
    readonly field: string;
  };
  export type GoalForbidden = {
    readonly errorCode: typeof AnalyticsErrorCode.GoalForbidden;
  };
  export type GoalInvalidRange = {
    readonly errorCode: typeof AnalyticsErrorCode.GoalInvalidRange;
    /** The call field at fault: `goalLowCents`, `goalHighCents` or `goalMonth`. */
    readonly field: string;
  };
}
