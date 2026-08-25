import { describe, expect, it } from 'vitest';
import {
  COMPLETED,
  CONFIRMED,
  NO_SHOW,
  PENDING,
  canTransition,
  cancelled,
  isSettled,
  isTerminal,
} from './appointment-status';

describe('cancelled()', () => {
  it('structurally carries its reason', () => {
    const status = cancelled('no longer needed');
    expect(status.kind).toBe('cancelled');
    if (status.kind === 'cancelled') {
      expect(status.reason).toBe('no longer needed');
    }
  });
});

describe('isTerminal', () => {
  it('pending and confirmed are non-terminal', () => {
    expect(isTerminal(PENDING)).toBe(false);
    expect(isTerminal(CONFIRMED)).toBe(false);
  });

  it('completed and cancelled are terminal', () => {
    expect(isTerminal(COMPLETED)).toBe(true);
    expect(isTerminal(cancelled('x'))).toBe(true);
  });

  it('no_show is NOT terminal — it carries the correction edge', () => {
    // A no-show is a judgement made at a moment, and the moment it is most
    // often wrong is the ten minutes right after it.
    expect(isTerminal(NO_SHOW)).toBe(false);
  });
});

describe('isSettled', () => {
  it('separates "the visit is over" from "the graph has nowhere to go"', () => {
    // The two were the same set until no_show gained its edge, and readers
    // used them interchangeably — so this split is what stops one new edge
    // from putting no-showed bookings back into clients' upcoming lists.
    expect(isSettled(COMPLETED)).toBe(true);
    expect(isSettled(cancelled('x'))).toBe(true);
    expect(isSettled(NO_SHOW)).toBe(true);
    expect(isSettled(PENDING)).toBe(false);
    expect(isSettled(CONFIRMED)).toBe(false);
  });
});

describe('canTransition — the full lifecycle matrix', () => {
  it('pending can move to confirmed or cancelled only', () => {
    expect(canTransition(PENDING, 'confirmed')).toBe(true);
    expect(canTransition(PENDING, 'cancelled')).toBe(true);
    expect(canTransition(PENDING, 'completed')).toBe(false);
    expect(canTransition(PENDING, 'no_show')).toBe(false);
  });

  it('confirmed can move to completed, cancelled, or no_show', () => {
    expect(canTransition(CONFIRMED, 'completed')).toBe(true);
    expect(canTransition(CONFIRMED, 'cancelled')).toBe(true);
    expect(canTransition(CONFIRMED, 'no_show')).toBe(true);
    expect(canTransition(CONFIRMED, 'confirmed')).toBe(false);
  });

  it('terminal states have no legal outgoing transitions', () => {
    for (const status of [COMPLETED, cancelled('x')]) {
      expect(canTransition(status, 'confirmed')).toBe(false);
      expect(canTransition(status, 'completed')).toBe(false);
      expect(canTransition(status, 'cancelled')).toBe(false);
      expect(canTransition(status, 'no_show')).toBe(false);
    }
  });

  it('no_show can move back to confirmed, and nowhere else', () => {
    expect(canTransition(NO_SHOW, 'confirmed')).toBe(true);
    expect(canTransition(NO_SHOW, 'completed')).toBe(false);
    expect(canTransition(NO_SHOW, 'cancelled')).toBe(false);
    expect(canTransition(NO_SHOW, 'no_show')).toBe(false);
  });

  it('completed stays terminal — a delivered cut cannot be undelivered', () => {
    // Deliberately asymmetric with no_show. A no-show is an assertion about
    // the future that can be falsified minutes later; a completed cut is a
    // fact, and money will hang off it.
    expect(canTransition(COMPLETED, 'confirmed')).toBe(false);
  });
});
