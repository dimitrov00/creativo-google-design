import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngagementErrorCode } from '../components/engagement-errors.data';
import type { Money } from '../components/money.data';
import { VoucherCode } from '../components/voucher-code.data';
import type { VoucherRedemption } from '../components/voucher-redemption.data';
import { VoucherRefusal, VoucherState } from '../components/voucher-state.data';
import {
  type GiftVoucherEntity,
  GiftVoucherId,
} from '../entities/gift-voucher.entity';
import { UserId } from '../entities/user.entity';
import {
  dayTableFixture,
  deepFreeze,
  fixtureTodayAt,
  unwrapErr,
  unwrapOk,
} from '../testing';
import { VoucherSystem } from './voucher.system';

/*
 * The cases of libs/domain/engagement/src/lib/gift-voucher.spec.ts, copied
 * over plain entities (the class spec keeps running against its shim), plus
 * the cancellation's give-back (`voucher-restore.ts`), the wallet's
 * spendable math and the balance algebra as properties.
 */

const NOW = Date.UTC(2026, 8, 10, 9, 0);

function eur(minor: number): Money {
  return { amountMinorUnits: minor, currencyCode: 'EUR' };
}

function issued(
  overrides: {
    balance?: number;
    expiresAtMs?: number | null;
    state?: VoucherState;
    id?: string;
    code?: string;
  } = {},
): GiftVoucherEntity {
  return {
    id: GiftVoucherId.of(overrides.id ?? 'v1'),
    code: VoucherCode.of(overrides.code ?? 'GIFT2025'),
    initialValue: eur(2500),
    balance: eur(overrides.balance ?? 2500),
    issuedAtMs: Date.UTC(2026, 8, 1, 6, 0),
    expiresAtMs: overrides.expiresAtMs ?? null,
    issuedToUserId: UserId.of('client-1'),
    state: overrides.state ?? VoucherState.active(),
  };
}

