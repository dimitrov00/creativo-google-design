import { describe, expect, it } from 'vitest';
import { CustomerId, UserId } from '@core/primitives';
import { customerOf, deepFreeze } from '@core/testing';
import { SeatLabel } from './seat-label.data';
import {
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
} from './seat-occupant.data';

const MARIA = UserId.of('u-maria');
const account = SeatOccupant.account(
  MARIA,
  customerOf(MARIA),
  SubjectRelationship.Self,
);
const guest = SeatOccupant.anonymous(SeatLabel.of('Гост'));
const WALK_IN_RECORD = CustomerId.of('cus_0123456789abcdef0123');
const walkIn = SeatOccupant.walkIn(WALK_IN_RECORD, SeatLabel.of('Мария'));

describe('SeatOccupant — who a seat is for', () => {
  it('builds each variant with exactly its fields, and copies one back out', () => {
    expect(account).toEqual({
      seatSubject: SeatSubject.Account,
      subjectUserId: MARIA,
      subjectCustomerId: customerOf(MARIA),
      subjectRelationship: SubjectRelationship.Self,
    });
    expect(guest).toEqual({
      seatSubject: SeatSubject.Anonymous,
      guestLabel: 'Гост',
    });
    expect(
      SeatOccupant.of({ ...account, seatId: 's1' } as SeatOccupant),
    ).toEqual(account);
    expect(SeatOccupant.isContactless(guest)).toBe(true);
    expect(SeatOccupant.isContactless(account)).toBe(false);
  });

  it('builds a walk-in by the record the server keeps and the label the seat shows — no account (OR-26)', () => {
    expect(walkIn).toEqual({
      seatSubject: SeatSubject.WalkIn,
      subjectCustomerId: WALK_IN_RECORD,
      guestLabel: 'Мария',
    });
    expect(walkIn).not.toHaveProperty('subjectUserId');
    // Copied back out to exactly its fields — a whole seat's extras dropped.
    expect(
      SeatOccupant.of({ ...walkIn, seatId: 's1' } as SeatOccupant),
    ).toEqual(walkIn);
    // The shop keeps a phone or an e-mail for them: not contactless.
    expect(SeatOccupant.isContactless(walkIn)).toBe(false);
  });
});

describe('SeatOccupant.fieldFault — the read-time check of a stored occupant (edge hardening D-1)', () => {
  it('answers null for an account seat and a guest seat', () => {
    expect(SeatOccupant.fieldFault(account)).toBeNull();
    expect(SeatOccupant.fieldFault(guest)).toBeNull();
  });

  it('admits a walk-in seat, and names its record when it is no id — its label is display-only (OR-26)', () => {
    expect(SeatOccupant.fieldFault(walkIn)).toBeNull();
    for (const subjectCustomerId of ['', '  ', 'cus/1', '__x__', null, 7]) {
      expect(SeatOccupant.fieldFault({ ...walkIn, subjectCustomerId })).toBe(
        'subjectCustomerId',
      );
    }
    expect(
      SeatOccupant.fieldFault({
        seatSubject: SeatSubject.WalkIn,
        subjectCustomerId: WALK_IN_RECORD,
      }),
    ).toBeNull();
  });

  it('names the account’s ids when they are no ids — the account, then the record', () => {
    for (const subjectUserId of ['', '  ', 'a/b', null, 42]) {
      expect(SeatOccupant.fieldFault({ ...account, subjectUserId })).toBe(
        'subjectUserId',
      );
    }
    for (const subjectCustomerId of ['', 'cus/1', undefined]) {
      expect(SeatOccupant.fieldFault({ ...account, subjectCustomerId })).toBe(
        'subjectCustomerId',
      );
    }
    expect(
      SeatOccupant.fieldFault({
        ...account,
        subjectUserId: '',
        subjectCustomerId: '',
      }),
    ).toBe('subjectUserId');
  });

  it('names seatSubject for anything the dictionary does not hold', () => {
    for (const seatSubject of [
      'GUEST',
      'account',
      'walk_in',
      null,
      undefined,
    ]) {
      expect(SeatOccupant.fieldFault({ ...account, seatSubject })).toBe(
        'seatSubject',
      );
    }
  });

  it('leaves the display-only fields alone — a guest’s label, the relationship', () => {
    expect(
      SeatOccupant.fieldFault({ seatSubject: SeatSubject.Anonymous }),
    ).toBeNull();
    expect(
      SeatOccupant.fieldFault({ ...account, subjectRelationship: 'COUSIN' }),
    ).toBeNull();
  });

  it('is pure: same input → same output, the input untouched', () => {
    const raw = deepFreeze({ ...account, subjectUserId: '' });
    expect(SeatOccupant.fieldFault(raw)).toBe(SeatOccupant.fieldFault(raw));
    expect(raw.subjectUserId).toBe('');
  });
});
