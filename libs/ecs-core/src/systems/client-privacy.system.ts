import {
  type BookingContact,
  ErasureOffer,
  ErasureStatus,
  type Seat,
  SeatSubject,
} from '@core/components';
import { PrivacyError } from '@core/errors';
import {
  type AppointmentId,
  CustomerId,
  Result,
  type SeatId,
  type UserId,
} from '@core/primitives';
import type {
  Appointment,
  AppointmentPhoto,
  Customer,
  CustomerMeta,
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
 * record's values are gone. The erasure's own decisions live in
 * `ClientErasureSystem`; the first three below are shared by every privacy
 * callable and the admin's card (P3-RU-37 (h), P3-L-7, P3-L-19).
 */
export const ClientPrivacySystem = {
  /**
   * THE ONE D29 LINK CHECK of every privacy callable (P3-L-9, P3-RU-37 (h)):
   * the account the record PROVABLY links — `ok(record.userId)` when
   * `record.id === CustomerId.forUser(record.userId, hash)` (the invariant
   * every account-holder record is created under,
   * `CustomerRecordSystem.createsFor`), `ok(null)` when the record links
   * none (a walk-in), and `PRIVACY_ACCOUNT_LINK_MISMATCH` for a `userId`
   * the id does not derive from — a corrupt or foreign link. The export, the
   * preview and the erasure refuse on it BEFORE any read keyed by the uid,
   * so a broken link never exports or erases another account. `hash` is the
   * pipeline's plain `Hash` port (the record id's own digest), never the
   * walk-in key.
   */
  linkOf(
    record: CustomerMeta,
    hash: (input: string) => string,
  ): Result<UserId | null, PrivacyError.AccountLinkMismatch> {
    const userId = record.userId;
    if (userId === null) return Result.ok(null);
    return CustomerId.forUser(userId, hash) === record.id
      ? Result.ok(userId)
      : Result.err(PrivacyError.accountLinkMismatch());
  },

  /**
   * The walk-in record ids the person's contact values derive (P3-L-7):
   * `CustomerId.forWalkIn` of the record's phone, the record's e-mail, the
   * account's phone and the account's e-mail — each non-null value once, in
   * that order — the record itself excluded. Ids only (an admin-only
   * answer): the pipeline reads which of them exist, and the card offers
   * each as its own act; none is ever merged into this person's erasure (two
   * people sharing a phone share a walk-in record, OR-26). `walkInHash` is
   * the keyed digest (`WalkInKeyPorts.walkInHash`) — its input is a contact.
   * Once the stamp has cleared the values, nothing derives: `[]`.
   */
  siblingIdsOf(
    person: ClientPerson,
    walkInHash: (input: string) => string,
  ): readonly CustomerId[] {
    const record = person.record;
    const account = person.account;
    const keys: readonly (string | null)[] = [
      record.phone,
      record.email,
      account === null ? null : account.phone,
      account === null ? null : account.email,
    ];
    const out: CustomerId[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] ?? null;
      if (key === null) continue;
      const id = CustomerId.forWalkIn(key, walkInHash);
      if (id !== record.id && !out.includes(id)) out.push(id);
    }
    return out;
  },

  /**
   * What the admin's card offers for a record (Law 10.2 — the presenter
   * only words it, P3-L-19): `NONE` → erase, `ERASING` → resume the
   * unfinished erasure, `ERASED` → re-sweep whatever was written since.
   */
  erasureOffer(erasureStatus: ErasureStatus): ErasureOffer {
    switch (erasureStatus) {
      case ErasureStatus.None:
        return ErasureOffer.Erase;
      case ErasureStatus.Erasing:
        return ErasureOffer.Resume;
      case ErasureStatus.Erased:
        return ErasureOffer.Resweep;
    }
  },

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
