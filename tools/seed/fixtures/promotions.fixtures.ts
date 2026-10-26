/**
 * THE DEV SEED'S PROMOTIONS (flip 1): `coupons/{id}`, `couponGrants/{id}`
 * and `giftVouchers/{id}` as their flat archetypes minus `id` — what the
 * visit sheet's «Отстъпка» page can offer and what the client card shows as
 * held. The plan logic (`tools/seed/promotions.mjs`) decides WHO holds
 * WHAT and WHEN; these builders are the documents.
 *
 * D29 on every holder: a grant rewards a client RECORD (`customerId`) and
 * is READ by its account (`holderUserId`); a voucher is issued to a record
 * (`issuedToCustomerId`) and read by its account (`holderUserId`) — two
 * fields, two values, the account key written beside the record, never
 * derived from it (a paper voucher has neither).
 */
import {
  Combinability,
  CouponExpiryRule,
  CouponOccasion,
  CouponStatus,
  CouponValue,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  VoucherCode,
  VoucherLifecycle,
} from '@core/components';
import type { Coupon, CouponGrant, GiftVoucher } from '@core/entities';
import {
  CouponId,
  Currency,
  GiftVoucherId,
  LocalDate,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  at,
  type Body,
  cents,
  day,
  present,
  type Seeded,
  SHOP_TIME_ZONE,
  sure,
} from './catalog.fixtures';
import { customerIdOf } from './customers.fixtures';

// ── Coupons ────────────────────────────────────────────────────────────────

/** The stamp card's reward — what «Безплатно подстригване» in the rewards catalogue grants. */
export const PUNCH_CARD_COUPON_ID = CouponId.of('coupon-punch-free-cut');

/** A coupon nobody ties to an occasion, open to everyone, with no limit. */
const listed = {
  usageLimit: null,
  couponStatus: CouponStatus.Enabled,
  couponOccasion: null,
} as const;

const percentOff = (percent: number) =>
  sure(CouponValue.percentOff(percent), `percent ${percent}`);

/**
 * Two open by CODE at the counter (`FIRST10`, `BEARD5`), one retired, and
 * four that reach clients only as GRANTS. `coupon-birthday` carries the
 * OCCASION it is given for: the client card's birthday card shows the gift
 * when the grant's coupon says `BIRTHDAY`, and never reads it off a name.
 */
export const COUPONS: readonly Seeded<CouponId, Coupon>[] = [
  {
    id: CouponId.of('coupon-first10'),
    body: {
      ...listed,
      name: 'Първо посещение',
      code: VoucherCode.of('FIRST10'),
      combinability: Combinability.Stackable,
      ...percentOff(10),
      ...CouponExpiryRule.never(),
    } satisfies Omit<Coupon, 'id'>,
  },
  {
    id: CouponId.of('coupon-beard5'),
    body: {
      ...listed,
      name: 'Брада −5 €',
      code: VoucherCode.of('BEARD5'),
      combinability: Combinability.Stackable,
      ...sure(CouponValue.fixedAmount(cents(500), Currency.EUR), 'beard −5 €'),
      ...CouponExpiryRule.never(),
    } satisfies Omit<Coupon, 'id'>,
  },
  {
    id: CouponId.of('coupon-retired'),
    body: {
      ...listed,
      name: 'Лятна промоция',
      code: VoucherCode.of('SUMMER'),
      combinability: Combinability.Stackable,
      ...percentOff(15),
      ...CouponExpiryRule.never(),
      // Retired: the code must read as "no such code" at the counter.
      couponStatus: CouponStatus.Disabled,
    } satisfies Omit<Coupon, 'id'>,
  },
  {
    id: CouponId.of('coupon-birthday'),
    body: {
      ...listed,
      name: 'Рожден ден',
      code: null,
      combinability: Combinability.Exclusive,
      ...percentOff(20),
      ...sure(CouponExpiryRule.days(30), 'thirty days'),
      // What makes a grant of it THE birthday gift.
      couponOccasion: CouponOccasion.Birthday,
    } satisfies Omit<Coupon, 'id'>,
  },
  {
    id: CouponId.of('coupon-fifth-cut'),
    body: {
      ...listed,
      name: 'Пето подстригване',
      code: null,
      combinability: Combinability.Exclusive,
      ...CouponValue.freeService(),
      ...CouponExpiryRule.never(),
    } satisfies Omit<Coupon, 'id'>,
  },
  {
    // The stamp card's reward, minted at every tenth worked visit.
    id: PUNCH_CARD_COUPON_ID,
    body: {
      ...listed,
      name: 'Безплатно подстригване',
      code: null,
      combinability: Combinability.Exclusive,
      ...CouponValue.freeService(),
      ...CouponExpiryRule.never(),
    } satisfies Omit<Coupon, 'id'>,
  },
  {
    // What «Безплатно оформяне на брада» in the rewards catalogue grants.
    id: CouponId.of('coupon-free-beard'),
    body: {
      ...listed,
      name: 'Безплатно оформяне на брада',
      code: null,
      combinability: Combinability.Exclusive,
      ...CouponValue.freeService(),
      ...CouponExpiryRule.never(),
    } satisfies Omit<Coupon, 'id'>,
  },
];

