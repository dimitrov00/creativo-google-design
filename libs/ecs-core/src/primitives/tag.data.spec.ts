import { describe, expect, expectTypeOf, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { BookingStatus } from './booking-status.data';
import { Locale } from './locale.data';
import { Tag } from './tag.data';

/** A dictionary whose key order is NOT its value order — `values` follows the keys. */
const Shuffled = { Zulu: 'ZULU', Alpha: 'ALPHA', Mike: 'MIKE' } as const;
type Shuffled = Tag<typeof Shuffled>;
/** A numeric dictionary (sort ranks, ISO numbers): members are numbers. */
const Rank = { Low: 1, High: 2 } as const;

describe('Tag — the one membership scan of every as-const dictionary (pass D, D-5)', () => {
  it('Tag<D> is the dictionary’s member type', () => {
    expectTypeOf<Tag<typeof BookingStatus>>().toEqualTypeOf<BookingStatus>();
    expectTypeOf<Tag<typeof Locale>>().toEqualTypeOf<Locale>();
    expectTypeOf<Shuffled>().toEqualTypeOf<'ZULU' | 'ALPHA' | 'MIKE'>();
  });

  it('values lists the members in key order', () => {
    expect(Tag.values(Shuffled)).toEqual(['ZULU', 'ALPHA', 'MIKE']);
    expect(Tag.values(Locale)).toEqual(['bg', 'en']);
    expect(Tag.values(BookingStatus)).toEqual([
      'PENDING',
      'CONFIRMED',
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED',
    ]);
    expect(Tag.values(Rank)).toEqual([1, 2]);
  });

  it('has accepts every member, exactly', () => {
    for (const member of Tag.values(BookingStatus)) {
      expect(Tag.has(BookingStatus, member)).toBe(true);
    }
    expect(Tag.has(Locale, 'bg')).toBe(true);
    expect(Tag.has(Rank, Rank.High)).toBe(true);
  });

  it('has rejects a key, another case, a near miss and non-strings', () => {
    expect(Tag.has(BookingStatus, 'Confirmed')).toBe(false);
    expect(Tag.has(BookingStatus, 'confirmed')).toBe(false);
    expect(Tag.has(BookingStatus, ' CONFIRMED')).toBe(false);
    expect(Tag.has(Locale, 'EN')).toBe(false);
    expect(Tag.has(Locale, '')).toBe(false);
    for (const raw of [null, undefined, 0, 1, true, {}, ['bg'], { bg: 'bg' }]) {
      expect(Tag.has(Locale, raw)).toBe(false);
    }
  });

  it('has narrows to the dictionary type', () => {
    const raw: unknown = 'NO_SHOW';
    if (Tag.has(BookingStatus, raw)) {
      expectTypeOf(raw).toEqualTypeOf<BookingStatus>();
      expect(raw).toBe(BookingStatus.NoShow);
    } else {
      expect.unreachable('NO_SHOW is a member');
    }
  });

  it('has reads a numeric dictionary by value — never by its text', () => {
    expect(Tag.has(Rank, 2)).toBe(true);
    expect(Tag.has(Rank, '2')).toBe(false);
    expect(Tag.has(Rank, 3)).toBe(false);
    expectTypeOf<Tag<typeof Rank>>().toEqualTypeOf<1 | 2>();
  });

  it('has scans the dictionary’s OWN members only — the answers Object.values gave', () => {
    // An inherited enumerable key is not a member: `Object.values` never
    // listed it, and the allocation-free scan agrees (edge hardening, DEP-12).
    const inherited: Readonly<Record<string, string>> = Object.create({
      Ghost: 'GHOST',
    });
    const withOwn = Object.assign(Object.create({ Ghost: 'GHOST' }), {
      Real: 'REAL',
    }) as Readonly<Record<string, string>>;
    expect(Object.values(inherited)).toEqual([]);
    expect(Tag.has(inherited, 'GHOST')).toBe(false);
    expect(Tag.has(withOwn, 'GHOST')).toBe(false);
    expect(Tag.has(withOwn, 'REAL')).toBe(true);
    // Every member and near miss answers as an Object.values scan would.
    for (const raw of [
      ...Tag.values(BookingStatus),
      ...Tag.values(Shuffled),
      'CONFIRMED ',
      'zulu',
      1,
      null,
    ]) {
      expect(Tag.has(BookingStatus, raw)).toBe(
        Object.values(BookingStatus).some((member) => member === raw),
      );
      expect(Tag.has(Shuffled, raw)).toBe(
        Object.values(Shuffled).some((member) => member === raw),
      );
    }
  });

  it('or answers the member, or the fallback for anything else', () => {
    expect(Tag.or(Locale, 'en', Locale.Bg)).toBe('en');
    expect(Tag.or(Locale, 'fr', Locale.Bg)).toBe('bg');
    expect(Tag.or(Locale, null, Locale.En)).toBe('en');
    expect(Tag.or(Shuffled, 'MIKE', Shuffled.Alpha)).toBe('MIKE');
    expectTypeOf(Tag.or(Locale, 'x', Locale.Bg)).toEqualTypeOf<Locale>();
  });

  it('is pure: same input → same output, the dictionary untouched', () => {
    const frozen = deepFreeze({ One: 'ONE', Two: 'TWO' } as const);
    expect(Tag.values(frozen)).toEqual(Tag.values(frozen));
    expect(Tag.values(frozen)).not.toBe(Tag.values(frozen));
    expect(Tag.has(frozen, 'TWO')).toBe(Tag.has(frozen, 'TWO'));
    expect(Tag.or(frozen, 'THREE', frozen.One)).toBe(
      Tag.or(frozen, 'THREE', frozen.One),
    );
    expect(frozen).toEqual({ One: 'ONE', Two: 'TWO' });
  });
});
