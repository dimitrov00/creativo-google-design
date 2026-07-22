import { describe, expect, it } from 'vitest';
import {
  COMPLETED,
  CONFIRMED,
  NO_SHOW,
  PENDING,
  canTransition,
  cancelled,
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

  it('completed, cancelled, and no_show are terminal', () => {
    expect(isTerminal(COMPLETED)).toBe(true);
    expect(isTerminal(cancelled('x'))).toBe(true);
    expect(isTerminal(NO_SHOW)).toBe(true);
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
    for (const status of [COMPLETED, cancelled('x'), NO_SHOW]) {
      expect(canTransition(status, 'confirmed')).toBe(false);
      expect(canTransition(status, 'completed')).toBe(false);
      expect(canTransition(status, 'cancelled')).toBe(false);
      expect(canTransition(status, 'no_show')).toBe(false);
    }
  });
});
