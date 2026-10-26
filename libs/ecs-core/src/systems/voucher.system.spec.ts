import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  VoucherRefusal,
  Currency,
  GiftVoucherId,
  UserId,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { EngagementErrorCode } from '@core/errors';
import {
  type Money,
  VoucherCode,
  type VoucherRedemption,
  VoucherLifecycle,
} from '@core/components';
import type { GiftVoucher } from '@core/entities';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  giftVoucherFixtures,
  localDate,
  unwrapErr,
  unwrapOk,
  utcMs,
  customerOf,
} from '@core/testing';
import { ZonedTimeSystem } from './zoned-time.system';
import { VoucherSystem } from './voucher.system';

/*
 * The cases of the legacy engagement `gift-voucher.spec.ts` (deleted in Phase
 * 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), copied over
 * plain entities, plus the cancellation's give-back (`voucher-restore.ts`), the
 * wallet's spendable math and the balance algebra as properties. The issue
 * and redeem verbs are deleted (OR-14); their refusal cases — insufficient
 * balance, a currency mismatch, not redeemable, the inverse property — are
 * ported onto `settle` and `refusal`, the one balance rule left.
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
    issuedToCustomerId: customerOf(UserId.of('client-1')),
    holderUserId: UserId.of('client-1'),
    ...(overrides.lifecycle ?? VoucherLifecycle.active()),
  };
}

describe('VoucherSystem — the balance algebra', () => {
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

  it('draws within its balance (a settle from nothing) and restores never above its value — the redeem cases, ported (OR-14)', () => {
    const drawn = unwrapOk(VoucherSystem.settle(issued(), eur(0), eur(1000)));
    expect(drawn.balanceCents).toBe(1500);
    // Insufficient balance: a draw past what is left.
    expect(unwrapErr(VoucherSystem.settle(drawn, eur(0), eur(1600)))).toEqual({
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
    const voided = issued({
      balance: 1500,
      lifecycle: VoucherLifecycle.voided(NOW, 'lost'),
    });
    expect(VoucherSystem.restore(voided, eur(1000)).ok).toBe(true);
    // Not redeemable: a void voucher refuses a draw that grows, as VOID.
    expect(unwrapErr(VoucherSystem.settle(voided, eur(0), eur(1)))).toEqual({
      errorCode: EngagementErrorCode.GiftVoucherNotRedeemable,
      reason: VoucherRefusal.Void,
    });
    // A voucher NEW to a bill passes `refusal` first: void, expired, empty.
    expect(VoucherSystem.refusal(voided, NOW)).toBe(VoucherRefusal.Void);
    expect(
      VoucherSystem.refusal(issued({ expiresAtUtcMs: later(NOW, -1) }), NOW),
    ).toBe(VoucherRefusal.Expired);
    // A currency mismatch, either way round.
    expect(
      unwrapErr(VoucherSystem.settle(drawn, eur(0), money(1, Currency.BGN)))
        .errorCode,
    ).toBe(EngagementErrorCode.GiftVoucherCurrencyMismatch);
    expect(
      unwrapErr(VoucherSystem.restore(drawn, money(1, Currency.BGN))),
    ).toEqual({
      errorCode: EngagementErrorCode.GiftVoucherCurrencyMismatch,
      expected: 'EUR',
      found: 'BGN',
    });
  });

  it("settles one visit's draw from a previous amount to the next", () => {
    const held = issued({ balance: 1500 });
    const grown = unwrapOk(VoucherSystem.settle(held, eur(1000), eur(2000)));
    expect(grown.balanceCents).toBe(500);
    expect(VoucherSystem.settle(held, eur(1000), eur(2600)).ok).toBe(false);
    const voided = issued({
      balance: 1500,
      lifecycle: VoucherLifecycle.voided(NOW, 'lost'),
    });
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

  it('a draw and a give-back of the same amount are inverses (property — the redeem one, on settle)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2500 }),
        fc.integer({ min: 0, max: 2500 }),
        (balance, amount) => {
          const voucher = issued({ balance });
          const drawn = VoucherSystem.settle(voucher, eur(0), eur(amount));
          if (!drawn.ok) {
            expect(amount).toBeGreaterThan(balance);
            return;
          }
          expect(
            unwrapOk(VoucherSystem.restore(drawn.value, eur(amount))),
          ).toEqual(voucher);
          expect(
            unwrapOk(VoucherSystem.settle(drawn.value, eur(amount), eur(0))),
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

  it('sums what the spendable ones hold, one sum per currency in first-seen order (OR-17)', () => {
    expect(
      VoucherSystem.spendableSums(
        [
          issued({ balance: 700 }),
          issued({ balance: 0 }),
          issued({ balance: 300 }),
        ],
        FIXTURE_TODAY,
      ),
    ).toEqual([eur(1000)]);
    const lev = (balance: number) => ({
      ...issued({ balance }),
      currency: Currency.BGN,
    });
    expect(
      VoucherSystem.spendableSums(
        [lev(400), issued({ balance: 700 }), lev(100), issued({ balance: 0 })],
        FIXTURE_TODAY,
      ),
    ).toEqual([money(500, Currency.BGN), eur(700)]);
    // A currency nothing spendable is held in has no sum.
    expect(
      VoucherSystem.spendableSums(
        [lev(0), issued({ balance: 200 })],
        FIXTURE_TODAY,
      ),
    ).toEqual([eur(200)]);
    expect(VoucherSystem.spendableSums([], FIXTURE_TODAY)).toEqual([]);
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

/*
 * The decisions of `voucherVms` (what is held, in which order) and of the
 * holdings total of `walletVm` in
 * libs/features/staff/client-card/src/lib/wallet.presenter.spec.ts, over
 * the loyalty fixtures' vouchers: Георги holds three (GIFT50, 25,00 € of
 * 50,00 € to 31.12.2026; one spent; one the shop voided), Мартин one,
 * whole. The words — the balance, the chip, the day — stay with the
 * presenter's spec.
 */
