/**
 * PROMOTIONS for the dev seed: the coupons, the grants that put one in a
 * client's hands, and the gift vouchers — what the visit sheet's «Отстъпка»
 * page can offer (2026-09-10) and what the client card shows as held
 * (client-card-revision-3.md §4.5, §4.6). Plain `{ path, data }` writes,
 * every instant from the shop's calendar or the book, so a second run the
 * same day writes the same documents. Nothing here touches Firebase.
 *
 * ### Coupons
 * Two open by CODE at the counter (`FIRST10`, `BEARD5`), one is retired,
 * and four reach clients only as GRANTS. A coupon document holds every
 * field the production writer writes (`couponToPersistence`), the ones
 * that say "none" included. `coupon-birthday` carries the OCCASION it is
 * given for: the client card's birthday card shows the gift when the
 * grant's coupon says `birthday`, and never reads it off a name.
 *
 * ### Grants
 * Мартин (today's 12:30 chair, and today IS his birthday) holds the
 * birthday −20 %, and one already USED so the sheet can be seen filtering
 * it out; Петър a free fifth cut. And the coupons the loyalty engine
 * granted the two account holders, each under the id its journal row
 * names: what the stamp card minted (Георги still holds his newest — the
 * ticket his card shows as ready) and what they bought with points.
 *
 * ### Gift vouchers
 * Money already paid, drawn down by visits. The vouchers ARE the fixture
 * file `vouchers.json` under `@creativo/ecs-core/testing` (moved there
 * from `@creativo/application/engagement/testing`, which re-exports it, in
 * the ECS migration's Phase 3a), which the mapper's spec parses and the
 * in-memory reader serves, moved by
 * whole days from the fixtures' day to the shop's today (as the seasons
 * move): Георги HOLDS `GIFT50`, 25,00 € left of 50,00 € — the pass
 * «В портфейла» — beside one he spent and one the shop voided, which a
 * card must not show; Мартин holds `GIFT2025`; `GIFT5` is paper, nobody's.
 * `EMPTY001`, the seed's own, was spent: the sheet must say so, not "no
 * such code".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wallTimeMovedBy } from './calendar.mjs';
import { WORKSPACE_ROOT } from './load-domain.mjs';
import {
  LOYALTY_CATALOG_TODAY,
  LOYALTY_HOLDERS,
  PUNCH_CARD,
  punchCardGrantsOf,
  redemptionGrantsOf,
} from './loyalty.mjs';

// ── The wire (the adapters' collections; the spec holds them equal) ────────

export const COUPONS_COLLECTION = 'coupons';
export const COUPON_GRANTS_COLLECTION = 'couponGrants';
export const GIFT_VOUCHERS_COLLECTION = 'giftVouchers';

const DAY_MS = 86_400_000;
const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

// ── Coupons ────────────────────────────────────────────────────────────────

const STACKABLE = Object.freeze({ kind: 'stackable' });
const EXCLUSIVE = Object.freeze({ kind: 'exclusive' });
const NEVER = Object.freeze({ kind: 'never' });
const FREE_SERVICE = Object.freeze({ kind: 'free_service' });

/** A coupon with every field the writer writes; `occasion` and the limit say "none" unless given. */
const coupon = (id, fields) =>
  Object.freeze({
    id,
    data: Object.freeze({
      usageLimit: null,
      enabled: true,
      occasion: null,
      ...fields,
    }),
  });

