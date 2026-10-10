import { Email } from './email.data';
import type { E164 } from './phone-number.data';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';

/**
 * Who the shop calls about THIS booking, and anything they should know first
 * — the stored `appointments.contact` (`booking-contact.ts:13-19`), branded
 * plain strings stored as scalars. A SNAPSHOT, not a pointer to the profile:
 * the number given for a booking is the number the shop dials for it, whatever
 * the profile says two months later. Ownership is NOT in here — `ownerUserId`
 * from the verified token decides who may see or cancel.
 *
 * Registration takes this same component; there is no twin.
 */
export type BookingContact = {
  readonly name: string;
  readonly phone: E164;
  readonly email: Email | null;
  /** At most {@link BookingContact.MAX_NOTE_LENGTH} characters; empty is `null`. */
  readonly note: string | null;
};

export const BookingContact = {
  /** Two SMS worth — a request, not an essay. */
  MAX_NOTE_LENGTH: 200,

  /**
   * The edge guard over raw input. `parsePhone` is the edge's phone parser
   * (`PhoneSystem.parse` → its E.164, or `null`), passed in because a
   * component never imports a system. The name is trimmed and required; an
   * absent or blank email is none, a present-and-broken one is refused (a
   * confirmation nobody receives, silently); a blank note is none.
   */
  create(
    raw: BookingContact.Input,
    parsePhone: (raw: string) => E164 | null,
  ): Result<BookingContact, SchedulingError> {
    const name = raw.name.trim();
    if (name.length === 0)
      return Result.err(SchedulingError.contactEmptyName());

    const phone = parsePhone(raw.phone);
    if (phone === null) {
      return Result.err(SchedulingError.contactInvalidPhone(raw.phone));
    }

    const rawEmail = raw.email === null ? '' : raw.email.trim();
    let email: Email | null = null;
    if (rawEmail.length > 0) {
      email = Email.parse(rawEmail);
      if (email === null) {
        return Result.err(SchedulingError.contactInvalidEmail(rawEmail));
      }
    }

    const note = raw.note === null ? '' : raw.note.trim();
    if (note.length > BookingContact.MAX_NOTE_LENGTH) {
      return Result.err(
        SchedulingError.contactNoteTooLong(BookingContact.MAX_NOTE_LENGTH),
      );
    }

    return Result.ok({
      name,
      phone,
      email,
      note: note.length === 0 ? null : note,
    });
  },

  equals(a: BookingContact, b: BookingContact): boolean {
    return (
      a.name === b.name &&
      a.phone === b.phone &&
      a.email === b.email &&
      a.note === b.note
    );
  },
} as const;

export namespace BookingContact {
  /** The raw fields an edge hands {@link BookingContact.create}. */
  export type Input = {
    readonly name: string;
    readonly phone: string;
    readonly email: string | null;
    readonly note: string | null;
  };
}
