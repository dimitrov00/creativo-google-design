import { describe, expect, it } from 'vitest';
import { type UtcEpochMs, WaitlistStatus } from '@core/primitives';
import { unwrapOk, utcMs } from '@core/testing';
import { WaitlistLifecycle } from './waitlist-lifecycle.data';

const T1 = utcMs('2026-09-28T09:00:00+03:00');
const T2 = utcMs('2026-09-28T09:00:01+03:00');
const T3 = utcMs('2026-09-28T09:00:02+03:00');

function moved(
  from: WaitlistLifecycle,
  to: WaitlistStatus,
  atUtcMs: UtcEpochMs,
): WaitlistLifecycle {
  return unwrapOk(WaitlistLifecycle.transition(from, to, atUtcMs));
}

describe('WaitlistLifecycle', () => {
  it('opens watching, stamped', () => {
    expect(WaitlistLifecycle.open(T1)).toEqual({
      waitlistStatus: 'OPEN',
      waitlistStatusAtUtcMs: T1,
    });
  });

  it('goes OPEN → MATCHED → BOOKED', () => {
    const matched = moved(
      WaitlistLifecycle.open(T1),
      WaitlistStatus.Matched,
      T2,
    );
    expect(matched).toEqual({
      waitlistStatus: 'MATCHED',
      waitlistStatusAtUtcMs: T2,
    });
    expect(moved(matched, WaitlistStatus.Booked, T3)).toEqual({
      waitlistStatus: 'BOOKED',
      waitlistStatusAtUtcMs: T3,
    });
  });

  it('reopens a match that went unclaimed', () => {
    const matched = moved(
      WaitlistLifecycle.open(T1),
      WaitlistStatus.Matched,
      T2,
    );
    expect(moved(matched, WaitlistStatus.Open, T3)).toEqual({
      waitlistStatus: 'OPEN',
      waitlistStatusAtUtcMs: T3,
    });
  });

  it('refuses to leave a terminal state', () => {
    for (const terminal of [
      WaitlistStatus.Booked,
      WaitlistStatus.Cancelled,
      WaitlistStatus.Expired,
    ]) {
      const lifecycle = moved(WaitlistLifecycle.open(T1), terminal, T2);
      expect(WaitlistLifecycle.isTerminal(lifecycle)).toBe(true);
      for (const to of Object.values(WaitlistStatus)) {
        expect(WaitlistLifecycle.transition(lifecycle, to, T3)).toEqual({
          ok: false,
          error: {
            errorCode: 'SCHEDULING_WAITLIST_INVALID_TRANSITION',
            from: terminal,
            to,
          },
        });
      }
    }
  });

  it('refuses a move to where it already is', () => {
    expect(
      WaitlistLifecycle.canTransition(
        WaitlistLifecycle.open(T1),
        WaitlistStatus.Open,
      ),
    ).toBe(false);
  });

  it('only watches while OPEN or MATCHED', () => {
    const open = WaitlistLifecycle.open(T1);
    expect(WaitlistLifecycle.isWatching(open)).toBe(true);
    expect(
      WaitlistLifecycle.isWatching(moved(open, WaitlistStatus.Matched, T2)),
    ).toBe(true);
    for (const terminal of [
      WaitlistStatus.Booked,
      WaitlistStatus.Cancelled,
      WaitlistStatus.Expired,
    ]) {
      expect(WaitlistLifecycle.isWatching(moved(open, terminal, T2))).toBe(
        false,
      );
    }
    expect(WaitlistLifecycle.isTerminal(open)).toBe(false);
  });
});