// ── Grants ─────────────────────────────────────────────────────────────────

/** The coupon a grant is minted from — a grant of no seeded coupon is a broken fixture. */
function couponOf(couponId: string): Body<Coupon> {
  return present(
    COUPONS.find(({ id }) => id === couponId)?.body ?? null,
    `no coupon ${couponId} to grant`,
  );
}

/**
 * `couponGrants/{id}`: `uid`'s record holds one use of `couponId`, granted
 * at `grantedAtUtcMs` at the coupon's value then — still held (single use,
 * no expiry), or used at `usedAtUtcMs`.
 */
export function couponGrantBody(
  uid: string,
  couponId: string,
  grantedAtUtcMs: number,
  usedAtUtcMs: number | null,
): Body<CouponGrant> {
  return {
    customerId: customerIdOf(uid),
    holderUserId: UserId.of(uid),
    couponId: CouponId.of(couponId),
    grantedAtUtcMs: sure(UtcEpochMs.of(grantedAtUtcMs), 'granted'),
    ...CouponValue.of(couponOf(couponId)),
    ...GrantLifecycle.of(
      usedAtUtcMs === null
        ? GrantLifecycle.active(
            GrantCapacityTerms.singleUse(),
            GrantExpiryTerms.none(),
          )
        : GrantLifecycle.used(
            {
              ...GrantCapacityTerms.singleUse(),
              ...GrantExpiryTerms.none(),
            },
            sure(UtcEpochMs.of(usedAtUtcMs), 'used'),
            'seed',
          ),
    ),
  } satisfies Omit<CouponGrant, 'id'>;
}

// ── Gift vouchers ──────────────────────────────────────────────────────────

/** A wall-clock reading on a shop day moved `shiftDays` from the fixtures' day. */
function movedInstant(
  localDate: string,
  hour: number,
  minute: number,
  shiftDays: number,
): UtcEpochMs {
  return sure(
    ZonedTimeSystem.toUtc(
      LocalDate.addDays(day(localDate), shiftDays),
      at(hour, minute),
      SHOP_TIME_ZONE,
    ),
    `${localDate} ${hour}:${minute}`,
  );
}

/**
 * A voucher is good to the END OF A MONTH («до 31.12»): the fixtures' last
 * day moved by `shiftDays`, pulled back to the last day of the month before
 * when it lands short of a month's end — never less than two months away.
 * Expires at that day's last millisecond on the shop's clock.
 */
function goodUntil(localDate: string, shiftDays: number) {
  const moved = LocalDate.addDays(day(localDate), shiftDays);
  const nextDay = LocalDate.addDays(moved, 1);
  const lastDay =
    LocalDate.startOfMonth(nextDay) === nextDay
      ? moved
      : LocalDate.addDays(LocalDate.startOfMonth(moved), -1);
  const after = ZonedTimeSystem.startOfLocalDay(
    LocalDate.addDays(lastDay, 1),
    SHOP_TIME_ZONE,
  );
  return {
    expiresAtUtcMs: UtcEpochMs.plusMs(after, -1),
    expiresLocalDate: lastDay,
  } as const;
}

/** Issued to `uid`'s record and readable by their account; `null` for paper. */
function holderOf(uid: string | null) {
  return {
    issuedToCustomerId: uid === null ? null : customerIdOf(uid),
    holderUserId: uid === null ? null : UserId.of(uid),
  } as const;
}

