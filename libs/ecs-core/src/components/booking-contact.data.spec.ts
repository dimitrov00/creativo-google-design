import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { BookingContact } from './booking-contact.data';
import { E164 } from './e164.data';

/**
 * A stand-in for the edge's `PhoneSystem.parse`: E.164-shaped input only.
 * The component never parses phones itself — a `*.data.ts` imports no system.
 */
const parsePhone = (raw: string): E164 | null => {
  const trimmed = raw.replace(/\s+/g, '');
  return /^\+[1-9]\d{7,14}$/.test(trimmed) ? E164.of(trimmed) : null;
};

const VALID: BookingContact.Input = {
  name: 'Димитър Димитров',
  phone: '+359896330113',
  email: 'dimitar@example.com',
  note: null,
};

describe('BookingContact.create', () => {
  it('keeps the details it was given, normalized', () => {
    const result = BookingContact.create(
      { ...VALID, name: '  Емил  ', email: ' Dimitar@Example.com ' },
      parsePhone,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        contactName: 'Емил',
        contactPhone: '+359896330113',
        contactEmail: 'dimitar@example.com',
        contactNote: null,
      },
    });
  });

  it('refuses a nameless booking — the shop calls out a name', () => {
    const result = BookingContact.create({ ...VALID, name: '   ' }, parsePhone);
    expect(!result.ok && result.error.errorCode).toBe(
      'SCHEDULING_BOOKING_CONTACT_EMPTY_NAME',
    );
  });

  it('refuses a phone that does not parse, naming the raw value', () => {
    const result = BookingContact.create({ ...VALID, phone: '12' }, parsePhone);
    expect(result).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_BOOKING_CONTACT_INVALID_PHONE',
        rawValue: '12',
      },
    });
  });

  it('accepts no email at all, but not a broken one', () => {
    const absent = BookingContact.create({ ...VALID, email: null }, parsePhone);
    expect(absent.ok && absent.value.contactEmail).toBeNull();

    // Whitespace is absence, not a value — a field the user cleared.
    const blank = BookingContact.create({ ...VALID, email: '   ' }, parsePhone);
    expect(blank.ok && blank.value.contactEmail).toBeNull();

    const broken = BookingContact.create(
      { ...VALID, email: 'not-an-email' },
      parsePhone,
    );
    expect(broken).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL',
        rawValue: 'not-an-email',
      },
    });
  });

  it('bounds the note, and treats an empty one as none', () => {
    const empty = BookingContact.create({ ...VALID, note: '   ' }, parsePhone);
    expect(empty.ok && empty.value.contactNote).toBeNull();

    const kept = BookingContact.create(
      { ...VALID, note: ' закъснявам 5 мин ' },
      parsePhone,
    );
    expect(kept.ok && kept.value.contactNote).toBe('закъснявам 5 мин');

    const atLimit = BookingContact.create(
      { ...VALID, note: 'x'.repeat(BookingContact.MAX_NOTE_LENGTH) },
      parsePhone,
    );
    expect(atLimit.ok).toBe(true);

    const tooLong = BookingContact.create(
      { ...VALID, note: 'x'.repeat(BookingContact.MAX_NOTE_LENGTH + 1) },
      parsePhone,
    );
    expect(tooLong).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_BOOKING_CONTACT_NOTE_TOO_LONG',
        maxLength: 200,
      },
    });
  });

  it('round-trips through its stored shape — the slice is its own input again', () => {
    const created = BookingContact.create(
      { ...VALID, note: 'без машинка' },
      parsePhone,
    );
    if (!created.ok) throw new Error('bad fixture');
    const restored = BookingContact.create(
      BookingContact.inputOf(created.value),
      parsePhone,
    );
    if (!restored.ok) throw new Error('expected a contact');
    expect(BookingContact.equals(restored.value, created.value)).toBe(true);
  });

  it('equals compares every field', () => {
    const created = BookingContact.create(VALID, parsePhone);
    if (!created.ok) throw new Error('bad fixture');
    const contact = created.value;
    expect(
      BookingContact.equals(contact, { ...contact, contactNote: 'x' }),
    ).toBe(false);
    expect(
      BookingContact.equals(contact, { ...contact, contactEmail: null }),
    ).toBe(false);
    expect(
      BookingContact.equals(contact, { ...contact, contactName: 'Иван' }),
    ).toBe(false);
    expect(
      BookingContact.equals(contact, {
        ...contact,
        contactPhone: E164.of('+359888000000'),
      }),
    ).toBe(false);
  });
});