describe('VoucherSystem.held, untouched, heldTotal (the wallet’s vouchers)', () => {
  const ALL = giftVoucherFixtures();
  const holding = (uid: string) =>
    ALL.filter((voucher) => voucher.holderUserId === uid);
  const GEORGI = holding('dev-client-1');
  const MARTIN = holding('dev-client-2');
  const [GIFT50] = GEORGI;
  const gift50 = GIFT50 as GiftVoucher;
  /** One more voucher of Георги's, GIFT50's document with some fields changed. */
  const voucherWith = (id: string, fields: Partial<GiftVoucher>) =>
    ({ ...gift50, id: GiftVoucherId.of(id), ...fields }) as GiftVoucher;
  const lastDay = (raw: string | null) => ({
    expiresAtUtcMs: raw === null ? null : utcMs(`${raw}T23:59:59.999+02:00`),
    expiresLocalDate: raw === null ? null : localDate(raw),
  });
  const ids = (vouchers: readonly GiftVoucher[]) => vouchers.map((v) => v.id);

  it('holds what can be spent: a voided voucher and an empty one are absent', () => {
    expect(GEORGI).toHaveLength(3);
    expect(ids(VoucherSystem.held(GEORGI, FIXTURE_TODAY))).toEqual([
      'voucher-dev-georgi',
    ]);
    expect(ids(VoucherSystem.held(MARTIN, FIXTURE_TODAY))).toEqual([
      'voucher-dev-martin',
    ]);
    expect(VoucherSystem.held([], FIXTURE_TODAY)).toEqual([]);
  });

  it('keeps a voucher to its last day and drops it after', () => {
    expect(ids(VoucherSystem.held([gift50], localDate('2026-12-31')))).toEqual([
      'voucher-dev-georgi',
    ]);
    expect(VoucherSystem.held([gift50], localDate('2027-01-01'))).toEqual([]);
  });

  it('puts the soonest to expire first, one that never expires last', () => {
    const october = voucherWith('voucher-b', lastDay('2026-10-31'));
    const open = voucherWith('voucher-a', lastDay(null));
    expect(
      ids(VoucherSystem.held([open, ...GEORGI, october], FIXTURE_TODAY)),
    ).toEqual(['voucher-b', 'voucher-dev-georgi', 'voucher-a']);
    // The never-expiring one stays last whatever the ids say.
    expect(ids(VoucherSystem.held([open, october], FIXTURE_TODAY))).toEqual([
      'voucher-b',
      'voucher-a',
    ]);
  });

  it('breaks a tie of last days by id in UTF-16 code units, whatever the input order (OR-18)', () => {
    const b = voucherWith('voucher-b', lastDay('2026-10-31'));
    const a = voucherWith('voucher-a', lastDay('2026-10-31'));
    expect(ids(VoucherSystem.held([b, a], FIXTURE_TODAY))).toEqual([
      'voucher-a',
      'voucher-b',
    ]);
    expect(ids(VoucherSystem.held([a, b], FIXTURE_TODAY))).toEqual([
      'voucher-a',
      'voucher-b',
    ]);
    // Code units, not a locale's collation: an upper-case id sorts before
    // every lower-case one, and «Z» before «a» (`localeCompare` would put
    // «a» first on most devices).
    const upper = voucherWith('voucher-Z', lastDay('2026-10-31'));
    expect(ids(VoucherSystem.held([a, upper], FIXTURE_TODAY))).toEqual([
      'voucher-Z',
      'voucher-a',
    ]);
    // Two that never expire tie too.
    const never = [
      voucherWith('voucher-y', lastDay(null)),
      voucherWith('voucher-x', lastDay(null)),
    ];
    expect(ids(VoucherSystem.held(never, FIXTURE_TODAY))).toEqual([
      'voucher-x',
      'voucher-y',
    ]);
    // `soonestFirst` shares the one order.
    expect(ids(VoucherSystem.soonestFirst([b, a]))).toEqual([
      'voucher-a',
      'voucher-b',
    ]);
  });

  it('is untouched while its balance is the whole value it was issued with', () => {
    expect(VoucherSystem.untouched(MARTIN[0] as GiftVoucher)).toBe(true);
    expect(VoucherSystem.untouched(gift50)).toBe(false);
    expect(
      VoucherSystem.untouched(
        voucherWith('voucher-new', { balanceCents: cents(5000) }),
      ),
    ).toBe(true);
  });

  it('totals what several spendable vouchers hold, from two of them on', () => {
    const second = voucherWith('voucher-second', {
      initialValueCents: cents(3000),
      balanceCents: cents(3000),
      ...lastDay(null),
    });
    expect(VoucherSystem.heldTotal([...GEORGI, second], FIXTURE_TODAY)).toEqual(
      eur(5500),
    );
    // One spendable voucher (the spent and the voided one never count): no total.
    expect(VoucherSystem.heldTotal(GEORGI, FIXTURE_TODAY)).toBeNull();
    expect(VoucherSystem.heldTotal(MARTIN, FIXTURE_TODAY)).toBeNull();
    expect(VoucherSystem.heldTotal([], FIXTURE_TODAY)).toBeNull();
    // A voucher past its day no longer counts toward the two.
    expect(
      VoucherSystem.heldTotal([...GEORGI, second], localDate('2027-01-01')),
    ).toBeNull();
  });

  it('has no total across two currencies, unless the other one cannot be spent', () => {
    const second = voucherWith('voucher-second', {
      balanceCents: cents(3000),
      initialValueCents: cents(3000),
    });
    const lev = voucherWith('voucher-lev', { currency: Currency.BGN });
    expect(
      VoucherSystem.heldTotal([gift50, second, lev], FIXTURE_TODAY),
    ).toBeNull();
    expect(VoucherSystem.heldTotal([lev, gift50], FIXTURE_TODAY)).toBeNull();
    const spentLev = voucherWith('voucher-lev', {
      currency: Currency.BGN,
      balanceCents: cents(0),
    });
    expect(
      VoucherSystem.heldTotal([spentLev, gift50, second], FIXTURE_TODAY),
    ).toEqual(eur(5500));
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const vouchers = deepFreeze([
      ...ALL,
      voucherWith('voucher-a', lastDay('2026-10-31')),
    ]);
    const run = () => [
      VoucherSystem.held(vouchers, FIXTURE_TODAY),
      VoucherSystem.heldTotal(vouchers, FIXTURE_TODAY),
      VoucherSystem.spendableSums(vouchers, FIXTURE_TODAY),
      VoucherSystem.untouched(vouchers[0] as GiftVoucher),
    ];
    expect(run()).toEqual(run());
    expect(ids(vouchers)).toEqual([...ids(ALL), 'voucher-a']);
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

/* ── Pass C: the one in-order cascade (the visit editor, the settle) ───── */

describe('VoucherSystem.cascade — vouchers covering a bill in order', () => {
  it('covers what the vouchers before left, never more than each has — the editor chain of 25,20 €', () => {
    // FIRST10 off 28,00 € leaves 25,20 €: GIFT2025 pays 10,00 € and keeps
    // 0,00 €; GIFT99 pays the 15,20 € left and keeps 34,80 €.
    const chain = VoucherSystem.cascade([cents(1000), cents(5000)], eur(2520));
    expect(chain.covers).toEqual([eur(1000), eur(1520)]);
    expect(chain.left).toEqual([eur(0), eur(3480)]);
    expect(chain.dueAfter).toEqual(eur(0));
    // A third has nothing left to cover.
    const third = VoucherSystem.cascade(
      [cents(1000), cents(5000), cents(500)],
      eur(2520),
    );
    expect(third.covers[2]).toEqual(eur(0));
    expect(third.left[2]).toEqual(eur(500));
    // Without the first, the second covers the whole 25,20 €.
    expect(VoucherSystem.cascade([cents(5000)], eur(2520)).covers).toEqual([
      eur(2520),
    ]);
  });

  it('leaves what no voucher covered, and covers nothing of a bill of nothing', () => {
    expect(VoucherSystem.cascade([cents(300), cents(200)], eur(1000))).toEqual({
      covers: [eur(300), eur(200)],
      left: [eur(0), eur(0)],
      dueAfter: eur(500),
    });
    expect(VoucherSystem.cascade([cents(300)], eur(0))).toEqual({
      covers: [eur(0)],
      left: [eur(300)],
      dueAfter: eur(0),
    });
    expect(VoucherSystem.cascade([], eur(700))).toEqual({
      covers: [],
      left: [],
      dueAfter: eur(700),
    });
  });

  it("works in the bill's currency", () => {
    const leva = VoucherSystem.cascade([cents(400)], money(1000, Currency.BGN));
    expect(leva.covers).toEqual([money(400, Currency.BGN)]);
    expect(leva.dueAfter).toEqual(money(600, Currency.BGN));
  });

  it('never covers more than is due, and covers plus what is left add up', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { maxLength: 6 }),
        fc.integer({ min: 0, max: 200_000 }),
        (balances, due) => {
          const chain = VoucherSystem.cascade(balances.map(cents), eur(due));
          const covers = chain.covers.map((cover) => cover.amountCents);
          const kept = chain.left.map(
            (left, at) => left.amountCents + (covers.at(at) ?? 0),
          );
          expect(kept).toEqual(balances);
          const covered = covers.reduce((sum, cover) => sum + cover, 0);
          expect(covered + chain.dueAfter.amountCents).toBe(due);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const available = deepFreeze([cents(1000), cents(5000)]);
    const due = deepFreeze(eur(2520));
    expect(VoucherSystem.cascade(available, due)).toEqual(
      VoucherSystem.cascade(available, due),
    );
    expect(available).toEqual([1000, 5000]);
  });
});
