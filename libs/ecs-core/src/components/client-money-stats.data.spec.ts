import { describe, expect, it } from 'vitest';
import { ClientMoneyStats } from './client-money-stats.data';

describe('ClientMoneyStats', () => {
  it('ClientMoneyStats.zero is a flat spend of nought cents in EUR', () => {
    expect(ClientMoneyStats.zero()).toEqual({
      lifetimeSpendCents: 0,
      currency: 'EUR',
    });
  });
});
