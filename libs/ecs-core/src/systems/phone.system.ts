import {
  AsYouType,
  ParseError,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isSupportedCountry,
  parsePhoneNumberFromString,
  parsePhoneNumberWithError,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/examples.mobile.json';
import {
  CountryIso2,
  DialSource,
  E164,
  type PhoneNumber,
} from '@core/components';
import { Result } from '@core/primitives';
import { PhoneError, PhoneInvalidReason } from '@core/errors';

/** One selectable entry in a phone-country picker. */
export type PhoneCountry = {
  /** ISO 3166-1 alpha-2, e.g. `'BG'`. */
  readonly code: CountryIso2;
  /** Calling code digits only, e.g. `'359'` — the UI renders `'+359'`. */
  readonly dialCode: string;
  /** The country's name in the picker's locale, e.g. `'България'`. */
  readonly name: string;
};

/**
 * How `listPhoneCountries` names and orders countries — the words half,
 * passed in because a system never constructs an `Intl` object (only
 * `zoned-time.system.ts` may): the template layer builds one
 * `Intl.DisplayNames([locale], { type: 'region' })` and one
 * `Intl.Collator(locale)` per locale, caches them, and hands their
 * functions here.
 */
export type CountryNaming = {
  /** The localized name, or `null` when the platform does not know the code. */
  readonly nameOf: (code: CountryIso2) => string | null;
  readonly compare: (a: string, b: string) => number;
};

/**
 * One stateless as-you-type formatting step — the caller feeds the FULL
 * current field text every keystroke (a fresh formatter per call is cheap and
 * fits signals better than a stateful one).
 */
export type PhoneDraft = {
  /** Text to render back into the input, e.g. `'88 555 0100'`. */
  readonly formatted: string;
  /** Re-detected country — changes when the user types or pastes `'+<dial code>'`. */
  readonly country: CountryIso2 | null;
  /** Canonical E.164, once the number is complete and plausible. */
  readonly e164: E164 | null;
  /** Drives live error clearing while typing (reward early, punish late). */
  readonly isValid: boolean;
  /** Format mask so far, e.g. `'xxx xxx xxxx'` — an optional ghost mask. */
  readonly template: string | null;
};

/**
 * The library's diagnosis codes (`ParseError.message` and
 * `validatePhoneNumberLength` share one vocabulary) onto the stable reasons.
 */
const INVALID_REASONS: Readonly<Record<string, PhoneInvalidReason>> = {
  NOT_A_NUMBER: PhoneInvalidReason.NotANumber,
  TOO_SHORT: PhoneInvalidReason.TooShort,
  TOO_LONG: PhoneInvalidReason.TooLong,
  INVALID_COUNTRY: PhoneInvalidReason.InvalidCountry,
};

function reasonOf(diagnosis: string | undefined): PhoneInvalidReason {
  return (
    (diagnosis === undefined ? undefined : INVALID_REASONS[diagnosis]) ??
    PhoneInvalidReason.Invalid
  );
}

const NON_DIGITS = /\D/g;

/**
 * The number the client card dials — {@link PhoneSystem.dialable}'s answer:
 * the account's own E.164, or the seat's digits as the edge stripped them.
 */
export type DialableNumber =
  | {
      readonly dialSource: typeof DialSource.Account;
      readonly e164: E164;
    }
  | {
      readonly dialSource: typeof DialSource.Seat;
      readonly digits: string;
    };

/**
 * Phone numbers — the one module in ecs-core that imports
 * `libphonenumber-js` (CLAUDE.md §3; the ESLint cage exempts this file
 * alone). The kernel's `PhoneNumber` class and `phone-country.ts` helpers,
 * as pure functions over plain strings: storage is always E.164
 * (`components/phone-number.data.ts`), country input is the branded
 * `CountryIso2`, never the library's `CountryCode`, and no library type
 * crosses this file's exports.
 *
 * Validation runs on the `min` metadata bundle (the root import) on purpose:
 * per-country length checks catch virtually all typos, landlines stay
 * legitimate, and `max`'s digit-pattern strictness would start rejecting
 * freshly assigned ranges as the metadata ages. OTP delivery is the real
 * reachability validator.
 */
export const PhoneSystem = {
  /**
   * The edge parse: an E.164 string, or a local-format string read against
   * `defaultCountry` — the canonical number, or `PHONE_INVALID` with the most
   * specific reason the library can give (`attempted` is the raw text,
   * untrimmed). A `defaultCountry` the metadata does not support refuses
   * with `invalid-country`, whatever the text.
   */
  parse(
    raw: string,
    defaultCountry: CountryIso2 | null,
  ): Result<PhoneNumber, PhoneError> {
    if (defaultCountry !== null && !isSupportedCountry(defaultCountry)) {
      return Result.err(
        PhoneError.invalid(raw, PhoneInvalidReason.InvalidCountry),
      );
    }
    const cleaned = raw.trim();
    const country = defaultCountry ?? undefined;
    try {
      const parsed = parsePhoneNumberWithError(cleaned, country);
      if (!parsed.isValid()) {
        // Parsed but not valid — the length checker gives a more specific
        // diagnosis (too short / too long) when it has one.
        return Result.err(
          PhoneError.invalid(
            raw,
            reasonOf(validatePhoneNumberLength(cleaned, country)),
          ),
        );
      }
      return Result.ok({
        e164: E164.of(parsed.number),
        countryCallingCode: parsed.countryCallingCode,
      });
    } catch (error) {
      // The library reports unparseable text by throwing; that is an
      // expected outcome here, so it becomes a value.
      return Result.err(
        PhoneError.invalid(
          raw,
          error instanceof ParseError
            ? reasonOf(error.message)
            : PhoneInvalidReason.Invalid,
        ),
      );
    }
  },

  /**
   * The edge guard for an ISO-2 string from an untrusted source (deployment
   * config, route data, `navigator.language`'s region subtag): trimmed,
   * upper-cased, supported by the metadata — or `PHONE_COUNTRY_UNSUPPORTED`
   * carrying the raw text. The kernel's `toCountryIso2`.
   */
  parseCountry(raw: string): Result<CountryIso2, PhoneError> {
    const normalized = raw.trim().toUpperCase();
    return isSupportedCountry(normalized)
      ? Result.ok(CountryIso2.of(normalized))
      : Result.err(PhoneError.countryUnsupported(raw));
  },

  /** The country an E.164 number belongs to, e.g. `'BG'`; `null` when the metadata cannot place it. */
  countryOf(e164: E164): CountryIso2 | null {
    const country = parsePhoneNumberFromString(e164)?.country;
    return country === undefined ? null : CountryIso2.of(country);
  },

  /** The calling code an E.164 number carries, digits only (`'+359…'` → `'359'`); `null` when unparseable. */
  callingCode(e164: E164): string | null {
    return parsePhoneNumberFromString(e164)?.countryCallingCode ?? null;
  },

  /** The dial code a country's numbers carry after the `+` — `'BG'` → `'359'`; `null` for an unsupported code. */
  countryCallingCode(country: CountryIso2): string | null {
    return isSupportedCountry(country) ? getCountryCallingCode(country) : null;
  },

  /** Presentation only, e.g. `'088 555 0100'` — falls back to the E.164 itself. */
  formatNational(e164: E164): string {
    return parsePhoneNumberFromString(e164)?.formatNational() ?? e164;
  },

  /** Presentation only, e.g. `'+359 88 555 0100'` — falls back to the E.164 itself. */
  formatInternational(e164: E164): string {
    return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
  },

  /**
   * Every country the phone metadata supports with its dial code, named by
   * `naming.nameOf` (falling back to the ISO code rather than dropping the
   * entry) and sorted by `naming.compare`. A fresh array per call; the
   * template layer memoises it per locale.
   */
  listPhoneCountries(naming: CountryNaming): readonly PhoneCountry[] {
    const codes = getCountries();
    const countries: PhoneCountry[] = [];
    for (let i = 0; i < codes.length; i++) {
      const raw = codes[i] as CountryCode;
      const code = CountryIso2.of(raw);
      countries.push({
        code,
        dialCode: getCountryCallingCode(raw),
        name: naming.nameOf(code) ?? raw,
      });
    }
    countries.sort((a, b) => naming.compare(a.name, b.name));
    return countries;
  },

  /**
   * A real example number for `country` in the significant form `formatDraft`
   * renders beside a dial-code trigger (trunk stripped — a placeholder
   * showing the trunk `0` would teach users to type the digit the `+code`
   * replaces): placeholder and error-copy material ("…like {example}").
   * `null` for a country the examples dataset does not cover.
   */
  example(country: CountryIso2): string | null {
    if (!isSupportedCountry(country)) return null;
    const example = getExampleNumber(country, examples);
    if (example === undefined) return null;
    const draft = PhoneSystem.formatDraft(example.nationalNumber, country);
    return draft.formatted.length > 0
      ? draft.formatted
      : example.formatNational();
  },

  /**
   * Formats `input` as the user types it, read against `country` unless the
   * text carries its own `+<dial code>`.
   *
   * ONE canonical display for country-anchored input (owner ruling
   * 2026-07-26): the SIGNIFICANT number, trunk prefix stripped — the trigger
   * already shows `+359`, and the trunk `0` is exactly what the dial code
   * replaces, so `'0896330113'` and `'896330113'` both render
   * `'89 633 0113'`. Achieved by formatting the significant digits through
   * the international form and stripping the dial-code prefix back off —
   * grouping without a lying leading zero.
   */
  formatDraft(input: string, country: CountryIso2 | null): PhoneDraft {
    const anchor =
      country !== null && isSupportedCountry(country) ? country : undefined;
    const formatter = new AsYouType(anchor);
    const formatted = formatter.input(input);
    const number = formatter.getNumber();
    const detected = formatter.getCountry();
    const template = formatter.getTemplate();
    const draft: PhoneDraft = {
      formatted,
      country: detected === undefined ? null : CountryIso2.of(detected),
      e164:
        number !== undefined && number.isPossible()
          ? E164.of(number.number)
          : null,
      isValid: number !== undefined && number.isValid(),
      template: template.length > 0 ? template : null,
    };

    const digits = input.replace(NON_DIGITS, '');
    if (anchor === undefined || input.includes('+') || digits.length < 2) {
      return draft;
    }
    // The plain pass already parsed the trunk: its national number IS the
    // significant number ('0896…' → '896…'); trunk-less input parses to
    // itself or fails, in which case the raw digits stand in.
    const significant = number?.nationalNumber || digits;
    const prefix = `+${getCountryCallingCode(anchor)}`;
    const intl = new AsYouType();
    const intlFormatted = intl.input(`${prefix}${significant}`);
    if (!intlFormatted.startsWith(prefix)) return draft;
    const stripped = intlFormatted.slice(prefix.length).trimStart();
    // Adopt only when the trick produced a real grouping of exactly the
    // significant digits; otherwise the plain draft stands.
    if (
      stripped.replace(NON_DIGITS, '') !== significant ||
      (stripped === digits && significant === digits)
    ) {
      return draft;
    }
    const intlNumber = intl.getNumber();
    return {
      formatted: stripped,
      country: draft.country ?? CountryIso2.of(anchor),
      e164:
        intlNumber !== undefined && intlNumber.isPossible()
          ? E164.of(intlNumber.number)
          : draft.e164,
      isValid: intlNumber === undefined ? draft.isValid : intlNumber.isValid(),
      template: null,
    };
  },

  /**
   * The number the client card dials (Law 10.2): the account's own E.164
   * first — a registered account always holds one, never the booker's for
   * a companion; else the seat's number, as the edge stripped it of its
   * `tel:` and of everything but digits and «+» (D-2.8); `null` when that
   * holds no digit (empty, or a lone «+») or there is none.
   */
  dialable(
    accountPhone: E164 | null,
    seatDigits: string | null,
  ): DialableNumber | null {
    if (accountPhone !== null) {
      return { dialSource: DialSource.Account, e164: accountPhone };
    }
    if (seatDigits === null || seatDigits.replace('+', '').length === 0) {
      return null;
    }
    return { dialSource: DialSource.Seat, digits: seatDigits };
  },
} as const;
