import type {
  BookingContactProps,
  FlexibleWhenProps,
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
  /**
   * The flexible declaration, if the client made one.
   *
   * Worth persisting where the per-seat assignments are not, and for the
   * opposite reason: an offer goes stale the moment someone else books, but
   * "I can come on the 25th or the 26th, mornings only" is a statement about
   * the CLIENT, and it stays true across a reload and across the sign-in round
   * trip a waitlist request has to make. Losing it would mean re-authoring
   * several days of windows to get back to where they were.
   *
   * `null` for the ordinary single-day pick, which never touches it.
   */
  readonly when: FlexibleWhenProps | null;
  /**
   * The shop zone `when`'s bare `YYYY-MM-DD` day keys were authored in.
   *
   * Stored rather than re-derived because a day key alone is ambiguous: the
   * 26th in Sofia and the 26th in Lisbon are different instants, and the
   * windows inside it resolve against whichever zone the restore picks. Guessing
   * a default would silently shift a declaration by an hour or more. `null`
   * when there is no declaration to restore.
   */
  readonly zone: string | null;
  /**
   * Who the shop calls about this booking, if the booker captured or
   * overrode it. Persisted like everything else the user typed: a reload
   * mid-flow must not silently drop back to the profile's number after
   * someone deliberately gave a different one.
   */
  readonly contact?: BookingContactProps | null;
  /**
   * The visit this booking was made FROM («Запиши пак»), and the account it
   * was read for. The rebooking edge is the one fact about a booking nothing
   * can rebuild later, and the review step's sign-in round trip returns
   * without the `?repeat=` that set it — so it rides in the draft, bound to
   * its reader: a restored draft that a DIFFERENT account then claims drops
   * it rather than linking one person's booking to another's visit.
   */
  readonly bookedFrom?: BookingDraftSource | null;
  /** The appointment being MOVED, bound to its reader the same way. */
  readonly rescheduleOf?: BookingDraftMove | null;
}

/** An appointment the draft points at, and whose read it came from. */
export interface BookingDraftSource {
  readonly appointmentId: string;
  /** The account the repository returned the appointment to. */
  readonly ownerId: string;
}

/**
 * The appointment being moved — and who moves WITH it that the cart cannot
 * name.
 *
 * `riders` are the visit's seats the server carries forward on a move (a
 * companion account the shop seated beside the booker): they never enter the
 * cart, so without this the review step would move a person the client was
 * never shown, and the grid's rider check would offer times the server
 * refuses for them. Persisted beside the source because a restored move
 * starts from them before its re-read lands (`BookingFlowStore.rereadMove`).
 * The server re-reads the stored visit and never trusts any of this.
 *
 * All or nothing: a stored move whose riders or chairs do not parse, or are
 * missing (a draft written before they existed), is not restored, and the
 * move link lands it again from the live visit.
 */
export interface BookingDraftMove extends BookingDraftSource {
  readonly riders: readonly BookingDraftRider[];
  /**
   * The chair time the visit holds NOW (`Appointment.chairTimes`), which the
   * schedule step hands back on every day query so the visit's own seats
   * never block its own move. Persisted for the same reason as the riders.
   */
  readonly chairTimes: readonly BookingDraftChairTime[];
}

/** One seat's chair time, as instants — see `BookingDraftMove.chairTimes`. */
export interface BookingDraftChairTime {
  readonly barberId: string;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * One carried seat — what the review step shows, and what the schedule step
 * asks the day query to keep room for, at a shop that offers its service
 * (`MoveRider`).
 */
export interface BookingDraftRider {
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  /**
   * Minutes from the earliest seat the cart stands in for to this one's
   * start, negative when it starts first (`carriedOffsetMinutes`). The new
   * start is the cart's new earliest start plus this (`carriedStartMs`),
   * which is the domain's one shift and the server's too.
   */
  readonly offsetMinutes: number;
  /**
   * The chair time the seat was SOLD at — service, setup and cleanup. The
   * server re-checks a carried seat on these stored terms, never on today's
   * catalogue, so the grid has to measure it the same way to offer only the
   * times the server will accept.
   */
  readonly durationMinutes: number;
  readonly setupMinutes: number;
  readonly cleanupMinutes: number;
}
