import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngagementErrorCode } from '../components/engagement-errors.data';
import type { Money } from '../components/money.data';
import { VoucherCode } from '../components/voucher-code.data';
import type { VoucherRedemption } from '../components/voucher-redemption.data';
import {
  VoucherLifecycle,
  VoucherRefusal,
} from '../components/voucher-state.data';
import type { GiftVoucher } from '../entities/gift-voucher.entity';
import { Currency } from '../primitives/currency.primitive';
import { GiftVoucherId, UserId } from '../primitives/ids.primitive';
import { PriceCents } from '../primitives/price-cents.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '../testing';
import { ZonedTimeSystem } from './zoned-time.system';
import { VoucherSystem } from './voucher.system';

/*
 * The cases of libs/domain/engagement/src/lib/gift-voucher.spec.ts, copied
 * over plain entities (the class spec keeps running against its shim), plus
 * the cancellation's give-back (`voucher-restore.ts`), the wallet's
 * spendable math and the balance algebra as properties.
 */

const NOW = utcMs('2026-09-10T09:00:00Z');
/** The first instant of the fixture shop's today (2026-09-28, Sofia). */
const TODAY_START = utcMs('2026-09-28T00:00:00+03:00');

function cents(minor: number): PriceCents {
  return unwrapOk(PriceCents.of(minor));
}

function money(minor: number, currency: Currency): Money {
  return { amountCents: cents(minor), currency };
}

function eur(minor: number): Money {
  return money(minor, Currency.EUR);
}

const later = (base: UtcEpochMs, ms: number): UtcEpochMs =>
  UtcEpochMs.plusMs(base, ms);

function issued(
  overrides: {
    balance?: number;
    expiresAtUtcMs?: UtcEpochMs | null;
    lifecycle?: VoucherLifecycle;
    id?: string;
    code?: string;
  } = {},
): GiftVoucher {
  const expiresAtUtcMs = overrides.expiresAtUtcMs ?? null;
  return {
    id: GiftVoucherId.of(overrides.id ?? 'v1'),
    code: VoucherCode.of(overrides.code ?? 'GIFT2025'),
    initialValueCents: cents(2500),
    balanceCents: cents(overrides.balance ?? 2500),
    currency: Currency.EUR,
    issuedAtUtcMs: utcMs('2026-09-01T06:00:00Z'),
    expiresAtUtcMs,
    // The shop day of the expiry, written at the boundary from the same instant (T5).
    expiresLocalDate:
      expiresAtUtcMs === null
        ? null
        : ZonedTimeSystem.toLocal(expiresAtUtcMs, FIXTURE_TIME_ZONE).localDate,
    issuedToUserId: UserId.of('client-1'),
    ...(overrides.lifecycle ?? VoucherLifecycle.active()),
  };
}

