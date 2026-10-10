/**
 * What the waitlist's door can refuse — the ONLY source of these strings,
 * kept verbatim from `request-waitlist.errors.ts` (each has its
 * `errors.booking.waitlist.*` i18n row). Every non-`code` field is an i18n
 * parameter: an i18n-safe scalar.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const WaitlistErrorCode = {
  /** Nobody to notify — the normal path for an anonymous visitor (a sign-in prompt, not a banner). */
  Unauthenticated: 'booking.waitlist.unauthenticated',
  /** `field` names what is wrong: a payload field or the refusal underneath. */
  InvalidRequest: 'booking.waitlist.invalid_request',
  TooManyDays: 'booking.waitlist.too_many_days',
  /** The same days are already watched for the same bag. */
  AlreadyWatching: 'booking.waitlist.already_watching',
} as const;
export type WaitlistErrorCode =
  (typeof WaitlistErrorCode)[keyof typeof WaitlistErrorCode];

/** A refusal of the waitlist's door — a plain struct the UI translates by `code`. */
export type WaitlistError =
  | WaitlistError.Unauthenticated
  | WaitlistError.InvalidRequest
  | WaitlistError.TooManyDays
  | WaitlistError.AlreadyWatching;

export const WaitlistError = {
  unauthenticated(): WaitlistError.Unauthenticated {
    return { code: WaitlistErrorCode.Unauthenticated };
  },
  invalidRequest(field: string): WaitlistError.InvalidRequest {
    return { code: WaitlistErrorCode.InvalidRequest, field };
  },
  tooManyDays(max: number): WaitlistError.TooManyDays {
    return { code: WaitlistErrorCode.TooManyDays, max };
  },
  alreadyWatching(): WaitlistError.AlreadyWatching {
    return { code: WaitlistErrorCode.AlreadyWatching };
  },
} as const;

export namespace WaitlistError {
  export type Unauthenticated = {
    readonly code: typeof WaitlistErrorCode.Unauthenticated;
  };
  export type InvalidRequest = {
    readonly code: typeof WaitlistErrorCode.InvalidRequest;
    readonly field: string;
  };
  export type TooManyDays = {
    readonly code: typeof WaitlistErrorCode.TooManyDays;
    readonly max: number;
  };
  export type AlreadyWatching = {
    readonly code: typeof WaitlistErrorCode.AlreadyWatching;
  };
}
