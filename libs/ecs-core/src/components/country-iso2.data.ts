import type { Brand } from '../primitives/brand';
/**
 * An ISO 3166-1 alpha-2 country code, upper-case, supported by the phone
 * metadata — the brand the phone field's country picker and
 * `PhoneSystem.parse(raw, defaultCountry)` take, standing in for
 * libphonenumber's `CountryCode` so the library type never leaves the cage.
 *
 * The edge guard needs libphonenumber's `isSupportedCountry`, which a
 * `*.data.ts` may not import, so it lives in the caged system:
 * `PhoneSystem.parseCountry(raw): Result<CountryIso2, PhoneError>` (the
 * kernel's `toCountryIso2`). This companion only casts.
 */
export type CountryIso2 = Brand<string, 'CountryIso2'>;

export const CountryIso2 = {
  /** The only cast site — after `PhoneSystem.parseCountry`, or for a literal the specs and the deployment config own. */
  of: (raw: string): CountryIso2 => raw as CountryIso2,
} as const;
