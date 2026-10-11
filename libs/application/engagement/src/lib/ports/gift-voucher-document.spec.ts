import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/domain/kernel';
import type { GiftVoucher } from '@creativo/domain/engagement';
import { giftVouchersJson as vouchersJson } from '@core/testing';
import {
  GIFT_VOUCHERS_COLLECTION,
  GIFT_VOUCHER_HOLDER_FIELD,
  type GiftVoucherFields,
  giftVoucherFromDocument,
  giftVoucherToDocument,
} from './gift-voucher-document';

/**
 * The voucher fixtures are the wire: `giftVouchers/{id}` exactly as
 * Firestore holds them, on the loyalty fixtures' day (2026-09-28). Георги
 * holds three (one to spend, one spent, one the shop voided), Мартин one,
 * and one is paper: it belongs to whoever presents its code.
 */
const documents: Readonly<Record<string, unknown>> = vouchersJson.giftVouchers;

const GEORGI = 'dev-client-1';
const MARTIN = 'dev-client-2';

/** The fixtures' day at noon, in the shop's zone. */
const NOW = zoned('2026-09-28T12:00:00.000+03:00');

function zoned(iso: string): ZonedDateTime {
  const parsed = ZonedDateTime.fromISO(iso, 'Europe/Sofia');
  if (parsed.isFailure()) throw parsed.error;
  return parsed.value;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}

/** A fixture document, as a reader is handed it. */
function documentOf(id: string): Record<string, unknown> {
  const data = new Map(Object.entries(documents)).get(id);
  if (!isRecord(data)) throw new Error(`fixture: no voucher ${id}`);
  return data;
}

function voucherOf(id: string): GiftVoucher {
  const voucher = giftVoucherFromDocument(id, documentOf(id));
  if (voucher === null) throw new Error(`fixture: ${id} is not a voucher`);
  return voucher;
}

/** An unfrozen copy of a fixture document, changed by `edit`. */
function edited(
  id: string,
  edit: (copy: Record<string, unknown>) => void,
): Record<string, unknown> {
  const copy = structuredClone(documentOf(id));
  edit(copy);
  return copy;
}

/**
 * What a read by holder answers: the query's filter, then the reader, as
 * the adapter and the in-memory reader both run them.
 */
function heldBy(userId: string): readonly GiftVoucher[] {
  return Object.entries(documents).flatMap(([id, data]) => {
    if (
      !isRecord(data) ||
      new Map(Object.entries(data)).get(GIFT_VOUCHER_HOLDER_FIELD) !== userId
    ) {
      return [];
    }
    const voucher = giftVoucherFromDocument(id, data);
    return voucher === null ? [] : [voucher];
  });
}

describe('the voucher’s collection and its holder', () => {
  it('names the collection and the field a read by holder filters on', () => {
    expect(GIFT_VOUCHERS_COLLECTION).toBe('giftVouchers');
    expect(Object.keys(vouchersJson)).toEqual([GIFT_VOUCHERS_COLLECTION]);
    expect(GIFT_VOUCHER_HOLDER_FIELD).toBe('issuedToUserId');
  });

  it('writes the holder under that field', () => {
    const written = new Map(
      Object.entries(giftVoucherToDocument(voucherOf('voucher-dev-georgi'))),
    );
    expect(written.get(GIFT_VOUCHER_HOLDER_FIELD)).toBe(GEORGI);
  });
});

describe('reading the voucher fixtures', () => {
  it('reads every one of them', () => {
    expect(Object.keys(documents)).toEqual([
      'voucher-dev-georgi',
      'voucher-dev-georgi-spent',
      'voucher-dev-georgi-void',
      'voucher-dev-martin',
      'voucher-dev-five',
    ]);
    for (const id of Object.keys(documents)) {
      expect(voucherOf(id).id.value, id).toBe(id);
    }
  });

  it('Георги’s gift: 25,00 € left of 50,00 €, until the end of 31.12', () => {
    const voucher = voucherOf('voucher-dev-georgi');
    expect(voucher.issuedToUserId?.value).toBe(GEORGI);
    expect(voucher.balance.toMinorUnits()).toBe(2500);
    expect(voucher.initialValue.toMinorUnits()).toBe(5000);
    expect(voucher.balance.currencyCode()).toBe('EUR');
    expect(voucher.expiresAt?.toISODate()).toBe('2026-12-31');
    expect(voucher.state).toEqual({ kind: 'active' });
    expect(voucher.refusal(NOW)).toBeNull();
    expect(voucher.refusal(zoned('2026-12-31T23:59:00.000+02:00'))).toBeNull();
    expect(voucher.refusal(zoned('2027-01-01T00:00:00.000+02:00'))).toBe(
      'expired',
    );
  });

  // The card keeps what can be spent: `active`, with a balance.
  it('says why the other two of Георги’s are not on his card', () => {
    const spent = voucherOf('voucher-dev-georgi-spent');
    expect(spent.state.kind).toBe('active');
    expect(spent.refusal(NOW)).toBe('empty');

    const voided = voucherOf('voucher-dev-georgi-void');
    expect(voided.refusal(NOW)).toBe('void');
    expect(voided.state).toMatchObject({
      kind: 'void',
      reason: 'Издаден с грешна стойност',
    });
    expect(voided.balance.toMinorUnits()).toBe(3000);
  });

  it('reads a voucher that does not lapse, and one that is nobody’s', () => {
    const martin = voucherOf('voucher-dev-martin');
    expect(martin.expiresAt).toBeNull();
    expect(martin.issuedToUserId?.value).toBe(MARTIN);
    expect(voucherOf('voucher-dev-five').issuedToUserId).toBeNull();
  });
});