describe('VoucherSystem — the balance algebra', () => {
  it('is issued with its whole value as balance, its code normalised', () => {
    const voucher = unwrapOk(
      VoucherSystem.issue({
        id: GiftVoucherId.of('v2'),
        code: 'gift5',
        value: eur(500),
        issuedAtMs: NOW,
        expiresAtMs: null,
        issuedToUserId: null,
      }),
    );
    expect(voucher.code).toBe('GIFT5');
    expect(voucher.balance.amountMinorUnits).toBe(500);
    expect(voucher.issuedToUserId).toBeNull();
    expect(VoucherSystem.isRedeemable(voucher, NOW)).toBe(true);
  });

  it('refuses to be issued worthless or with an illegal code', () => {
    const base = {
      id: GiftVoucherId.of('v'),
      issuedAtMs: NOW,
      expiresAtMs: null,
      issuedToUserId: null,
    };
    expect(
      unwrapErr(VoucherSystem.issue({ ...base, code: 'GIFT5', value: eur(0) })),
    ).toEqual([{ code: EngagementErrorCode.GiftVoucherValueInvalid }]);
    expect(
      unwrapErr(VoucherSystem.issue({ ...base, code: 'no', value: eur(500) })),
    ).toEqual([
      { code: EngagementErrorCode.VoucherCodeInvalid, attempted: 'NO' },
    ]);
  });

  it('says why it cannot be used — void, expired, empty — in that order', () => {
    expect(VoucherSystem.refusal(issued(), NOW)).toBeNull();
    expect(VoucherSystem.refusal(issued({ balance: 0 }), NOW)).toBe('empty');
    expect(
      VoucherSystem.refusal(
        issued({ expiresAtMs: Date.UTC(2026, 8, 8, 21, 0) }),
        NOW,
      ),
    ).toBe('expired');
    expect(
      VoucherSystem.refusal(
        issued({ balance: 0, state: VoucherState.voided(NOW, 'lost') }),
        NOW,
      ),
    ).toBe('void');
    // AT the expiry instant it is still usable.
    expect(VoucherSystem.refusal(issued({ expiresAtMs: NOW }), NOW)).toBeNull();
  });

  it('covers what is owed or what it has, whichever is smaller', () => {
    expect(VoucherSystem.coverage(issued(), eur(1450)).amountMinorUnits).toBe(
      1450,
    );
    expect(VoucherSystem.coverage(issued(), eur(4000)).amountMinorUnits).toBe(
      2500,
    );
    expect(
      VoucherSystem.coverage(issued({ balance: 0 }), eur(4000))
        .amountMinorUnits,
    ).toBe(0);
    expect(
      VoucherSystem.coverage(issued(), {
        amountMinorUnits: 100,
        currencyCode: 'BGN',
      }),
    ).toEqual(eur(0));
  });

  it('redeems within its balance and restores never above its value', () => {
    const drawn = unwrapOk(VoucherSystem.redeem(issued(), eur(1000), NOW));
    expect(drawn.balance.amountMinorUnits).toBe(1500);
    expect(unwrapErr(VoucherSystem.redeem(drawn, eur(1600), NOW))).toEqual({
      code: EngagementErrorCode.GiftVoucherInsufficientBalance,
      requestedMinorUnits: 1600,
      balanceMinorUnits: 1500,
    });
    const back = unwrapOk(VoucherSystem.restore(drawn, eur(1000)));
    expect(back.balance.amountMinorUnits).toBe(2500);
    expect(unwrapErr(VoucherSystem.restore(back, eur(1))).code).toBe(
      EngagementErrorCode.GiftVoucherOverRestore,
    );
    // Money goes back even to a void voucher.
    const voided = VoucherSystem.void(drawn, NOW, 'lost');
    expect(VoucherSystem.restore(voided, eur(1000)).ok).toBe(true);
    expect(unwrapErr(VoucherSystem.redeem(voided, eur(1), NOW))).toEqual({
      code: EngagementErrorCode.GiftVoucherNotRedeemable,
      reason: VoucherRefusal.Void,
    });
    expect(
      unwrapErr(
        VoucherSystem.redeem(
          drawn,
          { amountMinorUnits: 1, currencyCode: 'BGN' },
          NOW,
        ),
      ).code,
    ).toBe(EngagementErrorCode.GiftVoucherCurrencyMismatch);
  });

  it("settles one visit's draw from a previous amount to the next", () => {
    const held = issued({ balance: 1500 });
    const grown = unwrapOk(VoucherSystem.settle(held, eur(1000), eur(2000)));
    expect(grown.balance.amountMinorUnits).toBe(500);
    expect(VoucherSystem.settle(held, eur(1000), eur(2600)).ok).toBe(false);
    const voided = VoucherSystem.void(held, NOW, 'lost');
    expect(VoucherSystem.settle(voided, eur(1000), eur(500)).ok).toBe(true);
    expect(VoucherSystem.settle(voided, eur(1000), eur(1500)).ok).toBe(false);
    const returned = unwrapOk(VoucherSystem.settle(held, eur(1000), eur(0)));
    expect(returned.balance.amountMinorUnits).toBe(2500);
    expect(
      unwrapErr(VoucherSystem.settle(issued(), eur(1000), eur(0))).code,
    ).toBe(EngagementErrorCode.GiftVoucherOverRestore);
    expect(
      unwrapErr(
        VoucherSystem.settle(held, eur(0), {
          amountMinorUnits: 1,
          currencyCode: 'BGN',
        }),
      ),
    ).toEqual({
      code: EngagementErrorCode.GiftVoucherCurrencyMismatch,
      expected: 'EUR',
      found: 'BGN',
    });
  });

  it('keeps the balance within [0, initial] through any settle (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2500 }),
        fc.integer({ min: 0, max: 2500 }),
        fc.integer({ min: 0, max: 5000 }),
        (balance, previous, next) => {
          const settled = VoucherSystem.settle(
            issued({ balance }),
            eur(previous),
            eur(next),
          );
          if (!settled.ok) return;
          expect(settled.value.balance.amountMinorUnits).toBeGreaterThanOrEqual(
            0,
          );
          expect(settled.value.balance.amountMinorUnits).toBeLessThanOrEqual(
            2500,
          );
          // What the draw moved is exactly what the balance moved.
          expect(balance - settled.value.balance.amountMinorUnits).toBe(
            next - previous,
          );
        },
      ),
    );
  });

  it('a redeem and a restore of the same amount are inverses (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2500 }),
        fc.integer({ min: 0, max: 2500 }),
        (balance, amount) => {
          const voucher = issued({ balance });
          const drawn = VoucherSystem.redeem(voucher, eur(amount), NOW);
          if (!drawn.ok) {
            expect(amount).toBeGreaterThan(balance);
            return;
          }
          expect(
            unwrapOk(VoucherSystem.restore(drawn.value, eur(amount))),
          ).toEqual(voucher);
        },
      ),
    );
  });
});

/* ── What a cancellation gives back (voucher-restore.ts) ─────────────── */

