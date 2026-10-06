import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type StreakDefinitionVersion,
  StreakDefinition,
  type StreakPreview,
  type StreakState,
} from '@creativo/application/engagement';
import {
  type VisitTranslate,
  rhythmRuleWords,
} from '@creativo/features/shared/visits';
import { sampleRhythmRun } from '../admin-rhythm.preview';
import {
  type AdminRhythmContext,
  afterMissRow,
  changeWord,
  daysOf,
  earnEveryOptions,
  effectiveOptions,
  effectiveReading,
  excusesRow,
  fieldName,
  graceMarks,
  historyRow,
  inForceCapsule,
  intervalOptions,
  invalidNotice,
  longDay,
  monthWord,
  onBreakOptions,
  pauseDaysOptions,
  previewWords,
  protectionsRow,
  qualifierOptions,
  repairPerYearOptions,
  repairWindowOptions,
  riskLeadOptions,
  ruleDigest,
  sampleLabel,
  samplePeriods,
  sampleUnit,
  servicesCount,
  shortDay,
  signedDelta,
  toleranceExample,
  toleranceMarks,
  toleranceReadout,
  upcomingLine,
  weekMarks,
  weeksOf,
} from './admin-rhythm.words';

// ── The app's own words, read by key ─────────────────────────────────────

type Lang = 'bg' | 'en';

/** The catalogue flat, key → sentence, as a map (no dynamic index). */
function flatten(
  node: unknown,
  prefix = '',
  into: Map<string, string> = new Map(),
): Map<string, string> {
  if (typeof node === 'string') {
    into.set(prefix, node);
    return into;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix === '' ? key : `${prefix}.${key}`, into);
    }
  }
  return into;
}

