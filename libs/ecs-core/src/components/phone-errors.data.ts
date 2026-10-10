/**
 * The phone context's error codes — the kernel's flat `phone_number_invalid`
 * (`phone-number.errors.ts`) and `country_unsupported`
 * (`phone-country.errors.ts`), renamed to the dotted convention (blueprint
 * §2.5, catalog-kernel Q13). Raised only by `PhoneSystem`, the one
 * libphonenumber-caged module.
 */
export const PhoneErrorCode = {
  /** The raw text is not a valid phone number; `reason` says why. */
  Invalid: 'phone.invalid',
  /** The raw text is not an ISO 3166-1 alpha-2 code the phone metadata supports. */
  CountryUnsupported: 'phone.country_unsupported',
} as const;
export type PhoneErrorCode =
  (typeof PhoneErrorCode)[keyof typeof PhoneErrorCode];

/**
 * Why a raw string failed to parse — maps 1:1 onto the
 * `errors.identity.phone.*` i18n keys (hyphens → underscores), so the UI says
 * "too short, for example 088 123 4567" instead of one generic "invalid".
 * `Invalid` is the fallback for a number that parses but fails validation
 * without a more specific diagnosis. The strings are the kernel's
 * `PhoneNumberInvalidReason`, unchanged.
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
    return { code: PhoneErrorCode.Invalid, attempted, reason };
  },
  countryUnsupported(attempted: string): PhoneError.CountryUnsupported {
    return { code: PhoneErrorCode.CountryUnsupported, attempted };
  },
  /** Narrows an error to one code — `PhoneError.is(e, PhoneErrorCode.Invalid)`. */
  is<C extends PhoneErrorCode>(
    error: PhoneError,
    code: C,
  ): error is Extract<PhoneError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace PhoneError {
  export type Invalid = {
    readonly code: typeof PhoneErrorCode.Invalid;
    /** The raw text as the caller passed it, untrimmed. */
    readonly attempted: string;
    readonly reason: PhoneInvalidReason;
  };
  export type CountryUnsupported = {
    readonly code: typeof PhoneErrorCode.CountryUnsupported;
    readonly attempted: string;
  };
}
