import { describe, expect, it } from 'vitest';
import { SESSION_KINDS, SessionKind, isSessionKind } from './session-kind.data';

describe('SessionKind', () => {
  it('keeps the verifyOtp wire values', () => {
    expect([...SESSION_KINDS]).toEqual(['new', 'returning']);
    expect(SessionKind.Returning).toBe('returning');
  });

  it('isSessionKind narrows the wire value and rejects strangers', () => {
    expect(isSessionKind('new')).toBe(true);
    expect(isSessionKind('returning')).toBe(true);
    expect(isSessionKind('existing')).toBe(false);
    expect(isSessionKind(true)).toBe(false);
  });
});
