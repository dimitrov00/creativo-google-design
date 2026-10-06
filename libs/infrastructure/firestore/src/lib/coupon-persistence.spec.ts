import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import {
  COUPON_OCCASIONS,
  Coupon,
  CouponCombinability,
  CouponExpiry,
  CouponOccasionUnknownError,
  CouponValue,
  type CreateCouponProps,
} from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';
import {
  couponFromPersistence,
  couponToPersistence,
} from './coupon-persistence';

function must<T>(result: {
  isFailure(): boolean;
  readonly value?: T;
  readonly error?: unknown;
}): T {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value as T;
}

/** The seed's `coupon-birthday`, as `coupons/coupon-birthday` holds it after this round. */
const BIRTHDAY = {
  name: 'Рожден ден',
  code: null,
  value: { kind: 'percent_off', percent: 20 },
  combinability: { kind: 'exclusive' },
  expiry: { kind: 'days', days: 30 },
  enabled: true,
  occasion: 'birthday',
};

function read(id: string, data: Record<string, unknown>): Coupon {
  const coupon = couponFromPersistence(id, data);
  if (coupon.isFailure()) throw coupon.error;
  return coupon.value;
}

function coupon(overrides: Partial<CreateCouponProps> = {}): Coupon {
  return must(
    Coupon.create({
      id: 'coupon-birthday',
      name: 'Рожден ден',
      value: must(CouponValue.percentOff(20)),
      combinability: CouponCombinability.exclusive(),
      expiry: must(CouponExpiry.days(30)),
      enabled: true,
      occasion: 'birthday',
      ...overrides,
    }),
  );
}

describe('coupon persistence, the occasion (client-card-revision-3 §4.6)', () => {
  describe('reading', () => {
    it('reads what the coupon is given for', () => {
      expect(read('coupon-birthday', BIRTHDAY).occasion).toBe('birthday');
    });

    it.each(COUPON_OCCASIONS)('knows the occasion «%s»', (occasion) => {
      expect(read('coupon-x', { ...BIRTHDAY, occasion }).occasion).toBe(
        occasion,
      );
    });

    it('reads a coupon written before occasions existed as tied to none', () => {
      const before = Object.fromEntries(
        Object.entries(BIRTHDAY).filter(([field]) => field !== 'occasion'),
      );

      expect(before).not.toHaveProperty('occasion');
      expect(read('coupon-birthday', before).occasion).toBeNull();
    });

    it('reads a written «none» as none', () => {
      expect(
        read('coupon-first10', { ...BIRTHDAY, occasion: null }).occasion,
      ).toBeNull();
    });

    it.each([
      ['a word nobody knows', 'nameday'],
      ['the right word in the wrong case', 'Birthday'],
      ['an empty word', ''],
      ['a figure', 1],
      ['a switch', true],
      ['a list', ['birthday']],
    ])(
      'refuses %s rather than pass it as «none» and undress the gift',
      (_what, occasion) => {
        const result = couponFromPersistence('coupon-birthday', {
          ...BIRTHDAY,
          occasion,
        });

        if (result.isSuccess()) throw new Error('expected a refusal');
        expect(result.error).toBeInstanceOf(RepositoryError);
        expect(result.error.message).toBe('Malformed Coupon document');
        expect(result.error.cause).toEqual([
          expect.any(CouponOccasionUnknownError),
        ]);
      },
    );

    it('leaves every other field of the coupon as it read before', () => {
      const birthday = read('coupon-birthday', BIRTHDAY);

      expect(birthday.id.value).toBe('coupon-birthday');
      expect(birthday.name).toBe('Рожден ден');
      expect(birthday.code).toBeNull();
      expect(birthday.value).toEqual(must(CouponValue.percentOff(20)));
      expect(birthday.combinability.kind).toBe('exclusive');
      expect(birthday.expiry).toEqual({ kind: 'days', days: 30 });
      expect(birthday.usageLimit).toBeNull();
      expect(birthday.enabled).toBe(true);
    });
  });

  describe('writing', () => {
    it('writes the occasion with every other field, the ones that say «none» included', () => {
      expect(couponToPersistence(coupon())).toEqual({
        ...BIRTHDAY,
        usageLimit: null,
      });
    });

    it('writes «none» as null, never as a missing field', () => {
      const written = couponToPersistence(coupon({ occasion: null }));

      expect(written).toHaveProperty('occasion', null);
      expect(written).toHaveProperty('code', null);
      expect(written).toHaveProperty('usageLimit', null);
    });

    it('never writes the id: it is the document’s', () => {
      expect(couponToPersistence(coupon())).not.toHaveProperty('id');
    });
  });

  describe('the round trip: an admin’s save does not drop the occasion', () => {
    const until = must(
      ZonedDateTime.fromISO('2026-12-31T21:59:59.999Z', 'UTC'),
    );

    it.each<[string, Partial<CreateCouponProps>]>([
      ['the birthday gift', {}],
      ['a coupon tied to no occasion', { occasion: null }],
      [
        'a coupon with a code, a limit and a last day',
        {
          id: 'coupon-first10',
          name: 'Първо посещение',
          code: 'first10',
          value: must(CouponValue.percentOff(10)),
          combinability: CouponCombinability.stackable(),
          expiry: CouponExpiry.fixedDate(until),
          usageLimit: 100,
          occasion: null,
        },
      ],
      [
        'a fixed amount that never expires',
        {
          id: 'coupon-beard5',
          name: 'Брада −5 €',
          code: 'BEARD5',
          value: must(
            CouponValue.fixedAmount(
              must(Money.fromMinorUnitsAndCode(500, 'EUR')),
            ),
          ),
          combinability: CouponCombinability.stackable(),
          expiry: CouponExpiry.never(),
        },
      ],
      [
        'a free service, switched off',
        {
          id: 'coupon-fifth-cut',
          value: CouponValue.freeService(),
          expiry: CouponExpiry.never(),
          enabled: false,
        },
      ],
    ])('%s reads back as the coupon that was saved', (_what, props) => {
      const saved = coupon(props);

      const written = couponToPersistence(saved);

      const back = read(saved.id.value, written);

      expect(back.id.value).toBe(saved.id.value);
      expect(back.name).toBe(saved.name);
      expect(back.code).toBe(saved.code);
      expect(back.value.kind).toBe(saved.value.kind);
      expect(back.combinability).toEqual(saved.combinability);
      expect(back.usageLimit).toBe(saved.usageLimit);
      expect(back.enabled).toBe(saved.enabled);
      expect(back.occasion).toBe(saved.occasion);
      expect(back.expiry.kind).toBe(saved.expiry.kind);
      // Money and instants are compared as they are written: a coupon
      // that reads back and is saved again writes the same document.
      expect(couponToPersistence(back)).toEqual(written);
    });

    it('an edit of the birthday coupon keeps what it is given for', () => {
      // The admin's editor reads the coupon, changes the figure, saves.
      const stored = read('coupon-birthday', BIRTHDAY);
      const edited = must(
        Coupon.create({
          id: stored.id.value,
          name: stored.name,
          value: must(CouponValue.percentOff(25)),
          combinability: stored.combinability,
          expiry: stored.expiry,
          enabled: stored.enabled,
          code: stored.code,
          occasion: stored.occasion,
        }),
      );

      const back = read('coupon-birthday', couponToPersistence(edited));

      expect(back.occasion).toBe('birthday');
      expect(back.value).toEqual(must(CouponValue.percentOff(25)));
    });
  });
});
