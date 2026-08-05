import { PhoneNumber, Result, fail, ok } from '@creativo/domain/kernel';
import { Email } from '@creativo/domain/accounts';
import {
  type BookingContactError,
  BookingContactEmptyNameError,
  BookingContactInvalidEmailError,
  BookingContactInvalidPhoneError,
  BookingContactNoteTooLongError,
} from './booking-contact.errors';

/** What a note may run to. Two SMS worth — a request, not an essay. */
export const MAX_BOOKING_NOTE_LENGTH = 200;

export interface BookingContactProps {
  readonly name: string;
  /** E.164 — the same form the account stores. */
  readonly phone: string;
  readonly email: string | null;
  readonly note: string | null;
}

/**
 * Who the shop calls about THIS booking, and anything they should know first.
 *
 * ### Why the appointment carries its own contact
 * It is a SNAPSHOT, not a pointer to the profile. The number given for a
 * booking is the number the shop dials for that booking: if the client
 * changes their profile phone two months later, September's appointment must
 * not silently re-point at a number nobody gave for it. It is also what lets
 * a person book on a colleague's phone, or give the landline of the office
 * they will be at — without editing who they are.
 *
 * Ownership is NOT in here. `ownerUserId` (from the verified token) remains
 * the only thing that decides who may see or cancel an appointment; these
 * fields are contact details, and a caller choosing them changes nothing
 * about authority.
 *
 * ### The note is part of the same object
 * It is captured in the same breath, it is written once and read once, and
 * it has the same lifetime. Splitting it into its own aggregate field would
 * mean two nullable things that are only ever set together.
 */
export class BookingContact {
  private constructor(
    readonly name: string,
    readonly phone: PhoneNumber,
    readonly email: Email | null,
    readonly note: string | null,
  ) {}

  static create(
    props: BookingContactProps,
  ): Result<BookingContact, BookingContactError> {
    const name = props.name.trim();
    if (name.length === 0) return fail(new BookingContactEmptyNameError());

    const phoneResult = PhoneNumber.create(props.phone);
    if (phoneResult.isFailure()) {
      return fail(new BookingContactInvalidPhoneError(props.phone));
    }

    // Absent is fine; present-and-broken is not. An address that fails to
    // parse would be a confirmation nobody receives, silently.
    let email: Email | null = null;
    const rawEmail = props.email?.trim() ?? '';
    if (rawEmail.length > 0) {
      const emailResult = Email.create(rawEmail);
      if (emailResult.isFailure()) {
        return fail(new BookingContactInvalidEmailError(rawEmail));
      }
      email = emailResult.value;
    }

    const note = props.note?.trim() ?? '';
    if (note.length > MAX_BOOKING_NOTE_LENGTH) {
      return fail(new BookingContactNoteTooLongError(MAX_BOOKING_NOTE_LENGTH));
    }

    return ok(new BookingContact(name, phoneResult.value, email, note || null));
  }

  /** The persistence/wire shape — primitives, both SDKs can produce it. */
  toProps(): BookingContactProps {
    return {
      name: this.name,
      phone: this.phone.value,
      email: this.email?.value ?? null,
      note: this.note,
    };
  }

  equals(other: BookingContact): boolean {
    return (
      this.name === other.name &&
      this.phone.equals(other.phone) &&
      (this.email?.value ?? null) === (other.email?.value ?? null) &&
      this.note === other.note
    );
  }
}
