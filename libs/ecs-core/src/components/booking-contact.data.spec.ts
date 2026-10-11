import { describe, expect, it } from 'vitest';
import { BookingContact } from './booking-contact.data';
import { E164 } from './phone-number.data';

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
    expect(BookingContact.of(appointment)).toEqual(created.value);
  });
});
