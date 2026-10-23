import type { Appointment } from '@core/entities';
import type { BookingStatus } from '@core/primitives';

/**
 * One visit, as the CALENDAR and the VISIT SHEET state it: the day cell's
 * face and announcement, the sheet's title, time, barber and verbs, the
 * `.ics` a person carries home.
 *
 * The LIST no longer reads it: «Моите часове» draws the shared visits
 * list (`@creativo/features/shared/visits`, client-card redesign §5.3.5),
 * whose rows are `VisitRowVm`s. This view model is built FROM that row —
 * the title and the barber's word are the row's own, and so is
 * `upcoming` — so a row and the sheet it opens can never word one visit
 * apart.
 *
 * Built in the page rather than in the template because every field is a
 * lookup or a format — a template that calls four methods per row re-runs
 * all of them on every change detection, which is what made the booking
 * calendar's day cells slow enough to feel.
 */
export interface ClientVisitVm {
  readonly id: string;
  /** The stored visit — the flat entity straight from its document. */
  readonly appointment: Appointment;
  /** The services, deduplicated and joined — what the visit IS (the row's title). */
  readonly title: string;
  /**
   * The barber, or the party of them («2 бръснари») — the row's own word.
   * A party with several barbers has no face (`barberAvatarSrc` null, no
   * monogram): two faces in one place is a picture about faces rather than
   * about a visit.
   */
  readonly barberLabel: string;
  readonly barberAvatarSrc: string | null;
  /** The name the avatar draws its initial from; empty when the catalogue does not know the barber. */
  readonly barberMonogram: string;
  readonly timeLabel: string;
  /** Still ahead — open, and not yet begun (the row's `upcoming`, filed under «Предстоящи»). */
  readonly upcoming: boolean;
  /** The stored `bookingStatus` (`'CONFIRMED'`, …). */
  readonly bookingStatus: BookingStatus;
}