export const COUPONS = Object.freeze([
  coupon('coupon-first10', {
    name: 'Първо посещение',
    code: 'FIRST10',
    value: { kind: 'percent_off', percent: 10 },
    combinability: STACKABLE,
    expiry: NEVER,
  }),
  coupon('coupon-beard5', {
    name: 'Брада −5 €',
    code: 'BEARD5',
    value: { kind: 'fixed_amount', amountMinorUnits: 500, currencyCode: 'EUR' },
    combinability: STACKABLE,
    expiry: NEVER,
  }),
  coupon('coupon-retired', {
    name: 'Лятна промоция',
    code: 'SUMMER',
    value: { kind: 'percent_off', percent: 15 },
    combinability: STACKABLE,
    expiry: NEVER,
    // Retired: the code must read as "no such code" at the counter.
    enabled: false,
  }),
  coupon('coupon-birthday', {
    name: 'Рожден ден',
    code: null,
    value: { kind: 'percent_off', percent: 20 },
    combinability: EXCLUSIVE,
    expiry: { kind: 'days', days: 30 },
    // What makes a grant of it THE birthday gift (§4.6).
    occasion: 'birthday',
  }),
  coupon('coupon-fifth-cut', {
    name: 'Пето подстригване',
    code: null,
    value: FREE_SERVICE,
    combinability: EXCLUSIVE,
    expiry: NEVER,
  }),
  // The stamp card's reward, minted at every tenth worked visit — and what
  // «Безплатно подстригване» in the rewards catalogue grants.
  coupon(PUNCH_CARD.couponId, {
    name: 'Безплатно подстригване',
    code: null,
    value: FREE_SERVICE,
    combinability: EXCLUSIVE,
    expiry: NEVER,
  }),
  // What «Безплатно оформяне на брада» in the rewards catalogue grants.
  coupon('coupon-free-beard', {
    name: 'Безплатно оформяне на брада',
    code: null,
    value: FREE_SERVICE,
    combinability: EXCLUSIVE,
    expiry: NEVER,
  }),
]);

export function couponWritesOf() {
  return COUPONS.map(({ id, data }) => ({
    path: `${COUPONS_COLLECTION}/${id}`,
    data,
  }));
}

// ── Grants ─────────────────────────────────────────────────────────────────

const HELD = Object.freeze({
  kind: 'active',
  capacity: Object.freeze({ kind: 'single_use' }),
  expiration: Object.freeze({ kind: 'no_expiry' }),
});
const usedAt = (iso) => ({ kind: 'used', usedAtIso: iso, note: 'seed' });

function valueOf(couponId) {
  const found = COUPONS.find(({ id }) => id === couponId);
  if (!found) throw new Error(`seed: no coupon ${couponId} to grant`);
  return found.data.value;
}

const grant = (id, userId, couponId, grantedAt, state) => ({
  path: `${COUPON_GRANTS_COLLECTION}/${id}`,
  data: { id, userId, couponId, value: valueOf(couponId), grantedAt, state },
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
  const deskIso = new Date(calendar.msAt(-3, 12, 0)).toISOString();
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
    ].map((granted) => ({ ...granted, userId: holder.uid })),
  );
  return [
    grant(
      'grant-dev-martin-birthday',
      'dev-client-2',
      'coupon-birthday',
      deskIso,
      HELD,
    ),
    grant(
      'grant-dev-martin-used',
      'dev-client-2',
      'coupon-first10',
      deskIso,
      usedAt(deskIso),
    ),
    grant(
      'grant-dev-petar-fifth',
      'dev-client-3',
      'coupon-fifth-cut',
      deskIso,
      HELD,
    ),
    ...engine.map((granted) =>
      grant(
        granted.grantId,
        granted.userId,
        granted.couponId,
        granted.grantedAt,
        granted.usedAt === null ? HELD : usedAt(granted.usedAt),
      ),
    ),
  ];
}

// ── Gift vouchers ──────────────────────────────────────────────────────────

const VOUCHERS_FILE = join(
  WORKSPACE_ROOT,
  'libs/ecs-core/src/testing/fixtures/loyalty/vouchers.json',
);

/** How many days a date is past the last day of the month before it; none on a month's own last day. */
function daysPastMonthEnd(day) {
  const [year, month, date] = day.split('-').map(Number);
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return date === lastOfMonth ? 0 : date;
}

/**
 * `vouchers.json` as of the shop's `today`: every instant it holds (issued,
 * expires, voided) moved by the whole days between the fixtures' day and
 * `today`, each keeping its reading of the shop's clock. A fresh copy per
 * call, keyed by voucher id.
 *
 * A voucher is good to the END OF A MONTH, as the fixtures' is («до
 * 31.12»): where the moved day is not a month's last, the voucher lapses
 * with the month before it. A day after the fixtures' that is still 31
 * December, not «до 1.01»; it is never less than two months away.
 */
