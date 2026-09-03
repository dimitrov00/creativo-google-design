import { DomainError } from '@creativo/domain/kernel';
import type { CommitBookingError } from './commit-booking.errors';

/**
 * The refusals that belong to STAFF editing specifically.
 *
 * Everything a staff edit shares with a commit — an unknown service, a
 * malformed field, a store that would not write — keeps the commit path's own
 * code, because the sheet has nothing different to say about them and a
 * second vocabulary for the same failure is a second thing to translate. What
 * is here is what only this path can refuse.
 */
export class StaffEditUnauthenticatedError extends DomainError {
  readonly code = 'booking.staffEdit.unauthenticated' as const;

  constructor() {
    super('Editing the book needs a signed-in caller');
  }
}

/**
 * The caller is signed in and is not one of the roles that works the book.
 *
 * Deliberately NOT masked as not-found: this endpoint's existence is no
 * secret, and "you lack the role" is more debuggable than a phantom 404 —
 * the same reasoning `transitionAppointment` already applies.
 */
export class StaffEditForbiddenError extends DomainError {
  readonly code = 'booking.staffEdit.forbidden' as const;

  constructor() {
    super('Only the roles that work the book may edit an appointment');
  }
}

/**
 * The command did not parse, or named something the appointment does not have.
 *
 * `field` says which part — `kind`, `startIso`, `edge`, `seatId`,
 * `priceMinorUnits`, `minutes`, `barberId`. Note what is deliberately absent:
 * there is no `invalid_range` code, because `До ≤ От` is unrepresentable in
 * the editor — the end is DERIVED from a start and a duration, and a duration
 * that is not positive is refused as a duration, at the field the user
 * actually typed in.
 */
export class StaffEditInvalidCommandError extends DomainError {
  readonly code = 'booking.staffEdit.invalid_command' as const;

  constructor(readonly field: string) {
    super(`Invalid staff edit: ${field}`, { field });
  }
}

/**
 * The move would end the visit before the client walked in.
 *
 * A DATA-INTEGRITY refusal, not a scheduling one, and that is why it is its
 * own code rather than a collision or a bad range: nothing about the chair is
 * wrong, but the appointment would be claiming to have finished before it
 * started being attended. The stamp is the fact that cannot move — it was
 * taken from the server's clock when someone actually walked through the
 * door, and it can never be backfilled or corrected.
 */
export class StaffEditBeforeArrivalError extends DomainError {
  readonly code = 'booking.staffEdit.before_arrival' as const;

  constructor(endIso: string, arrivedAtIso: string) {
    super(`A visit cannot end at ${endIso}, before its arrival stamp`, {
      endIso,
      arrivedAtIso,
    });
  }
}

/**
 * Somebody else's booking is in the way — and staff may save anyway.
 *
 * The ONE refusal on this path that is an offer rather than a wall. The sheet
 * relabels its commit «Запази въпреки застъпването» and re-sends with
 * `acknowledgedOverlap`, and the server then keeps that promise. `edge` names
 * which handle caused it on a resize (`start`/`end`) and is absent for a
 * move, which claims the whole interval and cannot blame one side.
 */
export class StaffEditOverlapError extends DomainError {
  readonly code = 'booking.staffEdit.overlaps' as const;

  constructor(
    readonly edge: 'start' | 'end' | null,
    barberId: string,
    startIso: string,
  ) {
    super(`${barberId} is already booked across ${startIso}`, {
      barberId,
      startIso,
      ...(edge ? { edge } : {}),
    });
  }
}

/**
 * The book moved under the sheet.
 *
 * Two people hold one visit open on a Saturday; the second to save must be
 * told rather than allowed to overwrite the first with a screen drawn five
 * minutes ago. The check is opt-in: a caller that sends no `expectedVersion`
 * is not making a claim about what it read, and is not refused for it.
 */
export class StaffEditStaleError extends DomainError {
  readonly code = 'booking.staffEdit.stale' as const;

  constructor(expected: number, actual: number) {
    super(
      `The appointment has moved on: expected ${expected}, found ${actual}`,
      {
        expected: String(expected),
        actual: String(actual),
      },
    );
  }
}

export type StaffEditError =
  | CommitBookingError
  | StaffEditUnauthenticatedError
  | StaffEditForbiddenError
  | StaffEditInvalidCommandError
  | StaffEditBeforeArrivalError
  | StaffEditOverlapError
  | StaffEditStaleError;
