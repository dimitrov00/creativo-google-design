/**
 * What the waitlist's door can refuse — the ONLY source of these strings,
 * SCREAMING_SNAKE and prefixed `BOOKING_WAITLIST_` (Law 7.5, flatten-spec
 * §4.2). The UI resolves `errors.<errorCode>`; since the Phase 4a wire flip
 * the wire carries these codes too (the legacy `booking.waitlist.*` codes
 * are retired). Every non-`errorCode` field is an i18n parameter: an
 * i18n-safe scalar.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const WaitlistErrorCode = {
  /** Nobody to notify — the normal path for an anonymous visitor (a sign-in prompt, not a banner). */
  Unauthenticated: 'BOOKING_WAITLIST_UNAUTHENTICATED',
  /** `field` names what is wrong: a payload field or the refusal underneath. */
  InvalidRequest: 'BOOKING_WAITLIST_INVALID_REQUEST',
  TooManyDays: 'BOOKING_WAITLIST_TOO_MANY_DAYS',
  /** The same days are already watched for the same bag. */
  AlreadyWatching: 'BOOKING_WAITLIST_ALREADY_WATCHING',
} as const;
export type WaitlistErrorCode =
  (typeof WaitlistErrorCode)[keyof typeof WaitlistErrorCode];

/** A refusal of the waitlist's door — a plain struct the UI translates by `errorCode`. */
export type WaitlistError =
  | WaitlistError.Unauthenticated
  | WaitlistError.InvalidRequest
  | WaitlistError.TooManyDays
  | WaitlistError.AlreadyWatching;

export const WaitlistError = {
  unauthenticated(): WaitlistError.Unauthenticated {
    return { errorCode: WaitlistErrorCode.Unauthenticated };
  },
  invalidRequest(field: string): WaitlistError.InvalidRequest {
    return { errorCode: WaitlistErrorCode.InvalidRequest, field };
  },
  tooManyDays(max: number): WaitlistError.TooManyDays {
    return { errorCode: WaitlistErrorCode.TooManyDays, max };
  },
  alreadyWatching(): WaitlistError.AlreadyWatching {
    return { errorCode: WaitlistErrorCode.AlreadyWatching };
  },
} as const;

export namespace WaitlistError {
  export type Unauthenticated = {
    readonly errorCode: typeof WaitlistErrorCode.Unauthenticated;
  };
  export type InvalidRequest = {
    readonly errorCode: typeof WaitlistErrorCode.InvalidRequest;
    readonly field: string;
  };
  export type TooManyDays = {
    readonly errorCode: typeof WaitlistErrorCode.TooManyDays;
    readonly max: number;
  };
  export type AlreadyWatching = {
    readonly errorCode: typeof WaitlistErrorCode.AlreadyWatching;
  };
}

/** Why a withdrawal was refused — the ONLY source of these strings, the field `errorCode`. */
export const CancelWaitlistRefusalCode = {
  /** No such request, or not the caller's. */
  NotFound: 'BOOKING_WAITLIST_NOT_FOUND',
  /** The request already concluded (`BOOKED`, `EXPIRED`). */
  NotCancellable: 'BOOKING_WAITLIST_NOT_CANCELLABLE',
} as const;
export type CancelWaitlistRefusalCode =
  (typeof CancelWaitlistRefusalCode)[keyof typeof CancelWaitlistRefusalCode];

/** A refused withdrawal — a flat struct the edge translates by `errorCode`. */
export type CancelWaitlistRefusal = {
  readonly errorCode: CancelWaitlistRefusalCode;
};
