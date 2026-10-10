import { describe, expect, it } from 'vitest';
import { WaitlistState, WaitlistStatus } from './waitlist-status.data';

function moved(
  from: WaitlistStatus,
  to: WaitlistState,
  atMs: number,
): WaitlistStatus {
  const result = WaitlistStatus.transition(from, to, atMs);
  if (!result.ok) throw new Error(`unexpected refusal ${from.kind} → ${to}`);
  return result.value;
}

describe('WaitlistStatus', () => {
  it('opens watching, stamped', () => {
    expect(WaitlistStatus.open(1)).toEqual({ kind: 'open', atMs: 1 });
  });

  it('goes open → matched → booked', () => {
    const matched = moved(WaitlistStatus.open(1), WaitlistState.Matched, 2);
    expect(matched).toEqual({ kind: 'matched', atMs: 2 });
    expect(moved(matched, WaitlistState.Booked, 3)).toEqual({
      kind: 'booked',
      atMs: 3,
    });
  });

  it('reopens a match that went unclaimed', () => {
    const matched = moved(WaitlistStatus.open(1), WaitlistState.Matched, 2);
    expect(moved(matched, WaitlistState.Open, 3)).toEqual({
      kind: 'open',
      atMs: 3,
    });
  });

  it('refuses to leave a terminal state', () => {
    for (const terminal of [
      WaitlistState.Booked,
      WaitlistState.Cancelled,
      WaitlistState.Expired,
    ]) {
      const status = moved(WaitlistStatus.open(1), terminal, 2);
      expect(WaitlistStatus.isTerminal(status)).toBe(true);
      for (const to of Object.values(WaitlistState)) {
        expect(WaitlistStatus.transition(status, to, 3)).toEqual({
          ok: false,
          error: {
            code: 'scheduling.waitlist.invalid_transition',
            from: terminal,
            to,
          },
        });
      }
    }
  });

  it('refuses a move to where it already is', () => {
    expect(
      WaitlistStatus.canTransition(WaitlistStatus.open(1), WaitlistState.Open),
    ).toBe(false);
  });

  it('only watches while open or matched', () => {
    const open = WaitlistStatus.open(1);
    expect(WaitlistStatus.isWatching(open)).toBe(true);
    expect(
      WaitlistStatus.isWatching(moved(open, WaitlistState.Matched, 2)),
    ).toBe(true);
    for (const terminal of [
      WaitlistState.Booked,
      WaitlistState.Cancelled,
      WaitlistState.Expired,
    ]) {
      expect(WaitlistStatus.isWatching(moved(open, terminal, 2))).toBe(false);
    }
    expect(WaitlistStatus.isTerminal(open)).toBe(false);
  });
});
