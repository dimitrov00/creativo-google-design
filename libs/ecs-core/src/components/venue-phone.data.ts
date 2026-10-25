import { Result } from '@core/primitives';
import { CatalogError } from '@core/errors';
import type { E164 } from './e164.data';

/**
 * A shop's contact phone as TENANT CONTENT (`venue-phone.ts:13`): the
 * canonical `E164` (the `tel:` href) beside the admin-authored display string
 * the UI renders verbatim — a flat SLICE (Law 6) that `ShopLocation`
 * intersects, so `phoneE164` and `phoneDisplay` sit at its root (was the
 * nested `phone: { e164, display }`; the stored document keeps it until the
 * booking-core flip). Denormalised rather than formatted at render time — a
 * venue phone renders on the public landing, and pre-formatting it once at
 * authoring time keeps every render path free of the libphonenumber closure.
 *
 * Parsing happens at the edge: the catalogue handler and the seed call
 * `PhoneSystem.parse(raw)` and hand the result's `e164` to
 * {@link VenuePhone.of}. A `*.data.ts` never imports a system: at run time
 * this file reads only the `Result` companion and the `CatalogError`
 * factories.
 */
export type VenuePhone = {
  readonly phoneE164: E164;
  readonly phoneDisplay: string;
};

export const VenuePhone = {
  /**
   * The venue phone from an already-parsed number: the display text is
   * trimmed and must not be blank (`CATALOG_VENUE_PHONE_BLANK_DISPLAY`).
   */
  of(
    phoneE164: E164,
    phoneDisplay: string,
  ): Result<VenuePhone, CatalogError.VenuePhoneBlankDisplay> {
    const trimmed = phoneDisplay.trim();
    return trimmed.length > 0
      ? Result.ok({ phoneE164, phoneDisplay: trimmed })
      : Result.err(CatalogError.venuePhoneBlankDisplay());
  },

  /** Same number and same display text. */
  equals(a: VenuePhone, b: VenuePhone): boolean {
    return a.phoneE164 === b.phoneE164 && a.phoneDisplay === b.phoneDisplay;
  },
} as const;
