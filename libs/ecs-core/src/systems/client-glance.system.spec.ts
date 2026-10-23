import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BlockReason,
  ClientStats,
  type PunchCard,
  type VisitLeg,
  VoucherCode,
  VoucherLifecycle,
  VoucherStatus,
  WallTime,
} from '@core/components';
import type { GiftVoucher } from '@core/entities';
import {
  Currency,
  AchievementRuleId,
  AppointmentId,
  BarberId,
  DurationMinutes,
  GiftVoucherId,
  SeatId,
  ServiceId,
  ServiceVariantId,
  PriceCents,
} from '@core/primitives';
import {
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  deepFreeze,
  localDate,
  minute,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  ClientGlanceSystem,
  type GlanceHoldingsInput,
  type GlanceLeg,
  type RepeatDraft,
} from './client-glance.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * COPIED, never moved, and re-targeted to the numbers and verdicts the
 * presenters' cases assert (the words stay with their specs):
 * - libs/features/staff/client-card/src/lib/client-card.presenter.spec.ts —
 *   «pauseOf, isInChairToday», the head's «treats a pause that has run out
 *   as none», and «Повтори»'s «the draft already holds it» (`sameLegs`);
 * - libs/features/staff/client-card/src/lib/glance.presenter.spec.ts — the
 *   holdings: the vouchers that still pay as one sum, the facts the flags
 *   and the data allow, no rhythm for a lost run or a paused client.
 * `isBirthdayToday` is AgeSystem's (identity), not here.
 *
 * Zone-blind (Law 7): "now" is the fixture shop's `ShopNow` (2026-09-28
 * 09:00 in Sofia), a leg's start a `WallTime` and a voucher's last day its
 * `expiresLocalDate` — the conversions the presenters make at their
 * boundary are made here with `ZonedTimeSystem.toLocal` where a case names
 * an instant.
 */

const TODAY = localDate('2026-09-28');
/** 09:00 in Sofia on the fixtures' day. */
const NOW = FIXTURE_NOW;
const NOW_UTC_MS = FIXTURE_NOW_UTC_MS;

const cents = (raw: number): PriceCents => unwrapOk(PriceCents.of(raw));

describe('ClientGlanceSystem.pauseOf', () => {
  it('reads a pause, and when it ends', () => {
    const untilUtcMs = utcMs('2026-10-12T21:00:00.000Z');
    expect(
      ClientGlanceSystem.pauseOf(
        AccountLifecycle.block(BlockReason.Manual, untilUtcMs),
        NOW_UTC_MS,
      ),
    ).toEqual({ untilUtcMs });
    expect(
      ClientGlanceSystem.pauseOf(
        AccountLifecycle.block(BlockReason.Manual, null),
        NOW_UTC_MS,
      ),
    ).toEqual({ untilUtcMs: null });
    expect(
      ClientGlanceSystem.pauseOf(AccountLifecycle.active(), NOW_UTC_MS),
    ).toBeNull();
    expect(ClientGlanceSystem.pauseOf(null, NOW_UTC_MS)).toBeNull();
  });

  it('treats a pause that has run out as none', () => {
    expect(
      ClientGlanceSystem.pauseOf(
        AccountLifecycle.block(
          BlockReason.Manual,
          utcMs('2026-08-31T21:00:00.000Z'),
        ),
        NOW_UTC_MS,
      ),
    ).toBeNull();
  });
});

describe('ClientGlanceSystem.sameLegs', () => {
  const leg = (
    serviceId: string,
    variantId: string | null = null,
  ): GlanceLeg => ({
    serviceId: ServiceId.of(serviceId),
    variantId: variantId === null ? null : ServiceVariantId.of(variantId),
  });

  it('holds the last visit when the draft holds its services, whatever the order', () => {
    expect(
      ClientGlanceSystem.sameLegs(
        [leg('svc-fade'), leg('svc-beard')],
        [leg('svc-beard'), leg('svc-fade')],
      ),
    ).toBe(true);
  });

  it('tells another variant, another count and another service apart', () => {
    expect(
      ClientGlanceSystem.sameLegs([leg('svc-cut', 'long')], [leg('svc-cut')]),
    ).toBe(false);
    expect(
      ClientGlanceSystem.sameLegs(
        [leg('svc-cut')],
        [leg('svc-cut'), leg('svc-cut')],
      ),
    ).toBe(false);
    expect(ClientGlanceSystem.sameLegs([leg('a')], [leg('b')])).toBe(false);
    expect(ClientGlanceSystem.sameLegs([], [])).toBe(true);
  });
});

