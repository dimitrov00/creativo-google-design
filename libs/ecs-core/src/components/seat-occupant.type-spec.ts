/**
 * Compile-only proofs over the `WALK_IN` occupant (OR-26, DEP-F20): the new
 * variant keeps `SeatOccupant`, every `Seat` and the `Appointment` that
 * holds them from collapsing to `never`; it is flat; `seatSubject` narrows
 * to exactly its fields (a client record and a label — no account); a whole
 * `Seat` still passes where the ACCOUNT rules read an occupant
 * (`AccountSeat`), which never sees the walk-in's record. `tsc` failing — on
 * a `false` constant or an unused `@ts-expect-error` — IS the test; nothing
 * here runs.
 */
import type { Appointment } from '@core/entities';
import type { CustomerId } from '@core/primitives';
import type { AllTrue, NoNested } from '@core/testing';
import type { AccountOccupant } from './account-occupant.data';
import type { AccountSeat } from './account-seat.data';
import type { SeatLabel } from './seat-label.data';
import { SeatOccupant, SeatSubject } from './seat-occupant.data';
import type { Seat } from './seat.data';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;
/** The seats of the union that are of one occupant variant. */
type SeatOf<S extends SeatSubject> = Extract<Seat, { seatSubject: S }>;
/** An appointment whose seats are all walk-ins' — the element type narrowed. */
type WalkInAppointment = Appointment & {
  readonly seats: readonly SeatOf<typeof SeatSubject.WalkIn>[];
};

export const walkInNotNever: IsNever<SeatOccupant.WalkIn> = false;
export const occupantFlat: EveryVariantFlat<SeatOccupant> = true;
export const walkInSeatNotNever: IsNever<SeatOf<typeof SeatSubject.WalkIn>> =
  false;
export const walkInSeatFlat: EveryVariantFlat<
  SeatOf<typeof SeatSubject.WalkIn>
> = true;
export const appointmentWithWalkInNotNever: IsNever<WalkInAppointment> = false;
export const walkInSeatIsAccountSeat: SeatOf<
  typeof SeatSubject.WalkIn
> extends AccountSeat
  ? true
  : false = true;
export const walkInIsSeatOccupant: SeatOccupant.WalkIn extends SeatOccupant
  ? true
  : false = true;

declare const seat: Seat;
if (seat.seatSubject === SeatSubject.WalkIn) {
  void seat.subjectCustomerId;
  void seat.guestLabel;
  // @ts-expect-error — a walk-in has no account
  void seat.subjectUserId;
  // @ts-expect-error — nor a relationship to the booker
  void seat.subjectRelationship;
}

declare const apt: WalkInAppointment;
const first = apt.seats[0];
if (first !== undefined) {
  void first.subjectCustomerId;
  void first.attendanceState;
}

declare const read: AccountOccupant;
if (read.seatSubject === SeatSubject.WalkIn) {
  void read.guestLabel;
  // @ts-expect-error — the ACCOUNT rules never read the walk-in's record
  void read.subjectCustomerId;
}

// The factory builds exactly the variant, from a record and a label.
declare const record: CustomerId;
declare const label: SeatLabel;
export const built: SeatOccupant.WalkIn = SeatOccupant.walkIn(record, label);
