import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { GiftVoucher } from './gift-voucher';

function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, 'Europe/Sofia');
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function eur(minor: number): Money {
  const r = Money.fromMinorUnitsAndCode(minor, 'EUR');
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function issued(
  overrides: {
    balance?: number;
    expiresAt?: ZonedDateTime | null;
    state?: GiftVoucher['state'];
  } = {},
): GiftVoucher {
  const r = GiftVoucher.reconstitute({
    id: 'v1',
    code: ' gift2025 ',
    value: eur(2500),
    balance: eur(overrides.balance ?? 2500),
    issuedAt: at('2026-09-01T09:00:00'),
    expiresAt: overrides.expiresAt ?? null,
    issuedToUserId: 'client-1',
    state: overrides.state ?? { kind: 'active' },
  });
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

const NOW = at('2026-09-10T12:00:00');

describe('GiftVoucher', () => {
  it('is issued with its whole value as balance, its code normalised', () => {
    const voucher = GiftVoucher.issue({
      id: 'v2',
      code: 'gift5',
      value: eur(500),
      issuedAt: NOW,
    });
    expect(voucher.isSuccess()).toBe(true);
    if (voucher.isFailure()) return;
    expect(voucher.value.code).toBe('GIFT5');
    expect(voucher.value.balance.toMinorUnits()).toBe(500);
    expect(voucher.value.issuedToUserId).toBeNull();
    expect(voucher.value.isRedeemable(NOW)).toBe(true);
  });

  it('refuses to be issued worthless or with an illegal code', () => {
    expect(
      GiftVoucher.issue({
        id: 'v',
        code: 'GIFT5',
        value: eur(0),
        issuedAt: NOW,
      }).isFailure(),
    ).toBe(true);
    expect(
      GiftVoucher.issue({
        id: 'v',
        code: 'no',
        value: eur(500),
        issuedAt: NOW,
      }).isFailure(),
    ).toBe(true);
  });

  it('says why it cannot be used — void, expired, empty — in that order', () => {
    expect(issued().refusal(NOW)).toBeNull();
    expect(issued({ balance: 0 }).refusal(NOW)).toBe('empty');
    expect(issued({ expiresAt: at('2026-09-09T00:00:00') }).refusal(NOW)).toBe(
      'expired',
    );
    expect(
      issued({
        balance: 0,
        state: { kind: 'void', voidedAt: NOW, reason: 'lost' },
      }).refusal(NOW),
    ).toBe('void');
  });

  it('covers what is owed or what it has, whichever is smaller', () => {
    expect(issued().coverage(eur(1450)).toMinorUnits()).toBe(1450);
    expect(issued().coverage(eur(4000)).toMinorUnits()).toBe(2500);
    expect(issued({ balance: 0 }).coverage(eur(4000)).toMinorUnits()).toBe(0);
  });

  it('redeems within its balance and restores never above its value', () => {
    const drawn = issued().redeem(eur(1000), NOW);
    expect(drawn.isSuccess()).toBe(true);
    if (drawn.isFailure()) return;
    expect(drawn.value.balance.toMinorUnits()).toBe(1500);
    expect(drawn.value.redeem(eur(1600), NOW).isFailure()).toBe(true);
    const back = drawn.value.restore(eur(1000));
    expect(back.isSuccess()).toBe(true);
    if (back.isFailure()) return;
    expect(back.value.balance.toMinorUnits()).toBe(2500);
    expect(back.value.restore(eur(1)).isFailure()).toBe(true);
    // Money goes back even to a void voucher: the shop cancelling a visit
    // must not keep the client's money.
    const voided = drawn.value.void(NOW, 'lost');
    expect(voided.restore(eur(1000)).isSuccess()).toBe(true);
    expect(voided.redeem(eur(1), NOW).isFailure()).toBe(true);
  });

  it("settles one visit's draw from a previous amount to the next", () => {
    // 25,00 issued, this visit already holds 10,00 of it: 15,00 left.
    const held = issued({ balance: 1500 });
    const grown = held.settle(eur(1000), eur(2000));
    expect(grown.isSuccess()).toBe(true);
    if (grown.isFailure()) return;
    expect(grown.value.balance.toMinorUnits()).toBe(500);
    // Never past what is available (balance + own draw).
    expect(held.settle(eur(1000), eur(2600)).isFailure()).toBe(true);
    // Shrinking is allowed on a void voucher; growing is not.
    const voided = held.void(NOW, 'lost');
    expect(voided.settle(eur(1000), eur(500)).isSuccess()).toBe(true);
    expect(voided.settle(eur(1000), eur(1500)).isFailure()).toBe(true);
    // Dropping the draw entirely gives it all back.
    const returned = held.settle(eur(1000), eur(0));
    expect(returned.isSuccess()).toBe(true);
    if (returned.isFailure()) return;
    expect(returned.value.balance.toMinorUnits()).toBe(2500);
  });
});
