import { describe, expect, it } from 'vitest';
import { GuestId, UserId } from '@core/primitives';
import { SeatKey, SeatKeyRole } from './seat-key.data';

const SELF = SeatKey.text(SeatKey.self());
const GUEST = SeatKey.text(SeatKey.guest(GuestId.of('guest-0')));

describe('SeatKey — the cart’s key for a seat', () => {
  it('distinguishes the booker from every guest and companion — the text form is unchanged', () => {
    expect(SELF).toBe('self');
    expect(GUEST).toBe('guest-0');
    expect(SeatKey.text(SeatKey.guest(GuestId.of('guest-1')))).toBe('guest-1');
    expect(SeatKey.text(SeatKey.companion(UserId.of('u1')))).toBe(
      'companion-u1',
    );
  });

  it('parses its own text back, and nothing else', () => {
    for (const key of [
      SeatKey.self(),
      SeatKey.guest(GuestId.of('guest-3')),
      SeatKey.companion(UserId.of('u1')),
    ]) {
      expect(SeatKey.parse(SeatKey.text(key))).toEqual(key);
    }
    for (const raw of ['', 'Self', 'guest-', 'companion-', 'guest3']) {
      expect(SeatKey.parse(raw)).toBeNull();
    }
    expect(SeatKey.self().seatKeyRole).toBe(SeatKeyRole.Self);
    expect(SeatKey.companion(UserId.of('u1'))).toEqual({
      seatKeyRole: 'COMPANION',
      companionUserId: 'u1',
    });
  });

  it('compares by value', () => {
    expect(
      SeatKey.equals(
        SeatKey.guest(GuestId.of('guest-1')),
        SeatKey.guest(GuestId.of('guest-1')),
      ),
    ).toBe(true);
    expect(
      SeatKey.equals(SeatKey.self(), SeatKey.guest(GuestId.of('guest-1'))),
    ).toBe(false);
  });
});