describe('VoucherSystem — the balance algebra', () => {
  it('is issued with its whole value as balance, its code normalised', () => {
    const voucher = unwrapOk(
      VoucherSystem.issue({
        id: GiftVoucherId.of('v2'),
        code: 'gift5',
        valueCents: cents(500),
        currency: Currency.EUR,
        issuedAtUtcMs: NOW,
        expiresAtUtcMs: null,
        expiresLocalDate: null,
        issuedToUserId: null,
      }),
    );
    expect(voucher.code).toBe('GIFT5');
    expect(voucher.balanceCents).toBe(500);
    expect(voucher.voucherStatus).toBe('ACTIVE');
    expect(voucher.issuedToUserId).toBeNull();
    expect(VoucherSystem.isRedeemable(voucher, NOW)).toBe(true);
  });

  it('refuses to be issued worthless or with an illegal code', () => {
    const base = {
      id: GiftVoucherId.of('v'),
      currency: Currency.EUR,
      issuedAtUtcMs: NOW,
      expiresAtUtcMs: null,
      expiresLocalDate: null,
      issuedToUserId: null,
    };
    expect(
      unwrapErr(
        VoucherSystem.issue({ ...base, code: 'GIFT5', valueCents: cents(0) }),
      ),
    ).toEqual([{ errorCode: EngagementErrorCode.GiftVoucherValueInvalid }]);
    expect(
      unwrapErr(
        VoucherSystem.issue({ ...base, code: 'no', valueCents: cents(500) }),
      ),
    ).toEqual([
      { errorCode: EngagementErrorCode.VoucherCodeInvalid, attempted: 'NO' },
    ]);
  });

  it('says why it cannot be used — void, expired, empty — in that order', () => {
    expect(VoucherSystem.refusal(issued(), NOW)).toBeNull();
    expect(VoucherSystem.refusal(issued({ balance: 0 }), NOW)).toBe('EMPTY');
    expect(
      VoucherSystem.refusal(
        issued({ expiresAtUtcMs: utcMs('2026-09-08T21:00:00Z') }),
        NOW,
      ),
    ).toBe('EXPIRED');
    expect(
      VoucherSystem.refusal(
        issued({ balance: 0, lifecycle: VoucherLifecycle.voided(NOW, 'lost') }),
        NOW,
      ),
    ).toBe('VOID');
    // AT the expiry instant it is still usable.
    expect(
      VoucherSystem.refusal(issued({ expiresAtUtcMs: NOW }), NOW),
    ).toBeNull();
  });

  it('covers what is owed or what it has, whichever is smaller', () => {
    expect(VoucherSystem.coverage(issued(), eur(1450)).amountCents).toBe(1450);
    expect(VoucherSystem.coverage(issued(), eur(4000)).amountCents).toBe(2500);
    expect(
      VoucherSystem.coverage(issued({ balance: 0 }), eur(4000)).amountCents,
    ).toBe(0);
    expect(VoucherSystem.coverage(issued(), money(100, Currency.BGN))).toEqual(
      eur(0),
    );
  });

  it('redeems within its balance and restores never above its value', () => {
    const drawn = unwrapOk(VoucherSystem.redeem(issued(), eur(1000), NOW));
    expect(drawn.balanceCents).toBe(1500);
    expect(unwrapErr(VoucherSystem.redeem(drawn, eur(1600), NOW))).toEqual({
      errorCode: EngagementErrorCode.GiftVoucherInsufficientBalance,
      requestedCents: 1600,
      balanceCents: 1500,
    });
    const back = unwrapOk(VoucherSystem.restore(drawn, eur(1000)));
    expect(back.balanceCents).toBe(2500);
    expect(unwrapErr(VoucherSystem.restore(back, eur(1))).errorCode).toBe(
      EngagementErrorCode.GiftVoucherOverRestore,
    );
    // Money goes back even to a void voucher.
    const voided = VoucherSystem.void(drawn, NOW, 'lost');
    expect(voided).toMatchObject({
      voucherStatus: 'VOID',
      voidedAtUtcMs: NOW,
      voidReason: 'lost',
      balanceCents: 1500,
    });
    expect(VoucherSystem.restore(voided, eur(1000)).ok).toBe(true);
    expect(unwrapErr(VoucherSystem.redeem(voided, eur(1), NOW))).toEqual({
      errorCode: EngagementErrorCode.GiftVoucherNotRedeemable,
      reason: VoucherRefusal.Void,
    });
    expect(
      unwrapErr(VoucherSystem.redeem(drawn, money(1, Currency.BGN), NOW))
        .errorCode,
    ).toBe(EngagementErrorCode.GiftVoucherCurrencyMismatch);
  });

  it("settles one visit's draw from a previous amount to the next", () => {
    const held = issued({ balance: 1500 });
    const grown = unwrapOk(VoucherSystem.settle(held, eur(1000), eur(2000)));
    expect(grown.balanceCents).toBe(500);
    expect(VoucherSystem.settle(held, eur(1000), eur(2600)).ok).toBe(false);
    const voided = VoucherSystem.void(held, NOW, 'lost');
    expect(VoucherSystem.settle(voided, eur(1000), eur(500)).ok).toBe(true);
    expect(VoucherSystem.settle(voided, eur(1000), eur(1500)).ok).toBe(false);
    const returned = unwrapOk(VoucherSystem.settle(held, eur(1000), eur(0)));
    expect(returned.balanceCents).toBe(2500);
    expect(
      unwrapErr(VoucherSystem.settle(issued(), eur(1000), eur(0))).errorCode,
    ).toBe(EngagementErrorCode.GiftVoucherOverRestore);
    expect(
      unwrapErr(VoucherSystem.settle(held, eur(0), money(1, Currency.BGN))),
    ).toEqual({
      errorCode: EngagementErrorCode.GiftVoucherCurrencyMismatch,
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
          expect(settled.value.balanceCents).toBeGreaterThanOrEqual(0);
          expect(settled.value.balanceCents).toBeLessThanOrEqual(2500);
          // What the draw moved is exactly what the balance moved.
          expect(balance - settled.value.balanceCents).toBe(next - previous);
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
  reversedAtUtcMs: UtcEpochMs | null = null,
): VoucherRedemption {
  return {
    voucherId: GiftVoucherId.of(voucherId),
    code: VoucherCode.of(voucherId.toUpperCase()),
    amountCents: cents(amount),
    balanceAfterCents: cents(0),
    currency: Currency.EUR,
    appliedAtUtcMs: later(NOW, -3_600_000),
    reversedAtUtcMs,
  };
}

describe('VoucherSystem.restorePlan — a cancellation gives the money back', () => {
  it('plans nothing when the visit paid with no live voucher', () => {
    expect(VoucherSystem.restorePlan([], [issued()], NOW)).toBeNull();
    expect(
      VoucherSystem.restorePlan(
        [line('v1', 500, later(NOW, -1))],
        [issued()],
        NOW,
      ),
    ).toBeNull();
  });

  it('restores every voucher drawn on and reverses every live line, keeping history', () => {
    const history = line('v1', 300, later(NOW, -10));
    const plan = VoucherSystem.restorePlan(
      [history, line('v1', 1000)],
      [issued({ balance: 1500 })],
      NOW,
    );
    expect(plan?.vouchers.map((v) => v.balanceCents)).toEqual([2500]);
    expect(plan?.voucherRedemptions).toEqual([
      history,
      { ...line('v1', 1000), reversedAtUtcMs: NOW },
    ]);
  });

  it('skips a voucher that is gone, or one that would not take the money back — the line is still reversed', () => {
    const plan = VoucherSystem.restorePlan(
      [line('gone', 500), line('v1', 2000)],
      [issued({ balance: 1000 })],
      NOW,
    );
    expect(plan?.vouchers).toEqual([]);
    expect(
      plan?.voucherRedemptions.every((l) => l.reversedAtUtcMs === NOW),
    ).toBe(true);
  });

  it('restores two lines on one voucher one after the other', () => {
    const plan = VoucherSystem.restorePlan(
      [line('v1', 500), line('v1', 700)],
      [issued({ balance: 1000 })],
      NOW,
    );
    expect(plan?.vouchers.map((v) => v.balanceCents)).toEqual([2200]);
  });
});

/* ── The wallet: what can be spent today ─────────────────────────────── */

describe('VoucherSystem — spendable today, the soonest first', () => {
  it('is spendable when active, holding money, and not past today', () => {
    expect(VoucherSystem.spendable(issued(), FIXTURE_TODAY)).toBe(true);
    expect(
      VoucherSystem.spendable(
        issued({ expiresAtUtcMs: later(TODAY_START, 1) }),
        FIXTURE_TODAY,
      ),
    ).toBe(true);
    expect(
      VoucherSystem.spendable(
        issued({ expiresAtUtcMs: later(TODAY_START, -1) }),
        FIXTURE_TODAY,
      ),
    ).toBe(false);
    expect(VoucherSystem.spendable(issued({ balance: 0 }), FIXTURE_TODAY)).toBe(
      false,
    );
    expect(
      VoucherSystem.spendable(
        issued({ lifecycle: VoucherLifecycle.voided(NOW, 'lost') }),
        FIXTURE_TODAY,
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
        FIXTURE_TODAY,
        Currency.EUR,
      ),
    ).toEqual(eur(1000));
  });

  it('orders by the last day, never-expiring last, ties by id', () => {
    const never = issued({ id: 'a-never' });
    const laterDay = issued({
      id: 'b',
      expiresAtUtcMs: later(TODAY_START, 3 * 86_400_000),
    });
    const soonB = issued({
      id: 'd',
      expiresAtUtcMs: later(TODAY_START, 12 * 3_600_000),
    });
    const soonA = issued({
      id: 'c',
      expiresAtUtcMs: later(TODAY_START, 20 * 3_600_000),
    });
    const input = deepFreeze([never, laterDay, soonB, soonA]);
    expect(VoucherSystem.soonestFirst(input).map((v) => v.id)).toEqual([
      'c',
      'd',
      'b',
      'a-never',
    ]);
  });
});

describe('VoucherSystem.transitionWrite — one variant on the stored document', () => {
  it('sets the balance and the new variant, deletes the old variant’s fields', () => {
    const voided = issued({ lifecycle: VoucherLifecycle.voided(NOW, 'lost') });
    expect(VoucherSystem.transitionWrite(voided, issued())).toMatchObject({
      writeAction: 'UPDATE',
      path: ['giftVouchers', 'v1'],
      fields: { balanceCents: 2500, voucherStatus: 'ACTIVE' },
      deleteFields: ['voidedAtUtcMs', 'voidReason'],
    });
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
    expect(voucher.balanceCents).toBe(1500);
  });
});
