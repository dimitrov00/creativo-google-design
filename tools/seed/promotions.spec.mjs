/**
 * The seed's promotions, held to the archetypes the app reads them as
 * (client-card-revision-3.md §4.5, §4.6; flip 1): every coupon is the flat
 * `Coupon` body — one value variant, its tags from the dictionaries — the
 * birthday coupon says what it is given for, a grant rewards a client
 * RECORD and is read by its account (D29), the gift vouchers tell the
 * shared fixture's story on the fixtures' day and follow the shop's today on
 * any other, and every coupon the loyalty journal says was granted is a
 * grant the seed writes.
 *
 * Zero mapper (Law 5): a body's shape is the type checker's
 * (`fixtures/promotions.fixtures.ts`, every builder `satisfies` its
 * archetype, `pnpm nx typecheck seed-tools`); what this spec holds is what
 * no type can say.
 */
import {
  Combinability,
  CouponExpiry,
  CouponOccasion,
  CouponStatus,
  DiscountMethod,
  PublicLabel,
  StreakRule,
  VoucherStatus,
} from '@core/components';
import { Collections } from '@core/entities';
import { GrantStatus, LocalDate } from '@core/primitives';
import { StreakRuleSystem, StreakSystem, ZonedTimeSystem } from '@core/systems';
import { FIXTURE_TODAY, giftVouchersJson } from '@core/testing';
import { describe, expect, it } from 'vitest';
import { buildClientBook } from './fixtures.mjs';
import { customerIdOf } from './fixtures/customers.fixtures.ts';
import {
  LOYALTY_CATALOG_TODAY,
  LOYALTY_HOLDERS,
  PUNCH_CARD,
  loyaltyCatalogFor,
  projectLoyaltyFor,
} from './loyalty.mjs';
import {
  COUPONS,
  COUPONS_COLLECTION,
  COUPON_GRANTS_COLLECTION,
  GIFT_VOUCHERS_COLLECTION,
  couponGrantWritesOf,
  couponWritesOf,
  giftVoucherWritesOf,
  readPromotionWrites,
} from './promotions.mjs';

/** The shops' zone, spelled here so the spec reads instants independently of the seed. */
const SHOP_ZONE = 'Europe/Sofia';
const DAY_MS = 86_400_000;
const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const SHOP_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});
const SHOP_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_ZONE });
const shopDayOf = (ms) => SHOP_DAY.format(new Date(ms));

/** The fixtures' day, in the evening: Георги's 10:00 cut is done, Мартин is still due. */
const NOW = Date.parse('2026-09-28T20:00:00+03:00');

/** Early morning on days spread over two years, plus the awkward ones. */
const ANCHORS = [
  ...Array.from(
    { length: 10 },
    (_, i) => Date.parse('2026-01-02T07:30:00+02:00') + i * 73 * DAY_MS,
  ),
  Date.parse('2026-03-29T07:30:00+03:00'), // spring forward
  Date.parse('2026-10-25T07:30:00+02:00'), // fall back
  Date.parse('2028-02-29T07:30:00+02:00'), // a leap day
];

/** What the loyalty fold is handed, imported the ordinary way (the domain the seed's bundle holds). */
const DOMAIN = {
  StreakSystem,
  StreakRuleSystem,
  StreakRule,
};

const idOf = ({ path }) => path.split('/').at(-1);

/** The fields of a body that ARE its coupon value (`CouponValue`), by method. */
const VALUE_FIELDS = Object.freeze({
  [DiscountMethod.PercentOff]: ['discountMethod', 'discountPercent'],
  [DiscountMethod.FixedAmount]: [
    'discountMethod',
    'discountAmountCents',
    'discountCurrency',
  ],
  [DiscountMethod.FreeService]: ['discountMethod'],
});
const ALL_VALUE_FIELDS = [...new Set(Object.values(VALUE_FIELDS).flat())];
const valueOf = (body) =>
  Object.fromEntries(
    VALUE_FIELDS[body.discountMethod].map((field) => [field, body[field]]),
  );

