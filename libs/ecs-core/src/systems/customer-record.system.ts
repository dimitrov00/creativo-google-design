import {
  type BookingCall,
  CustomerOrigin,
  type E164,
  EditCommand,
  type Email,
  ErasureLifecycle,
  RequestedSubjectRole,
  type Seat,
  SeatLabel,
  SeatSubject,
  WriteOp,
} from '@core/components';
import {
  CartLineId,
  CustomerId,
  type OperationId,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type AccountContact,
  Collections,
  type Customer,
  Profile,
} from '@core/entities';
import type { DecisionWalkIn } from './booking-decision.system';
import { SearchFieldsSystem } from './search-fields.system';

/**
 * CustomerRecordSystem — the client RECORD an account gets (D29,
 * flatten-spec §5.3): the body and the create-when-absent decision, lifted
 * out of the booking pipelines' helper (flip 1, F1-5) so every transaction
 * that creates one — a first booking or edit (`FIRST_BOOKING`), a
 * registration (`REGISTRATION`, identity flip (2), F2-7b) — plans it the
 * same way. The pipelines resolve the ids (`CustomerId.forUser(uid, hash)`),
 * read the records inside their transaction and hand this system what they
 * read; it plans, it never reads.
 *
 * And the record a WALK-IN gets (OR-26): a guest the shop seats with a
 * phone or an e-mail is a person the desk will look for again, so the
 * server keeps a record for them at a deterministic id
 * (`CustomerId.forWalkIn` over {@link CustomerRecordSystem.walkInKey}, under
 * the server's keyed digest — the key is a person's contact) — resolved
 * BEFORE the transaction ({@link CustomerRecordSystem.walkInGuests},
 * {@link CustomerRecordSystem.addedWalkIns}), read in its phase-one
 * `getAll`, seated `WALK_IN` by the decision and created when absent
 * ({@link CustomerRecordSystem.walkInCreates}, `STAFF_WALK_IN`). A name
 * alone keys nothing: that guest stays `ANONYMOUS`.
 */

/**
 * A guest the shop keeps a client record for (OR-26): the request line it
 * sits on (a commit's `lineId`, an edit's `seatId`), the record's
 * deterministic id, the label the desk called them by and the contact it
 * took. A `DecisionWalkIn` as it is (the decision seats it by `lineId`).
 */
export type WalkInGuest = DecisionWalkIn & {
  readonly label: SeatLabel;
  readonly phone: E164 | null;
  readonly email: Email | null;
};

/**
 * The walk-in a guest line is, or `null`: a guest with a contact that keys
 * a record (the phone, else the e-mail) and a label the seat rules accept —
 * a label the decision would refuse seats nobody, so it keeps no record.
 */
function walkInOf(
  lineId: CartLineId,
  label: string,
  contact: BookingCall.GuestContact | null,
  keyedHash: (input: string) => string,
): WalkInGuest | null {
  if (contact === null) return null;
  const key = CustomerRecordSystem.walkInKey(contact);
  if (key === null) return null;
  const parsed = SeatLabel.parse(label);
  if (!parsed.ok) return null;
  return {
    lineId,
    customerId: CustomerId.forWalkIn(key, keyedHash),
    label: parsed.value,
    phone: contact.phone,
    email: contact.email,
  };
}

/** No contact for an account (its `users` document is gone): a nameless record, never a guess. */
const NO_CONTACT: AccountContact = {
  firstName: null,
  lastName: null,
  phone: null,
  email: null,
};

