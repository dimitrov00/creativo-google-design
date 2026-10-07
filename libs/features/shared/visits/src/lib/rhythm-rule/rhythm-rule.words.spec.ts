import { describe, expect, it } from 'vitest';
import {
  StreakDefinition,
  type StreakDefinitionProps,
  type StreakIntervalProps,
  type StreakRuleSummary,
} from '@creativo/application/engagement';
import { appCatalogue } from '../testing/app-catalogue';
import { catalogueTranslator } from '../testing/visit-fixtures';
import type { VisitTranslate } from '../visit-row.presenter';
import {
  type RhythmRuleContext,
  type RhythmRuleWords,
  rhythmRuleUnits,
  rhythmRuleWords,
} from './rhythm-rule.words';

// ── The app's own words ──────────────────────────────────────────────────
//
// The rule is worded from the real catalogues, so a key this file names
// and a catalogue lacks fails here (the translator throws), not on a card.

type Lang = 'bg' | 'en';
const LANGS: readonly Lang[] = ['bg', 'en'];

const CATALOGUE_BG = appCatalogue('bg');
const CATALOGUE_EN = appCatalogue('en');
const BG = catalogueTranslator(CATALOGUE_BG);
const EN = catalogueTranslator(CATALOGUE_EN);

const catalogueOf = (lang: Lang) =>
  lang === 'bg' ? CATALOGUE_BG : CATALOGUE_EN;
const translatorOf = (lang: Lang): VisitTranslate => (lang === 'bg' ? BG : EN);

// ── The rule, through the domain's own factory ───────────────────────────
//
// Every summary here is one `StreakDefinition.summary()` really returns:
// the recommended rule, revised. A rule the domain refuses fails the spec.

function summaryOf(
  patch: Partial<StreakDefinitionProps> = {},
): StreakRuleSummary {
  const revised = StreakDefinition.default().revise(patch, '2026-10-01');
  if (revised.isFailure()) {
    throw new Error(
      `the rule was refused: ${revised.error.map((error) => error.code).join(', ')}`,
    );
  }
  return revised.value.summary();
}

const PERSONAL: StreakIntervalProps = {
  kind: 'personal',
  tolerancePct: 50,
  minDays: 21,
  maxDays: 70,
  fallbackDays: 42,
};

function worded(
  patch: Partial<StreakDefinitionProps> = {},
  context?: RhythmRuleContext,
  lang: Lang = 'bg',
): RhythmRuleWords {
  // The fourth argument is left out, not handed over empty, wherever a case
  // has none: the three-argument call is the contract's (§7.3).
  return context === undefined
    ? rhythmRuleWords(summaryOf(patch), translatorOf(lang), lang)
    : rhythmRuleWords(summaryOf(patch), translatorOf(lang), lang, context);
}

/** The rule whole, as the card unfolds it: the sentence, then every detail. */
const whole = (words: RhythmRuleWords): readonly string[] => [
  words.sentence,
  ...words.details,
];

const SERVICES = new Map([
  ['svc-fade', 'Фейд'],
  ['svc-beard', 'Оформяне на брада'],
  ['svc-shave', 'Бръснене'],
]);
const nameOf = (id: string): string | null => SERVICES.get(id) ?? null;