export function giftVouchersFor(today) {
  const { giftVouchers } = JSON.parse(readFileSync(VOUCHERS_FILE, 'utf8'));
  const shift = dayNumber(today) - dayNumber(LOYALTY_CATALOG_TODAY);
  const moved = (instant, days = shift) =>
    instant === null
      ? null
      : {
          iso: wallTimeMovedBy(instant.iso, days, instant.zone),
          zone: instant.zone,
        };
  const lapses = (instant) => {
    const on = moved(instant);
    return on === null
      ? null
      : moved(on, -daysPastMonthEnd(on.iso.slice(0, 10)));
  };
  return Object.fromEntries(
    Object.entries(giftVouchers).map(([id, voucher]) => [
      id,
      {
        ...voucher,
        issuedAt: moved(voucher.issuedAt),
        expiresAt: lapses(voucher.expiresAt),
        state:
          voucher.state.kind === 'void'
            ? { ...voucher.state, voidedAt: moved(voucher.state.voidedAt) }
            : voucher.state,
      },
    ]),
  );
}

/** The fixture file's vouchers as of the shop's today, and the seed's own spent one. */
export function giftVoucherWritesOf(calendar) {
  return [
    ...Object.entries(giftVouchersFor(calendar.dayKeyAt(0))).map(
      ([id, data]) => ({ path: `${GIFT_VOUCHERS_COLLECTION}/${id}`, data }),
    ),
    {
      path: `${GIFT_VOUCHERS_COLLECTION}/voucher-dev-empty`,
      data: {
        code: 'EMPTY001',
        initialValueMinorUnits: 1000,
        balanceMinorUnits: 0,
        currencyCode: 'EUR',
        // Three days ago at noon, on the shop's clock.
        issuedAt: { iso: calendar.isoAt(-3, 12, 0), zone: calendar.zone },
        expiresAt: null,
        issuedToUserId: null,
        state: { kind: 'active' },
      },
    },
  ];
}

// ── Read back, as the app reads ────────────────────────────────────────────

/**
 * Reads promotion writes back before the seed writes them — `readers` is
 * `loadSeedDomain()`: a coupon through the adapters' own
 * `couponFromPersistence` (a word the domain does not know for an
 * occasion FAILS the coupon there, which is how a typo would undress the
 * birthday gift), a voucher through `giftVoucherFromDocument`. A grant has
 * no reader outside its adapter, so it is held to what it points at: a
 * coupon among `writes`, and that coupon's value.
 *
 * Answers what was read and a `problems` line per document refused; the
 * seed writes nothing while there is one.
 */
export function readPromotionWrites(readers, writes) {
  const read = { coupons: [], vouchers: [], grants: [], problems: [] };
  const couponData = new Map(
    writes
      .filter(({ path }) => path.startsWith(`${COUPONS_COLLECTION}/`))
      .map(({ path, data }) => [path.split('/').at(-1), data]),
  );
  for (const { path, data } of writes) {
    const [collection, id, ...deeper] = path.split('/');
    if (deeper.length > 0) {
      read.problems.push(`${path}: no promotion is written there`);
    } else if (collection === COUPONS_COLLECTION) {
      const parsed = readers.couponFromPersistence(id, data);
      if (parsed.isSuccess()) read.coupons.push(parsed.value);
      else read.problems.push(`${path}: ${parsed.error.message}`);
    } else if (collection === GIFT_VOUCHERS_COLLECTION) {
      const voucher = readers.giftVoucherFromDocument(id, data);
      if (voucher !== null) read.vouchers.push(voucher);
      else read.problems.push(`${path}: not a gift voucher`);
    } else if (collection === COUPON_GRANTS_COLLECTION) {
      const granted = couponData.get(data.couponId);
      if (granted === undefined) {
        read.problems.push(
          `${path}: grants ${data.couponId}, which is not seeded`,
        );
      } else if (JSON.stringify(granted.value) !== JSON.stringify(data.value)) {
        read.problems.push(`${path}: its value is not ${data.couponId}'s`);
      } else if (data.id !== id) {
        read.problems.push(`${path}: names itself ${data.id}`);
      } else {
        read.grants.push(data);
      }
    } else {
      read.problems.push(`${path}: no promotion is written there`);
    }
  }
  return read;
}
