/**
 * The seed's promotions, held to the production code that reads them
 * (client-card-revision-3.md §4.5, §4.6): every coupon reads through the
 * adapters' own mapper and writes back as the very document, the birthday
 * coupon says what it is given for, the gift vouchers ARE the fixture file
 * on the fixtures' day and follow the shop's today on any other, and every
 * coupon the loyalty journal says was granted is a grant the seed writes.
 */
import {
  GIFT_VOUCHERS_COLLECTION as WIRE_GIFT_VOUCHERS,
  GIFT_VOUCHER_HOLDER_FIELD,
  giftVoucherFromDocument,
  giftVoucherToDocument,
  streakScheduleFromDocument,
  streakStateToDocument,
} from '@creativo/application/engagement';
import { loyaltyFixtures } from '@creativo/application/engagement/testing';
import { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
import { COUPON_OCCASIONS } from '@creativo/domain/engagement';
import { describe, expect, it } from 'vitest';
import { traceStreak } from '../../libs/domain/engagement/src/lib/loyalty/streak-projector';
import {
  couponFromPersistence,
  couponToPersistence,
} from '../../libs/infrastructure/firestore/src/lib/coupon-persistence';
import { Collections } from '../../libs/infrastructure/firestore/src/lib/firestore-paths';
import { createShopCalendar, wallTimeMovedBy } from './calendar.mjs';
import { buildClientBook } from './fixtures.mjs';
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
  giftVouchersFor,
  readPromotionWrites,
} from './promotions.mjs';

const DAY_MS = 86_400_000;
const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

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

/** The readers, imported the ordinary way (`load-domain.spec.mjs` holds the bundle's equal). */
const READERS = { couponFromPersistence, giftVoucherFromDocument };
const DOMAIN = {
  ServiceCategoryId,
  ServiceId,
  streakScheduleFromDocument,
  streakStateToDocument,
  traceStreak,
};

const idOf = ({ path }) => path.split('/').at(-1);

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
    '%s reads through the adapters’ mapper, and writes back as the very document',
    (id, { data }) => {
      const coupon = couponFromPersistence(id, data);
      expect(coupon.isSuccess()).toBe(true);
      // Every field the production writer writes, the ones that say "none" too.
      expect(couponToPersistence(coupon.value)).toEqual(data);
    },
  );

  it('says what the birthday coupon is given for, and gives no other an occasion', () => {
    const occasions = Object.fromEntries(
      couponWritesOf().map((write) => [
        idOf(write),
        couponFromPersistence(idOf(write), write.data).value.occasion,
      ]),
    );
    expect(occasions).toEqual({
      'coupon-first10': null,
      'coupon-beard5': null,
      'coupon-retired': null,
      'coupon-birthday': 'birthday',
      'coupon-fifth-cut': null,
      [PUNCH_CARD.couponId]: null,
      'coupon-free-beard': null,
    });
    expect(COUPON_OCCASIONS).toContain('birthday');
    // Written, never left out: a save that drops the field undresses the gift.
    for (const { data } of couponWritesOf()) {
      expect(Object.keys(data)).toContain('occasion');
    }
  });

  it('keeps the two codes of the counter, and the retired one off', () => {
    const coupons = couponWritesOf().map(
      (write) => couponFromPersistence(idOf(write), write.data).value,
    );
    expect(
      coupons
        .filter((coupon) => coupon.code !== null)
        .map((coupon) => [coupon.code, coupon.enabled]),
    ).toEqual([
      ['FIRST10', true],
      ['BEARD5', true],
      ['SUMMER', false],
    ]);
  });
});

