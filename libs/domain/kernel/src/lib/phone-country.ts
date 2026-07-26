import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isSupportedCountry,
  type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/examples.mobile.json';
import { Brand } from './brand';
import { Result, fail, ok } from './result';
import { CountryUnsupportedError } from './phone-country.errors';

/**
 * ISO 3166-1 alpha-2 country code, uppercase, guaranteed supported by the
 * phone metadata — the branded stand-in for `libphonenumber-js`'s
 * `CountryCode` so the library type never crosses the kernel boundary
 * (same cage as `PhoneNumber` itself; ESLint `no-restricted-imports`).
 * The ONLY untrusted-input path into the brand is `toCountryIso2`.
 */
export type CountryIso2 = Brand<string, 'CountryIso2'>;

/** One selectable entry in a phone-country picker. */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2, e.g. `'BG'`. */
  readonly code: CountryIso2;
  /** Calling code digits only, e.g. `'359'` — the UI renders `'+359'`. */
  readonly dialCode: string;
  /** Localized via `Intl.DisplayNames`, e.g. `'България'` for locale `bg`. */
  readonly name: string;
}

const countriesByLocale = new Map<string, readonly PhoneCountry[]>();

/**
 * Every country the phone metadata supports, named for `locale` via
 * `Intl.DisplayNames` (platform-provided — zero country-name payload
 * shipped) and sorted with `Intl.Collator(locale)`. Memoized per locale;
 * building the ~250-entry list is pure, so the cache never invalidates.
 */
export function listPhoneCountries(locale: string): readonly PhoneCountry[] {
  const cached = countriesByLocale.get(locale);
  if (cached) {
    return cached;
  }
  const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale);
  const countries: readonly PhoneCountry[] = getCountries()
    .map((code): PhoneCountry => ({
      code: code as string as CountryIso2,
      dialCode: getCountryCallingCode(code),
      // `of()` is undefined only for codes DisplayNames doesn't know;
      // fall back to the raw ISO code rather than dropping the entry.
      name: displayNames.of(code) ?? code,
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
  countriesByLocale.set(locale, countries);
  return countries;
}

/**
 * Parse/validate an ISO-2 string from untrusted edges (tenant config,
 * route data, `navigator.language` region subtags). Case-insensitive on
 * the way in; the brand is always uppercase.
 */
export function toCountryIso2(
  raw: string,
): Result<CountryIso2, CountryUnsupportedError> {
  const normalized = raw.trim().toUpperCase();
  if (!isSupportedCountry(normalized)) {
    return fail(new CountryUnsupportedError(raw));
  }
  return ok(normalized as CountryIso2);
}

/**
 * One stateless as-you-type formatting step — feed the FULL current field
 * text every keystroke (a fresh `AsYouType` per call is cheap and fits
 * signals better than caging a stateful formatter).
 */
export interface PhoneDraft {
  /** National-format text to render back into the input, e.g. `'088 555 0100'`. */
  readonly formatted: string;
  /** Re-detected country — changes when the user types/pastes `'+<dial code>'`. */
  readonly country: CountryIso2 | undefined;
  /** Canonical E.164, defined once the number is complete and plausible. */
  readonly e164: string | undefined;
  /** Drives live error clearing while typing (reward early, punish late). */
  readonly isValid: boolean;
  /** Format mask for the input so far, e.g. `'xxx xxx xxxx'` — optional ghost-mask. */
  readonly template: string | undefined;
}

/** Format `input` as the user types it, interpreted against `country` unless the text carries its own `+<dial code>`. */
export function formatPhoneDraft(
  input: string,
  country?: CountryIso2,
): PhoneDraft {
  const formatter = new AsYouType(country as CountryCode | undefined);
  const formatted = formatter.input(input);
  const number = formatter.getNumber();
  const draft: PhoneDraft = {
    formatted,
    country: formatter.getCountry() as string | undefined as
      CountryIso2 | undefined,
    e164: number?.isPossible() ? (number.number as string) : undefined,
    isValid: number?.isValid() ?? false,
    template: formatter.getTemplate() || undefined,
  };

  // ONE canonical display for country-anchored input (owner ruling
  // 2026-07-26): the SIGNIFICANT number, trunk prefix stripped — the
  // trigger already shows `+359`, and the trunk `0` is exactly what the
  // dial code replaces, so '0896330113' and '896330113' must both render
  // '89 633 0113'. Achieved by re-formatting the significant digits
  // through the international form and stripping the dial-code prefix
  // back off — grouping without a lying leading zero.
  const digits = input.replace(/\D/g, '');
  if (country !== undefined && !input.includes('+') && digits.length >= 2) {
    // The plain pass already parsed the trunk: its nationalNumber IS the
    // significant number ('0896…' → '896…'); trunk-less input parses to
    // itself or fails, in which case the raw digits stand in.
    const significant =
      (number?.nationalNumber as string | undefined) || digits;
    try {
      const dial = getCountryCallingCode(country as CountryCode);
      const intl = new AsYouType();
      const intlFormatted = intl.input(`+${dial}${significant}`);
      const prefix = `+${dial}`;
      if (intlFormatted.startsWith(prefix)) {
        const stripped = intlFormatted.slice(prefix.length).trimStart();
        // Adopt only when the trick produced a real grouping of exactly
        // the significant digits; otherwise the plain draft stands.
        if (
          stripped.replace(/\D/g, '') === significant &&
          (stripped !== digits || significant !== digits)
        ) {
          const intlNumber = intl.getNumber();
          return {
            formatted: stripped,
            country: draft.country ?? country,
            e164: intlNumber?.isPossible()
              ? (intlNumber.number as string)
              : draft.e164,
            isValid: intlNumber?.isValid() ?? draft.isValid,
            template: undefined,
          };
        }
      }
    } catch {
      // Unknown dial code — fall through to the plain draft.
    }
  }
  return draft;
}

/**
 * A real example number for `country` in national format — placeholder and
 * error-copy material ("…like {example}"). Backed by the library's
 * examples dataset (statically imported, ~30 KB — acceptable next to the
 * metadata the kernel already ships; revisit with a lazy chunk if the
 * kernel's bundle budget ever tightens).
 */
export function examplePhoneNumber(country: CountryIso2): string | undefined {
  const example = getExampleNumber(country as CountryCode, examples);
  if (!example) return undefined;
  // Significant form, trunk stripped — the same canonical display
  // `formatPhoneDraft` renders next to a dial-code trigger (a placeholder
  // showing the trunk '0' would teach users to type the digit the +code
  // replaces).
  const draft = formatPhoneDraft(example.nationalNumber as string, country);
  return draft.formatted || example.formatNational();
}
