import { Email } from './email.data';
import { Result, StoredFields } from '@core/primitives';
import { SchedulingError } from '@core/errors';
import type { E164 } from './e164.data';

/**
 * Who the shop calls about THIS booking, and anything they should know
 * first — a 1-to-1 slice flat at the root of the `Appointment` archetype
 * (Law 6; was the nested, nullable `contact`, N9). A SNAPSHOT, not a pointer
 * to the profile: the number given for a booking is the number the shop
 * dials for it, whatever the profile says two months later. Ownership is
 * NOT in here — `ownerUserId` from the verified token decides who may see or
 * cancel.
 *
 * Invariant (stated here, kept by {@link BookingContact.create} and
 * {@link BookingContact.NONE}): `contactName === null ⇔ contactPhone ===
 * null` — a contact is present with a name and a phone, or absent with all
 * four fields `null` (a walk-in with nobody to call). Registration takes this
 * same component; there is no twin.
 */
export type BookingContact = {
  readonly contactName: string | null;
  readonly contactPhone: E164 | null;
  readonly contactEmail: Email | null;
  /** At most {@link BookingContact.MAX_NOTE_LENGTH} characters; empty is `null`. */
  readonly contactNote: string | null;
};

const NONE: BookingContact = {
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  contactNote: null,
};

export const BookingContact = {
  /** Two SMS worth — a request, not an essay. */
  MAX_NOTE_LENGTH: 200,

  /** No contact — the walk-in with nobody to call; all four fields `null`. */
  NONE,

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
  ): Result<BookingContact.Present, SchedulingError> {
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
      contactName: name,
      contactPhone: phone,
      contactEmail: email,
      contactNote: note.length === 0 ? null : note,
    });
  },

  /**
   * A present contact with the note the client just typed
   * (`booking-review-step.ts` `saveNote`): trimmed, then cut to
   * {@link BookingContact.MAX_NOTE_LENGTH} — a TRUNCATION, unlike
   * {@link create}, which refuses an over-long note — and a blank one is
   * none (`null`). Everything else of the contact is kept as it is.
   */
  withNote(
    contact: BookingContact.Present,
    raw: string,
  ): BookingContact.Present {
    const note = raw.trim().slice(0, BookingContact.MAX_NOTE_LENGTH);
    return { ...contact, contactNote: note || null };
  },

  /**
   * The read-time check of a stored contact (edge hardening D-1): the NAME
   * of the first of `contactName`, `contactPhone`, `contactEmail`,
   * `contactNote` that is neither a string nor `null`, else `null`. The
   * SHAPE of the phone (E.164) and the e-mail is not re-checked — only a
   * presenter and the call sheet read them, and no system decides on them.
   * No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    if (!StoredFields.isTextOrNull(raw['contactName'])) return 'contactName';
    if (!StoredFields.isTextOrNull(raw['contactPhone'])) return 'contactPhone';
    if (!StoredFields.isTextOrNull(raw['contactEmail'])) return 'contactEmail';
    return StoredFields.isTextOrNull(raw['contactNote']) ? null : 'contactNote';
  },

  /** Is there somebody to call? Narrows to the present contact. */
  isPresent(contact: BookingContact): contact is BookingContact.Present {
    return contact.contactName !== null && contact.contactPhone !== null;
  },

  /** A present contact as the raw fields {@link create} takes — its own input again. */
  inputOf(contact: BookingContact.Present): BookingContact.Input {
    return {
      name: contact.contactName,
      phone: contact.contactPhone,
      email: contact.contactEmail,
      note: contact.contactNote,
    };
  },

  /** The contact slice of a value that carries one (a whole `Appointment`), copied. */
  of(contact: BookingContact): BookingContact {
    return {
      contactName: contact.contactName,
      contactPhone: contact.contactPhone,
      contactEmail: contact.contactEmail,
      contactNote: contact.contactNote,
    };
  },

  equals(a: BookingContact, b: BookingContact): boolean {
    return (
      a.contactName === b.contactName &&
      a.contactPhone === b.contactPhone &&
      a.contactEmail === b.contactEmail &&
      a.contactNote === b.contactNote
    );
  },
} as const;

export namespace BookingContact {
  /** A contact that is there — a name and a phone to dial. */
  export type Present = {
    readonly contactName: string;
    readonly contactPhone: E164;
    readonly contactEmail: Email | null;
    readonly contactNote: string | null;
  };
  /** The raw fields an edge hands {@link BookingContact.create} (foreign input). */
  export type Input = {
    readonly name: string;
    readonly phone: string;
    readonly email: string | null;
    readonly note: string | null;
  };
}
