import { describe, expect, it } from 'vitest';
import { JournalEntryId, UserId } from '@core/primitives';

describe('JournalEntryId', () => {
  it('pads the per-client sequence to six digits, so ids sort as the ledger', () => {
    // The account's uid comes from its companion, never a cast (L7, D29).
    const uid = UserId.of('u_ivan');
    expect(JournalEntryId.forEntry(uid, 7)).toBe('u_ivan_000007');
    expect(JournalEntryId.forEntry(uid, 123_456)).toBe('u_ivan_123456');
    const ids = [12, 3, 100].map((seq) => JournalEntryId.forEntry(uid, seq));
    expect([...ids].sort()).toEqual([
      'u_ivan_000003',
      'u_ivan_000012',
      'u_ivan_000100',
    ]);
  });

  it('casts a stored id as it is', () => {
    expect(JournalEntryId.of('u_ivan_000001')).toBe('u_ivan_000001');
  });
});
