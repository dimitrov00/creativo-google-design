import type {
  Currency,
  DurationMinutes,
  MinuteCount,
  SeatKeyText,
  PriceCents,
} from '@core/primitives';
import type { ServiceTerms } from './service-terms.data';

/**
 * A seat's terms as STAFF fixed them by hand — the snapshot carried forward
 * plus whatever the command changed, keyed by the requested seat's key (its
 * line id, a `SeatKeyText`). Each figure replaces the catalogue's; `null`
 * keeps the catalogue's (`decide-booking.ts:223-229` — the staff edit and a
 * client's move carry PARTIAL overrides). Flat (Law 6): the `ServiceTerms`
 * fields, each nullable (N6/N14 — `priceCents` beside one `currency`).
 * Assembled server-side only (the staff edit, or a client's move from the
 * STORED seats), never parsed from a client payload: "name your own price"
 * is the one thing the round trip exists to prevent. Split out of
 * `placement-policy.data.ts` (pass D, D-7).
 */
export type StaffTermsOverride = {
  readonly seatKey: SeatKeyText;
  readonly priceCents: PriceCents | null;
  readonly currency: Currency | null;
  readonly durationMinutes: DurationMinutes | null;
  readonly setupMinutes: MinuteCount | null;
  readonly cleanupMinutes: MinuteCount | null;
};

export const StaffTermsOverride = {
  /** Every figure fixed: the seat is written with exactly `terms`. */
  of(seatKey: SeatKeyText, terms: ServiceTerms): StaffTermsOverride {
    return {
      seatKey,
      priceCents: terms.priceCents,
      currency: terms.currency,
      durationMinutes: terms.durationMinutes,
      setupMinutes: terms.setupMinutes,
      cleanupMinutes: terms.cleanupMinutes,
    };
  },

  /** No figure fixed — the catalogue's terms, but the seat counts as carried. */
  carried(seatKey: SeatKeyText): StaffTermsOverride {
    return {
      seatKey,
      priceCents: null,
      currency: null,
      durationMinutes: null,
      setupMinutes: null,
      cleanupMinutes: null,
    };
  },

  /** The override for `seatKey` (a requested seat's line id), or `null` — a seat no one re-priced. */
  find(
    overrides: readonly StaffTermsOverride[],
    seatKey: string,
  ): StaffTermsOverride | null {
    for (let i = 0; i < overrides.length; i++) {
      const override = overrides[i] as StaffTermsOverride;
      if (override.seatKey === seatKey) return override;
    }
    return null;
  },
} as const;