describe('BookingContact.NONE / isPresent / of', () => {
  it('is absent with all four fields null together', () => {
    expect(BookingContact.NONE).toEqual({
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      contactNote: null,
    });
    expect(BookingContact.isPresent(BookingContact.NONE)).toBe(false);
  });

  it('is present once created, and copies itself out of a carrier', () => {
    const created = BookingContact.create(VALID, parsePhone);
    if (!created.ok) throw new Error('bad fixture');
    expect(BookingContact.isPresent(created.value)).toBe(true);
    const appointment = { ...created.value, bookingStatus: 'CONFIRMED' };
    expect(BookingContact.sliceOf(appointment)).toEqual(created.value);
  });
});

describe('BookingContact.withNote — the note the client just typed', () => {
  const present = (): BookingContact.Present => {
    const created = BookingContact.create(VALID, parsePhone);
    if (!created.ok) throw new Error('bad fixture');
    return created.value;
  };

  it('keeps the note trimmed and the rest of the contact as it is', () => {
    expect(BookingContact.withNote(present(), '  ring the bell  ')).toEqual({
      ...present(),
      contactNote: 'ring the bell',
    });
  });

  it('reads a blank note as none', () => {
    const noted = BookingContact.withNote(present(), 'old');
    expect(BookingContact.withNote(noted, '   ').contactNote).toBeNull();
    expect(BookingContact.withNote(noted, '').contactNote).toBeNull();
  });

  it('cuts an over-long note at the limit — a truncation, where create refuses', () => {
    const long = 'я'.repeat(BookingContact.MAX_NOTE_LENGTH + 20);
    const noted = BookingContact.withNote(present(), `  ${long}`);
    expect(noted.contactNote).toBe('я'.repeat(BookingContact.MAX_NOTE_LENGTH));
    expect(
      BookingContact.withNote(
        present(),
        'я'.repeat(BookingContact.MAX_NOTE_LENGTH),
      ).contactNote?.length,
    ).toBe(BookingContact.MAX_NOTE_LENGTH);
  });

  it('trims BEFORE the cut — the cut may leave inner spaces it does not trim again', () => {
    const raw = `${'a'.repeat(BookingContact.MAX_NOTE_LENGTH - 1)}  b`;
    expect(BookingContact.withNote(present(), raw).contactNote).toBe(
      `${'a'.repeat(BookingContact.MAX_NOTE_LENGTH - 1)} `,
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const contact = deepFreeze(present());
    expect(BookingContact.withNote(contact, ' x ')).toEqual(
      BookingContact.withNote(contact, ' x '),
    );
    expect(contact.contactNote).toBeNull();
  });
});

describe('BookingContact.fieldFault — the read-time check of a stored contact (edge hardening D-1)', () => {
  const present = {
    contactName: 'Георги',
    contactPhone: E164.of('+359888123456'),
    contactEmail: null,
    contactNote: 'по-късно',
  };

  it('answers null for no contact and for a present one', () => {
    expect(BookingContact.fieldFault(BookingContact.NONE)).toBeNull();
    expect(BookingContact.fieldFault(present)).toBeNull();
  });

  it('names each field that is neither a string nor null, in field order', () => {
    for (const field of [
      'contactName',
      'contactPhone',
      'contactEmail',
      'contactNote',
    ] as const) {
      expect(BookingContact.fieldFault({ ...present, [field]: 42 })).toBe(
        field,
      );
      expect(
        BookingContact.fieldFault({ ...present, [field]: undefined }),
      ).toBe(field);
    }
    expect(
      BookingContact.fieldFault({ ...present, contactName: 1, contactNote: 2 }),
    ).toBe('contactName');
  });

  it('never re-checks the phone’s or the e-mail’s shape — no system decides on them', () => {
    expect(
      BookingContact.fieldFault({ ...present, contactPhone: 'call me' }),
    ).toBeNull();
  });

  it('is pure: same input → same output, the input untouched', () => {
    const raw = deepFreeze({ ...present, contactNote: 7 });
    expect(BookingContact.fieldFault(raw)).toBe(BookingContact.fieldFault(raw));
    expect(raw.contactNote).toBe(7);
  });
});
