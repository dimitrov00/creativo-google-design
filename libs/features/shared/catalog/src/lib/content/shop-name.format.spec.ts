import { describe, expect, it } from 'vitest';
import type { ShopLocation } from '@core/entities';
import { RepositoryError } from '@core/errors';
import { Locale, LocationId, Result } from '@core/primitives';
import { deepFreeze, locationFixture, textFixture } from '@core/testing';
import { namedShopsOf, shopNameOf } from './shop-name.format';

/*
 * A shop's name as the programs pages and the admin's pickers print it
 * (OR-37, OR-42), pinned from fixed inputs in both data languages: the
 * short name when the shop has one, else its name; and the shops a row may
 * name — none until read, none on a failed read, none at a one-shop tenant.
 */

const CENTER = locationFixture({ shortName: textFixture('Center', 'Център') });
/** A shop with no short name — named by its full name. */
const MLADOST = locationFixture({
  id: LocationId.of('loc-mladost'),
  name: textFixture('Creativo · Mladost', 'Креативо · Младост'),
  sortOrder: 1,
});

const read = (
  shops: readonly ShopLocation[],
): Result<readonly ShopLocation[], RepositoryError> => Result.ok(shops);

describe('shopNameOf — what a line that already knows the business calls a shop', () => {
  it('says its short name, in the data language', () => {
    expect(shopNameOf(CENTER, Locale.Bg)).toBe('Център');
    expect(shopNameOf(CENTER, Locale.En)).toBe('Center');
  });

  it('says its full name when it has no short one', () => {
    expect(shopNameOf(MLADOST, Locale.Bg)).toBe('Креативо · Младост');
    expect(shopNameOf(MLADOST, Locale.En)).toBe('Creativo · Mladost');
  });
});

describe('namedShopsOf — the shops a row may name, each worded once', () => {
  it('names nothing while the shops are unread', () => {
    expect(namedShopsOf(undefined, Locale.Bg)).toEqual([]);
  });

  it('names nothing on a failed read', () => {
    expect(
      namedShopsOf(Result.err(RepositoryError.unavailable()), Locale.Bg),
    ).toEqual([]);
  });

  it('names nothing at a one-shop tenant — there is nothing to tell apart', () => {
    expect(namedShopsOf(read([CENTER]), Locale.Bg)).toEqual([]);
  });

  it('names every shop of a multi-shop tenant, in the read’s order and the data language', () => {
    expect(namedShopsOf(read([MLADOST, CENTER]), Locale.Bg)).toEqual([
      { id: MLADOST.id, name: 'Креативо · Младост' },
      { id: CENTER.id, name: 'Център' },
    ]);
    expect(namedShopsOf(read([CENTER, MLADOST]), Locale.En)).toEqual([
      { id: CENTER.id, name: 'Center' },
      { id: MLADOST.id, name: 'Creativo · Mladost' },
    ]);
  });

  it('is pure: the same read names the same shops and is left as it was', () => {
    const shops = deepFreeze(read([CENTER, MLADOST]));
    expect(namedShopsOf(shops, Locale.Bg)).toEqual(
      namedShopsOf(shops, Locale.Bg),
    );
  });
});
