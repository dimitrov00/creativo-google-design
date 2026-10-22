import { describe, expect, it } from 'vitest';
import { FIXTURE_TODAY, loyaltyAccountJson } from '@core/testing';
import * as production from './index';
import * as testing from './testing';
import type { GiftVoucherFields } from './lib/ports/gift-voucher-document';
import { InMemoryClientVouchersReader, giftVoucherFixtures } from './testing';

/**
 * The voucher fixture is the wire contract the client card, the dev seed
 * and this lib's reference reader build against (client-card-revision-3
 * §4.5), so it is held to it here: the compiler checks its shape
 * (`testing.ts`), these checks the closed vocabulary and every invariant a
 * reader relies on. The loyalty fixtures moved to `@core/testing` with the
 * loyalty flip (3) and are held there (`loyalty.fixtures.spec.ts`).
 */

type Vocabulary<T extends string> = Readonly<Record<T, true>>;

// Exhaustive by construction: a value added to the union fails to compile here.
const VOUCHER_STATES: Vocabulary<GiftVoucherFields['state']['kind']> = {
  active: true,
  void: true,
};

const known = <T extends string>(vocabulary: Vocabulary<T>, value: string) =>
  Object.hasOwn(vocabulary, value);

const SOFIA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Sofia',
});
const sofiaDay = (instant: string) => SOFIA_DAY.format(new Date(instant));

const vouchers = giftVoucherFixtures;
/** The dev seed's two account holders, as the loyalty fixtures name them. */
const georgi = loyaltyAccountJson.georgi.uid;
const martin = loyaltyAccountJson.martin.uid;

describe('@creativo/application/engagement/testing — test support, apart from the barrel', () => {
  it('offers the gift voucher fixture', () => {
    expect(Object.keys(testing.giftVoucherFixtures)).toEqual([
      'voucher-dev-georgi',
      'voucher-dev-georgi-spent',
      'voucher-dev-georgi-void',
      'voucher-dev-martin',
      'voucher-dev-five',
    ]);
  });

  it('offers the vouchers port its in-memory reference', () => {
    expect(
      Object.keys(testing)
        .filter((name) => name.startsWith('InMemory'))
        .sort(),
    ).toEqual(['InMemoryClientVouchersReader']);
  });

  it('keeps them off the production barrel', () => {
    expect(Object.keys(production)).not.toContain('giftVoucherFixtures');
    expect(
      Object.keys(production).filter((name) => name.startsWith('InMemory')),
    ).toEqual([]);
  });

  it('re-exports none of the test support', () => {
    const support = Object.keys(testing).filter((name) =>
      Object.keys(production).includes(name),
    );
    expect(support).toEqual([]);
  });

  // Shared by every spec in a worker: one spec's mutation must not become
  // the next one's fixture.
  it('hands them out frozen, all the way down', () => {
    const gift = vouchers['voucher-dev-georgi'];
    expect(Object.isFrozen(vouchers)).toBe(true);
    expect(Object.isFrozen(gift)).toBe(true);
    expect(Object.isFrozen(gift?.issuedAt)).toBe(true);
    expect(Object.isFrozen(gift?.state)).toBe(true);
    expect(() => {
      (gift as { balanceMinorUnits: number }).balanceMinorUnits = 0;
    }).toThrow(TypeError);
  });
});

describe('the voucher fixture', () => {
  const all = Object.entries(vouchers);
  const holders = [georgi, martin];

  it('holds five vouchers, each under its own code', () => {
    expect(all).toHaveLength(5);
    const codes = all.map(([, voucher]) => voucher.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => code === code.trim().toUpperCase())).toBe(
      true,
    );
  });

  it('counts money in whole euro cents, never more left than was issued', () => {
    for (const [id, voucher] of all) {
      expect(voucher.currencyCode, id).toBe('EUR');
      expect(Number.isInteger(voucher.initialValueMinorUnits), id).toBe(true);
      expect(Number.isInteger(voucher.balanceMinorUnits), id).toBe(true);
      expect(voucher.initialValueMinorUnits, id).toBeGreaterThan(0);
      expect(voucher.balanceMinorUnits, id).toBeGreaterThanOrEqual(0);
      expect(voucher.balanceMinorUnits, id).toBeLessThanOrEqual(
        voucher.initialValueMinorUnits,
      );
    }
  });

  it('speaks only the closed vocabulary, and dates everything in the shop’s zone', () => {
    for (const [id, voucher] of all) {
      expect(known(VOUCHER_STATES, voucher.state.kind), id).toBe(true);
      const instants = [
        voucher.issuedAt,
        ...(voucher.expiresAt === null ? [] : [voucher.expiresAt]),
        ...(voucher.state.kind === 'void' ? [voucher.state.voidedAt] : []),
      ];
      for (const instant of instants) {
        expect(instant.zone, id).toBe('Europe/Sofia');
        expect(Number.isFinite(Date.parse(instant.iso)), id).toBe(true);
      }
      expect(sofiaDay(voucher.issuedAt.iso) <= FIXTURE_TODAY, id).toBe(true);
      if (voucher.expiresAt !== null)
        expect(voucher.expiresAt.iso > voucher.issuedAt.iso, id).toBe(true);
    }
  });

  it('issues a voucher to a seeded client, or to nobody', () => {
    for (const [id, voucher] of all) {
      if (voucher.issuedToUserId !== null)
        expect(holders, id).toContain(voucher.issuedToUserId);
    }
    expect(
      all.filter(([, voucher]) => voucher.issuedToUserId === null),
    ).toHaveLength(1);
  });
});

// The §4.6 story the vouchers tell — what the card's specs and the e2e
// read off them.
describe('the seeded story (§4.6)', () => {
  it('the vouchers: Георги has 25,00 € left of 50,00 € until the year’s end', () => {
    expect(vouchers['voucher-dev-georgi']).toMatchObject({
      code: 'GIFT50',
      initialValueMinorUnits: 5000,
      balanceMinorUnits: 2500,
      issuedToUserId: 'dev-client-1',
      state: { kind: 'active' },
    });
    expect(sofiaDay(vouchers['voucher-dev-georgi']?.expiresAt?.iso ?? '')).toBe(
      '2026-12-31',
    );
    expect(vouchers['voucher-dev-five']?.issuedToUserId).toBeNull();
  });
});

// The reference is seeded from the fixture above and reads it through the
// wire's mapper; the port's own spec holds it to the port's promises. Here:
// that it tells the fixture's story.
describe('the in-memory references, seeded', () => {
  it('hands each client the vouchers issued to them, and nobody the paper one', async () => {
    const reader = InMemoryClientVouchersReader.seeded();
    const codes = async (userId: string) => {
      const held = await reader.listForHolder(userId);
      if (held.isFailure()) throw held.error;
      return held.value.map((voucher) => voucher.code).sort();
    };
    expect(await codes(georgi)).toEqual(['GIFT50', 'SPENT20', 'VOID30']);
    expect(await codes(martin)).toEqual(['GIFT2025']);
    expect(await codes('dev-client-9')).toEqual([]);
  });
});