describe('reading by holder', () => {
  it('answers the holder’s vouchers, whatever their state', () => {
    expect(heldBy(GEORGI).map((voucher) => voucher.id.value)).toEqual([
      'voucher-dev-georgi',
      'voucher-dev-georgi-spent',
      'voucher-dev-georgi-void',
    ]);
    expect(heldBy(MARTIN).map((voucher) => voucher.code)).toEqual(['GIFT2025']);
  });

  it('keeps one usable voucher on Георги’s card', () => {
    expect(
      heldBy(GEORGI)
        .filter((voucher) => voucher.refusal(NOW) === null)
        .map((voucher) => voucher.id.value),
    ).toEqual(['voucher-dev-georgi']);
  });

  it('never finds a paper voucher: it has no holder', () => {
    expect(heldBy('dev-client-3')).toEqual([]);
    expect(
      [GEORGI, MARTIN].flatMap(heldBy).map((voucher) => voucher.code),
    ).not.toContain('GIFT5');
  });
});

describe('writing a voucher', () => {
  it.each(Object.keys(documents))(
    'writes %s back exactly as the fixture holds it',
    (id) => {
      const written: GiftVoucherFields = giftVoucherToDocument(voucherOf(id));
      expect(written).toEqual(documentOf(id));
    },
  );

  it('round-trips a drawn-down balance', () => {
    const drawn = giftVoucherFromDocument(
      'voucher-dev-georgi',
      edited('voucher-dev-georgi', (v) => (v['balanceMinorUnits'] = 750)),
    );
    expect(drawn?.balance.toMinorUnits()).toBe(750);
    expect(drawn && giftVoucherToDocument(drawn).balanceMinorUnits).toBe(750);
  });
});

describe('refusing what is not a voucher', () => {
  it('answers null for a missing document', () => {
    expect(giftVoucherFromDocument('voucher-x', undefined)).toBeNull();
  });

  it.each<[string, (v: Record<string, unknown>) => void]>([
    ['no code', (v) => delete v['code']],
    ['a code too short to be one', (v) => (v['code'] = 'G5')],
    ['a value in words', (v) => (v['initialValueMinorUnits'] = 'fifty')],
    ['no balance', (v) => delete v['balanceMinorUnits']],
    ['a voucher worth nothing', (v) => (v['initialValueMinorUnits'] = 0)],
    ['no currency', (v) => delete v['currencyCode']],
    ['a Timestamp for the day it was issued', (v) => (v['issuedAt'] = 1)],
    [
      'a day that does not exist',
      (v) =>
        (v['issuedAt'] = {
          iso: '2026-02-30T10:00:00.000+02:00',
          zone: 'Europe/Sofia',
        }),
    ],
  ])('answers null for %s', (_case, edit) => {
    expect(
      giftVoucherFromDocument(
        'voucher-dev-georgi',
        edited('voucher-dev-georgi', edit),
      ),
    ).toBeNull();
  });

  // The voucher is real money whoever holds it: losing the name is the
  // cheaper loss, so a holder that does not parse reads as nobody.
  it('reads a holder that is not an id as nobody', () => {
    const voucher = giftVoucherFromDocument(
      'voucher-dev-georgi',
      edited('voucher-dev-georgi', (v) => (v['issuedToUserId'] = 7)),
    );
    expect(voucher?.issuedToUserId).toBeNull();
    expect(voucher?.balance.toMinorUnits()).toBe(2500);
  });

  it('never reads a balance below nothing', () => {
    const voucher = giftVoucherFromDocument(
      'voucher-dev-georgi',
      edited('voucher-dev-georgi', (v) => (v['balanceMinorUnits'] = -100)),
    );
    expect(voucher?.balance.toMinorUnits()).toBe(0);
  });
});