/** Everything the seed writes of promotions on the book of `nowMs`. */
function promotionsOn(nowMs) {
  const book = buildClientBook(nowMs);
  const today = book.calendar.dayKeyAt(0);
  const catalog = loyaltyCatalogFor(today);
  const coupons = couponWritesOf();
  const grants = couponGrantWritesOf(book, catalog, today);
  const vouchers = giftVoucherWritesOf(book.calendar);
  return {
    book,
    today,
    catalog,
    coupons,
    grants,
    vouchers,
    writes: [...coupons, ...grants, ...vouchers],
  };
}

describe('the coupons', () => {
  it('are written to the adapters’ collection, one document per coupon', () => {
    expect(COUPONS_COLLECTION).toBe(Collections.Coupons);
    expect(couponWritesOf().map(({ path }) => path)).toEqual(
      COUPONS.map(({ id }) => `coupons/${id}`),
    );
    expect(new Set(COUPONS.map(({ id }) => id)).size).toBe(COUPONS.length);
  });

  it.each(couponWritesOf().map((write) => [idOf(write), write]))(
    '%s is the flat coupon: one value variant, every tag from its dictionary, no id in the body',
    (_id, { data }) => {
      expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
      expect(Object.keys(data)).not.toContain('id');
      expect(Object.values(DiscountMethod)).toContain(data.discountMethod);
      // Exactly the fields of its own variant — never another's beside them.
      for (const field of ALL_VALUE_FIELDS) {
        expect(field in data, field).toBe(
          VALUE_FIELDS[data.discountMethod].includes(field),
        );
      }
      expect(Object.values(CouponStatus)).toContain(data.couponStatus);
      expect(Object.values(Combinability)).toContain(data.combinability);
      expect(Object.values(CouponExpiry)).toContain(data.couponExpiry);
      // A plain document: what is written is what is read, byte for byte.
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    },
  );

  it('says what the birthday coupon is given for, and gives no other an occasion', () => {
    const occasions = Object.fromEntries(
      couponWritesOf().map((write) => [idOf(write), write.data.couponOccasion]),
    );
    expect(occasions).toEqual({
      'coupon-first10': null,
      'coupon-beard5': null,
      'coupon-retired': null,
      'coupon-birthday': CouponOccasion.Birthday,
      'coupon-fifth-cut': null,
      [PUNCH_CARD.couponId]: null,
      'coupon-free-beard': null,
    });
    expect(CouponOccasion.Birthday).toBe('BIRTHDAY');
    // Written, never left out: a save that drops the field undresses the
    // gift — and a value is one the dictionary knows, never a typo.
    for (const { data } of couponWritesOf()) {
      expect(Object.keys(data)).toContain('couponOccasion');
      if (data.couponOccasion !== null) {
        expect(Object.values(CouponOccasion)).toContain(data.couponOccasion);
      }
    }
  });

  it('keeps the two codes of the counter, and the retired one off', () => {
    expect(
      couponWritesOf()
        .map(({ data }) => data)
        .filter((coupon) => coupon.code !== null)
        .map((coupon) => [coupon.code, coupon.couponStatus]),
    ).toEqual([
      ['FIRST10', CouponStatus.Enabled],
      ['BEARD5', CouponStatus.Enabled],
      ['SUMMER', CouponStatus.Disabled],
    ]);
  });
});

