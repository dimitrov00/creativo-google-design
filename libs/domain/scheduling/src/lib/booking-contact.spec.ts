import { describe, expect, it } from 'vitest';
import { BookingContact, MAX_BOOKING_NOTE_LENGTH } from './booking-contact';

const VALID = {
  name: 'Димитър Димитров',
  phone: '+359896330113',
  email: 'dimitar@example.com',
  note: null,
} as const;

describe('BookingContact', () => {
  it('keeps the details it was given, normalized', () => {
    const result = BookingContact.create({ ...VALID, name: '  Емил  ' });
    expect(result.isSuccess()).toBe(true);
    if (result.isFailure()) return;

    expect(result.value.name).toBe('Емил');
    expect(result.value.phone.value).toBe('+359896330113');
    expect(result.value.email?.value).toBe('dimitar@example.com');
    expect(result.value.note).toBeNull();
  });

  it('refuses a nameless booking — the shop calls out a name', () => {
    const result = BookingContact.create({ ...VALID, name: '   ' });
    expect(result.isFailure()).toBe(true);
    if (result.isSuccess()) return;
    expect(result.error.code).toBe('booking.contact.empty_name');
  });

  it('refuses a phone that does not parse', () => {
    const result = BookingContact.create({ ...VALID, phone: '12' });
    expect(result.isFailure()).toBe(true);
    if (result.isSuccess()) return;
    expect(result.error.code).toBe('booking.contact.invalid_phone');
  });

  it('accepts no email at all, but not a broken one', () => {
    const absent = BookingContact.create({ ...VALID, email: null });
    expect(absent.isSuccess()).toBe(true);
    if (absent.isSuccess()) expect(absent.value.email).toBeNull();

    // Whitespace is absence, not a value — a field the user cleared.
    const blank = BookingContact.create({ ...VALID, email: '   ' });
    expect(blank.isSuccess()).toBe(true);
    if (blank.isSuccess()) expect(blank.value.email).toBeNull();

    const broken = BookingContact.create({ ...VALID, email: 'not-an-email' });
    expect(broken.isFailure()).toBe(true);
    if (broken.isFailure()) {
      expect(broken.error.code).toBe('booking.contact.invalid_email');
    }
  });

  it('bounds the note, and treats an empty one as none', () => {
    const empty = BookingContact.create({ ...VALID, note: '   ' });
    expect(empty.isSuccess()).toBe(true);
    if (empty.isSuccess()) expect(empty.value.note).toBeNull();

    const kept = BookingContact.create({
      ...VALID,
      note: ' закъснявам 5 мин ',
    });
    expect(kept.isSuccess()).toBe(true);
    if (kept.isSuccess()) expect(kept.value.note).toBe('закъснявам 5 мин');

    const tooLong = BookingContact.create({
      ...VALID,
      note: 'x'.repeat(MAX_BOOKING_NOTE_LENGTH + 1),
    });
    expect(tooLong.isFailure()).toBe(true);
    if (tooLong.isFailure()) {
      expect(tooLong.error.code).toBe('booking.contact.note_too_long');
    }
  });

  it('round-trips through its persistence shape', () => {
    const created = BookingContact.create({ ...VALID, note: 'без машинка' });
    expect(created.isSuccess()).toBe(true);
    if (created.isFailure()) return;

    const restored = BookingContact.create(created.value.toProps());
    expect(restored.isSuccess()).toBe(true);
    if (restored.isFailure()) return;
    expect(restored.value.equals(created.value)).toBe(true);
  });
});