describe('rhythmRuleWords', () => {
  describe('the recommended rule', () => {
    it('reads in Bulgarian as the card prints it', () => {
      const words = worded();

      expect(whole(words)).toEqual([
        'Посещение на всеки 6 седмици пази ритъма.',
        '7 дни гратис след срока.',
        'До 2 защити покриват пропуснат срок; нова на всеки 5 посещения в ритъм.',
        'Час, отменен от салона, не се брои за пропуск.',
        'Записан час до 14 дни след срока пази ритъма.',
        'След прекъсване посещение до 14 дни връща ритъма.',
      ]);
      expect(words.short).toBe('На всеки 6 седмици · 7 дни гратис');
    });

    it('reads in English', () => {
      const words = worded({}, undefined, 'en');

      expect(whole(words)).toEqual([
        'A visit every 6 weeks keeps the rhythm.',
        '7 days of grace after the due date.',
        'Up to 2 protections cover a missed due date; a new one every 5 visits in rhythm.',
        'A visit the shop cancelled is never a miss.',
        'A booked visit up to 14 days past due keeps the rhythm.',
        'After a break, a visit within 14 days restores the rhythm.',
      ]);
      expect(words.short).toBe('Every 6 weeks · 7 days of grace');
    });

    it('takes the contract’s three arguments and asks for no context', () => {
      expect(rhythmRuleWords(summaryOf(), BG, 'bg').sentence).toBe(
        'Посещение на всеки 6 седмици пази ритъма.',
      );
      expect(rhythmRuleWords).toHaveLength(3);
    });
  });

  describe('a part the rule has nothing to say about', () => {
    const GRACE = '7 дни гратис след срока.';
    const PROTECTIONS =
      'До 2 защити покриват пропуснат срок; нова на всеки 5 посещения в ритъм.';
    const EXCUSES = 'Час, отменен от салона, не се брои за пропуск.';
    const HOLD = 'Записан час до 14 дни след срока пази ритъма.';
    const REPAIR = 'След прекъсване посещение до 14 дни връща ритъма.';
    const RULE = StreakDefinition.default().toProps();

    it.each<[string, Partial<StreakDefinitionProps>, string]>([
      ['no grace', { graceDays: 0 }, GRACE],
      [
        'protections off',
        { protections: { ...RULE.protections, enabled: false } },
        PROTECTIONS,
      ],
      [
        'a reserve that holds none',
        { protections: { ...RULE.protections, maxBanked: 0 } },
        PROTECTIONS,
      ],
      [
        'one of the shop’s excuses off',
        { excuses: ['shopClosure', 'barberAbsence'] },
        EXCUSES,
      ],
      ['no excuse at all', { excuses: [] }, EXCUSES],
      [
        'the hold off',
        { bookingHold: { ...RULE.bookingHold, enabled: false } },
        HOLD,
      ],
      [
        'a hold of no days',
        { bookingHold: { enabled: true, maxDaysPastDue: 0 } },
        HOLD,
      ],
      ['no way back', { repair: { ...RULE.repair, enabled: false } }, REPAIR],
    ])(
      '%s: its sentence is not said, the rest stay in order',
      (_, patch, gone) => {
        const said = whole(worded());
        const words = worded(patch);

        expect(said).toContain(gone);
        expect(whole(words)).toEqual(said.filter((line) => line !== gone));
      },
    );

    it('says the closed days nowhere: they are not the shop calling a visit off', () => {
      expect(
        whole(worded({ excuses: [...RULE.excuses, 'closedDays'] })),
      ).toEqual(whole(worded()));
    });

    it('drops the grace from the rule line too', () => {
      const words = worded({ graceDays: 0 });

      expect(words.short).toBe('На всеки 6 седмици');
      expect(worded({ graceDays: 0 }, undefined, 'en').short).toBe(
        'Every 6 weeks',
      );
    });

    it('is one sentence when every part is off', () => {
      const words = worded({
        graceDays: 0,
        protections: { ...RULE.protections, enabled: false },
        excuses: [],
        bookingHold: { ...RULE.bookingHold, enabled: false },
        repair: { ...RULE.repair, enabled: false },
      });

      expect(words.sentence).toBe('Посещение на всеки 6 седмици пази ритъма.');
      expect(words.details).toEqual([]);
    });
  });

  describe('the figures', () => {
    it('words every figure of the rule in its own plural', () => {
      const words = worded({
        interval: { kind: 'fixed', days: 56 },
        graceDays: 1,
        protections: {
          enabled: true,
          maxBanked: 3,
          earnEvery: 8,
          startWith: 0,
        },
        bookingHold: { enabled: true, maxDaysPastDue: 1 },
        repair: { enabled: true, windowDays: 30, perYear: 2 },
      });

      expect(whole(words)).toEqual([
        'Посещение на всеки 8 седмици пази ритъма.',
        '1 ден гратис след срока.',
        'До 3 защити покриват пропуснат срок; нова на всеки 8 посещения в ритъм.',
        'Час, отменен от салона, не се брои за пропуск.',
        'Записан час до 1 ден след срока пази ритъма.',
        'След прекъсване посещение до 30 дни връща ритъма.',
      ]);
      expect(words.short).toBe('На всеки 8 седмици · 1 ден гратис');
    });

    it('says the grace in days, however long', () => {
      expect(worded({ graceDays: 21 }).short).toBe(
        'На всеки 6 седмици · 21 дни гратис',
      );
    });

    it.each<[number, string, string]>([
      [14, '2 седмици', '2 weeks'],
      [21, '3 седмици', '3 weeks'],
      [42, '6 седмици', '6 weeks'],
      [182, '26 седмици', '26 weeks'],
      // Between two whole weeks: the nearest half.
      [39, '5½ седмици', '5½ weeks'],
      [45, '6½ седмици', '6½ weeks'],
      [57, '8 седмици', '8 weeks'],
      [16, '2½ седмици', '2½ weeks'],
    ])('an interval of %i days is «%s»', (days, bg, en) => {
      const patch = {
        interval: { kind: 'fixed', days } as const,
        graceDays: 0,
      };

      expect(worded(patch).short).toBe(`На всеки ${bg}`);
      expect(worded(patch, undefined, 'en').short).toBe(`Every ${en}`);
    });
  });

  describe('a miss that holds the count', () => {
    it('says so, and promises no way back: nothing was broken', () => {
      const words = worded({ onBreak: 'hold' });

      expect(words.details).toEqual([
        '7 дни гратис след срока.',
        'До 2 защити покриват пропуснат срок; нова на всеки 5 посещения в ритъм.',
        'Час, отменен от салона, не се брои за пропуск.',
        'Записан час до 14 дни след срока пази ритъма.',
        'Пропускът не нулира броя.',
      ]);
      expect(worded({ onBreak: 'hold' }, undefined, 'en').details.at(-1)).toBe(
        'A miss does not reset the count.',
      );
    });
  });

  describe('a rule that is off', () => {
    it.each<[Lang, string]>([
      [
        'bg',
        'Изключено. Картата на клиента не показва ритъм. Натрупаното се пази.',
      ],
      ['en', 'Off. The client card shows no rhythm. What was earned is kept.'],
    ])('says only that it is off (%s)', (lang, off) => {
      const words = worded({ enabled: false }, undefined, lang);

      expect(words.sentence).toBe(off);
      expect(words.details).toEqual([]);
      expect(words.short).toBe(off);
    });

    it('still counts days and weeks: the editor’s controls read them', () => {
      const words = worded({ enabled: false });

      expect(words.days(7)).toBe('7 дни');
      expect(words.weeks(6)).toBe('6 седмици');
    });
  });

  describe('a personal interval', () => {
    const rule = { interval: PERSONAL };

    it('is the person’s own, once the habit is known', () => {
      const period = {
        intervalDays: 39,
        source: 'personal',
        habitDays: 28,
      } as const;

      const words = worded(rule, { period });

      expect(words.sentence).toBe(
        'Идва на около 4 седмици, срокът му е 5½ седмици.',
      );
      expect(words.short).toBe('На всеки 5½ седмици · 7 дни гратис');
      expect(worded(rule, { period }, 'en').sentence).toBe(
        'Comes about every 4 weeks; the due date is 5½ weeks.',
      );
    });

    it('keeps every detail under the person’s sentence', () => {
      const period = {
        intervalDays: 57,
        source: 'personal',
        habitDays: 38,
      } as const;

      expect(whole(worded(rule, { period }))).toEqual([
        'Идва на около 5½ седмици, срокът му е 8 седмици.',
        ...worded().details,
      ]);
    });

    it('says a habit under two weeks in days', () => {
      const period = {
        intervalDays: 21,
        source: 'personal',
        habitDays: 10.4,
      } as const;

      expect(worded(rule, { period }).sentence).toBe(
        'Идва на около 10 дни, срокът му е 3 седмици.',
      );
    });

    it.each<[string, RhythmRuleContext | undefined]>([
      ['nobody yet (the editor’s draft)', undefined],
      ['no open period', { period: null }],
      [
        'a newcomer',
        { period: { intervalDays: 42, source: 'fallback', habitDays: null } },
      ],
      [
        'a period an older fixed rule opened',
        { period: { intervalDays: 35, source: 'fixed', habitDays: null } },
      ],
      [
        'a habit nobody measured',
        { period: { intervalDays: 39, source: 'personal', habitDays: null } },
      ],
      [
        'a habit of no days',
        { period: { intervalDays: 39, source: 'personal', habitDays: 0 } },
      ],
    ])('is the rule’s own figure for %s', (_, context) => {
      const words = worded(rule, context);

      expect(words.sentence).toBe(
        'Срокът е 6 седмици, докато опознаем навика му.',
      );
      expect(words.short).toBe('На всеки 6 седмици · 7 дни гратис');
      expect(worded(rule, context, 'en').sentence).toBe(
        'The due date is 6 weeks until we know the habit.',
      );
    });

    it('reads the newcomer’s figure from the rule in force, not from an older period', () => {
      const words = worded(
        { interval: { ...PERSONAL, fallbackDays: 35 } },
        { period: { intervalDays: 42, source: 'fallback', habitDays: null } },
      );

      expect(words.sentence).toBe(
        'Срокът е 5 седмици, докато опознаем навика му.',
      );
    });
  });

  describe('a fixed interval', () => {
    it('is one sentence for everyone, whatever a person’s period still holds', () => {
      const words = worded(
        {},
        { period: { intervalDays: 39, source: 'personal', habitDays: 26 } },
      );

      expect(whole(words)).toEqual(whole(worded()));
      expect(words.short).toBe(worded().short);
    });
  });

  describe('a rule that counts a chosen list', () => {
    const services = {
      qualifier: {
        kind: 'services',
        serviceIds: ['svc-fade', 'svc-beard'],
      },
    } as const;

    it('names the services last, in the order they were chosen', () => {
      const words = worded(services, { nameOf });

      expect(words.details.at(-1)).toBe(
        'Броят се посещения с: Фейд и Оформяне на брада.',
      );
      expect(words.details.slice(0, -1)).toEqual(worded().details);
      expect(worded(services, { nameOf }, 'en').details.at(-1)).toBe(
        'Visits count with: Фейд and Оформяне на брада.',
      );
    });

    it('lists three and more the way the language does', () => {
      const words = worded(
        {
          qualifier: {
            kind: 'services',
            serviceIds: ['svc-shave', 'svc-fade', 'svc-beard'],
          },
        },
        { nameOf },
      );

      expect(words.details.at(-1)).toBe(
        'Броят се посещения с: Бръснене, Фейд и Оформяне на брада.',
      );
    });

    it('names categories through the same lookup', () => {
      const words = worded(
        { qualifier: { kind: 'categories', categoryIds: ['cat-hair'] } },
        { nameOf: (id) => (id === 'cat-hair' ? 'Подстригване' : null) },
      );

      expect(words.details.at(-1)).toBe('Броят се посещения с: Подстригване.');
    });

    it('leaves out what it cannot name, and a name said twice', () => {
      const words = worded(
        {
          qualifier: {
            kind: 'services',
            serviceIds: ['svc-gone', 'svc-fade', 'svc-fade-long'],
          },
        },
        // Two variants of one service carry one name, padded as a hand-typed
        // title can be.
        { nameOf: (id) => (id === 'svc-gone' ? null : ' Фейд ') },
      );

      expect(words.details.at(-1)).toBe('Броят се посещения с: Фейд.');
    });

    it.each<[string, RhythmRuleContext | undefined]>([
      ['no lookup', undefined],
      ['a lookup that is null', { nameOf: null }],
      ['a lookup that names nothing', { nameOf: () => null }],
    ])('says nothing about services with %s', (_, context) => {
      expect(worded(services, context).details).toEqual(worded().details);
    });

    it('says nothing about services when every visit counts', () => {
      expect(worded({}, { nameOf }).details).toEqual(worded().details);
    });
  });

  describe('days and weeks, for the places that count by themselves', () => {
    const bg = worded();
    const en = worded({}, undefined, 'en');

    it.each<[number, string, string]>([
      [0, '0 дни', '0 days'],
      [1, '1 ден', '1 day'],
      [2, '2 дни', '2 days'],
      [7, '7 дни', '7 days'],
      [21, '21 дни', '21 days'],
      [6.6, '7 дни', '7 days'],
    ])('%d days', (count, inBulgarian, inEnglish) => {
      expect(bg.days(count)).toBe(inBulgarian);
      expect(en.days(count)).toBe(inEnglish);
    });

    it.each<[number, string, string]>([
      [1, '1 седмица', '1 week'],
      [2, '2 седмици', '2 weeks'],
      [6, '6 седмици', '6 weeks'],
      [26, '26 седмици', '26 weeks'],
      [5.5, '5½ седмици', '5½ weeks'],
      [1.5, '1½ седмици', '1½ weeks'],
      // To the nearest half.
      [5.2, '5 седмици', '5 weeks'],
      [5.3, '5½ седмици', '5½ weeks'],
      [5.8, '6 седмици', '6 weeks'],
      // Under one week the half stands alone.
      [0.5, '½ седмици', '½ weeks'],
    ])('%d weeks', (count, inBulgarian, inEnglish) => {
      expect(bg.weeks(count)).toBe(inBulgarian);
      expect(en.weeks(count)).toBe(inEnglish);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -3])(
      'counts nothing for %d, never a broken word',
      (count) => {
        expect(bg.days(count)).toBe('0 дни');
        expect(bg.weeks(count)).toBe('0 седмици');
      },
    );
  });

  describe('the function itself', () => {
    it('is pure: the same rule gives the same words and the summary is untouched', () => {
      const summary = summaryOf({
        qualifier: { kind: 'services', serviceIds: ['svc-fade'] },
      });
      const before = JSON.stringify(summary);

      const first = rhythmRuleWords(summary, BG, 'bg', { nameOf });
      const second = rhythmRuleWords(summary, BG, 'bg', { nameOf });

      expect(whole(second)).toEqual(whole(first));
      expect(second.short).toBe(first.short);
      expect(JSON.stringify(summary)).toBe(before);
    });

    it.each(LANGS)(
      'leaves no placeholder unfilled and no doubled space (%s)',
      (lang) => {
        const period = {
          intervalDays: 39,
          source: 'personal',
          habitDays: 28,
        } as const;
        const rules: readonly RhythmRuleWords[] = [
          worded({}, undefined, lang),
          worded({ enabled: false }, undefined, lang),
          worded({ onBreak: 'hold', graceDays: 0 }, undefined, lang),
          worded({ interval: PERSONAL }, { period }, lang),
          worded({ interval: PERSONAL }, undefined, lang),
          worded(
            { qualifier: { kind: 'services', serviceIds: ['svc-fade'] } },
            { nameOf },
            lang,
          ),
        ];

        for (const words of rules) {
          for (const line of [...whole(words), words.short]) {
            expect(line).not.toMatch(/\{\{|\}\}/);
            expect(line).not.toMatch(/\s{2,}/);
            expect(line).toBe(line.trim());
            expect(line.length).toBeGreaterThan(0);
          }
        }
      },
    );

    it.each(LANGS)(
      'reads every key of the rule’s root but the one its hosts fill (%s)',
      (lang) => {
        const read = new Set<string>();
        const recording: VisitTranslate = (key, params) => {
          read.add(key);
          return translatorOf(lang)(key, params);
        };
        const period = {
          intervalDays: 39,
          source: 'personal',
          habitDays: 28,
        } as const;
        const say = (
          patch: Partial<StreakDefinitionProps>,
          context: RhythmRuleContext = {},
        ) => rhythmRuleWords(summaryOf(patch), recording, lang, context);

        const words = say({});
        words.days(1);
        words.weeks(1);
        words.weeks(5.5);
        say({ graceDays: 0, onBreak: 'hold' });
        say({ enabled: false });
        say({ interval: PERSONAL });
        say({ interval: PERSONAL }, { period });
        say(
          { qualifier: { kind: 'services', serviceIds: ['svc-fade'] } },
          { nameOf },
        );

        const leaves = (node: unknown, path: string): string[] =>
          node !== null && typeof node === 'object'
            ? Object.entries(node).flatMap(([key, value]) =>
                leaves(value, `${path}.${key}`),
              )
            : [path];
        const root = new Map(Object.entries(catalogueOf(lang))).get(
          'rhythmRule',
        );

        // `rhythmRule.upcoming` takes a DATE, which the host formats: the
        // card words it through its own table, the editor through its own.
        expect([...read].sort()).toEqual(
          leaves(root, 'rhythmRule')
            .filter((key) => key !== 'rhythmRule.upcoming')
            .sort(),
        );
      },
    );
  });
});

describe('rhythmRuleUnits', () => {
  it.each<[Lang, number, string, string]>([
    ['bg', 1, 'ден', 'седмица'],
    ['bg', 0, 'дни', 'седмици'],
    ['bg', 7, 'дни', 'седмици'],
    ['bg', 21, 'дни', 'седмици'],
    ['en', 1, 'day', 'week'],
    ['en', 14, 'days', 'weeks'],
  ])(
    '%s, %d: the unit alone, in the count’s plural',
    (lang, count, day, week) => {
      const units = rhythmRuleUnits(translatorOf(lang), lang);

      expect(units.days(count)).toBe(day);
      expect(units.weeks(count)).toBe(week);
    },
  );

  it.each(LANGS)(
    'is the counted word without its count, so the two never spell apart (%s)',
    (lang) => {
      const units = rhythmRuleUnits(translatorOf(lang), lang);
      const words = rhythmRuleWords(summaryOf(), translatorOf(lang), lang);

      for (const count of [1, 2, 7, 14]) {
        expect(words.days(count)).toBe(`${count} ${units.days(count)}`);
        expect(words.weeks(count)).toBe(`${count} ${units.weeks(count)}`);
      }
    },
  );
});
