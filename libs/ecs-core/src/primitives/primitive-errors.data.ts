/**
 * Why foreign input did not become a branded primitive (Law 7.4) — the error
 * of every primitive smart constructor (`LocalDate.parse`, `MinuteOfDay.of`,
 * `AppointmentId.parse`, …). One flat shape for every refusal, so every
 * primitive error shares one hidden class; `brand` names the tag that refused
 * (`'LocalDate'`), `raw` echoes the refused input. The UI resolves
 * `errors.<errorCode>` (one generic text for the whole family).
 *
 * (`TimeZone` refusals are `TimeError`s — its constructor needs `Intl`, so it
 * lives in `ZonedTimeSystem.checkZone`, decision F-2.)
 */

/** Error codes — the ONLY source of these strings (SCREAMING_SNAKE, `PRIMITIVE_` prefix). */
export const PrimitiveErrorCode = {
  LocalDateInvalid: 'PRIMITIVE_LOCAL_DATE_INVALID',
  MinuteOutOfRange: 'PRIMITIVE_MINUTE_OUT_OF_RANGE',
  DurationNotPositive: 'PRIMITIVE_DURATION_NOT_POSITIVE',
  MinuteCountNegative: 'PRIMITIVE_MINUTE_COUNT_NEGATIVE',
  MinuteDeltaNotInteger: 'PRIMITIVE_MINUTE_DELTA_NOT_INTEGER',
  UtcEpochMsInvalid: 'PRIMITIVE_UTC_EPOCH_MS_INVALID',
  PriceCentsInvalid: 'PRIMITIVE_PRICE_CENTS_INVALID',
  CurrencyUnknown: 'PRIMITIVE_CURRENCY_UNKNOWN',
  IdEmpty: 'PRIMITIVE_ID_EMPTY',
  IdHasSlash: 'PRIMITIVE_ID_HAS_SLASH',
  LatitudeOutOfRange: 'PRIMITIVE_LATITUDE_OUT_OF_RANGE',
  LongitudeOutOfRange: 'PRIMITIVE_LONGITUDE_OUT_OF_RANGE',
  EpochSecondsInvalid: 'PRIMITIVE_EPOCH_SECONDS_INVALID',
  SubsecondNanosOutOfRange: 'PRIMITIVE_SUBSECOND_NANOS_OUT_OF_RANGE',
  SeatKeyTextEmpty: 'PRIMITIVE_SEAT_KEY_TEXT_EMPTY',
  AuditResourceIdInvalid: 'PRIMITIVE_AUDIT_RESOURCE_ID_INVALID',
} as const;
export type PrimitiveErrorCode =
  (typeof PrimitiveErrorCode)[keyof typeof PrimitiveErrorCode];

/**
 * A refused primitive — flat, zero-prototype, serialisable. Every field
 * besides `errorCode` is an i18n parameter.
 */
export type PrimitiveError = {
  readonly errorCode: PrimitiveErrorCode;
  /** The input as received (a string or a number), never transformed. */
  readonly raw: string | number;
  /** The tag of the brand that refused it (`'LocalDate'`, `'AppointmentId'`). */
  readonly brand: string;
};

export const PrimitiveError = {
  of(
    errorCode: PrimitiveErrorCode,
    raw: string | number,
    brand: string,
  ): PrimitiveError {
    return { errorCode, raw, brand };
  },

  is(error: PrimitiveError, errorCode: PrimitiveErrorCode): boolean {
    return error.errorCode === errorCode;
  },
} as const;
