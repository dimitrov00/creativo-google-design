import { describe, expect, it } from 'vitest';
import { Locale, LocationId } from '@core/primitives';
import { deepFreeze, locationFixture, textFixture } from '@core/testing';
import { shopRows } from './shops.presenter';

/*
 * «Салони», worded (Law 10): one row per shop of the catalogue, pinned in
 * both languages from fixed inputs.
 */

const CENTER = locationFixture();
const MLADOST = locationFixture({
  id: LocationId.of('mladost'),
  name: textFixture('Mladost', 'Младост'),
});

const input = deepFreeze({
  shops: [CENTER, MLADOST],
  picked: [CENTER.id],
  rostered: [CENTER.id],
  locale: Locale.Bg,
});

describe('shopRows — «Салони»', () => {
  it('lists every shop in the catalogue’s order: ticked or not, held where the roster has hours', () => {
    expect(shopRows(input)).toEqual([
      {
        locationId: CENTER.id,
        name: 'Център',
        picked: true,
        held: true,
        testId: `member-shop-${CENTER.id}`,
      },
      {
        locationId: MLADOST.id,
        name: 'Младост',
        picked: false,
        held: false,
        testId: 'member-shop-mladost',
      },
    ]);
  });

  it('names the shops in English', () => {
    expect(
      shopRows({ ...input, locale: Locale.En }).map((row) => row.name),
    ).toEqual(['Centre', 'Mladost']);
  });

  it('is pure: same input → same output, the input untouched', () => {
    expect(shopRows(input)).toEqual(shopRows(input));
  });
});