describe('ClientGlanceSystem.isInChairToday', () => {
  it('puts the client in the chair only on an open visit today', () => {
    // 10:00 in Sofia, today and yesterday.
    const today = WallTime.of(TODAY, minute(600));
    const yesterday = WallTime.of(localDate('2026-09-27'), minute(600));
    expect(ClientGlanceSystem.isInChairToday(true, [today], NOW)).toBe(true);
    // A visit settled, or one on another day, is no visit in the chair.
    expect(ClientGlanceSystem.isInChairToday(false, [today], NOW)).toBe(false);
    expect(ClientGlanceSystem.isInChairToday(true, [yesterday], NOW)).toBe(
      false,
    );
    // A leg the boundary could not place reaches the system as no leg.
    expect(ClientGlanceSystem.isInChairToday(true, [], NOW)).toBe(false);
    // Any one leg of the visit on today will do.
    expect(
      ClientGlanceSystem.isInChairToday(true, [yesterday, today], NOW),
    ).toBe(true);
  });

  it('reads today on the shop’s calendar: 00:30 in Sofia is already tomorrow in Sofia', () => {
    const halfPastMidnight = utcMs('2026-09-28T21:30:00.000Z');
    const leg = ZonedTimeSystem.toLocal(halfPastMidnight, FIXTURE_TIME_ZONE);
    const now = ZonedTimeSystem.shopNow(halfPastMidnight, FIXTURE_TIME_ZONE);
    expect(leg).toEqual({ localDate: '2026-09-29', minute: 30 });
    expect(ClientGlanceSystem.isInChairToday(true, [leg], now)).toBe(true);
  });
});

