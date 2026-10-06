import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import {
  Appointment,
  BarberPref,
  COMPLETED,
  CONFIRMED,
  Seat,
  SeatId,
  SeatSubject,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import { InMemoryClientHistoryReader } from '../../testing';
import { CLIENT_HISTORY_READER } from './client-history-reader.port';

const ZONE = 'Europe/Sofia';

function must<T>(result: { isSuccess(): boolean; value?: T }): T {
  if (!result.isSuccess()) throw new Error('bad fixture');
  return result.value as T;
}

function seat(
  userId: string,
  relationship: 'self' | 'companion',
  startIso: string,
): Seat {
  // Company sits in the next chair: one barber cannot take two at once.
  const barberId = must<BarberId>(
    BarberId.create(relationship === 'self' ? 'ivan' : 'niko'),
  );
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(
      must<UserId>(UserId.create(userId)),
      relationship,
    ),
    serviceId: must<ServiceId>(ServiceId.create('svc-fade')),
    variantId: null,
    barberId,
    pref: BarberPref.specific(barberId),
    terms: must<ServiceTerms>(
      ServiceTerms.create(
        must<Money>(Money.fromMinorUnitsAndCode(2500, 'EUR')),
        30,
      ),
    ),
    startsAt: must<ZonedDateTime>(ZonedDateTime.fromISO(startIso, ZONE)),
  });
}

/** A visit starting at `startIso` (Sofia), booked by `booker`, with company when given. */
function visit(
  id: string,
  startIso: string,
  booker: string,
  companion?: string,
): Appointment {
  const seats = [seat(booker, 'self', startIso)];
  if (companion !== undefined)
    seats.push(seat(companion, 'companion', startIso));
  return must<Appointment>(
    Appointment.reconstitute({
      id,
      locationId: 'loc-center',
      seats,
      status: startIso < '2026-09-28' ? COMPLETED : CONFIRMED,
      bookedAt: null,
    }),
  );
}

const ids = (page: { appointments: readonly Appointment[] }) =>
  page.appointments.map((a) => a.id.value);

/**
 * The port's reference reader, held to the port's promises — the ones the
 * Firestore adapter keeps too (its emulator spec): the person's every
 * visit, newest first, a page at a time, never splitting one instant.
 */
describe('ClientHistoryReader — the in-memory reference', () => {
  const history = [
    visit('a-01', '2026-06-02T10:00:00', 'georgi'),
    visit('a-02', '2026-07-01T10:00:00', 'martin', 'georgi'),
    visit('a-03', '2026-08-05T10:00:00', 'georgi'),
    visit('a-04', '2026-09-02T10:00:00', 'martin'),
    visit('a-05', '2026-09-28T10:00:00', 'georgi'),
    visit('a-06', '2026-10-26T10:00:00', 'georgi'),
  ];

  it('names its token', () => {
    expect(CLIENT_HISTORY_READER.toString()).toContain('ClientHistoryReader');
  });

  it('reads every visit with a seat for the person — company included — newest first, upcoming too', async () => {
    const reader = new InMemoryClientHistoryReader(history);
    const page = await reader.pageForSubject('georgi', {
      beforeIso: null,
      limit: 10,
    });
    if (page.isFailure()) throw page.error;
    expect(ids(page.value)).toEqual(['a-06', 'a-05', 'a-03', 'a-02', 'a-01']);
    expect(page.value.nextBeforeIso).toBeNull();
  });

  it('pages by the stored start, strictly before the cursor, until nothing is older', async () => {
    const reader = new InMemoryClientHistoryReader(history);
    const first = await reader.pageForSubject('georgi', {
      beforeIso: null,
      limit: 2,
    });
    if (first.isFailure()) throw first.error;
    expect(ids(first.value)).toEqual(['a-06', 'a-05']);
    expect(first.value.nextBeforeIso).toBe(history[4]?.timeSlot.start.toISO());

    const second = await reader.pageForSubject('georgi', {
      beforeIso: first.value.nextBeforeIso,
      limit: 2,
    });
    if (second.isFailure()) throw second.error;
    expect(ids(second.value)).toEqual(['a-03', 'a-02']);

    const last = await reader.pageForSubject('georgi', {
      beforeIso: second.value.nextBeforeIso,
      limit: 2,
    });
    if (last.isFailure()) throw last.error;
    expect(ids(last.value)).toEqual(['a-01']);
    expect(last.value.nextBeforeIso).toBeNull();
  });

  it('gives no cursor when a page ends exactly on the last visit', async () => {
    const reader = new InMemoryClientHistoryReader(history);
    const page = await reader.pageForSubject('martin', {
      beforeIso: null,
      limit: 2,
    });
    expect(page.isSuccess() && page.value.nextBeforeIso).toBeNull();
  });

  // A visit cancelled and booked again for the same minute: two appointments,
  // one instant. The cursor is an instant, so a page takes both or neither.
  it('keeps visits starting at the same instant on one page', async () => {
    const reader = new InMemoryClientHistoryReader([
      ...history,
      visit('a-05b', '2026-09-28T10:00:00', 'georgi'),
    ]);
    const page = await reader.pageForSubject('georgi', {
      beforeIso: null,
      limit: 2,
    });
    if (page.isFailure()) throw page.error;
    expect(ids(page.value)).toEqual(['a-06', 'a-05b', 'a-05']);
    const next = await reader.pageForSubject('georgi', {
      beforeIso: page.value.nextBeforeIso,
      limit: 2,
    });
    expect(next.isSuccess() && ids(next.value)).toEqual(['a-03', 'a-02']);
  });

  it('reads nothing for a person with no visit', async () => {
    const reader = new InMemoryClientHistoryReader(history);
    const page = await reader.pageForSubject('nobody', {
      beforeIso: null,
      limit: 5,
    });
    expect(page.isSuccess() && page.value).toEqual({
      appointments: [],
      nextBeforeIso: null,
    });
  });

  it('fails while told to, and records every page asked for', async () => {
    const reader = new InMemoryClientHistoryReader(history).failWith();
    const failed = await reader.pageForSubject('georgi', {
      beforeIso: null,
      limit: 5,
    });
    expect(failed.isFailure() && failed.error).toBeInstanceOf(RepositoryError);
    reader.recover();
    expect(
      (
        await reader.pageForSubject('georgi', {
          beforeIso: '2026-09-01',
          limit: 5,
        })
      ).isSuccess(),
    ).toBe(true);
    expect(reader.calls).toEqual([
      { userId: 'georgi', beforeIso: null, limit: 5 },
      { userId: 'georgi', beforeIso: '2026-09-01', limit: 5 },
    ]);
  });
});
