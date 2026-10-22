import { describe, expect, it } from 'vitest';
import { CustomerId, JournalEntryId, UserId } from '@core/primitives';
import { fixtureHash } from '@core/testing';

describe('JournalEntryId', () => {
  it('pads the per-client sequence to six digits, so ids sort as the ledger', () => {
    // The client record's id is DERIVED from the account, never cast (D29).
    const customerId = CustomerId.forUser(UserId.of('u_ivan'), fixtureHash);
    expect(JournalEntryId.forEntry(customerId, 7)).toBe(`${customerId}_000007`);
    expect(JournalEntryId.forEntry(customerId, 123_456)).toBe(
      `${customerId}_123456`,
    );
    const ids = [12, 3, 100].map((seq) =>
      JournalEntryId.forEntry(customerId, seq),
    );
    expect([...ids].sort()).toEqual([
      `${customerId}_000003`,
      `${customerId}_000012`,
      `${customerId}_000100`,
    ]);
  });

  it('keys the entry by the client record, never by the account it was derived from', () => {
    const customerId = CustomerId.forUser(UserId.of('u_ivan'), fixtureHash);
    expect(JournalEntryId.forEntry(customerId, 1)).toMatch(
      /^cus_[0-9a-f]{20}_000001$/,
    );
    expect(JournalEntryId.forEntry(customerId, 1)).not.toContain('u_ivan');
  });

  it('casts a stored id as it is', () => {
    expect(JournalEntryId.of('cus_0123456789abcdef0123_000001')).toBe(
      'cus_0123456789abcdef0123_000001',
    );
  });
});