function catalogueOf(lang: Lang): Map<string, string> {
  return flatten(
    JSON.parse(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
      readFileSync(
        resolve(
          __dirname,
          `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
        ),
        'utf8',
      ),
    ),
  );
}

const CATALOGUES = new Map<Lang, Map<string, string>>([
  ['bg', catalogueOf('bg')],
  ['en', catalogueOf('en')],
]);

/** Transloco's `translate`, as a spec can hold it: the catalogue and its `{{param}}` slots. */
function translateOf(lang: Lang): VisitTranslate {
  const catalogue = CATALOGUES.get(lang) ?? new Map<string, string>();
  return (key, params = {}) => {
    const raw = catalogue.get(key);
    if (raw === undefined) return key;
    const slots = new Map(Object.entries(params));
    return raw.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) =>
      String(slots.get(name) ?? ''),
    );
  };
}

const TODAY = '2026-09-28';

function contextOf(lang: Lang = 'bg'): AdminRhythmContext {
  const translate = translateOf(lang);
  const rule = rhythmRuleWords(
    StreakDefinition.default().summary(),
    translate,
    lang,
  );
  return { translate, lang, today: TODAY, rule };
}

const RECOMMENDED = StreakDefinition.default().toProps();

function revised(
  patch: Partial<ReturnType<StreakDefinition['toProps']>>,
  effectiveFrom = '2026-09-01',
): StreakDefinition {
  const next = StreakDefinition.default().revise(patch, effectiveFrom);
  if (next.isFailure()) throw new Error('the fixture is no rule');
  return next.value;
}

function versionOf(
  definition: StreakDefinition,
  extra: Partial<StreakDefinitionVersion> = {},
): StreakDefinitionVersion {
  return {
    definition,
    publishedAt: new Date('2026-08-28T07:00:00.000Z'),
    publishedBy: 'dev-staff-ivan',
    transition: 'grandfather',
    direction: 'looser',
    changed: ['interval'],
    requestId: 'request-1',
    withdrawnAt: null,
    ...extra,
  };
}

// ── Dates ────────────────────────────────────────────────────────────────

describe('the dates', () => {
  it('say the day and the month, and the year only outside today’s', () => {
    expect(shortDay('2026-09-01', TODAY, 'bg')).toBe('1.09');
    expect(shortDay('2025-03-01', TODAY, 'bg')).toBe('1.03.2025 г.');
  });

  it('say a date someone hears in words', () => {
    expect(longDay('2026-09-04', TODAY, 'bg')).toBe('4 септември');
    expect(longDay('2025-03-06', TODAY, 'bg')).toBe('6 март 2025 г.');
    expect(monthWord('2026-09-04', 'bg')).toBe('септември');
  });

  it('never move a day across a zone', () => {
    expect(shortDay('2026-12-31', TODAY, 'bg')).toBe('31.12');
    expect(shortDay('2026-01-01', TODAY, 'bg')).toBe('1.01');
  });
});

// ── Figures ──────────────────────────────────────────────────────────────

describe('the figures', () => {
  it('sign a delta with the typographic minus, and say nothing for none', () => {
    const context = contextOf();
    expect(signedDelta(context, 131, 148)).toBe('+17');
    expect(signedDelta(context, 71, 57)).toBe('−14');
    expect(signedDelta(context, 12, 12)).toBeNull();
  });

  it('turn days into weeks and back', () => {
    expect(weeksOf(42)).toBe(6);
    expect(weeksOf(39)).toBe(6);
    expect(daysOf(8)).toBe(56);
  });
});

// ── The menus ────────────────────────────────────────────────────────────

describe('the menus', () => {
  const context = contextOf();

  it('offer what counts, by kind', () => {
    expect(qualifierOptions(context).map((o) => [o.id, o.label])).toEqual([
      ['anyVisit', 'Всяко завършено посещение'],
      ['services', 'Посещение с избрани услуги'],
    ]);
    expect(intervalOptions(context).map((o) => o.label)).toEqual([
      'Еднакъв за всички',
      'Според навика на клиента',
    ]);
  });

  it('word the day counts in the rule’s own units', () => {
    expect(riskLeadOptions(context).map((o) => [o.id, o.label])).toEqual([
      ['0', '0 дни'],
      ['3', '3 дни'],
      ['7', '7 дни'],
      ['14', '14 дни'],
    ]);
    expect(pauseDaysOptions(context).map((o) => o.label)).toEqual([
      '30 дни',
      '60 дни',
      '90 дни',
    ]);
    expect(repairWindowOptions(context).map((o) => o.label)).toEqual([
      '7 дни',
      '14 дни',
      '21 дни',
      '30 дни',
    ]);
  });

  it('word the earning («на всеки 5 посещения») and the bare counts', () => {
    expect(earnEveryOptions(context).map((o) => o.label)).toEqual([
      'на всеки 3 посещения',
      'на всеки 4 посещения',
      'на всеки 5 посещения',
      'на всеки 6 посещения',
      'на всеки 8 посещения',
      'на всеки 10 посещения',
    ]);
    expect(repairPerYearOptions(context).map((o) => [o.id, o.label])).toEqual([
      ['1', '1'],
      ['2', '2'],
      ['3', '3'],
    ]);
    expect(onBreakOptions(context).map((o) => o.label)).toEqual([
      'Започва отначало',
      'Продължава оттам',
    ]);
  });

  it('give every option a test id of its own', () => {
    for (const option of [
      ...qualifierOptions(context),
      ...effectiveOptions(context),
      ...earnEveryOptions(context),
    ]) {
      expect(option.testId).toMatch(/^admin-rhythm-option-/);
    }
  });
});

// ── «От» ─────────────────────────────────────────────────────────────────

describe('effectiveReading', () => {
  const context = contextOf();
  const days = { tomorrow: '2026-09-29', firstOfMonth: '2026-10-01' };

  it('reads tomorrow, the first of the month, or the day itself', () => {
    expect(effectiveReading(context, '2026-09-29', days)).toEqual({
      choice: 'tomorrow',
      label: 'От утре',
    });
    expect(effectiveReading(context, '2026-10-01', days)).toEqual({
      choice: 'firstOfMonth',
      label: 'От 1-во число',
    });
    expect(effectiveReading(context, '2026-10-12', days)).toEqual({
      choice: 'pick',
      label: 'от 12.10',
    });
  });

  it('offers the three days in order', () => {
    expect(effectiveOptions(context).map((o) => o.id)).toEqual([
      'tomorrow',
      'firstOfMonth',
      'pick',
    ]);
  });
});

// ── The rulers’ marks ────────────────────────────────────────────────────

describe('the marks', () => {
  it('name the weeks evenly, floor to ceiling, every third major', () => {
    expect(weekMarks().map((m) => [m.value, m.label])).toEqual([
      [2, '2'],
      [8, '8'],
      [14, '14'],
      [20, '20'],
      [26, '26'],
    ]);
  });

  it('end the grace ruler where the ruler does', () => {
    expect(graceMarks(21).map((m) => m.value)).toEqual([0, 7, 14, 21]);
    expect(graceMarks(13).map((m) => m.value)).toEqual([0, 7]);
    expect(graceMarks(0).map((m) => m.value)).toEqual([0]);
  });

  it('print the tolerance in percent', () => {
    expect(toleranceMarks().map((m) => m.label)).toEqual([
      '0 %',
      '50 %',
      '100 %',
    ]);
  });
});

// ── The value rows ───────────────────────────────────────────────────────

describe('the value rows', () => {
  const context = contextOf();

  it('count the services', () => {
    expect(servicesCount(context, 1)).toBe('1 услуга');
    expect(servicesCount(context, 3)).toBe('3 услуги');
  });

  it('read the protections, on and off', () => {
    expect(protectionsRow(context, RECOMMENDED)).toBe('До 2 в запас');
    expect(
      protectionsRow(context, {
        ...RECOMMENDED,
        protections: { ...RECOMMENDED.protections, enabled: false },
      }),
    ).toBe('Изключени');
  });

  it('read the excuses, with the client’s pause when it is on', () => {
    expect(excusesRow(context, RECOMMENDED)).toBe('3 от 4');
    expect(
      excusesRow(context, {
        ...RECOMMENDED,
        clientPause: { enabled: true, maxDaysPerYear: 90 },
      }),
    ).toBe('3 от 4 · пауза до 90 дни');
  });

  it('read what a miss does', () => {
    expect(afterMissRow(context, RECOMMENDED)).toBe('Започва отначало');
    expect(afterMissRow(context, { ...RECOMMENDED, onBreak: 'hold' })).toBe(
      'Продължава оттам',
    );
  });
});

// ── The rule card's digest ───────────────────────────────────────────────

describe('the rule card’s digest', () => {
  const context = contextOf();

  it('joins grace, the protections and the excuses on a middle dot, in the rule’s order', () => {
    expect(ruleDigest(context, RECOMMENDED)).toBe(
      'гратис 7 дни\u00a0· защити до 2 в запас\u00a0· извинения 3 от 4',
    );
  });

  it('says what is off instead of leaving a gap', () => {
    expect(
      ruleDigest(context, {
        ...RECOMMENDED,
        graceDays: 0,
        protections: { ...RECOMMENDED.protections, enabled: false },
      }),
    ).toBe('без гратис\u00a0· без защити\u00a0· извинения 3 от 4');
  });

  it('is nothing while the rule is off', () => {
    expect(ruleDigest(context, { ...RECOMMENDED, enabled: false })).toBeNull();
  });

  it('read the tolerance and explain it on one habit', () => {
    const personal = {
      kind: 'personal' as const,
      tolerancePct: 50,
      minDays: 21,
      maxDays: 70,
      fallbackDays: 42,
    };
    expect(toleranceReadout(context, 50)).toBe('+50 %');
    expect(toleranceExample(context, personal)).toBe(
      'Клиент, който идва на 4 седмици, има срок 6 седмици.',
    );
    // The clamp holds the example too.
    expect(toleranceExample(context, { ...personal, maxDays: 35 })).toBe(
      'Клиент, който идва на 4 седмици, има срок 5 седмици.',
    );
  });

  it('word the capsule and the waiting version’s line', () => {
    expect(inForceCapsule(context, '2026-09-01', false)).toBe('В сила от 1.09');
    expect(inForceCapsule(context, '2026-10-01', true)).toBe('От 1.10');
    expect(upcomingLine(context, '2026-10-01', 'На всеки 5 седмици')).toBe(
      'От 1.10: На всеки 5 седмици',
    );
  });
});

// ── The history ──────────────────────────────────────────────────────────

describe('changeWord', () => {
  const context = contextOf();

  it('words every parameter, lower case, no stop', () => {
    const on = RECOMMENDED;
    expect(changeWord(context, 'enabled', on)).toBe('ритъмът е включен');
    expect(changeWord(context, 'enabled', { ...on, enabled: false })).toBe(
      'ритъмът е изключен',
    );
    expect(changeWord(context, 'qualifier', on)).toBe(
      'брои се всяко посещение',
    );
    expect(changeWord(context, 'minGapDays', on)).toBe(
      'близки посещения 7 дни',
    );
    expect(changeWord(context, 'bookingHold', on)).toBe(
      'записан час пази 14 дни',
    );
    expect(changeWord(context, 'interval', on)).toBe('интервал 6 седмици');
    expect(
      changeWord(context, 'interval', {
        ...on,
        interval: {
          kind: 'personal',
          tolerancePct: 50,
          minDays: 21,
          maxDays: 70,
          fallbackDays: 42,
        },
      }),
    ).toBe('интервал по навика');
    expect(changeWord(context, 'graceDays', on)).toBe('гратис 7 дни');
    expect(changeWord(context, 'graceDays', { ...on, graceDays: 0 })).toBe(
      'без гратис',
    );
    expect(changeWord(context, 'riskLeadDays', on)).toBe('подсещане 7 дни');
    expect(changeWord(context, 'protections', on)).toBe('защити до 2 в запас');
    expect(changeWord(context, 'excuses', on)).toBe('извинения 3 от 4');
    expect(changeWord(context, 'clientPause', on)).toBe('без пауза');
    expect(changeWord(context, 'repair', on)).toBe('връщане до 14 дни');
    expect(changeWord(context, 'onBreak', on)).toBe('пропускът нулира броя');
    expect(changeWord(context, 'name', on)).toBe('ново име');
  });

  it('says nothing for a version’s identity', () => {
    expect(changeWord(context, 'id', RECOMMENDED)).toBeNull();
    expect(changeWord(context, 'version', RECOMMENDED)).toBeNull();
    expect(changeWord(context, 'effectiveFrom', RECOMMENDED)).toBeNull();
  });
});

describe('historyRow', () => {
  const context = contextOf();

  it('names the first rule and the system', () => {
    const row = historyRow(
      context,
      versionOf(revised({}, '2025-03-01'), {
        publishedBy: 'system',
        publishedAt: new Date('2025-03-01T07:00:00.000Z'),
        changed: [],
      }),
    );
    // `revise` numbers the next version: the recommended rule's successor is 2.
    expect(row).toEqual({
      version: 2,
      title: 'От 1.03.2025 г.\u00a0· първо правило',
      // Published on its own day: the title says the day, the by-line does not.
      by: 'системата',
      withdrawn: false,
    });
  });

  it('names one change, and counts the rest in the rule’s order', () => {
    const one = historyRow(
      context,
      versionOf(revised({ interval: { kind: 'fixed', days: 42 } })),
    );
    expect(one.title).toBe('От 1.09\u00a0· интервал 6 седмици');
    expect(one.by).toBe('dev-staff-ivan · 28.08');

    // A rule scheduled and published on one day says that day once.
    const sameDay = historyRow(
      context,
      versionOf(revised({ interval: { kind: 'fixed', days: 42 } }), {
        publishedAt: new Date('2026-09-01T07:00:00.000Z'),
      }),
    );
    expect(sameDay.title).toBe(one.title);
    expect(sameDay.by).toBe('dev-staff-ivan');

    const several = historyRow(
      context,
      versionOf(
        revised({ graceDays: 10, interval: { kind: 'fixed', days: 35 } }),
        {
          changed: ['graceDays', 'interval', 'effectiveFrom'],
        },
      ),
    );
    expect(several.title).toBe('От 1.09\u00a0· интервал 5 седмици и още 1');
  });

  it('marks a version called off before its day', () => {
    expect(
      historyRow(
        context,
        versionOf(revised({}), {
          withdrawnAt: new Date('2026-09-02T07:00:00Z'),
        }),
      ).withdrawn,
    ).toBe(true);
  });
});

// ── The preview ──────────────────────────────────────────────────────────

describe('previewWords', () => {
  const context = contextOf();
  const estimate: StreakPreview = {
    kind: 'estimate',
    clients: 214,
    before: { inRhythm: 131, inGrace: 12, broken: 71 },
    after: { inRhythm: 148, inGrace: 9, broken: 57 },
    back: 17,
    out: 0,
  };

  it('words the clients, three figures with their deltas, and the two halves', () => {
    const words = previewWords(context, estimate, false, 1000);
    expect(words.kind).toBe('estimate');
    if (words.kind !== 'estimate') return;
    expect(words.clients).toBe('214 клиенти с посещение за 12 месеца');
    expect(words.capped).toBeNull();
    expect(
      words.metrics.map((m) => [m.id, m.value, m.delta, m.caption]),
    ).toEqual([
      ['inRhythm', '148', '+17', 'В ритъм'],
      ['inGrace', '9', '−3', 'Гратис'],
      ['broken', '57', '−14', 'Прекъснати'],
    ]);
    expect(words.metrics[0]?.label).toBe('В ритъм: 131 → 148');
    expect(words.summary).toBe(
      '17 се връщат в ритъм\u00a0· никой не излиза от ритъм',
    );
  });

  it('agrees at one, and says who leaves', () => {
    const words = previewWords(
      context,
      { ...estimate, back: 1, out: 1 },
      false,
      1000,
    );
    if (words.kind !== 'estimate') throw new Error('estimate');
    expect(words.summary).toBe('1 се връща в ритъм\u00a0· 1 излиза от ритъм');
    expect(
      previewWords(context, { ...estimate, clients: 1 }, false, 1000),
    ).toMatchObject({ clients: '1 клиент с посещение за 12 месеца' });
  });

  it('says where the walk stopped', () => {
    const words = previewWords(context, estimate, true, 1000);
    if (words.kind !== 'estimate') throw new Error('estimate');
    // Bulgarian groups from five digits (CLDR's minimum grouping), so a
    // thousand prints whole; English groups it.
    expect(words.capped).toBe('от първите 1000 клиенти');
    const english = previewWords(contextOf('en'), estimate, true, 1000);
    if (english.kind !== 'estimate') throw new Error('estimate');
    expect(english.capped).toBe('of the first 1,000 clients');
  });

  it('draws no figures while either rule is off', () => {
    const words = previewWords(
      context,
      { ...estimate, after: null, back: 0, out: 0 },
      false,
      1000,
    );
    if (words.kind !== 'estimate') throw new Error('estimate');
    expect(words.metrics).toEqual([]);
    expect(words.summary).toBe(
      'никой не се връща\u00a0· никой не излиза от ритъм',
    );
  });

  it('says why it is unavailable', () => {
    expect(
      previewWords(
        context,
        { kind: 'unavailable', reason: 'qualifier' },
        false,
        1000,
      ),
    ).toEqual({
      kind: 'unavailable',
      reason: 'Прегледът не е наличен за избрани услуги.',
    });
  });
});

// ── The sample track ─────────────────────────────────────────────────────

describe('samplePeriods', () => {
  const context = contextOf();

  it('draws the projector’s run: kept visits, the miss, the visit after it and the open period', () => {
    const state = sampleRhythmRun(StreakDefinition.default(), TODAY);
    if (state === null) throw new Error('the sample has no run');
    const periods = samplePeriods(context, state);
    const marks = periods.map((p) => p.mark);
    expect(marks[marks.length - 1]).toBe('current');
    expect(marks).toContain('kept');
    expect(new Set(periods.map((p) => p.id)).size).toBe(periods.length);
    for (const period of periods) {
      expect(period.caption).toBe('');
      expect(period.description).not.toBe('');
      expect(period.description).not.toMatch(/clientCard\./);
    }
    expect(sampleLabel(context, state)).toBe(
      `${state.current} посещения в ритъм`,
    );
    expect(sampleUnit(context)).toBe('в ритъм');
  });

  it('describes each closed mark in its month, and a frozen open period as covered', () => {
    const state: StreakState = {
      streakId: 'cadence',
      definitionVersion: 1,
      phase: { kind: 'frozen', until: '2026-10-10', reason: 'freeze' },
      current: 3,
      best: 5,
      lastQualifiedAt: null,
      dueBy: '2026-10-10',
      freezesBanked: 1,
      period: null,
      periods: [
        { mark: 'kept', on: '2026-07-04', reason: null },
        { mark: 'protected', on: '2026-08-15', reason: 'staffCancelled' },
        { mark: 'missed', on: '2026-09-01', reason: null },
        { mark: 'repaired', on: '2026-09-10', reason: null },
      ],
      heldBy: null,
      runStartedOn: '2026-07-04',
    };
    const periods = samplePeriods(context, state);
    expect(periods.map((p) => [p.mark, p.description])).toEqual([
      ['kept', 'юли · посещение 4.07'],
      ['protected', 'август · защита: салонът отмени часа'],
      ['missed', 'септември · без посещение'],
      ['repaired', 'септември · възстановено'],
      ['protected', 'текущ период · до 10 октомври'],
    ]);
  });
});

// ── A refused field ──────────────────────────────────────────────────────

describe('a refused field', () => {
  const context = contextOf();

  it('is named by its control’s label', () => {
    expect(fieldName(context, 'graceDays')).toBe('Гратисен период');
    expect(fieldName(context, 'interval.days')).toBe('Срок');
    expect(fieldName(context, 'protections.maxBanked')).toBe(
      'В запас най-много',
    );
    expect(fieldName(context, 'qualifier.serviceIds')).toBe(
      'Услуги, които се броят',
    );
    expect(fieldName(context, 'scheduled.transition')).toBe(
      'scheduled.transition',
    );
  });

  it('is said once per field, as a list', () => {
    expect(
      invalidNotice(context, ['graceDays', 'interval.days', 'graceDays']),
    ).toBe('Поправи: Гратисен период и Срок.');
  });
});

// ── English ──────────────────────────────────────────────────────────────

describe('in English', () => {
  it('reads the same rows and dates', () => {
    const context = contextOf('en');
    expect(protectionsRow(context, RECOMMENDED)).toBe('Up to 2 in reserve');
    expect(excusesRow(context, RECOMMENDED)).toBe('3 of 4');
    expect(ruleDigest(context, RECOMMENDED)).toBe(
      'grace 7 days\u00a0· protections, up to 2\u00a0· excuses 3 of 4',
    );
    expect(servicesCount(context, 1)).toBe('1 service');
    expect(
      effectiveReading(context, '2026-09-29', {
        tomorrow: '2026-09-29',
        firstOfMonth: '2026-10-01',
      }).label,
    ).toBe('From tomorrow');
  });
});