describe('the grants', () => {
  const seeded = promotionsOn(NOW);
  const grantsOf = (uid) =>
    seeded.grants.filter(({ data }) => data.holderUserId === uid);
  const held = (uid) =>
    grantsOf(uid)
      .filter(({ data }) => data.grantStatus === GrantStatus.Active)
      .map(idOf);

  it('are written to the adapters’ collection, each under its own id', () => {
    expect(COUPON_GRANTS_COLLECTION).toBe(Collections.CouponGrants);
    for (const write of seeded.grants) {
      expect(write.path.startsWith('couponGrants/')).toBe(true);
      expect(Object.keys(write.data)).not.toContain('id');
    }
    expect(new Set(seeded.grants.map(idOf)).size).toBe(seeded.grants.length);
  });

  it('reward the client RECORD and are read by its account: two fields, never one value for both', () => {
    for (const { path, data } of seeded.grants) {
      expect(data.customerId, path).toBe(customerIdOf(data.holderUserId));
      expect(data.customerId.startsWith('cus_'), path).toBe(true);
      expect(data.customerId, path).not.toBe(data.holderUserId);
    }
  });

  it('put in each client’s hands what their card shows as ready, and nothing they have used', () => {
    // Георги: the free cut of his twentieth stamp, under the id the card has always shown.
    expect(held('dev-client-1')).toEqual(['grant-dev-georgi-punch']);
    // Мартин: the birthday gift. Петър: his fifth cut.
    expect(held('dev-client-2')).toEqual(['grant-dev-martin-birthday']);
    expect(held('dev-client-3')).toEqual(['grant-dev-petar-fifth']);
    expect(
      seeded.grants
        .filter(({ data }) => data.grantStatus === GrantStatus.Used)
        .map(idOf),
    ).toEqual([
      'grant-dev-martin-used',
      'grant-dev-georgi-punch-10',
      'grant-rdm-dev-georgi-cut',
      'grant-dev-martin-punch-10',
      'grant-rdm-dev-martin-beard',
    ]);
    for (const write of seeded.grants) {
      const { data } = write;
      if (data.grantStatus !== GrantStatus.Used) continue;
      expect(data.usedAtUtcMs >= data.grantedAtUtcMs, idOf(write)).toBe(true);
      expect(data.usedNote).toBe('seed');
    }
  });

  it('Мартин’s gift is a grant of the coupon that says birthday', () => {
    const [gift] = grantsOf('dev-client-2').filter(
      ({ data }) => data.grantStatus === GrantStatus.Active,
    );
    const coupon = COUPONS.find(({ id }) => id === gift.data.couponId);
    expect(coupon.body.couponOccasion).toBe(CouponOccasion.Birthday);
    expect(valueOf(gift.data)).toEqual({
      discountMethod: DiscountMethod.PercentOff,
      discountPercent: 20,
    });
    // Nobody else holds one: the card's birthday card is his alone.
    expect(
      seeded.grants
        .filter(({ data }) => data.couponId === 'coupon-birthday')
        .map(idOf),
    ).toEqual(['grant-dev-martin-birthday']);
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s every coupon the journal says was granted is a grant the seed writes, to the instant',
    (_label, nowMs) => {
      const { book, today, catalog, grants } = promotionsOn(nowMs);
      const written = new Map(grants.map((write) => [idOf(write), write.data]));
      for (const holder of LOYALTY_HOLDERS) {
        const user = book.users.find((entry) => entry.uid === holder.uid);
        const { clientJournal } = projectLoyaltyFor(
          DOMAIN,
          holder.uid,
          book.appointments,
          catalog,
          today,
          {
            profile: {
              email: user.doc.email,
              birthDate: user.doc.birthDate,
              hasAvatar: false,
            },
            redemptions: holder.redemptions,
            stampGrants: holder.stampGrants,
          },
        );
        const named = Object.values(clientJournal).flatMap((row) =>
          row.journalEffect === 'REWARD'
            ? [[row.rewardCouponGrantId, row, PublicLabel.param(row, 'coupon')]]
            : row.journalEffect === 'REDEMPTION'
              ? [
                  [
                    row.grantCouponGrantId,
                    row,
                    catalog.rewardsCatalog[row.redeemedRewardId].grantCouponId,
                  ],
                ]
              : [],
        );
        expect(named.length, holder.uid).toBeGreaterThanOrEqual(2);
        for (const [grantId, row, couponId] of named) {
          expect(written.get(grantId), grantId).toMatchObject({
            customerId: customerIdOf(holder.uid),
            holderUserId: holder.uid,
            couponId,
            // The row and the grant name one instant, to the millisecond.
            grantedAtUtcMs: row.utcEpochMs,
          });
          // …and one client record (D29): the row's, the grant's.
          expect(row.customerId, grantId).toBe(customerIdOf(holder.uid));
        }
        // And the seed writes no grant of the engine's the journal does not name.
        expect(
          grants
            .filter(
              (write) =>
                write.data.holderUserId === holder.uid &&
                !idOf(write).startsWith('grant-dev-martin-birthday') &&
                !idOf(write).startsWith('grant-dev-martin-used'),
            )
            .map(idOf)
            .sort(),
        ).toEqual(named.map(([grantId]) => grantId).sort());
      }
    },
  );

  it('are the same documents on a second run the same day', () => {
    expect(promotionsOn(NOW + 60_000).writes).toEqual(seeded.writes);
  });
});

describe('the gift vouchers', () => {
  const seeded = promotionsOn(NOW);
  const documents = Object.fromEntries(
    seeded.vouchers.map((write) => [idOf(write), write.data]),
  );

  it('are written to the adapters’ collection, and say their record and their account', () => {
    expect(GIFT_VOUCHERS_COLLECTION).toBe(Collections.GiftVouchers);
    for (const { path, data } of seeded.vouchers) {
      expect(path.startsWith(`${Collections.GiftVouchers}/`)).toBe(true);
      // The staff card reads by record, the client's own list by account.
      expect(Object.keys(data)).toContain('issuedToCustomerId');
      expect(Object.keys(data)).toContain('holderUserId');
      expect(data.issuedToCustomerId, path).toBe(
        data.holderUserId === null ? null : customerIdOf(data.holderUserId),
      );
    }
  });

  it('are the fixtures’ vouchers, fact for fact, on the fixtures’ day — and the seed’s own spent one', () => {
    expect(LOYALTY_CATALOG_TODAY).toBe(FIXTURE_TODAY);
    const onFixturesDay = promotionsOn(
      Date.parse(`${FIXTURE_TODAY}T20:00:00+03:00`),
    ).vouchers;
    const { 'voucher-dev-empty': spent, ...fromTheFile } = Object.fromEntries(
      onFixturesDay.map((write) => [idOf(write), write.data]),
    );
    expect(Object.keys(fromTheFile)).toEqual(
      Object.keys(giftVouchersJson.giftVouchers),
    );
    // The file IS the flat body (Law 5): what the seed writes on the
    // fixtures' day is the file's document, key for key.
    for (const [id, body] of Object.entries(giftVouchersJson.giftVouchers)) {
      expect(fromTheFile[id], id).toEqual(body);
    }
    expect(spent).toMatchObject({
      code: 'EMPTY001',
      balanceCents: 0,
      issuedToCustomerId: null,
      holderUserId: null,
      voucherStatus: VoucherStatus.Active,
    });
  });

  it('Георги holds one he can spend: 25,00 € left of 50,00 €, to the end of the year', () => {
    const his = Object.entries(documents).filter(
      ([, data]) => data.issuedToCustomerId === customerIdOf('dev-client-1'),
    );
    // Three by record, as the reader returns them: the card keeps the one
    // that is active with money on it.
    expect(his.map(([id]) => id)).toEqual([
      'voucher-dev-georgi',
      'voucher-dev-georgi-spent',
      'voucher-dev-georgi-void',
    ]);
    const spendable = his
      .map(([, data]) => data)
      .filter(
        (voucher) =>
          voucher.voucherStatus === VoucherStatus.Active &&
          voucher.balanceCents > 0,
      );
    expect(spendable).toHaveLength(1);
    const [gift] = spendable;
    expect(gift.code).toBe('GIFT50');
    expect(gift.balanceCents).toBe(2500);
    expect(gift.initialValueCents).toBe(5000);
    expect(gift.currency).toBe('EUR');
    expect(gift.expiresAtUtcMs).toBe(
      Date.parse('2026-12-31T23:59:59.999+02:00'),
    );
    expect(gift.expiresLocalDate).toBe('2026-12-31');
    expect(gift.holderUserId).toBe('dev-client-1');
  });

  it('keeps Мартин’s whole one, and the paper ones nobody holds', () => {
    const by = (holder) =>
      Object.values(documents)
        .filter((data) => data.holderUserId === holder)
        .map((data) => data.code);
    expect(by('dev-client-2')).toEqual(['GIFT2025']);
    expect(by(null)).toEqual(['GIFT5', 'EMPTY001']);
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s each is one lifecycle variant, its money in cents beside its currency',
    (_label, nowMs) => {
      const { vouchers } = promotionsOn(nowMs);
      expect(vouchers).toHaveLength(6);
      for (const { path, data } of vouchers) {
        expect(Object.values(VoucherStatus), path).toContain(
          data.voucherStatus,
        );
        const voided = data.voucherStatus === VoucherStatus.Void;
        expect('voidedAtUtcMs' in data, path).toBe(voided);
        expect('voidReason' in data, path).toBe(voided);
        expect(Number.isInteger(data.balanceCents), path).toBe(true);
        expect(data.balanceCents, path).toBeLessThanOrEqual(
          data.initialValueCents,
        );
        expect(data.currency, path).toBe('EUR');
        // The two halves of an expiry agree: both, or neither.
        expect(data.expiresAtUtcMs === null, path).toBe(
          data.expiresLocalDate === null,
        );
        expect(JSON.parse(JSON.stringify(data)), path).toEqual(data);
      }
    },
  );

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s Георги’s is good to the end of a month, two to three months on, and was issued before today',
    (_label, nowMs) => {
      const { today, vouchers } = promotionsOn(nowMs);
      const gift = vouchers.find(
        (write) => idOf(write) === 'voucher-dev-georgi',
      ).data;
      const lapsesOn = gift.expiresLocalDate;
      // The day's last millisecond on the shop's clock: the next is the
      // first of the next day there.
      expect(SHOP_TIME.format(new Date(gift.expiresAtUtcMs))).toBe(
        '23:59:59.999',
      );
      expect(shopDayOf(gift.expiresAtUtcMs)).toBe(lapsesOn);
      expect(gift.expiresAtUtcMs + 1).toBe(
        ZonedTimeSystem.startOfLocalDay(
          LocalDate.addDays(lapsesOn, 1),
          SHOP_ZONE,
        ),
      );
      // The last day of its month: the day after is a first.
      expect(LocalDate.addDays(lapsesOn, 1).slice(8, 10)).toBe('01');
      const ahead = dayNumber(lapsesOn) - dayNumber(today);
      expect(ahead).toBeGreaterThanOrEqual(64);
      expect(ahead).toBeLessThanOrEqual(94);
      expect(shopDayOf(gift.issuedAtUtcMs) < today).toBe(true);
      // The voided one was voided after it was issued, the same day.
      const voided = vouchers.find(
        (write) => idOf(write) === 'voucher-dev-georgi-void',
      ).data;
      expect(voided.voidedAtUtcMs - voided.issuedAtUtcMs).toBe(4 * 60_000);
    },
  );
});

describe('readPromotionWrites', () => {
  const seeded = promotionsOn(NOW);

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s reads every coupon, grant and voucher the seed writes',
    (_label, nowMs) => {
      const { coupons, grants, vouchers, writes } = promotionsOn(nowMs);
      const read = readPromotionWrites(writes);
      expect(read.problems).toEqual([]);
      expect(read.coupons).toHaveLength(coupons.length);
      expect(read.grants).toHaveLength(grants.length);
      expect(read.vouchers).toHaveLength(vouchers.length);
    },
  );

  it('names each grant it refuses, and each path no promotion is written at', () => {
    const [grant] = seeded.grants;
    const [voucher] = seeded.vouchers;
    expect(grant.data.discountMethod).toBe(DiscountMethod.PercentOff);
    const read = readPromotionWrites([
      ...seeded.coupons,
      { path: grant.path, data: { ...grant.data, couponId: 'coupon-gone' } },
      {
        path: grant.path,
        data: { ...grant.data, discountMethod: DiscountMethod.FreeService },
      },
      { path: `${voucher.path}/draws/one`, data: {} },
      { path: 'loyaltyAccounts/dev-client-1', data: {} },
    ]);
    expect(read.coupons).toHaveLength(seeded.coupons.length);
    expect(read.grants).toEqual([]);
    expect(read.vouchers).toEqual([]);
    expect(read.problems).toEqual([
      `${grant.path}: grants coupon-gone, which is not seeded`,
      `${grant.path}: its value is not ${grant.data.couponId}'s`,
      `${voucher.path}/draws/one: no promotion is written there`,
      'loyaltyAccounts/dev-client-1: no promotion is written there',
    ]);
  });
});
