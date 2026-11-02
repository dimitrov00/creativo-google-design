import { SeatSubject, type Seat, type SeatLabel } from '@core/components';

/*
 * A SEAT'S GUEST LABEL — tag narrowing that reads a field (D-2.1), shared by
 * the row's words, the search's fields and the page's own count of a visit's
 * guests.
 */

/**
 * The labels these seats' guests ride under, seat by seat — a guest's only
 * identity, and what the server's party check tells people apart by
 * (`personKey`).
 */
export function guestLabelsOf(seats: readonly Seat[]): string[] {
  return seats.flatMap((seat) => {
    const guestLabel = guestLabelOf(seat);
    return guestLabel === null ? [] : [guestLabel];
  });
}

/**
 * The label a seat's subject rides under: an anonymous guest's, and a
 * walk-in's — the label the desk gave them on this visit, their record
 * (OR-26) keeping its own name — or `null` for an account, which is named
 * by the contact or its profile. Every `SeatSubject` answers here, so a new
 * one is a compile error until it does.
 */
export function guestLabelOf(seat: Seat): SeatLabel | null {
  switch (seat.seatSubject) {
    case SeatSubject.Anonymous:
    case SeatSubject.WalkIn:
      return seat.guestLabel;
    case SeatSubject.Account:
      return null;
  }
}
