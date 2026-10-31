import { describe, expect, it } from 'vitest';
import { DayWindows, MinuteRange, WriteOp } from '@core/components';
import {
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
  WaitlistStatus,
} from '@core/primitives';
import { CancelWaitlistRefusalCode } from '@core/errors';
import { Collections, type WaitlistRequest } from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';
import {
  bodyOf,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  localDate,
  memoryStore,
  memoryTxPorts,
  minute,
  unwrapOk,
} from '@core/testing';
import { cancelWaitlist } from './cancel-waitlist.pipeline';

/*
 * Withdrawing a waitlist request (`cancel-waitlist.ts`): one transaction,
 * one `CANCELLED` transition (`WriteOp.transition` — the lifecycle slice
 * has no variant fields, so nothing is deleted), idempotent on a request
 * already cancelled, and not-found and not-yours answering alike.
 */

const REQUEST = WaitlistRequestId.of('wl_request');
const PATH = [Collections.WaitlistRequests, REQUEST];
const DAY = localDate('2026-09-30');
const EARLIER = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -3_600_000);

function requestWith(status: WaitlistStatus): WaitlistRequest {
  return {
    id: REQUEST,
    ownerUserId: FIXTURE_IDS.client,
    locationId: null,
    localDates: [DAY],
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(DAY, FIXTURE_TIME_ZONE),
    createdAtUtcMs: EARLIER,
    cartSeats: [],
    cartNextSequence: 0,
    flexibleDays: [
      DayWindows.of(DAY, [MinuteRange.of(minute(600), endMinute(720))]),
    ],
    waitlistStatus: status,
    waitlistStatusAtUtcMs: EARLIER,
  };
}

function rig(stored: WaitlistRequest | null) {
  const store = memoryStore(
    stored === null ? [] : [{ path: PATH, body: bodyOf(stored) }],
  );
  const tx = memoryTxPorts(store);
  return { store, tx, run: cancelWaitlist(tx) };
}

const mine = { ownerUserId: FIXTURE_IDS.client, requestId: REQUEST };

describe('cancelWaitlist', () => {
  it.each([WaitlistStatus.Open, WaitlistStatus.Matched])(
    'withdraws a %s request: ONE transition to CANCELLED, stamped now, nothing to delete',
    async (status) => {
      const { tx, store, run } = rig(requestWith(status));
      const answer = await run(mine);
      expect(answer).toEqual({
        ok: true,
        value: { requestId: REQUEST },
      });
      // The callable answers this value as it is (Law 5 — no wire encoder):
      // exactly these keys, in this order, byte for byte on the wire.
      expect(Object.keys(unwrapOk(answer))).toEqual(['requestId']);
      expect(tx.plans).toEqual([
        [
          WriteOp.transition(
            PATH,
            {
              waitlistStatus: WaitlistStatus.Cancelled,
              waitlistStatusAtUtcMs: FIXTURE_NOW_UTC_MS,
            },
            [],
          ),
        ],
      ]);
      expect(store.get(PATH.join('/'))?.['waitlistStatus']).toBe(
        WaitlistStatus.Cancelled,
      );
      expect(tx.transactions[0]?.reads).toEqual([PATH]);
    },
  );

  it('answers success for a request already cancelled, and writes nothing', async () => {
    const { tx, store, run } = rig(requestWith(WaitlistStatus.Cancelled));
    const before = store.get(PATH.join('/'));
    expect(await run(mine)).toEqual({
      ok: true,
      value: { requestId: REQUEST },
    });
    expect(tx.plans).toEqual([[]]);
    expect(store.get(PATH.join('/'))).toBe(before);
  });

  it('answers not-found for a request that is not there, and for one that is not the caller’s — alike', async () => {
    const missing = await rig(null).run(mine);
    const foreign = await rig(requestWith(WaitlistStatus.Open)).run({
      ...mine,
      ownerUserId: UserId.of('u-someone-else'),
    });
    const notFound = {
      ok: false,
      error: { errorCode: CancelWaitlistRefusalCode.NotFound },
    };
    expect(missing).toEqual(notFound);
    expect(foreign).toEqual(notFound);
  });

  it.each([WaitlistStatus.Booked, WaitlistStatus.Expired])(
    'refuses to rewrite a %s request — the matcher’s terminal verdict stands',
    async (status) => {
      const { tx, run } = rig(requestWith(status));
      expect(await run(mine)).toEqual({
        ok: false,
        error: { errorCode: CancelWaitlistRefusalCode.NotCancellable },
      });
      expect(tx.plans).toEqual([]);
    },
  );
});
