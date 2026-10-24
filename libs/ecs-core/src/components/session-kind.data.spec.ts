import { describe, expect, it } from 'vitest';
import { SESSION_KINDS, SessionKind } from './session-kind.data';

describe('SessionKind', () => {
  it('keeps the verifyOtp wire values, upper-snaked', () => {
    expect([...SESSION_KINDS]).toEqual(['NEW', 'RETURNING']);
    expect(SessionKind.Returning).toBe('RETURNING');
  });
});
