import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { SeatId } from './ids';
import { SeatLabel } from './seat-label';
import { Seat, SeatSubject } from './seat';

const zone = 'Europe/Sofia';

function startOf(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, zone);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function terms(durationMinutes: number, priceMinorUnits = 1500): ServiceTerms {
  const price = Money.fromMinorUnitsAndCode(priceMinorUnits, 'EUR');
  if (price.isFailure()) throw new Error('bad fixture');
  const result = ServiceTerms.create(price.value, durationMinutes);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/** A seat's length now comes from ONE place: its terms. */
function seat(
  overrides: {
    barberId?: BarberId;
    startIso?: string;
    durationMinutes?: number;
    variantId?: ServiceVariantId | null;
  } = {},
): Seat {
  const startsAt = ZonedDateTime.fromISO(
    overrides.startIso ?? '2026-06-01T10:00:00',
    zone,
  );
  if (startsAt.isFailure()) throw new Error('bad fixture');
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(UserId.generate(), 'self'),
    serviceId: ServiceId.generate(),
    variantId: overrides.variantId ?? null,
    barberId: overrides.barberId ?? BarberId.generate(),
    terms: terms(overrides.durationMinutes ?? 30),
    startsAt: startsAt.value,
  });
}

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
    const built = Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.anonymous(label.value),
      serviceId: ServiceId.generate(),
      variantId: null,
      barberId: BarberId.generate(),
      terms: terms(30),
      startsAt: startOf('2026-06-01T10:00:00'),
    });
    expect(built.isContactless()).toBe(true);
  });

  it('assembles a seat for a registered account subject', () => {
    const built = seat();
    expect(built.isContactless()).toBe(false);
    expect(built.subject.kind).toBe('account');
  });

  it('carries the variant chosen within the service', () => {
    const variantId = ServiceVariantId.create('long');
    if (variantId.isFailure()) throw new Error('bad fixture');
    expect(seat({ variantId: variantId.value }).variantId?.value).toBe('long');
  });

  it('DERIVES its slot from the start plus the snapshotted duration', () => {
    // The seat states its length exactly once. A slot that disagreed with
    // the terms used to be representable, and conflict detection and
    // utilisation would then disagree forever with no error anywhere.
    const built = seat({
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    expect(built.durationMinutes()).toBe(45);
    expect(built.slot.durationMinutes()).toBe(45);
    expect(built.slot.end.hour).toBe(10);
    expect(built.slot.end.minute).toBe(45);
    expect(built.endsAt().equals(built.slot.end)).toBe(true);
  });
});

describe('Seat.collidesWith', () => {
  const IVAN = BarberId.generate();
  const NIKO = BarberId.generate();

  it('collides when the same barber has overlapping slots', () => {
    const a = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    const b = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:30:00',
      durationMinutes: 30,
    });
    expect(a.collidesWith(b)).toBe(true);
    expect(b.collidesWith(a)).toBe(true);
  });

  it('does NOT collide when the same barber works back to back', () => {
    // Half-open intervals: 10:45 ends exactly as the next begins.
    const a = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    const b = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:45:00',
      durationMinutes: 30,
    });
    expect(a.collidesWith(b)).toBe(false);
  });

  it('does NOT collide when different barbers work at the same time', () => {
    const a = seat({
      barberId: IVAN,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 45,
    });
    const b = seat({
      barberId: NIKO,
      startIso: '2026-06-01T10:00:00',
      durationMinutes: 30,
    });
    expect(a.collidesWith(b)).toBe(false);
  });
});