describe('ClientGlanceSystem.holdings (glance.presenter.spec.ts)', () => {
  const voucher = (
    amount: number,
    overrides: Partial<GiftVoucher> = {},
  ): GiftVoucher =>
    ({
      id: GiftVoucherId.of(`voucher-${amount}`),
      code: VoucherCode.of('GIFT-0001'),
      initialValueCents: cents(5000),
      balanceCents: cents(amount),
      currency: Currency.EUR,
      issuedAtUtcMs: utcMs('2026-01-01T10:00:00Z'),
      expiresAtUtcMs: null,
      expiresLocalDate: null,
      issuedToCustomerId: null,
      holderUserId: null,
      ...VoucherLifecycle.active(),
      ...overrides,
    }) as GiftVoucher;
  const STAMPS: PunchCard = {
    ruleId: AchievementRuleId.of('rule-every-10th-visit'),
    filled: 4,
    size: 10,
    title: { bg: 'Подстригване', en: 'Cut' },
  };
  const input = (
    overrides: Partial<GlanceHoldingsInput> = {},
  ): GlanceHoldingsInput => ({
    vouchers: [voucher(2500)],
    punchCards: [STAMPS],
    achievements: true,
    rhythmOn: true,
    rhythm: { current: 24 },
    paused: false,
    today: TODAY,
    ...overrides,
  });
  const eur = (amount: number) => ({
    voucherCents: amount,
    voucherCurrency: 'EUR',
  });

  it('counts only the vouchers that still pay: active, not empty, not past their last day, as one sum', () => {
    const fact = (vouchers: readonly GiftVoucher[] | null) => {
      const held = ClientGlanceSystem.holdings(input({ vouchers }));
      return held.voucherCents === null
        ? null
        : {
            voucherCents: held.voucherCents,
            voucherCurrency: held.voucherCurrency,
          };
    };
    expect(fact([voucher(2500)])).toEqual(eur(2500));
    expect(fact([voucher(2500), voucher(2500), voucher(500)])).toEqual(
      eur(5500),
    );
    expect(
      fact([
        voucher(0),
        voucher(2500, {
          ...VoucherLifecycle.voided(utcMs('2026-09-01T00:00:00Z'), 'refund'),
        }),
      ]),
    ).toBeNull();
    // The last day is the expiry's day on the shop calendar (T5).
    const lastDay = (iso: string) => {
      const expiresAtUtcMs = utcMs(iso);
      return voucher(2500, {
        expiresAtUtcMs,
        expiresLocalDate: ZonedTimeSystem.toLocal(
          expiresAtUtcMs,
          FIXTURE_TIME_ZONE,
        ).localDate,
      });
    };
    expect(fact([lastDay('2026-09-27T23:59:59.999+03:00')])).toBeNull();
    expect(fact([lastDay('2026-09-28T23:59:59.999+03:00')])).toEqual(eur(2500));
    expect(fact([])).toBeNull();
    expect(fact(null)).toBeNull();
  });

  it('sums in the first voucher’s currency alone', () => {
    const held = ClientGlanceSystem.holdings(
      input({
        vouchers: [voucher(2500), voucher(1000, { currency: Currency.BGN })],
      }),
    );
    expect({
      voucherCents: held.voucherCents,
      voucherCurrency: held.voucherCurrency,
    }).toEqual(eur(2500));
  });

  it('draws only the facts its flags and its data allow', () => {
    expect(ClientGlanceSystem.holdings(input())).toEqual({
      ...eur(2500),
      stamps: STAMPS,
      rhythm: 24,
    });
    expect(
      ClientGlanceSystem.holdings(input({ achievements: false })).stamps,
    ).toBeNull();
    expect(
      ClientGlanceSystem.holdings(input({ rhythmOn: false })).rhythm,
    ).toBeNull();
    expect(
      ClientGlanceSystem.holdings(input({ punchCards: [] })).stamps,
    ).toBeNull();
    expect(
      ClientGlanceSystem.holdings(input({ rhythm: null })).rhythm,
    ).toBeNull();
    // No voucher left: both halves of the sum are absent together.
    expect(ClientGlanceSystem.holdings(input({ vouchers: [] }))).toMatchObject({
      voucherCents: null,
      voucherCurrency: null,
    });
  });

  it('says no rhythm for a run that was lost, and agrees a run of one', () => {
    expect(
      ClientGlanceSystem.holdings(input({ rhythm: { current: 0 } })).rhythm,
    ).toBeNull();
    expect(
      ClientGlanceSystem.holdings(input({ rhythm: { current: 1 } })).rhythm,
    ).toBe(1);
  });

  it('never zeroes a paused client’s values; the rhythm, frozen, is the wallet’s to say', () => {
    expect(ClientGlanceSystem.holdings(input({ paused: true }))).toEqual({
      ...eur(2500),
      stamps: STAMPS,
      rhythm: null,
    });
  });
});

/*
 * «Пак същото» (Law 10.2; client-card.presenter.ts `quickActionsVm`, its
 * spec's «offers the last visit again», «drops «Повтори», which writes»,
 * «on a gone visit, on the last visit itself, and when the draft already
 * holds it», «when every one of its services left the catalogue»):
 * Мартин's last visit, a classic cut on 19 August, with today's visit on
 * screen holding a fade.
 */