const NEVER_EXPIRES = { expiresAtUtcMs: null, expiresLocalDate: null } as const;

/**
 * The client card's vouchers — the facts of the shared fixture
 * (`libs/ecs-core/src/testing/fixtures/loyalty/vouchers.json`, dated for
 * the fixtures' day 2026-09-28) authored as flat bodies, every instant moved
 * by `shiftDays` to the shop's today keeping its reading of the shop's
 * clock: Георги HOLDS `GIFT50`, 25,00 € left of 50,00 €, beside one he spent
 * and one the shop voided, which a card must not show; Мартин holds
 * `GIFT2025`; `GIFT5` is paper, nobody's. And the seed's own `EMPTY001`,
 * spent, issued at `emptyIssuedAtUtcMs`: the sheet must say so, not "no
 * such code".
 */
export function giftVoucherBodies(
  shiftDays: number,
  emptyIssuedAtUtcMs: number,
): readonly Seeded<GiftVoucherId, GiftVoucher>[] {
  return [
    {
      id: GiftVoucherId.of('voucher-dev-georgi'),
      body: {
        code: VoucherCode.of('GIFT50'),
        initialValueCents: cents(5000),
        balanceCents: cents(2500),
        currency: Currency.EUR,
        issuedAtUtcMs: movedInstant('2026-06-13', 10, 45, shiftDays),
        ...goodUntil('2026-12-31', shiftDays),
        ...holderOf('dev-client-1'),
        ...VoucherLifecycle.active(),
      } satisfies Omit<GiftVoucher, 'id'>,
    },
    {
      id: GiftVoucherId.of('voucher-dev-georgi-spent'),
      body: {
        code: VoucherCode.of('SPENT20'),
        initialValueCents: cents(2000),
        balanceCents: cents(0),
        currency: Currency.EUR,
        issuedAtUtcMs: movedInstant('2025-12-08', 10, 45, shiftDays),
        ...NEVER_EXPIRES,
        ...holderOf('dev-client-1'),
        ...VoucherLifecycle.active(),
      } satisfies Omit<GiftVoucher, 'id'>,
    },
    {
      id: GiftVoucherId.of('voucher-dev-georgi-void'),
      body: {
        code: VoucherCode.of('VOID30'),
        initialValueCents: cents(3000),
        balanceCents: cents(3000),
        currency: Currency.EUR,
        issuedAtUtcMs: movedInstant('2026-06-13', 10, 40, shiftDays),
        ...goodUntil('2026-12-31', shiftDays),
        ...holderOf('dev-client-1'),
        ...VoucherLifecycle.voided(
          movedInstant('2026-06-13', 10, 44, shiftDays),
          'Издаден с грешна стойност',
        ),
      } satisfies Omit<GiftVoucher, 'id'>,
    },
    {
      id: GiftVoucherId.of('voucher-dev-martin'),
      body: {
        code: VoucherCode.of('GIFT2025'),
        initialValueCents: cents(2500),
        balanceCents: cents(2500),
        currency: Currency.EUR,
        issuedAtUtcMs: movedInstant('2026-08-19', 13, 0, shiftDays),
        ...NEVER_EXPIRES,
        ...holderOf('dev-client-2'),
        ...VoucherLifecycle.active(),
      } satisfies Omit<GiftVoucher, 'id'>,
    },
    {
      id: GiftVoucherId.of('voucher-dev-five'),
      body: {
        code: VoucherCode.of('GIFT5'),
        initialValueCents: cents(500),
        balanceCents: cents(500),
        currency: Currency.EUR,
        issuedAtUtcMs: movedInstant('2026-08-19', 13, 0, shiftDays),
        ...NEVER_EXPIRES,
        ...holderOf(null),
        ...VoucherLifecycle.active(),
      } satisfies Omit<GiftVoucher, 'id'>,
    },
    {
      id: GiftVoucherId.of('voucher-dev-empty'),
      body: {
        code: VoucherCode.of('EMPTY001'),
        initialValueCents: cents(1000),
        balanceCents: cents(0),
        currency: Currency.EUR,
        issuedAtUtcMs: sure(UtcEpochMs.of(emptyIssuedAtUtcMs), 'issued'),
        ...NEVER_EXPIRES,
        ...holderOf(null),
        ...VoucherLifecycle.active(),
      } satisfies Omit<GiftVoucher, 'id'>,
    },
  ];
}
