import { CatalogError } from './catalog-errors.data';
import type { E164 } from './phone-number.data';
import { Result } from './result.data';

/**
 * A shop's contact phone as TENANT CONTENT (`venue-phone.ts:13`): the
 * canonical `E164` (the `tel:` href) beside the admin-authored `display`
 * string the UI renders verbatim. Denormalised rather than formatted at
 * render time — a venue phone renders on the public landing, and
 * pre-formatting it once at authoring time keeps every render path free of
 * the libphonenumber closure.
 *
 * Parsing happens at the edge: the catalogue handler and the seed call
 * `PhoneSystem.parse(raw)` and hand the result's `e164` to
 * {@link VenuePhone.of}. A `*.data.ts` never imports a system: at run time
 * this file reads only the `Result` companion and the `CatalogError`
 * factories.
 */
export type VenuePhone = {
  readonly e164: E164;
  readonly display: string;
};

export const VenuePhone = {
  /**
   * The venue phone from an already-parsed number: the display text is
   * trimmed and must not be blank (`catalog.venue_phone.blank_display`).
   */
  of(
    e164: E164,
    display: string,
  ): Result<VenuePhone, CatalogError.VenuePhoneBlankDisplay> {
    const trimmed = display.trim();
    return trimmed.length > 0
      ? Result.ok({ e164, display: trimmed })
      : Result.err(CatalogError.venuePhoneBlankDisplay());
  },

  /** Same number and same display text. */
  equals(a: VenuePhone, b: VenuePhone): boolean {
    return a.e164 === b.e164 && a.display === b.display;
  },
} as const;
