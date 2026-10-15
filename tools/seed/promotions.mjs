/**
 * PROMOTIONS for the dev seed: the coupons, the grants that put one in a
 * client's hands, and the gift vouchers — what the visit sheet's «Отстъпка»
 * page can offer (2026-09-10) and what the client card shows as held
 * (client-card-revision-3.md §4.5, §4.6). The BODIES are TypeScript (flip
 * 1): `fixtures/promotions.fixtures.ts`, each `satisfies` its archetype
 * (`Coupon`, `CouponGrant`, `GiftVoucher`); this module decides WHO holds
 * WHAT and WHEN, as plain `{ path, data }` writes, every instant from the
 * shop's calendar or the book, so a second run the same day writes the
 * same documents. Nothing here touches Firebase.
 *
 * ### Coupons
 * Two open by CODE at the counter (`FIRST10`, `BEARD5`), one is retired
 * (`couponStatus: 'DISABLED'`), and four reach clients only as GRANTS.
 * `coupon-birthday` carries the OCCASION it is given for
 * (`couponOccasion: 'BIRTHDAY'`): the client card's birthday card shows the
 * gift when the grant's coupon says so, and never reads it off a name.
 *
 * ### Grants
 * Мартин (today's 12:30 chair, and today IS his birthday) holds the
 * birthday −20 %, and one already USED so the sheet can be seen filtering
 * it out; Петър a free fifth cut. And the coupons the loyalty engine
 * granted the two account holders, each under the id its journal row
 * names: what the stamp card minted (Георги still holds his newest — the
 * ticket his card shows as ready) and what they bought with points. A
 * grant rewards the client RECORD (`customerId`, D29) and is read by its
 * account (`holderUserId`).
 *
 * ### Gift vouchers
 * Money already paid, drawn down by visits: the facts of the shared
 * fixture `vouchers.json` under `@core/testing`, moved by whole days from
 * the fixtures' day to the shop's today (as the seasons move): Георги
 * HOLDS `GIFT50`, 25,00 € left of 50,00 € — the pass «В портфейла» —
 * beside one he spent and one the shop voided, which a card must not
 * show; Мартин holds `GIFT2025`; `GIFT5` is paper, nobody's. `EMPTY001`,
 * the seed's own, was spent: the sheet must say so, not "no such code".
 */
import {
  COUPONS,
  couponGrantBody,
  giftVoucherBodies,
} from './fixtures/promotions.fixtures.ts';
import {
  LOYALTY_CATALOG_TODAY,
  LOYALTY_HOLDERS,
  punchCardGrantsOf,
  redemptionGrantsOf,
} from './loyalty.mjs';

export { COUPONS };

// ── The collections (`Collections` of `@core/entities`; the spec holds them equal) ─

export const COUPONS_COLLECTION = 'coupons';
export const COUPON_GRANTS_COLLECTION = 'couponGrants';
export const GIFT_VOUCHERS_COLLECTION = 'giftVouchers';

const DAY_MS = 86_400_000;
const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

// ── Coupons ────────────────────────────────────────────────────────────────

export function couponWritesOf() {
  return COUPONS.map(({ id, body }) => ({
    path: `${COUPONS_COLLECTION}/${id}`,
    data: body,
  }));
}

// ── Grants ─────────────────────────────────────────────────────────────────

/** `couponGrants/{id}`: `uid`'s record holds `couponId`, granted then — still held, or used at `usedAtUtcMs`. */
const grant = (id, uid, couponId, grantedAtUtcMs, usedAtUtcMs) => ({
  path: `${COUPON_GRANTS_COLLECTION}/${id}`,
  data: couponGrantBody(uid, couponId, grantedAtUtcMs, usedAtUtcMs),
});

/**
 * Every grant the seed writes. `book` is `buildClientBook`'s, `catalog` the
 * loyalty catalogue the accounts are projected under, `today` the shop's
 * day. The desk's three are dated three days ago at noon on the shop's
 * calendar, not three days before the clock; the engine's by the visit
 * that earned each, from the same visits the journal is folded from.
 */
