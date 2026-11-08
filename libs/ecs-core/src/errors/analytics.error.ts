import type { BarberId, LocalDate } from '@core/primitives';

/**
 * Staff analytics' refusals (`docs/designs/staff-analytics.md`, Errors) —
 * the `staffAnalytics` callable answers one of these instead of a report.
 * Flat structs discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with
 * the `ANALYTICS_` prefix; the screen words each as `errors.<errorCode>`.
 *
 * The visibility table decides most of them: who may ask for which scope,
 * judged on the caller's STORED roles and account status.
 */
export const AnalyticsErrorCode = {
  /** The callable was reached without a signed-in session. */
  Unauthenticated: 'ANALYTICS_UNAUTHENTICATED',
  /**
   * The caller may not see this scope: a blocked account, a role outside
   * `Roles.ANALYTICS_SELF` ∪ `Roles.ANALYTICS_SHOP`, or a barber asking for
   * another barber record or the shop.
   */
  Forbidden: 'ANALYTICS_FORBIDDEN',
  /** A barber whose account no admin has linked to a barber record yet. */
  BarberNotLinked: 'ANALYTICS_BARBER_NOT_LINKED',
  /** A period more than 12 months back, starting after today, or a `CUSTOM` range longer than `AnalyticsPeriod.CUSTOM_MAX_DAYS`. */
  PeriodOutOfRange: 'ANALYTICS_PERIOD_OUT_OF_RANGE',
  /** The requested scope names an id that is not a barber record. */
  ScopeUnknown: 'ANALYTICS_SCOPE_UNKNOWN',
  /**
   * A malformed request: a field missing or of the wrong type, a period
   * start that is not its span's first day, a `toLocalDate` on a span other
   * than `CUSTOM` (or none on `CUSTOM`, or one before the start), or the
   * refused `SAME_LAST_YEAR` comparison.
   */
  InvalidInput: 'ANALYTICS_INVALID_INPUT',
} as const;
export type AnalyticsErrorCode =
  (typeof AnalyticsErrorCode)[keyof typeof AnalyticsErrorCode];

export type AnalyticsError =
  | AnalyticsError.Unauthenticated
  | AnalyticsError.Forbidden
  | AnalyticsError.BarberNotLinked
  | AnalyticsError.PeriodOutOfRange
  | AnalyticsError.ScopeUnknown
  | AnalyticsError.InvalidInput;

export const AnalyticsError = {
  unauthenticated(): AnalyticsError.Unauthenticated {
    return { errorCode: AnalyticsErrorCode.Unauthenticated };
  },
  forbidden(): AnalyticsError.Forbidden {
    return { errorCode: AnalyticsErrorCode.Forbidden };
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
  invalidInput(field: string): AnalyticsError.InvalidInput {
    return { errorCode: AnalyticsErrorCode.InvalidInput, field };
  },
} as const;

export namespace AnalyticsError {
  export type Unauthenticated = {
    readonly errorCode: typeof AnalyticsErrorCode.Unauthenticated;
  };
  export type Forbidden = {
    readonly errorCode: typeof AnalyticsErrorCode.Forbidden;
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
  export type InvalidInput = {
    readonly errorCode: typeof AnalyticsErrorCode.InvalidInput;
    /** The request field at fault: `scopeBarberId`, `fromLocalDate`, `toLocalDate`, `analyticsSpan` or `analyticsComparison`. */
    readonly field: string;
  };
}