function line(
  voucherId: string,
  amount: number,
  reversedAtMs: number | null = null,
): VoucherRedemption {
  return {
    voucherId: GiftVoucherId.of(voucherId),
    code: voucherId.toUpperCase(),
    amount: eur(amount),
    balanceAfter: eur(0),
    appliedAtMs: NOW - 3_600_000,
    reversedAtMs,
  };
}

describe('VoucherSystem.restorePlan — a cancellation gives the money back', () => {
  it('plans nothing when the visit paid with no live voucher', () => {
    expect(VoucherSystem.restorePlan([], [issued()], NOW)).toBeNull();
    expect(
      VoucherSystem.restorePlan([line('v1', 500, NOW - 1)], [issued()], NOW),
    ).toBeNull();
  });

  it('restores every voucher drawn on and reverses every live line, keeping history', () => {
    const history = line('v1', 300, NOW - 10);
    const plan = VoucherSystem.restorePlan(
      [history, line('v1', 1000)],
      [issued({ balance: 1500 })],
      NOW,
    );
    expect(plan?.vouchers.map((v) => v.balance.amountMinorUnits)).toEqual([
      2500,
    ]);
    expect(plan?.voucherRedemptions).toEqual([
      history,
      { ...line('v1', 1000), reversedAtMs: NOW },
    ]);
  });

  it('skips a voucher that is gone, or one that would not take the money back — the line is still reversed', () => {
    const plan = VoucherSystem.restorePlan(
      [line('gone', 500), line('v1', 2000)],
      [issued({ balance: 1000 })],
      NOW,
    );
    expect(plan?.vouchers).toEqual([]);
    expect(plan?.voucherRedemptions.every((l) => l.reversedAtMs === NOW)).toBe(
      true,
    );
  });

  it('restores two lines on one voucher one after the other', () => {
    const plan = VoucherSystem.restorePlan(
      [line('v1', 500), line('v1', 700)],
      [issued({ balance: 1000 })],
      NOW,
    );
    expect(plan?.vouchers.map((v) => v.balance.amountMinorUnits)).toEqual([
      2200,
    ]);
  });
});

/* ── The wallet: what can be spent today ─────────────────────────────── */

describe('VoucherSystem — spendable today, the soonest first', () => {
  const todayStart = fixtureTodayAt(0);

  it('is spendable when active, holding money, and not past today', () => {
    expect(VoucherSystem.spendable(issued(), todayStart)).toBe(true);
    expect(
      VoucherSystem.spendable(
        issued({ expiresAtMs: todayStart + 1 }),
        todayStart,
      ),
    ).toBe(true);
    expect(
      VoucherSystem.spendable(
        issued({ expiresAtMs: todayStart - 1 }),
        todayStart,
      ),
    ).toBe(false);
    expect(VoucherSystem.spendable(issued({ balance: 0 }), todayStart)).toBe(
      false,
    );
    expect(
      VoucherSystem.spendable(
        issued({ state: VoucherState.voided(NOW, 'lost') }),
        todayStart,
      ),
    ).toBe(false);
  });

  it('sums what the spendable ones hold, in one currency', () => {
    expect(
      VoucherSystem.spendableSum(
        [
          issued({ balance: 700 }),
          issued({ balance: 0 }),
          issued({ balance: 300 }),
        ],
        todayStart,
        'EUR',
      ),
    ).toEqual(eur(1000));
  });

  it('orders by the last day, never-expiring last, ties by id', () => {
    const days = dayTableFixture('2026-09-28', '2026-10-05');
    const never = issued({ id: 'a-never' });
    const later = issued({
      id: 'b',
      expiresAtMs: fixtureTodayAt(0) + 3 * 86_400_000,
    });
    const soonB = issued({ id: 'd', expiresAtMs: fixtureTodayAt(12) });
    const soonA = issued({ id: 'c', expiresAtMs: fixtureTodayAt(20) });
    const input = deepFreeze([never, later, soonB, soonA]);
    expect(VoucherSystem.soonestFirst(input, days).map((v) => v.id)).toEqual([
      'c',
      'd',
      'b',
      'a-never',
    ]);
  });
});

describe('VoucherSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const voucher = deepFreeze(issued({ balance: 1500 }));
    const lines = deepFreeze([line('v1', 1000)]);
    expect(VoucherSystem.settle(voucher, eur(1000), eur(200))).toEqual(
      VoucherSystem.settle(voucher, eur(1000), eur(200)),
    );
    expect(VoucherSystem.restorePlan(lines, [voucher], NOW)).toEqual(
      VoucherSystem.restorePlan(lines, [voucher], NOW),
    );
    expect(voucher.balance.amountMinorUnits).toBe(1500);
  });
});
