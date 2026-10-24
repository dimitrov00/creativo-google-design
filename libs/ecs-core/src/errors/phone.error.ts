/**
 * The phone context's error codes — the legacy kernel's flat
 * `phone_number_invalid` (`phone-number.errors.ts`) and `country_unsupported`
 * (`phone-country.errors.ts`; both deleted in Phase 4b) — flat structs
 * discriminated by `errorCode` (Law 7.5), SCREAMING_SNAKE with the `PHONE_`
 * prefix (flatten-spec §4.2). Raised only by `PhoneSystem`, the one
 * libphonenumber-caged module.
 */
export const PhoneErrorCode = {
  /** The raw text is not a valid phone number; `reason` says why. */
  Invalid: 'PHONE_INVALID',
  /** The raw text is not an ISO 3166-1 alpha-2 code the phone metadata supports. */
  CountryUnsupported: 'PHONE_COUNTRY_UNSUPPORTED',
} as const;
export type PhoneErrorCode =
  (typeof PhoneErrorCode)[keyof typeof PhoneErrorCode];

/**
 * Why a raw string failed to parse — each value IS the reason segment of its
 * i18n key, `errors.PHONE_INVALID.<reason>` (`PHONE_INVALID.too-short`,
 * nothing mapped; `translateCodedError`'s `reason` argument builds it), so
 * the UI says "too short, for example 088 123 4567" instead of one generic
 * "invalid". `Invalid` is the fallback for a number that parses but fails
 * validation without a more specific diagnosis. The strings are the legacy
 * kernel's `PhoneNumberInvalidReason`, unchanged.
 */
export const PhoneInvalidReason = {
  NotANumber: 'not-a-number',
  TooShort: 'too-short',
  TooLong: 'too-long',
  InvalidCountry: 'invalid-country',
  Invalid: 'invalid',
} as const;
export type PhoneInvalidReason =
  (typeof PhoneInvalidReason)[keyof typeof PhoneInvalidReason];

export type PhoneError = PhoneError.Invalid | PhoneError.CountryUnsupported;

export const PhoneError = {
  invalid(attempted: string, reason: PhoneInvalidReason): PhoneError.Invalid {
    return { errorCode: PhoneErrorCode.Invalid, attempted, reason };
  },
  countryUnsupported(attempted: string): PhoneError.CountryUnsupported {
    return { errorCode: PhoneErrorCode.CountryUnsupported, attempted };
  },
  /** Narrows an error to one code — `PhoneError.is(e, PhoneErrorCode.Invalid)`. */
  is<C extends PhoneErrorCode>(
    error: PhoneError,
    errorCode: C,
  ): error is Extract<PhoneError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace PhoneError {
  export type Invalid = {
    readonly errorCode: typeof PhoneErrorCode.Invalid;
    /** The raw text as the caller passed it, untrimmed. */
    readonly attempted: string;
    readonly reason: PhoneInvalidReason;
  };
  export type CountryUnsupported = {
    readonly errorCode: typeof PhoneErrorCode.CountryUnsupported;
    readonly attempted: string;
  };
}