describe('the grants', () => {
  const seeded = promotionsOn(NOW);
  const grantsOf = (uid) =>
    seeded.grants.filter(({ data }) => data.userId === uid);
  const held = (uid) =>
    grantsOf(uid)
      .filter(({ data }) => data.state.kind === 'active')
      .map(idOf);

  it('are written to the adapters’ collection, each under its own id', () => {
    expect(COUPON_GRANTS_COLLECTION).toBe(Collections.CouponGrants);
    for (const write of seeded.grants) {
      expect(write.path).toBe(`couponGrants/${write.data.id}`);
    }
    expect(new Set(seeded.grants.map(idOf)).size).toBe(seeded.grants.length);
  });

  it('put in each client’s hands what their card shows as ready, and nothing they have used', () => {
    // Георги: the free cut of his twentieth stamp, under the id the card has always shown.
    expect(held('dev-client-1')).toEqual(['grant-dev-georgi-punch']);
    // Мартин: the birthday gift. Петър: his fifth cut.
    expect(held('dev-client-2')).toEqual(['grant-dev-martin-birthday']);
    expect(held('dev-client-3')).toEqual(['grant-dev-petar-fifth']);
    expect(
      seeded.grants.filter(({ data }) => data.state.kind === 'used').map(idOf),
    ).toEqual([
      'grant-dev-martin-used',
      'grant-dev-georgi-punch-10',
      'grant-rdm-dev-georgi-cut',
      'grant-dev-martin-punch-10',
      'grant-rdm-dev-martin-beard',
    ]);
    for (const { data } of seeded.grants) {
      if (data.state.kind !== 'used') continue;
      expect(data.state.usedAtIso >= data.grantedAt, data.id).toBe(true);
      expect(data.state.note).toBe('seed');
    }
  });

  it('Мартин’s gift is a grant of the coupon that says birthday', () => {
    const [gift] = grantsOf('dev-client-2').filter(
      ({ data }) => data.state.kind === 'active',
    );
    const coupon = COUPONS.find(({ id }) => id === gift.data.couponId);
    expect(coupon.data.occasion).toBe('birthday');
    expect(gift.data.value).toEqual({ kind: 'percent_off', percent: 20 });
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
      const written = new Map(grants.map(({ data }) => [data.id, data]));
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
          row.effect.kind === 'reward'
            ? [[row.effect.ref.id, row, row.publicLabel.params.coupon]]
            : row.effect.kind === 'redemption'
              ? [
                  [
                    row.effect.grant.id,
                    row,
                    catalog.rewardsCatalog[row.effect.rewardId].grants.couponId,
                  ],
                ]
              : [],
        );
        expect(named.length, holder.uid).toBeGreaterThanOrEqual(2);
        for (const [grantId, row, couponId] of named) {
          expect(written.get(grantId), grantId).toMatchObject({
            id: grantId,
            userId: holder.uid,
            couponId,
            grantedAt: row.at,
          });
        }
        // And the seed writes no grant of the engine's the journal does not name.
        expect(
          grants
            .filter(
              ({ data }) =>
                data.userId === holder.uid &&
                !data.id.startsWith('grant-dev-martin-birthday') &&
                !data.id.startsWith('grant-dev-martin-used'),
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

  it('are written to the wire’s collection, and say their holder in the field a read by holder filters on', () => {
    expect(GIFT_VOUCHERS_COLLECTION).toBe(WIRE_GIFT_VOUCHERS);
    expect(GIFT_VOUCHERS_COLLECTION).toBe(Collections.GiftVouchers);
    for (const { path, data } of seeded.vouchers) {
      expect(path.startsWith(`${WIRE_GIFT_VOUCHERS}/`)).toBe(true);
      expect(Object.keys(data)).toContain(GIFT_VOUCHER_HOLDER_FIELD);
    }
  });

  it('are the fixtures’ vouchers, verbatim, on the fixtures’ day — and the seed’s own spent one', () => {
    expect(LOYALTY_CATALOG_TODAY).toBe(loyaltyFixtures.today);
    expect(giftVouchersFor(LOYALTY_CATALOG_TODAY)).toEqual(
      loyaltyFixtures.vouchers,
    );
    const { 'voucher-dev-empty': spent, ...fromTheFile } = documents;
    expect(fromTheFile).toEqual(loyaltyFixtures.vouchers);
    expect(spent).toMatchObject({
      code: 'EMPTY001',
      balanceMinorUnits: 0,
      issuedToUserId: null,
      state: { kind: 'active' },
    });
  });

  it('Георги holds one he can spend: 25,00 € left of 50,00 €, to the end of the year', () => {
    const his = Object.entries(documents).filter(
      ([, data]) => data[GIFT_VOUCHER_HOLDER_FIELD] === 'dev-client-1',
    );
    // Three by holder, as the reader returns them: the card keeps the one
    // that is active with money on it.
    expect(his.map(([id]) => id)).toEqual([
      'voucher-dev-georgi',
      'voucher-dev-georgi-spent',
      'voucher-dev-georgi-void',
    ]);
    const spendable = his
      .map(([id, data]) => giftVoucherFromDocument(id, data))
      .filter(
        (voucher) =>
          voucher.state.kind === 'active' && voucher.balance.toMinorUnits() > 0,
      );
    expect(spendable).toHaveLength(1);
    const [gift] = spendable;
    expect(gift.code).toBe('GIFT50');
    expect(gift.balance.toMinorUnits()).toBe(2500);
    expect(gift.initialValue.toMinorUnits()).toBe(5000);
    expect(gift.balance.currencyCode()).toBe('EUR');
    expect(gift.expiresAt.toISO()).toBe('2026-12-31T23:59:59.999+02:00');
    expect(gift.issuedToUserId.value).toBe('dev-client-1');
  });

  it('keeps Мартин’s whole one, and the paper ones nobody holds', () => {
    const by = (holder) =>
      Object.values(documents)
        .filter((data) => data[GIFT_VOUCHER_HOLDER_FIELD] === holder)
        .map((data) => data.code);
    expect(by('dev-client-2')).toEqual(['GIFT2025']);
    expect(by(null)).toEqual(['GIFT5', 'EMPTY001']);
  });

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s each reads back as a voucher and writes back as the very document',
    (_label, nowMs) => {
      const { vouchers } = promotionsOn(nowMs);
      expect(vouchers).toHaveLength(6);
      for (const { path, data } of vouchers) {
        const voucher = giftVoucherFromDocument(idOf({ path }), data);
        expect(voucher, path).not.toBeNull();
        expect(giftVoucherToDocument(voucher), path).toEqual(data);
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
      const [lapsesOn, clock] = gift.expiresAt.iso.split('T');
      expect(clock.slice(0, 12)).toBe('23:59:59.999');
      // The last day of its month: the day after is a first.
      const dayAfter = new Date((dayNumber(lapsesOn) + 1) * DAY_MS)
        .toISOString()
        .slice(8, 10);
      expect(dayAfter).toBe('01');
      const ahead = dayNumber(lapsesOn) - dayNumber(today);
      expect(ahead).toBeGreaterThanOrEqual(64);
      expect(ahead).toBeLessThanOrEqual(94);
      expect(gift.issuedAt.iso.slice(0, 10) < today).toBe(true);
      // The voided one was voided after it was issued, the same day.
      const voided = vouchers.find(
        (write) => idOf(write) === 'voucher-dev-georgi-void',
      ).data;
      expect(
        Date.parse(voided.state.voidedAt.iso) - Date.parse(voided.issuedAt.iso),
      ).toBe(4 * 60_000);
    },
  );
});

describe('wallTimeMovedBy', () => {
  it('keeps the reading of the clock and takes the offset of the day it lands on', () => {
    const end = '2026-12-31T23:59:59.999+02:00';
    expect(wallTimeMovedBy(end, 0)).toBe(end);
    expect(wallTimeMovedBy(end, 1)).toBe('2027-01-01T23:59:59.999+02:00');
    // Across the spring change, and back across the autumn one.
    expect(wallTimeMovedBy(end, 200)).toBe('2027-07-19T23:59:59.999+03:00');
    expect(wallTimeMovedBy('2026-06-13T10:45:00.000+03:00', -200)).toBe(
      '2025-11-25T10:45:00.000+02:00',
    );
    // The night the clocks go forward in Sofia, either side of 03:00.
    expect(wallTimeMovedBy('2026-03-28T02:30:00.000+02:00', 1)).toBe(
      '2026-03-29T02:30:00.000+02:00',
    );
    expect(wallTimeMovedBy('2026-03-28T04:30:00.000+02:00', 1)).toBe(
      '2026-03-29T04:30:00.000+03:00',
    );
    // A leap day is a day.
    expect(wallTimeMovedBy('2028-02-28T12:00:00.000+02:00', 1)).toBe(
      '2028-02-29T12:00:00.000+02:00',
    );
  });

  it('moves by the shop’s days whatever the calendar it is asked from', () => {
    const calendar = createShopCalendar(NOW);
    expect(wallTimeMovedBy(calendar.isoAt(0, 12, 0), -3)).toBe(
      calendar.isoAt(-3, 12, 0),
    );
    expect(wallTimeMovedBy(calendar.isoAt(0, 9, 30), 40)).toBe(
      calendar.isoAt(40, 9, 30),
    );
  });

  it('refuses what is not a wall time of the zone', () => {
    expect(() => wallTimeMovedBy('2026-12-31T21:59:59.999Z', 1)).toThrow(
      /not a wall time of Europe\/Sofia/,
    );
    expect(() => wallTimeMovedBy('2026-12-31T23:59:59.999+03:00', 1)).toThrow(
      /not a wall time of Europe\/Sofia/,
    );
    expect(() => wallTimeMovedBy('31.12.2026', 1)).toThrow(/no wall time/);
  });
});

describe('readPromotionWrites', () => {
  const seeded = promotionsOn(NOW);

  it.each(ANCHORS.map((ms) => [new Date(ms).toISOString(), ms]))(
    'on %s reads every coupon, grant and voucher the seed writes',
    (_label, nowMs) => {
      const { coupons, grants, vouchers, writes } = promotionsOn(nowMs);
      const read = readPromotionWrites(READERS, writes);
      expect(read.problems).toEqual([]);
      expect(read.coupons).toHaveLength(coupons.length);
      expect(read.grants).toHaveLength(grants.length);
      expect(read.vouchers).toHaveLength(vouchers.length);
    },
  );

  it('names a coupon given for an occasion nobody knows: a typo must not pass for none', () => {
    const [birthday] = seeded.coupons.filter(
      (write) => idOf(write) === 'coupon-birthday',
    );
    const read = readPromotionWrites(READERS, [
      { path: birthday.path, data: { ...birthday.data, occasion: 'birtday' } },
    ]);
    expect(read.coupons).toEqual([]);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0].startsWith('coupons/coupon-birthday: ')).toBe(true);
  });

  it('names each document it refuses, and each path no promotion is written at', () => {
    const [grant] = seeded.grants;
    const [voucher] = seeded.vouchers;
    const read = readPromotionWrites(READERS, [
      ...seeded.coupons,
      { path: grant.path, data: { ...grant.data, couponId: 'coupon-gone' } },
      {
        path: grant.path,
        data: { ...grant.data, value: { kind: 'free_service' } },
      },
      { path: 'couponGrants/another', data: grant.data },
      { path: voucher.path, data: { ...voucher.data, issuedAt: null } },
      { path: `${voucher.path}/draws/one`, data: {} },
      { path: 'loyaltyAccounts/dev-client-1', data: {} },
    ]);
    expect(read.coupons).toHaveLength(seeded.coupons.length);
    expect(read.grants).toEqual([]);
    expect(read.vouchers).toEqual([]);
    expect(read.problems).toEqual([
      `${grant.path}: grants coupon-gone, which is not seeded`,
      `${grant.path}: its value is not ${grant.data.couponId}'s`,
      `couponGrants/another: names itself ${grant.data.id}`,
      `${voucher.path}: not a gift voucher`,
      `${voucher.path}/draws/one: no promotion is written there`,
      'loyaltyAccounts/dev-client-1: no promotion is written there',
    ]);
  });
});