export const CustomerRecordSystem = {
  /**
   * The accounts whose record the transaction found ABSENT and for whom no
   * contact snapshot was read yet — in `resolved`'s order. The staff edit
   * reads their contacts OUTSIDE any transaction and runs again, so
   * {@link createsFor} never writes a nameless record for a contact it
   * could have read. A record never read (`undefined` in `stored`) is not
   * absent: nobody is asked for.
   */
  missingContacts(
    resolved: ReadonlyMap<UserId, CustomerId>,
    stored: ReadonlyMap<CustomerId, Customer | null>,
    contacts: ReadonlyMap<UserId, AccountContact>,
  ): readonly UserId[] {
    const missing: UserId[] = [];
    for (const [userId, customerId] of resolved) {
      if (stored.get(customerId) === null && !contacts.has(userId)) {
        missing.push(userId);
      }
    }
    return missing;
  },

  /**
   * The `Create`s of the records the transaction found ABSENT — one per
   * account, at its deterministic path `customers/{customerId}`; a record
   * it read is left alone (no writer ever rewrites somebody's record), and
   * one never read (`undefined` in `stored`) is not absent: nothing is
   * planned for it. Each body is the account's contact as given — the full
   * name as `displayName`, the phone and e-mail, the search keys
   * `SearchFieldsSystem` derives — the `origin` and `nowUtcMs` as its
   * `createdAtUtcMs`, the explicit link `userId`, the writing call's
   * `writeOperationId` (WS-4.3 — the booking verb's operation id, or the
   * registration call's optional one; `null` when it carried none) and no
   * erasure (`erasureStatus: NONE`, P3-L-18).
   */
  createsFor(
    resolved: ReadonlyMap<UserId, CustomerId>,
    stored: ReadonlyMap<CustomerId, Customer | null>,
    contacts: ReadonlyMap<UserId, AccountContact>,
    origin: CustomerOrigin,
    nowUtcMs: UtcEpochMs,
    writeOperationId: OperationId | null,
  ): readonly WriteOp[] {
    const writes: WriteOp[] = [];
    const planned = new Set<CustomerId>();
    for (const [userId, customerId] of resolved) {
      // Read and present (a record), or never read (`undefined`): no create.
      if (planned.has(customerId) || stored.get(customerId) !== null) continue;
      planned.add(customerId);
      const contact = contacts.get(userId) ?? NO_CONTACT;
      const body: Omit<Customer, 'id'> = {
        userId,
        displayName: Profile.fullName(contact),
        phone: contact.phone,
        email: contact.email,
        ...SearchFieldsSystem.searchFields(
          contact.firstName,
          contact.lastName,
          contact.phone,
          contact.email,
        ),
        createdAtUtcMs: nowUtcMs,
        customerOrigin: origin,
        writeOperationId,
        ...ErasureLifecycle.none(),
      };
      writes.push(WriteOp.create([Collections.Customers, customerId], body));
    }
    return writes;
  },

  /**
   * The key a walk-in's record is found by (OR-26) — their E.164 phone, or
   * else their e-mail (canonical: `Email.parse` lower-cases it), or `null`
   * when the contact holds neither. What `CustomerId.forWalkIn` hashes: the
   * same number is the same person, whatever name the desk typed.
   */
  walkInKey(contact: BookingCall.GuestContact): string | null {
    return contact.phone ?? contact.email ?? null;
  },

  /**
   * The walk-ins of a commit's seats — each GUEST line with a contact (and
   * a label the seat rules accept, on a line whose id is one), in seat
   * order, its record's id derived here (`keyedHash` is the pipeline's
   * `WalkInKeyPorts.walkInHash` — never the plain `hash`: the input is a
   * person's contact).
   * Two lines with one contact are two seats of ONE record. What the
   * commit reads in its phase-one `getAll` and hands the decision.
   */
  walkInGuests(
    seats: readonly BookingCall.SeatInput[],
    keyedHash: (input: string) => string,
  ): readonly WalkInGuest[] {
    const out: WalkInGuest[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as BookingCall.SeatInput;
      const subject = seat.subject;
      if (subject.requestedSubjectRole !== RequestedSubjectRole.Guest) continue;
      const lineId = CartLineId.parse(seat.lineId);
      if (!lineId.ok) continue;
      const walkIn = walkInOf(
        lineId.value,
        subject.label,
        subject.contact,
        keyedHash,
      );
      if (walkIn !== null) out.push(walkIn);
    }
    return out;
  },

  /**
   * The walk-ins a staff edit's batch ADDS — each `ADD_SEAT` for a guest
   * with a contact, keyed by the seat id the sheet minted (the decision's
   * line id on an edit), in batch order — its record's id under the same
   * `keyedHash` as {@link CustomerRecordSystem.walkInGuests}.
   */
  addedWalkIns(
    commands: readonly BookingCall.EditCommand[],
    keyedHash: (input: string) => string,
  ): readonly WalkInGuest[] {
    const out: WalkInGuest[] = [];
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i] as BookingCall.EditCommand;
      if (command.editCommand !== EditCommand.AddSeat) continue;
      const subject = command.addedSubject;
      if (subject.requestedSubjectRole !== RequestedSubjectRole.Guest) continue;
      // On an edit a new seat's line id IS the id the sheet minted for it.
      const walkIn = walkInOf(
        CartLineId.of(command.seatId),
        subject.label,
        subject.contact,
        keyedHash,
      );
      if (walkIn !== null) out.push(walkIn);
    }
    return out;
  },

  /**
   * The walk-ins a visit already seats — each `WALK_IN` seat by its own id
   * and its record — so a re-decision (an edit) seats them `WALK_IN` again,
   * never as a stranger by label.
   */
  seatedWalkIns(seats: readonly Seat[]): readonly DecisionWalkIn[] {
    const out: DecisionWalkIn[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seat.seatSubject === SeatSubject.WalkIn) {
        out.push({
          lineId: CartLineId.of(seat.seatId),
          customerId: seat.subjectCustomerId,
        });
      }
    }
    return out;
  },

  /**
   * The walk-ins a client's reschedule carries — each guest line of the new
   * cart whose label a stored `WALK_IN` seat holds, keyed by the line: the
   * cart names its guests by label alone, so a walk-in the shop seated keeps
   * its record through the move instead of turning into a stranger.
   */
  walkInsByLabel(
    stored: readonly Seat[],
    lines: readonly BookingCall.SeatInput[],
  ): readonly DecisionWalkIn[] {
    const out: DecisionWalkIn[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as BookingCall.SeatInput;
      const subject = line.subject;
      if (subject.requestedSubjectRole !== RequestedSubjectRole.Guest) continue;
      const lineId = CartLineId.parse(line.lineId);
      if (!lineId.ok) continue;
      const label = subject.label.trim();
      for (let j = 0; j < stored.length; j++) {
        const seat = stored[j] as Seat;
        if (
          seat.seatSubject === SeatSubject.WalkIn &&
          seat.guestLabel === label
        ) {
          out.push({
            lineId: lineId.value,
            customerId: seat.subjectCustomerId,
          });
          break;
        }
      }
    }
    return out;
  },

  /**
   * The `Create`s of the walk-in records the transaction found ABSENT
   * (OR-26) — one per record, however many seats name it, at its
   * deterministic path; a record it read is left alone (no writer rewrites
   * somebody's record — the name the desk typed this time is the seat's
   * label, not the record's), and one never read (`undefined` in `stored`)
   * is not absent. Each body has no account (`userId: null`), the label as
   * its `displayName`, the phone and the e-mail the desk took, the search
   * keys `SearchFieldsSystem` derives (so the desk finds them again),
   * `nowUtcMs`, `STAFF_WALK_IN`, the staff call's `writeOperationId`
   * (WS-4.3) and no erasure (`erasureStatus: NONE`, P3-L-18).
   */
  walkInCreates(
    guests: readonly WalkInGuest[],
    stored: ReadonlyMap<CustomerId, Customer | null>,
    nowUtcMs: UtcEpochMs,
    writeOperationId: OperationId | null,
  ): readonly WriteOp[] {
    const writes: WriteOp[] = [];
    const planned = new Set<CustomerId>();
    for (let i = 0; i < guests.length; i++) {
      const guest = guests[i] as WalkInGuest;
      if (planned.has(guest.customerId)) continue;
      if (stored.get(guest.customerId) !== null) continue;
      planned.add(guest.customerId);
      const body: Omit<Customer, 'id'> = {
        userId: null,
        displayName: guest.label,
        phone: guest.phone,
        email: guest.email,
        ...SearchFieldsSystem.searchFields(
          guest.label,
          null,
          guest.phone,
          guest.email,
        ),
        createdAtUtcMs: nowUtcMs,
        customerOrigin: CustomerOrigin.StaffWalkIn,
        writeOperationId,
        ...ErasureLifecycle.none(),
      };
      writes.push(
        WriteOp.create([Collections.Customers, guest.customerId], body),
      );
    }
    return writes;
  },
} as const;
