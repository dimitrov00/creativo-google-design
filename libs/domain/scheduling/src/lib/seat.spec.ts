import { ServiceId } from '@creativo/domain/catalog';
import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { SeatId } from './ids';
import { SeatLabel } from './seat-label';
import { Seat, SeatSubject } from './seat';

describe('SeatSubject', () => {
  it('anonymous subjects are contactless', () => {
    const label = SeatLabel.create('Walk-in 14:30');
    if (label.isFailure()) throw new Error('bad fixture');
    const subject = SeatSubject.anonymous(label.value);
    expect(SeatSubject.isContactless(subject)).toBe(true);
  });

  it('account subjects are not contactless', () => {
    const subject = SeatSubject.account(UserId.generate(), 'self');
    expect(SeatSubject.isContactless(subject)).toBe(false);
  });
});

describe('Seat.of', () => {
  it('assembles a seat for an anonymous subject', () => {
    const label = SeatLabel.create('Walk-in 14:30');
    if (label.isFailure()) throw new Error('bad fixture');
    const seat = Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.anonymous(label.value),
      serviceId: ServiceId.generate(),
    });
    expect(seat.isContactless()).toBe(true);
  });

  it('assembles a seat for a registered account subject', () => {
    const seat = Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.account(UserId.generate(), 'companion'),
      serviceId: ServiceId.generate(),
    });
    expect(seat.isContactless()).toBe(false);
    expect(seat.subject.kind).toBe('account');
  });
});
