import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BarberId } from '@core/primitives';
import {
  type DayHealthLane,
  type DayHealthTranslate,
  dayHealthRowsOf,
  dayHealthWordsOf,
} from './day-health.presenter';
import { type DayHealthChair, DayHealthTestId } from './day-health.vm';

/*
 * THE DAY'S HEALTH ROWS (OR-2), worded from the app's REAL catalogue in
 * both languages — a key the presenter names and the catalogue lacks fails
 * here, not on a screen.
 */

type Catalogue = Record<string, unknown>;

function catalogue(lang: 'bg' | 'en'): Catalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Catalogue;
}

/** Transloco's reading, in miniature: a dotted key, `{{param}}` filled in. */
function translator(tree: Catalogue): DayHealthTranslate {
  return (key, params = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? new Map(Object.entries(node)).get(part)
            : undefined,
        tree,
      );
    if (typeof value !== 'string') throw new Error(`missing word ${key}`);
    const filled = new Map(Object.entries(params));
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(filled.get(name) ?? ''),
    );
  };
}

const BG = dayHealthWordsOf(translator(catalogue('bg')), 'bg');
const EN = dayHealthWordsOf(translator(catalogue('en')), 'en');

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const PETAR = BarberId.of('petar');

const CHAIRS = new Map<BarberId, DayHealthChair>([
  [IVAN, { name: 'Иван', tone: 2 }],
  [NIKO, { name: 'Нико', tone: 5 }],
  [PETAR, { name: 'Петър', tone: 1 }],
]);

const lane = (
  barberId: BarberId,
  facts: { readonly failed?: boolean; readonly unreadable?: number } = {},
): DayHealthLane => ({
  barberId,
  failed: facts.failed ?? false,
  unreadable: facts.unreadable ?? 0,
});

describe('dayHealthRowsOf — one row per chair not read in full', () => {
  it('says nothing on a clean day', () => {
    expect(
      dayHealthRowsOf({
        lanes: [lane(IVAN), lane(NIKO)],
        chairs: CHAIRS,
        words: BG,
      }),
    ).toEqual([]);
  });

  it('words a partial read — its count under the name, what to do as the meta (OR-2) — one and other, in bg', () => {
    const rows = dayHealthRowsOf({
      lanes: [lane(IVAN, { unreadable: 1 }), lane(NIKO, { unreadable: 3 })],
      chairs: CHAIRS,
      words: BG,
    });
    expect(rows).toEqual([
      {
        barberId: IVAN,
        name: 'Иван',
        detail: '1 посещение не може да се покаже',
        tone: 2,
        meta: 'Презареди страницата',
        label: '1 посещение не може да се покаже. Презареди страницата.',
        testId: DayHealthTestId.Unreadable,
      },
      {
        barberId: NIKO,
        name: 'Нико',
        detail: '3 посещения не могат да се покажат',
        tone: 5,
        meta: 'Презареди страницата',
        label: '3 посещения не могат да се покажат. Презареди страницата.',
        testId: DayHealthTestId.Unreadable,
      },
    ]);
  });

  it('words a partial read — its count under the name, what to do as the meta (OR-2) — one and other, in en', () => {
    const rows = dayHealthRowsOf({
      lanes: [lane(IVAN, { unreadable: 1 }), lane(NIKO, { unreadable: 2 })],
      chairs: CHAIRS,
      words: EN,
    });
    expect(
      rows.map(({ detail, meta, label }) => ({ detail, meta, label })),
    ).toEqual([
      {
        detail: "1 visit can't be shown",
        meta: 'Reload the page',
        label: "1 visit can't be shown. Reload the page.",
      },
      {
        detail: "2 visits can't be shown",
        meta: 'Reload the page',
        label: "2 visits can't be shown. Reload the page.",
      },
    ]);
  });

  it('words a failed chair as the failure — its badge beside the name, the schedule sentence for a reader', () => {
    for (const [words, meta, label] of [
      [BG, 'Не се зареди', 'Този график не се зареди — презареди страницата.'],
      [EN, "Didn't load", "This schedule didn't load — reload the page."],
    ] as const) {
      expect(
        dayHealthRowsOf({
          lanes: [lane(PETAR, { failed: true })],
          chairs: CHAIRS,
          words,
        }),
      ).toEqual([
        {
          barberId: PETAR,
          name: 'Петър',
          // A failed chair read no visits: no count to word under its name.
          detail: null,
          tone: 1,
          meta,
          label,
          testId: DayHealthTestId.Failed,
        },
      ]);
    }
  });

  it('keeps the lanes’ own order, and names a chair the catalogue does not by its id', () => {
    const rows = dayHealthRowsOf({
      lanes: [
        lane(NIKO, { failed: true }),
        lane(IVAN),
        lane(BarberId.of('gone'), { unreadable: 2 }),
      ],
      chairs: CHAIRS,
      words: BG,
    });
    expect(rows.map((row) => [row.name, row.tone, row.testId])).toEqual([
      ['Нико', 5, DayHealthTestId.Failed],
      ['gone', 0, DayHealthTestId.Unreadable],
    ]);
  });

  it('is pure: the same input words the same rows and is left as it was', () => {
    const lanes = [lane(IVAN, { unreadable: 2 }), lane(NIKO, { failed: true })];
    const before = structuredClone(lanes);
    const input = { lanes, chairs: CHAIRS, words: BG };
    expect(dayHealthRowsOf(input)).toEqual(dayHealthRowsOf(input));
    expect(lanes).toEqual(before);
    expect(CHAIRS.size).toBe(3);
  });
});
