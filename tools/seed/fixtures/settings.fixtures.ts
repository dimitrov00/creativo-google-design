/**
 * THE DEV SEED'S BOOKING POLICY: `settings/bookingPolicy` as the flat
 * `BookingPolicySettings` minus its `id` — the seven `BookingPolicy` fields
 * at the root, every one of them written, `autoConfirm` included, at the
 * numbers every reader falls back to today (`BookingPolicy.withDefaults`;
 * `seed-data.spec.mjs` holds the body equal to `BookingPolicy.DEFAULT`).
 *
 * Seeded EXPLICITLY even though every reader falls back to the same values,
 * because a missing document and a read default are indistinguishable on
 * screen — which is precisely how the client's broken policy parse went
 * unnoticed. With a real document in the emulator, changing a number here
 * must visibly move the calendar horizon; if it doesn't, the wiring broke
 * again.
 */
import { BOOKING_POLICY_DOC, type BookingPolicySettings } from '@core/entities';
import { type BookingPolicySettingsId, HourCount } from '@core/primitives';
import {
  type Body,
  minuteCount,
  minutesLong,
  type Seeded,
  sure,
} from './catalog.fixtures';

/**
 * The free-cancellation window the policy sets, and so the window every
 * seeded cancellation was made under: stamped on its seat as the cancel
 * paths stamp it (2026-09-25), which keeps the seed's late cancels where
 * they are whatever the window is moved to later. One number.
 */
export const CANCELLATION_WINDOW_HOURS: HourCount = sure(
  HourCount.of(24),
  'cancellation window 24',
);

/** `settings/bookingPolicy` — the one settings document. */
export const BOOKING_POLICY: Seeded<
  BookingPolicySettingsId,
  BookingPolicySettings
> = {
  id: BOOKING_POLICY_DOC,
  body: {
    maxPartySize: 5,
    slotStepMinutes: minutesLong(15),
    minLeadMinutes: minuteCount(120),
    horizonMonths: 2,
    cancellationWindowHours: CANCELLATION_WINDOW_HOURS,
    maxFlexibleDays: 7,
    // Owner ruling 2026-08-07: an online booking lands CONFIRMED.
    autoConfirm: true,
  } satisfies Body<BookingPolicySettings>,
};
