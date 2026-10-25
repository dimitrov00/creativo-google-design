import { describe, expect, it } from 'vitest';
import { Tag } from '@core/primitives';
import { SessionKind } from './session-kind.data';

describe('SessionKind', () => {
  it('keeps the verifyOtp wire values, upper-snaked', () => {
    expect([...Tag.values(SessionKind)]).toEqual(['NEW', 'RETURNING']);
    expect(SessionKind.Returning).toBe('RETURNING');
  });
});
