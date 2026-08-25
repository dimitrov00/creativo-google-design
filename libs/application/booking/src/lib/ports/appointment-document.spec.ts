import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceTerms,
} from '@creativo/domain/catalog';
import {
  Appointment,
  COMPLETED,
  CONFIRMED,
  PENDING,
  Seat,
  SeatId,
  SeatSubject,
  cancelled,
  seatCancelled,
  seatNoShow,
  seatWorked,
} from '@creativo/domain/scheduling';
import {
  appointmentToDocument,
  bookedAtFromDocument,
  seatOutcomeFromDocument,
  seatOutcomeToDocument,
} from './appointment-document';

const ZONE = 'Europe/Sofia';
const RESOLVED_AT_MS = Date.UTC(2026, 7, 5, 9, 0, 0);

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, ZONE);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function terms(): ServiceTerms {
  const price = Money.fromMinorUnitsAndCode(1500, 'EUR');
  if (price.isFailure()) throw new Error('bad fixture');
  const result = ServiceTerms.create(price.value, 30);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function seat(): Seat {
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(UserId.generate(), 'self'),
    serviceId: ServiceId.generate(),
    variantId: null,
    barberId: BarberId.generate(),
    terms: terms(),
    startsAt: at('2026-06-01T10:00:00'),
  });
}

function appointment(now = at('2026-05-01T09:00:00')): Appointment {
  const result = Appointment.create({
    id: 'appointment-2',
    locationId: LocationId.generate().toString(),
    seats: [seat()],
    now,
    bookedFromAppointmentId: 'appointment-1',
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('appointmentToDocument — write-time captures', () => {
  it('writes the booking instant with the zone that makes it renderable', () => {
    const now = at('2026-05-01T09:00:00');
    const document = appointmentToDocument(appointment(now));
    expect(document['bookedAt']).toEqual({
      iso: now.toISO(),
      zone: ZONE,
    });
  });

  it('writes the rebooking edge', () => {
    expect(
      appointmentToDocument(appointment())['bookedFromAppointmentId'],
    ).toBe('appointment-1');
  });

  it('round-trips the booking instant', () => {
    const now = at('2026-05-01T09:00:00');
    const document = appointmentToDocument(appointment(now));
    expect(bookedAtFromDocument(document)?.toMillis()).toBe(now.toMillis());
  });

  it('reads a missing booking instant as null rather than inventing one', () => {
    expect(bookedAtFromDocument({})).toBeNull();
    expect(bookedAtFromDocument({ bookedAt: 'nonsense' })).toBeNull();
    expect(
      bookedAtFromDocument({ bookedAt: { iso: 'nope', zone: ZONE } }),
    ).toBeNull();
  });

  it('writes a per-seat outcome for every seat', () => {
    const document = appointmentToDocument(appointment());
    const seats = document['seats'] as readonly Record<string, unknown>[];
    expect(seats[0]?.['outcome']).toEqual({ kind: 'scheduled' });
  });
});

describe('seatOutcome persistence', () => {
  const END_MS = at('2026-06-01T10:30:00').toMillis();

  it('round-trips every arm', () => {
    const cases = [
      seatWorked(RESOLVED_AT_MS),
      seatNoShow(RESOLVED_AT_MS),
      seatCancelled(RESOLVED_AT_MS, 'client', { kind: 'client_unwell' }),
      seatCancelled(RESOLVED_AT_MS, 'staff', {
        kind: 'other',
        note: 'barber called in sick',
      }),
    ];
    for (const outcome of cases) {
      expect(
        seatOutcomeFromDocument(
          seatOutcomeToDocument(outcome),
          CONFIRMED,
          END_MS,
        ),
      ).toEqual(outcome);
    }
  });

  it('reads a stored scheduled outcome as scheduled even on a finished visit', () => {
    expect(
      seatOutcomeFromDocument({ kind: 'scheduled' }, COMPLETED, END_MS).kind,
    ).toBe('scheduled');
  });

  /**
   * The legacy path: rows written before outcomes existed have no `outcome`
   * field at all, and leaving them `scheduled` would make every historical
   * visit read as unfinished business.
   */
  it('derives a missing outcome from a terminal root status', () => {
    expect(seatOutcomeFromDocument(undefined, COMPLETED, END_MS)).toEqual({
      kind: 'worked',
      atMs: END_MS,
    });
    expect(
      seatOutcomeFromDocument(undefined, cancelled('shop closed'), END_MS),
    ).toEqual({
      kind: 'cancelled',
      atMs: END_MS,
      by: 'staff',
      reason: { kind: 'other', note: 'shop closed' },
    });
  });

  it('leaves a missing outcome scheduled while the visit is still open', () => {
    expect(seatOutcomeFromDocument(undefined, PENDING, END_MS)).toEqual({
      kind: 'scheduled',
    });
    expect(seatOutcomeFromDocument(undefined, undefined, END_MS)).toEqual({
      kind: 'scheduled',
    });
  });

  it('falls back to the derivation when the stored outcome is malformed', () => {
    expect(
      seatOutcomeFromDocument({ kind: 'worked' }, COMPLETED, END_MS),
    ).toEqual({ kind: 'worked', atMs: END_MS });
    expect(
      seatOutcomeFromDocument({ kind: 'nonsense', atMs: 1 }, PENDING, END_MS)
        .kind,
    ).toBe('scheduled');
  });

  /**
   * Forward compatibility: a code this build does not know about must survive
   * a read rather than be silently flattened to a generic cancellation.
   */
  it('preserves an unrecognised cancellation code in the note', () => {
    const outcome = seatOutcomeFromDocument(
      {
        kind: 'cancelled',
        atMs: RESOLVED_AT_MS,
        by: 'client',
        reason: { kind: 'weather' },
      },
      CONFIRMED,
      END_MS,
    );
    expect(outcome.kind).toBe('cancelled');
    if (outcome.kind === 'cancelled') {
      expect(outcome.reason).toEqual({ kind: 'other', note: 'weather' });
    }
  });
});
