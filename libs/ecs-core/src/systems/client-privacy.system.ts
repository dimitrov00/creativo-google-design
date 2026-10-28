import {
  type BookingContact,
  type ClientPrivacyCall,
  ErasureOffer,
  ErasureStatus,
  Identifier,
  type Seat,
  type SeatOccupant,
  SeatSubject,
} from '@core/components';
import { PrivacyError } from '@core/errors';
import {
  type AppointmentId,
  CustomerId,
  Result,
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
 * never the plain hash — its input is a person's contact). A visit's own
 * contact is recognised by the ids it derives — which still answer once the
 * record's values are gone — and, while the record and the account still
 * hold them, by the person's contact VALUES too (P3-DEP-28: a visit may
 * carry the person's contact without seating them). The erasure's own
 * decisions live in `ClientErasureSystem`; the link, the contact values,
 * the siblings and the offer below are shared by every privacy callable and
 * the admin's card (P3-RU-37 (h), P3-L-7, P3-L-19).
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
   * THE PERSON'S CONTACT VALUES — the record's phone, the record's e-mail,
   * the account's phone and the account's e-mail, each non-null value once,
   * in that order: what the erasure's sweeps find a challenge or a visit
   * contact by (P3-RU-21, P3-DEP-28), what the export finds a visit contact
   * by, and what the sibling records derive from (P3-L-7). `[]` once the
   * stamp has cleared them.
   */
  contactValuesOf(person: ClientPerson): readonly Identifier[] {
    const record = person.record;
    const account = person.account;
    const values: readonly (string | null)[] = [
      record.phone,
      record.email,
      account === null ? null : account.phone,
      account === null ? null : account.email,
    ];
    const out: Identifier[] = [];
    for (let i = 0; i < values.length; i++) {
      const value = values[i] ?? null;
      if (value === null) continue;
      const identifier = Identifier.of(value);
      if (!out.includes(identifier)) out.push(identifier);
    }
    return out;
  },

  /**
   * The walk-in record ids the person's contact values derive (P3-L-7):
   * `CustomerId.forWalkIn` of each of
   * {@link ClientPrivacySystem.contactValuesOf}, in that order, each once —
   * the record itself excluded. Ids only (an admin-only answer): the
   * pipeline reads which of them exist, and the card offers each as its own
   * act; none is ever merged into this person's erasure (two people sharing
   * a phone share a walk-in record, OR-26). `walkInHash` is the keyed digest
   * (`WalkInKeyPorts.walkInHash`) — its input is a contact. Once the stamp
   * has cleared the values, nothing derives: `[]`.
   */
  siblingIdsOf(
    person: ClientPerson,
    walkInHash: (input: string) => string,
  ): readonly CustomerId[] {
    const values = ClientPrivacySystem.contactValuesOf(person);
    const out: CustomerId[] = [];
    for (let i = 0; i < values.length; i++) {
      const id = CustomerId.forWalkIn(values[i] as Identifier, walkInHash);
      if (id !== person.record.id && !out.includes(id)) out.push(id);
    }
    return out;
  },

  /**
   * The sibling records the admin's card keeps after a preview of its OWN
   * record (P3-L-7, Law 10.2): the preview's list while the record is
   * `NONE` — the only state whose contact values still derive one, so even
   * its `[]` replaces the list — else the list the card kept from before
   * the stamp (an `ERASING` or `ERASED` record's preview names none, and its
   * siblings must still be erased from the same card session).
   */
  siblingsAfterPreview(
    kept: readonly CustomerId[],
    preview: ClientPrivacyCall.ErasurePreview,
  ): readonly CustomerId[] {
    return preview.erasureStatus === ErasureStatus.None
      ? preview.erasureSiblingCustomerIds
      : kept;
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
   * Whether the visit's ids PROVE its {@link BookingContact} is the
   * person's — the value-free arms of
   * {@link ClientPrivacySystem.contactIsPersons}, which still answer once
   * the stamp has cleared the person's values: the visit's owner is the
   * person's record, or the person's linked account, or the contact derives
   * the person's record under the walk-in key
   * (`CustomerId.forWalkIn(contactKeyOf(visit), walkInHash) === record.id` —
   * a staff booking with no account seats its FIRST walk-in's contact on
   * the visit, `staff-edit-plan.system.ts`).
   */
  contactProvedById(
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
   * Whether the visit's contact phone or e-mail is one of the person's
   * contact values ({@link ClientPrivacySystem.contactValuesOf}) — exactly
   * what `ListVisitsByContact` finds a visit by (P3-DEP-28). `false` once
   * the stamp has cleared the values. No allocation.
   */
  contactCarriesValueOf(visit: Appointment, person: ClientPerson): boolean {
    return (
      isContactValueOf(person, visit.contactPhone) ||
      isContactValueOf(person, visit.contactEmail)
    );
  },

  /**
   * Whether the visit's {@link BookingContact} is the person's (P3-L-12,
   * P3-RU-36, P3-DEP-28): its ids prove it
   * ({@link ClientPrivacySystem.contactProvedById}), or it carries one of
   * the person's contact values
   * ({@link ClientPrivacySystem.contactCarriesValueOf} — a visit whose
   * booker's seat a staff edit removed keeps the booker's contact). A visit
   * with no contact is nobody's. Sole-subject is NOT an arm: the export
   * withholds a contact it cannot prove (a sole-subject visit may carry a
   * third person's number); the erasure adds that arm on its side.
   */
  contactIsPersons(
    visit: Appointment,
    person: ClientPerson,
    walkInHash: (input: string) => string,
  ): boolean {
    return (
      ClientPrivacySystem.contactProvedById(visit, person, walkInHash) ||
      ClientPrivacySystem.contactCarriesValueOf(visit, person)
    );
  },

  /**
   * THE ONE RULE of the person's own walk-in seat — `seatSubject` WALK_IN
   * naming `customerId`: the seat whose label is the person's (an account
   * seat carries no label; an anonymous one is nobody's). The erasure marks
   * those labels, the export shows them as stored.
   */
  isOwnWalkInSeat(
    seat: Seat,
    customerId: CustomerId,
  ): seat is Seat & SeatOccupant.WalkIn {
    return (
      seat.seatSubject === SeatSubject.WalkIn &&
      seat.subjectCustomerId === customerId
    );
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

  /**
   * Each document once, in the order read — the FIRST read of an id wins
   * (two footprint reads may meet one document). The input untouched.
   */
  distinct<E extends { readonly id: string }>(
    documents: readonly E[],
  ): readonly E[] {
    const seen = new Set<string>();
    const out: E[] = [];
    for (let i = 0; i < documents.length; i++) {
      const document = documents[i] as E;
      if (seen.has(document.id)) continue;
      seen.add(document.id);
      out.push(document);
    }
    return out;
  },
} as const;

/** Whether `value` is one of the person's contact values — the record's or the account's phone or e-mail. */
function isContactValueOf(person: ClientPerson, value: string | null): boolean {
  if (value === null) return false;
  const record = person.record;
  if (value === record.phone || value === record.email) return true;
  const account = person.account;
  return (
    account !== null && (value === account.phone || value === account.email)
  );
}

/** Whether a seat is the person's record — an account or walk-in seat naming it. */
function isPersonsSeat(seat: Seat, customerId: CustomerId): boolean {
  return (
    seat.seatSubject !== SeatSubject.Anonymous &&
    seat.subjectCustomerId === customerId
  );
}
