import type {
  ReconstituteBookingCartProps,
  ReconstituteBookingPartyProps,
  TimeSlotProps,
} from '@creativo/domain/scheduling';
import type { BookingFlowStep } from '../flow/booking-flow';

/**
 * A booking wizard's in-progress, unconfirmed selections — persisted so a
 * reload mid-flow doesn't cost the user the party and bag they assembled
 * (goal 6.5's exit criterion).
 *
 * **Deliberately raw props, not domain values.** `party` and `cart` are
 * exactly the `reconstitute()` inputs their aggregates already accept, so
 * the storage adapter is a JSON round-trip with a shape guard and the ONE
 * validation pass happens where it belongs — in the domain, on restore.
 * The shape this replaces carried `UserId`/`ServiceId`/`TimeSlot` values
 * and made the adapter re-implement id validation field by field.
 *
 * Two counters ride along and matter more than they look: `nextSequence` on
 * both the party and the cart. Without them a reload would restart minting
 * at zero and hand a fresh guest the id of one already removed — blueprint
 * §7.7's bug, reintroduced through the back door.
 *
 * `ownerId` is nullable throughout: `/book` is browsable anonymously, so a
 * draft routinely belongs to nobody yet.
 */
export interface BookingDraft {
  /** Where the wizard was — a restored draft resumes in place, not at step 1. */
  readonly step: BookingFlowStep;
  readonly party: ReconstituteBookingPartyProps;
  readonly cart: ReconstituteBookingCartProps;
  readonly locationId: string | null;
  readonly timeSlot: TimeSlotProps | null;
  /**
   * The calendar day the user had open, `YYYY-MM-DD`.
   *
   * Persisted separately from `timeSlot` because it survives further: a
   * restored draft resumes on the SCHEDULE step (the per-seat assignments an
   * offer consists of are not worth persisting, and would be stale anyway),
   * and landing on the day the user chose costs them one tap instead of a
   * re-hunt. That is the difference between signing in mid-flow being free
   * and being a punishment.
   */
  readonly dayKey: string | null;
}
