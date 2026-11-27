import type { ContactMethod } from '@core/components';
import type { ContactRowVm } from '@creativo/features/shared/catalog';
import { PositionStatus, WorkplaceMode } from '@core/components';
import type { ShopLocation } from '@core/entities';
import { RepositoryError } from '@core/errors';
import { LocationId, Result } from '@core/primitives';
import {
  deepFreeze,
  locationFixture,
  positionOf,
  textFixture,
} from '@core/testing';
import {
  positionRowsVm,
  type PositionRowsInput,
} from './marketing-careers.presenter';

/*
 * The `/careers` rows' words (OR-42, Law 10), pinned from fixed inputs: a
 * role scoped to two shops (listed in the reverse of the catalogue's
 * order), one open at every shop, and one scoped to a shop no listed one
 * answers.
 */

const INSTAGRAM = 'https://instagram.com/creativo.barbershop';

/** A row answered one way: that way is the whole answer, and the row's link. */
function only(contactMethod: ContactMethod, href: string): ContactRowVm {
  const link = { contactMethod, href };
  return { contacts: [link], only: link };
}

const CENTER = locationFixture({ shortName: textFixture('Center', 'Център') });
/** A shop with no short name — a row names it by its full name. */
const MLADOST = locationFixture({
  id: LocationId.of('loc-mladost'),
  name: textFixture('Creativo · Mladost', 'Креативо · Младост'),
  sortOrder: 1,
});

const SCOPED = positionOf('pos_scoped', {
  title: textFixture('Barber — full time', 'Бръснар — пълно работно време'),
  summary: textFixture('Five days a week.', 'Пет дни в седмицата.'),
  locationIds: [MLADOST.id, CENTER.id],
  contacts: [
    { contactMethod: 'LINK', contactValue: 'https://example.com/apply' },
  ],
});
const EVERYWHERE = positionOf('pos_everywhere', {
  positionStatus: PositionStatus.Closed,
  sortOrder: 1,
});
const AT_GONE_SHOP = positionOf('pos_gone', {
  locationIds: [LocationId.of('loc-gone')],
  sortOrder: 2,
});

function input(
  overrides: Partial<PositionRowsInput> = {},
  shops: readonly ShopLocation[] = [CENTER, MLADOST],
): PositionRowsInput {
  return {
    positions: [SCOPED, EVERYWHERE, AT_GONE_SHOP],
    shops: Result.ok(shops),
    lang: 'en',
    fallbackHref: INSTAGRAM,
    ...overrides,
  };
}

describe('positionRowsVm', () => {
  it("words each row in en, a scoped role's shops in the catalogue's order", () => {
    expect(positionRowsVm(input())).toEqual([
      {
        id: SCOPED.id,
        title: 'Barber — full time',
        summary: 'Five days a week.',
        shopsLine: 'Center · Creativo · Mladost',
        workplaceTag: null,
        contact: only('LINK', 'https://example.com/apply'),
      },
      // Open at every shop, and scoped only to a shop no listed one
      // answers: no shops line.
      {
        id: EVERYWHERE.id,
        title: 'Barber',
        summary: 'Full-time chair',
        shopsLine: null,
        workplaceTag: null,
        contact: only('INSTAGRAM', INSTAGRAM),
      },
      {
        id: AT_GONE_SHOP.id,
        title: 'Barber',
        summary: 'Full-time chair',
        shopsLine: null,
        workplaceTag: null,
        contact: only('INSTAGRAM', INSTAGRAM),
      },
    ]);
  });

  it('words each row in bg, a shop by its short name when it has one', () => {
    const [row] = positionRowsVm(input({ lang: 'bg' }));

    expect(row).toMatchObject({
      title: 'Бръснар — пълно работно време',
      summary: 'Пет дни в седмицата.',
      shopsLine: 'Център · Креативо · Младост',
    });
  });

  it('names no shop at a one-shop tenant — there is nothing to tell apart', () => {
    const rows = positionRowsVm(input({}, [CENTER]));

    expect(rows.map((row) => row.shopsLine)).toEqual([null, null, null]);
  });

  it('prints no shops line, and hides no row, while the shops are unread or after their read failed', () => {
    for (const shops of [
      undefined,
      Result.err(RepositoryError.unavailable()),
    ] as const) {
      const rows = positionRowsVm(input({ shops }));

      expect(rows.map((row) => row.id)).toEqual([
        SCOPED.id,
        EVERYWHERE.id,
        AT_GONE_SHOP.id,
      ]);
      expect(rows.map((row) => row.shopsLine)).toEqual([null, null, null]);
    }
  });

  it('hands on the workplace tag of a hybrid or remote role, and none for an on-site one', () => {
    const rows = positionRowsVm(
      input({
        positions: [
          SCOPED,
          { ...SCOPED, workplaceMode: WorkplaceMode.Hybrid },
          positionOf('pos_remote', { workplaceMode: WorkplaceMode.Remote }),
        ],
      }),
    );

    expect(rows.map((row) => [row.workplaceTag, row.shopsLine])).toEqual([
      [null, 'Center · Creativo · Mladost'],
      ['HYBRID', 'Center · Creativo · Mladost'],
      ['REMOTE', null],
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(input());

    expect(positionRowsVm(frozen)).toEqual(positionRowsVm(frozen));
  });
});
