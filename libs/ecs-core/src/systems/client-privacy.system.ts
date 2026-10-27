import { type BookingContact, type Seat, SeatSubject } from '@core/components';
import { type AppointmentId, CustomerId, type SeatId } from '@core/primitives';
import type {
  Appointment,
  AppointmentPhoto,
  Customer,
  User,
} from '@core/entities';

/**
 * The person a data-subject request is about (audit-hardening Phase 3,
 * WS-C / WS-D): the client RECORD the admin asked for and the account it
 * links (`users/{record.userId}`), `null` when the record links none or the
 * account document is absent. The record's `userId` is the link itself
 * (Law 7.4: an explicit field, never a value shared between the two ids).
 */
export type ClientPerson = {
  readonly record: Customer;
  readonly account: User | null;
};

/**
 * The rules the client export (WS-C) and the erasure (WS-D) share — which
 * part of a stored document is the PERSON'S (audit-hardening Phase 3,
 * P3-RU-18, P3-RU-36, P3-L-11, P3-L-12). Pure (Law 3): documents as stored
 * in, a yes / no or the person's ids out; the keyed digest a walk-in's
 * record id is derived with is a parameter (`WalkInKeyPorts.walkInHash`,
 * never the plain hash — its input is a person's contact). Nothing here
 * reads a value to compare it with the person's: the visit's own contact is
 * recognised by the id it derives, so the rule still answers once the
 * record's values are gone.
 */
export const ClientPrivacySystem = {
  /**
   * Whether every seat of the visit is the person's record — an account
   * seat or a walk-in seat naming `customerId`. An anonymous guest's seat
   * is nobody's record, so a visit holding one is shared; a visit with no
   * seat is nobody's.
   */
  isSoleSubject(visit: Appointment, customerId: CustomerId): boolean {
    const seats = visit.seats;
    if (seats.length === 0) return false;
    for (let i = 0; i < seats.length; i++) {
      if (!isPersonsSeat(seats[i] as Seat, customerId)) return false;
    }
    return true;
  },

  /**
   * The visit's contact key — its phone, or else its e-mail, or `null`
   * when it holds neither: the `CustomerRecordSystem.walkInKey` rule
   * (`phone ?? email`) over the {@link BookingContact} slice as stored, so
   * `CustomerId.forWalkIn` of it is the record a walk-in with this contact
   * was seated under (OR-26). No mapping: the slice is read as it is.
   */
  contactKeyOf(contact: BookingContact): string | null {
    return contact.contactPhone ?? contact.contactEmail ?? null;
  },

  /**
   * Whether the visit's {@link BookingContact} is PROVABLY the person's
   * (P3-L-12, P3-RU-36): the visit's owner is the person's record, or the
   * person's linked account, or the contact derives the person's record
   * under the walk-in key (`CustomerId.forWalkIn(contactKeyOf(visit),
   * walkInHash) === record.id` — a staff booking with no account seats its
   * FIRST walk-in's contact on the visit, `staff-edit-plan.system.ts`). A
   * visit with no contact is nobody's. Sole-subject is NOT an arm: the
   * export withholds a contact it cannot prove (a sole-subject visit may
   * carry a third person's number); the erasure adds that arm on its side.
   */
  contactIsPersons(
    visit: Appointment,
    person: ClientPerson,
    walkInHash: (input: string) => string,
  ): boolean {
    const record = person.record;
    if (visit.ownerCustomerId !== null && visit.ownerCustomerId === record.id) {
      return true;
    }
    if (
      record.userId !== null &&
      visit.ownerUserId !== null &&
      visit.ownerUserId === record.userId
    ) {
      return true;
    }
    const key = ClientPrivacySystem.contactKeyOf(visit);
    return key !== null && CustomerId.forWalkIn(key, walkInHash) === record.id;
  },

  /**
   * The person's own walk-in seats — `seatSubject` WALK_IN naming
   * `customerId` — in seat order: the seats whose label is the person's
   * (an account seat carries no label; an anonymous one is nobody's).
   */
  ownWalkInSeatIds(
    visit: Appointment,
    customerId: CustomerId,
  ): readonly SeatId[] {
    const out: SeatId[] = [];
    const seats = visit.seats;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (
        seat.seatSubject === SeatSubject.WalkIn &&
        seat.subjectCustomerId === customerId
      ) {
        out.push(seat.seatId);
      }
    }
    return out;
  },

  /**
   * Whether a photo is the person's: it names the person's record
   * (`clientCustomerId`, any origin — a library picture on a party visit
   * included), or it names nobody on a visit only the person sat
   * (`soleSubjectVisitIds`, {@link ClientPrivacySystem.isSoleSubject}).
   */
  photoIsPersons(
    photo: AppointmentPhoto,
    soleSubjectVisitIds: ReadonlySet<AppointmentId>,
    customerId: CustomerId,
  ): boolean {
    if (photo.clientCustomerId !== null) {
      return photo.clientCustomerId === customerId;
    }
    return soleSubjectVisitIds.has(photo.appointmentId);
  },
} as const;

/** Whether a seat is the person's record — an account or walk-in seat naming it. */
function isPersonsSeat(seat: Seat, customerId: CustomerId): boolean {
  return (
    seat.seatSubject !== SeatSubject.Anonymous &&
    seat.subjectCustomerId === customerId
  );
}
