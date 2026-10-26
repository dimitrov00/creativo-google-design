import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { DayWindows, MinuteRange, WaitlistLifecycle } from '@core/components';
import { WaitlistRequestId, WaitlistStatus } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { Collections, type WaitlistRequest } from '@core/entities';
import {
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  minute,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreWaitlistPorts } from './firestore-waitlist.adapter';

/*
 * The waitlist's server read, over the in-memory Admin SDK: the requests
 * still OPEN on a day (`waitlistStatus ==` ∧ `localDates array-contains`,
 * index #14) — bodies as stored. The read of one request by id is gone
 * (OR-28: no caller).
 */

const MONDAY = localDate('2026-09-28');
const TUESDAY = localDate('2026-09-29');

function requestOf(
  id: string,
  days: readonly (typeof MONDAY)[],
  status: WaitlistStatus = WaitlistStatus.Open,
): WaitlistRequest {
  return {
    id: WaitlistRequestId.of(id),
    ownerUserId: FIXTURE_IDS.client,
    locationId: null,
    localDates: days,
    utcEpochMs: FIXTURE_NOW_UTC_MS,
    createdAtUtcMs: FIXTURE_NOW_UTC_MS,
    cartSeats: [],
    cartNextSequence: 0,
    flexibleDays: days.map((day) =>
      DayWindows.of(day, [MinuteRange.of(minute(600), endMinute(720))]),
    ),
    ...WaitlistLifecycle.open(FIXTURE_NOW_UTC_MS),
    waitlistStatus: status,
  };
}

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const open = requestOf('wl_open', [MONDAY, TUESDAY]);
const elsewhere = requestOf('wl_tuesday', [TUESDAY]);
const matched = requestOf('wl_matched', [MONDAY], WaitlistStatus.Matched);

function seeded() {
  return createProjectionFirestore(
    Object.fromEntries(
      [open, elsewhere, matched].map((request) => [
        `${Collections.WaitlistRequests}/${request.id}`,
        bodyOf(request),
      ]),
    ),
  );
}

describe('firestoreWaitlistPorts', () => {
  it('reads the requests still OPEN that name the day — nothing matched, nothing for another day', async () => {
    const ports = firestoreWaitlistPorts(seeded().db as unknown as Firestore);
    expect(await ports.loadOpenWaitlist(MONDAY)).toEqual({
      ok: true,
      value: [open],
    });
  });

  it('builds the open-requests read alone — no read of one request by id (OR-28)', () => {
    const ports = firestoreWaitlistPorts(seeded().db as unknown as Firestore);
    expect(Object.keys(ports)).toEqual(['loadOpenWaitlist']);
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const fake = seeded();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    });
    const ports = firestoreWaitlistPorts(fake.db as unknown as Firestore);
    expect(await ports.loadOpenWaitlist(MONDAY)).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.WaitlistRequests,
        'unavailable',
      ),
    });
  });
});