describe('ClientGlanceSystem.repeatOffer', () => {
  const CUT = ServiceId.of('svc-classic');
  const BEARD = ServiceId.of('svc-beard');
  const visitLeg = (serviceId: ServiceId): VisitLeg => ({
    seatId: SeatId.of('appt-hist-c2-14-s1'),
    serviceId,
    variantId: null,
    barberId: BarberId.of('niko'),
    durationMinutes: unwrapOk(DurationMinutes.of(30)),
  });
  const LAST = {
    ...ClientStats.empty(),
    lastVisitAppointmentId: AppointmentId.of('appt-hist-c2-14'),
    lastVisitLocalDate: localDate('2026-08-19'),
    lastVisitLegs: [visitLeg(CUT)],
  };
  const DRAFT: RepeatDraft = {
    online: true,
    gone: false,
    currentAppointmentId: AppointmentId.of('appt-today'),
    legs: [{ serviceId: ServiceId.of('svc-fade'), variantId: null }],
  };
  const KNOWN: ReadonlySet<ServiceId> = new Set([CUT, BEARD]);

  it('offers the last visit again', () => {
    expect(ClientGlanceSystem.repeatOffer(LAST, DRAFT, KNOWN)).toBe(true);
    // No visit on screen at all.
    expect(
      ClientGlanceSystem.repeatOffer(
        LAST,
        { ...DRAFT, currentAppointmentId: null },
        KNOWN,
      ),
    ).toBe(true);
  });

  it('refuses without a known last visit — its id or its day', () => {
    expect(
      ClientGlanceSystem.repeatOffer(
        { ...LAST, lastVisitAppointmentId: null },
        DRAFT,
        KNOWN,
      ),
    ).toBe(false);
    expect(
      ClientGlanceSystem.repeatOffer(
        { ...LAST, lastVisitLocalDate: null },
        DRAFT,
        KNOWN,
      ),
    ).toBe(false);
  });

  it('refuses offline, which writes', () => {
    expect(
      ClientGlanceSystem.repeatOffer(LAST, { ...DRAFT, online: false }, KNOWN),
    ).toBe(false);
  });

  it('refuses on a gone visit', () => {
    expect(
      ClientGlanceSystem.repeatOffer(LAST, { ...DRAFT, gone: true }, KNOWN),
    ).toBe(false);
  });

  it('refuses on the last visit itself', () => {
    expect(
      ClientGlanceSystem.repeatOffer(
        LAST,
        { ...DRAFT, currentAppointmentId: LAST.lastVisitAppointmentId },
        KNOWN,
      ),
    ).toBe(false);
  });

  it('refuses a last visit with no services', () => {
    expect(
      ClientGlanceSystem.repeatOffer(
        { ...LAST, lastVisitLegs: [] },
        DRAFT,
        KNOWN,
      ),
    ).toBe(false);
  });

  it('refuses when the draft already holds them (sameLegs)', () => {
    expect(
      ClientGlanceSystem.repeatOffer(
        LAST,
        { ...DRAFT, legs: [{ serviceId: CUT, variantId: null }] },
        KNOWN,
      ),
    ).toBe(false);
  });

  it('refuses when every one of its services left the catalogue, and offers while one is left', () => {
    expect(ClientGlanceSystem.repeatOffer(LAST, DRAFT, new Set())).toBe(false);
    const two = {
      ...LAST,
      lastVisitLegs: [visitLeg(ServiceId.of('svc-retired')), visitLeg(BEARD)],
    };
    expect(ClientGlanceSystem.repeatOffer(two, DRAFT, KNOWN)).toBe(true);
    expect(
      ClientGlanceSystem.repeatOffer(two, DRAFT, new Set([ServiceId.of('x')])),
    ).toBe(false);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const last = deepFreeze({ ...LAST });
    const draft = deepFreeze({ ...DRAFT });
    const once = ClientGlanceSystem.repeatOffer(last, draft, KNOWN);
    expect(ClientGlanceSystem.repeatOffer(last, draft, KNOWN)).toBe(once);
    expect(last.lastVisitLegs).toEqual([visitLeg(CUT)]);
    expect(draft.legs).toHaveLength(1);
  });
});

describe('ClientGlanceSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const held = deepFreeze({
      vouchers: [
        {
          id: GiftVoucherId.of('voucher-1'),
          code: VoucherCode.of('GIFT-0001'),
          initialValueCents: cents(5000),
          balanceCents: cents(2500),
          currency: Currency.EUR,
          issuedAtUtcMs: utcMs('2026-01-01T10:00:00Z'),
          expiresAtUtcMs: utcMs('2026-10-01T00:00:00Z'),
          expiresLocalDate: localDate('2026-10-01'),
          issuedToCustomerId: null,
          holderUserId: null,
          voucherStatus: VoucherStatus.Active,
        } as GiftVoucher,
      ],
      punchCards: [],
      achievements: true,
      rhythmOn: true,
      rhythm: null,
      paused: false,
      today: TODAY,
    });
    const legs = deepFreeze([
      { serviceId: ServiceId.of('b'), variantId: null },
      { serviceId: ServiceId.of('a'), variantId: ServiceVariantId.of('x') },
    ]);
    const chair = deepFreeze([WallTime.of(TODAY, minute(540))]);
    const run = () => [
      ClientGlanceSystem.holdings(held),
      ClientGlanceSystem.sameLegs(legs, legs),
      ClientGlanceSystem.isInChairToday(true, chair, NOW),
    ];
    expect(run()).toEqual(run());
    expect(run()[0]).toMatchObject({ voucherCents: 2500 });
  });
});
