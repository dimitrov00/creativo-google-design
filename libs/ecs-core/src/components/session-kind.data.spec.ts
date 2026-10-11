import { describe, expect, it } from 'vitest';
import { SESSION_KINDS, SessionKind, isSessionKind } from './session-kind.data';

describe('SessionKind', () => {
  it('keeps the verifyOtp wire values, upper-snaked (the edge sends them lowercase until flip (2))', () => {
    expect([...SESSION_KINDS]).toEqual(['NEW', 'RETURNING']);
    expect(SessionKind.Returning).toBe('RETURNING');
  });

  it('isSessionKind narrows the tag and rejects strangers', () => {
    expect(isSessionKind('NEW')).toBe(true);
    expect(isSessionKind('RETURNING')).toBe(true);
    expect(isSessionKind('new')).toBe(false);
    expect(isSessionKind('existing')).toBe(false);
    expect(isSessionKind(true)).toBe(false);
  });
});