export function couponGrantWritesOf(book, catalog, today) {
  const { calendar, appointments } = book;
  const deskMs = calendar.msAt(-3, 12, 0);
  const engine = LOYALTY_HOLDERS.flatMap((holder) =>
    [
      ...punchCardGrantsOf(holder.uid, appointments, today, holder.stampGrants),
      ...redemptionGrantsOf(
        holder.uid,
        appointments,
        catalog,
        today,
        holder.redemptions,
      ),
    ].map((granted) => ({ ...granted, uid: holder.uid })),
  );
  return [
    grant(
      'grant-dev-martin-birthday',
      'dev-client-2',
      'coupon-birthday',
      deskMs,
      null,
    ),
    grant(
      'grant-dev-martin-used',
      'dev-client-2',
      'coupon-first10',
      deskMs,
      deskMs,
    ),
    grant(
      'grant-dev-petar-fifth',
      'dev-client-3',
      'coupon-fifth-cut',
      deskMs,
      null,
    ),
    ...engine.map((granted) =>
      grant(
        granted.grantId,
        granted.uid,
        granted.couponId,
        granted.grantedAtUtcMs,
        granted.usedAtUtcMs,
      ),
    ),
  ];
}

// ── Gift vouchers ──────────────────────────────────────────────────────────

/**
 * The fixture file's vouchers as of the shop's today — every instant moved
 * by the whole days between the fixtures' day and today, keeping its
 * reading of the shop's clock — and the seed's own spent one, issued three
 * days ago at noon on the shop's calendar.
 */
export function giftVoucherWritesOf(calendar) {
  const shiftDays =
    dayNumber(calendar.dayKeyAt(0)) - dayNumber(LOYALTY_CATALOG_TODAY);
  return giftVoucherBodies(shiftDays, calendar.msAt(-3, 12, 0)).map(
    ({ id, body }) => ({ path: `${GIFT_VOUCHERS_COLLECTION}/${id}`, data: body }),
  );
}

// ── Read back, before anything is written ──────────────────────────────────

/** The fields of a grant that ARE its coupon's value (`CouponValue`), by discount method. */
const VALUE_FIELDS = Object.freeze([
  'discountMethod',
  'discountPercent',
  'discountAmountCents',
  'discountCurrency',
]);

const valueOf = (body) =>
  Object.fromEntries(
    VALUE_FIELDS.filter((field) => field in body).map((field) => [
      field,
      body[field],
    ]),
  );

/**
 * Holds promotion writes to what they point at before the seed writes
 * them. A body's own shape is held by the type checker (every builder
 * `satisfies` its archetype); what no type can say is held here: a grant
 * grants a coupon among `writes`, at that coupon's value, and each write is
 * a document of a promotion collection.
 *
 * Answers what was read and a `problems` line per document refused; the
 * seed writes nothing while there is one.
 */
export function readPromotionWrites(writes) {
  const read = { coupons: [], vouchers: [], grants: [], problems: [] };
  const couponData = new Map(
    writes
      .filter(({ path }) => path.startsWith(`${COUPONS_COLLECTION}/`))
      .map(({ path, data }) => [path.split('/').at(-1), data]),
  );
  for (const { path, data } of writes) {
    const [collection, , ...deeper] = path.split('/');
    if (deeper.length > 0) {
      read.problems.push(`${path}: no promotion is written there`);
    } else if (collection === COUPONS_COLLECTION) {
      read.coupons.push(data);
    } else if (collection === GIFT_VOUCHERS_COLLECTION) {
      read.vouchers.push(data);
    } else if (collection === COUPON_GRANTS_COLLECTION) {
      const granted = couponData.get(data.couponId);
      if (granted === undefined) {
        read.problems.push(
          `${path}: grants ${data.couponId}, which is not seeded`,
        );
      } else if (
        JSON.stringify(valueOf(granted)) !== JSON.stringify(valueOf(data))
      ) {
        read.problems.push(`${path}: its value is not ${data.couponId}'s`);
      } else {
        read.grants.push(data);
      }
    } else {
      read.problems.push(`${path}: no promotion is written there`);
    }
  }
  return read;
}
