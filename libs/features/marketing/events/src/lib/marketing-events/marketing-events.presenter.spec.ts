import type { ShopLocation } from '@core/entities';
import { RepositoryError } from '@core/errors';
import { LocationId, Result } from '@core/primitives';
import {
  deepFreeze,
  FIXTURE_EVENT_DAY,
  locationFixture,
  shopEventOf,
  textFixture,
} from '@core/testing';
import { eventRowsVm, type EventRowsInput } from './marketing-events.presenter';

/*
 * The `/events` rows' words (OR-37, Law 10): pinned from fixed inputs —
 * every event on `FIXTURE_EVENT_DAY` (Monday 2026-10-05) at 19:00 on the
 * shop's wall clock, never the wall clock of the machine.
 */

const INSTAGRAM = 'https://instagram.com/creativo.barbershop';
const MLADOST_ID = LocationId.of('loc-mladost');

const CENTER = locationFixture({ shortName: textFixture('Center', 'Център') });
/** A shop with no short name — a row names it by its full name. */
const MLADOST = locationFixture({
  id: MLADOST_ID,
  name: textFixture('Creativo · Mladost', 'Креативо · Младост'),
  sortOrder: 1,
});

const AT_MLADOST = shopEventOf('ev_mladost', {
  title: textFixture('Open studio day', 'Ден на отворените врати'),
  localDate: FIXTURE_EVENT_DAY,
  locationId: MLADOST_ID,
  applyUrl: 'https://example.com/rsvp',
});
const AT_NO_SHOP = shopEventOf('ev_anywhere', { localDate: FIXTURE_EVENT_DAY });
const AT_GONE_SHOP = shopEventOf('ev_gone', {
  localDate: FIXTURE_EVENT_DAY,
  locationId: LocationId.of('loc-gone'),
});

function input(
  overrides: Partial<EventRowsInput> = {},
  shops: readonly ShopLocation[] = [CENTER, MLADOST],
): EventRowsInput {
  return {
    events: [AT_MLADOST, AT_NO_SHOP, AT_GONE_SHOP],
    shops: Result.ok(shops),
    lang: 'en',
    fallbackHref: INSTAGRAM,
    ...overrides,
  };
}

describe('eventRowsVm', () => {
  it('words each row in en: the title, the date, then the shop at a multi-shop tenant', () => {
    expect(eventRowsVm(input())).toEqual([
      {
        id: AT_MLADOST.id,
        title: 'Open studio day',
        whenLine: 'Mon, Oct 5, 07:00 PM · Creativo · Mladost',
        href: 'https://example.com/rsvp',
      },
      // At no shop, and at a shop no listed one answers: the date alone.
      {
        id: AT_NO_SHOP.id,
        title: 'Open Chair Day',
        whenLine: 'Mon, Oct 5, 07:00 PM',
        href: INSTAGRAM,
      },
      {
        id: AT_GONE_SHOP.id,
        title: 'Open Chair Day',
        whenLine: 'Mon, Oct 5, 07:00 PM',
        href: INSTAGRAM,
      },
    ]);
  });

  it('words each row in bg, a shop by its short name when it has one', () => {
    const atCenter = shopEventOf('ev_center', {
      localDate: FIXTURE_EVENT_DAY,
      locationId: CENTER.id,
    });
    const rows = eventRowsVm(
      input({ events: [AT_MLADOST, atCenter], lang: 'bg' }),
    );

    expect(rows.map((row) => [row.title, row.whenLine])).toEqual([
      ['Ден на отворените врати', 'пн, 5.10, 19:00 · Креативо · Младост'],
      ['Ден на отворените столове', 'пн, 5.10, 19:00 · Център'],
    ]);
  });

  it('names no shop at a one-shop tenant — there is nothing to tell apart', () => {
    const rows = eventRowsVm(input({}, [MLADOST]));

    expect(rows.map((row) => row.whenLine)).toEqual([
      'Mon, Oct 5, 07:00 PM',
      'Mon, Oct 5, 07:00 PM',
      'Mon, Oct 5, 07:00 PM',
    ]);
  });

  it('prints the date alone, and hides no row, while the shops are unread or after their read failed', () => {
    for (const shops of [
      undefined,
      Result.err(RepositoryError.unavailable()),
    ] as const) {
      const rows = eventRowsVm(input({ shops }));

      expect(rows.map((row) => row.id)).toEqual([
        AT_MLADOST.id,
        AT_NO_SHOP.id,
        AT_GONE_SHOP.id,
      ]);
      expect(rows.map((row) => row.whenLine)).toEqual([
        'Mon, Oct 5, 07:00 PM',
        'Mon, Oct 5, 07:00 PM',
        'Mon, Oct 5, 07:00 PM',
      ]);
    }
  });

  it('reads the data of any language but en in bg', () => {
    const [row] = eventRowsVm(input({ events: [AT_MLADOST], lang: 'de' }));

    expect(row?.title).toBe('Ден на отворените врати');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(input());

    expect(eventRowsVm(frozen)).toEqual(eventRowsVm(frozen));
  });
});
