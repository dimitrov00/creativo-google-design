import { Daypart, type Metric } from '@core/components';
import { StreakPublishErrorCode } from '@core/errors';
import { localDate } from '@core/testing';
import { pluralForm } from '@creativo/infrastructure/i18n';
import { describe, expect, it } from 'vitest';
import {
  dayRange,
  dayWithYear,
  monogramOf,
  monthYearLong,
} from './client-card.format';
import {
  type AchievementHowWord,
  type AchievementMetricWord,
  type ClientCardTranslate,
  achievementMetricWord,
  clientCardWordsOf,
} from './client-card.words';
import { catalogueOf, translatorOf } from '../testing/client-card.fixtures';
import { formatCount } from '@creativo/ui/wall-clock';

/** The sixteen words a metric is said with («Как се печели», the progress card). */
const HOW_WORDS = [
  'visits',
  'earlyBird',
  'weekend',
  'onTime',
  'party',
  'selfService',
  'waitlist',
  'referrals',
  'services',
  'barbers',
  'shops',
  'months',
  'spend',
  'points',
  'tenure',
  'shopBookings',
] as const satisfies readonly AchievementHowWord[];

/** A subject's name, then the count in both forms (2 asks for `other`, 1 for `one`). */
const NAMED_IN_BOTH_FORMS = [
  ['x', 2],
  ['x', 1],
] as const;

/** The words that take one of a closed set: every member is asked for. */
const CLOSED_SETS: Readonly<Record<string, readonly (readonly unknown[])[]>> = {
  'words.monthShort': Array.from({ length: 12 }, (_, i) => [i + 1]),
  'words.waitlist.daypart': Daypart.ALL.map((part) => [part]),
  'words.visits.cancelledBy': [['client'], ['shop']],
  'words.visits.rowName': [
    [
      {
        title: 'Фейд',
        when: 'днес',
        barber: 'Иван',
        outcome: '',
        price: '',
        marks: '',
        quote: '',
      },
    ],
  ],
  'words.ledger.verb': [
    ['earned'],
    ['bonus'],
    ['spent'],
    ['adjusted'],
    ['reversed'],
    ['expired'],
    ['debtCleared'],
    ['voided'],
    ['received'],
    ['status'],
  ],
  'words.achievements.record': [
    ['longestRhythm'],
    ['mostVisitsInYear'],
    ['favouriteService'],
    ['firstVisit'],
  ],
  // Revision 3 (§6.1).
  'words.loyalty.holding': [['voucher'], ['stamps'], ['rhythm']],
  'words.rhythm.reason': [
    ['freeze'],
    ['pause'],
    ['staffCancelled'],
    ['barberAbsence'],
    ['shopClosure'],
    ['closedDays'],
    ['clientPause'],
  ],
  'words.ledgerPage.filter': [['all'], ['points'], ['rewards'], ['status']],
  'words.records.group': [['rhythm'], ['visits'], ['favourites']],
  'words.records.row': [
    ['currentRhythm'],
    ['totalVisits'],
    ['last12Months'],
    ['preferredBarber'],
    ['usualServices'],
  ],
  'words.records.label': [
    ['longestRhythm'],
    ['mostVisitsInYear'],
    ['favouriteService'],
    ['firstVisit'],
  ],
  // With no count (the plural), and in both forms; the first visit's figure is a date.
  'words.records.sentence': [
    ['longestRhythm'],
    ['longestRhythm', 1],
    ['mostVisitsInYear', 2],
    ['mostVisitsInYear', 1],
    ['firstVisit'],
  ],
  'words.records.sentenceFavourite': [['x'], ['x', 1]],
  'words.achievement.how': HOW_WORDS.map((word) => [word]),
  // K1b (G1-6): a member whose COUNT is not its first argument is asked in
  // both forms here, or the sample never reaches its `.one`.
  'words.achievement.what': HOW_WORDS.flatMap((word) => [
    [word, 2],
    [word, 1],
  ]),
  'words.achievement.whatService': NAMED_IN_BOTH_FORMS,
  'words.achievement.whatBarber': NAMED_IN_BOTH_FORMS,
  'words.achievement.whatShop': NAMED_IN_BOTH_FORMS,
  'words.achievements.dayGroupName': NAMED_IN_BOTH_FORMS,
  'words.erasure.alertBody': [
    [{ visits: 12, notes: 2, photos: 3, accounts: 1, siblings: 1 }],
    [{ visits: 1, notes: 0, photos: 0, accounts: 0, siblings: 0 }],
  ],
  'words.achievements.collectionName': [
    [18, 42, 38],
    [1, 1, 1],
  ],
  'words.records.yearName': [
    ['x', 2, true],
    ['x', 1, false],
  ],
  'words.loyaltyPage.tierName': [
    ['x', 2, 1, 'x'],
    ['x', 1, 1, 'x'],
  ],
  'words.loyaltyPage.passName': [
    ['x', 'x', 2, 'x'],
    ['x', 'x', 1, 'x'],
  ],
  'words.loyaltyPage.stampsName': [
    [3, 10, 7, 'x'],
    [0, 1, 1, 'x'],
  ],
  'words.loyaltyPage.catalogListName': [
    ['x', 2, 3],
    ['x', 1, 1],
  ],
  'words.achievement.who': [
    ['anyBarberAnyShop'],
    ['anyServiceAnyShop'],
    ['anyBarberAnyService'],
  ],
};

/**
 * The keys of revision 3 the CARD does not read: the rule's sentences
 * (`rhythmRuleWords`, the shared visits lib), the admin page and the menu's
 * entry. The catalogue is this package's too, so their presence is pinned here.
 */
const KEYS_OTHER_FEATURES_READ: Readonly<Record<string, readonly string[]>> = {
  rhythmRule: [
    'fixed',
    'personal',
    'fallback',
    'grace',
    'protections',
    'excuses',
    'hold',
    'repair',
    'holdCount',
    'services',
    'upcoming',
    'short',
    'shortNoGrace',
    'off',
    'weeks.one',
    'weeks.other',
    'weeksHalf',
    'days.one',
    'days.other',
  ],
  'landing.menu': ['loyaltyAdmin'],
  'admin.rhythm': [
    'title',
    'lede',
    'back',
    'enabled',
    'inForce',
    'scheduled',
    'sample',
    'counts.title',
    'counts.label',
    'counts.any',
    'counts.services',
    'counts.servicesRow',
    'counts.servicesCount.one',
    'counts.servicesCount.other',
    'counts.hold',
    'counts.holdDays',
    'counts.minGap',
    'counts.seat',
    'interval.title',
    'interval.label',
    'interval.fixed',
    'interval.personal',
    'interval.tolerance',
    'interval.example',
    'interval.min',
    'interval.max',
    'interval.fallback',
    'grace.title',
    'grace.lead',
    'grace.leadNone',
    'protections.title',
    'protections.enabled',
    'protections.max',
    'protections.every',
    'protections.everyValue.one',
    'protections.everyValue.other',
    'protections.first',
    'protections.note',
    'excuses.title',
    'excuses.staffCancelled',
    'excuses.barberAbsence',
    'excuses.shopClosure',
    'excuses.closedDays',
    'excuses.offWarning',
    'pause.enabled',
    'pause.days',
    'afterMiss.title',
    'more.title',
    'row.protections',
    'row.protectionsOff',
    'row.excuses',
    'row.excusesPause',
    'sheet.services',
    'sheet.servicesSearch',
    'sheet.done',
    'onBreak.label',
    'onBreak.restart',
    'onBreak.hold',
    'repair.enabled',
    'repair.window',
    'repair.perYear',
    'effective.title',
    'effective.from',
    'effective.tomorrow',
    'effective.firstOfMonth',
    'effective.pick',
    'effective.picked',
    'transition.label',
    'transition.grandfather',
    'transition.note',
    'preview.title',
    'preview.estimate',
    'preview.clients.one',
    'preview.clients.other',
    'preview.inRhythm',
    'preview.inGrace',
    'preview.broken',
    'preview.delta',
    'preview.summary',
    'preview.nobodyOut',
    'preview.unavailable',
    'preview.capped',
    'preview.back.one',
    'preview.back.other',
    'preview.out.one',
    'preview.out.other',
    'preview.nobodyBack',
    'history.title',
    'history.row',
    'history.first',
    'history.by',
    'history.system',
    'history.withdraw',
    'history.withdrawn',
    'history.change.name',
    'history.change.enabled.on',
    'history.change.enabled.off',
    'history.change.qualifier.anyVisit',
    'history.change.qualifier.services',
    'history.change.qualifier.categories',
    'history.change.minGapDays',
    'history.change.bookingHold.on',
    'history.change.bookingHold.off',
    'history.change.interval.fixed',
    'history.change.interval.personal',
    'history.change.graceDays.days',
    'history.change.graceDays.none',
    'history.change.riskLeadDays.days',
    'history.change.riskLeadDays.none',
    'history.change.protections.on',
    'history.change.protections.off',
    'history.change.excuses',
    'history.change.clientPause.on',
    'history.change.clientPause.off',
    'history.change.repair.on',
    'history.change.repair.off',
    'history.change.onBreak.restart',
    'history.change.onBreak.hold',
    'history.more',
    'save',
    'confirm.stricter',
    'confirm.switchOff',
    'confirm.switchOffMessage',
    'confirm.switchOn',
    'confirm.discard',
    'confirm.discardYes',
    'confirm.discardKeep',
    'receipt',
    'undo',
    'empty',
    'flagOff',
    'failed',
    'offline',
  ],
  // The admin page words the publish refusals by their codes (pass D,
  // D-9.6): `errors.<errorCode>`, today's words.
  errors: [
    StreakPublishErrorCode.Stale,
    StreakPublishErrorCode.TooEarly,
    StreakPublishErrorCode.Invalid,
    StreakPublishErrorCode.CallerNotAdmin,
    StreakPublishErrorCode.CallerUnauthenticated,
  ],
};

/** Every sentence of a catalogue by its dotted key. */
function sentencesOf(node: unknown, path = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node === 'string') return out.set(path, node);
  if (node !== null && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      for (const [at, sentence] of sentencesOf(
        child,
        path === '' ? key : `${path}.${key}`,
      )) {
        out.set(at, sentence);
      }
    }
  }
  return out;
}

/**
 * The STRICT reading of the catalogue. `translatorOf` fills a slot nobody
 * handed a value with nothing, silently; this one throws, so a member that
 * forgets a parameter of its sentence fails here and not as a gap on a
 * screen. It also remembers every key it was asked for.
 */
function strictTranslator(lang: 'bg' | 'en'): {
  readonly translate: ClientCardTranslate;
  readonly asked: Set<string>;
  readonly sentences: ReadonlyMap<string, string>;
} {
  const sentences = sentencesOf(catalogueOf(lang));
  const asked = new Set<string>();
  return {
    asked,
    sentences,
    translate: (key, params = {}) => {
      const sentence = sentences.get(key);
      if (sentence === undefined) throw new Error(`missing word ${key}`);
      asked.add(key);
      const handed = new Map(Object.entries(params));
      return sentence.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, slot: string) => {
        if (!handed.has(slot)) throw new Error(`${key}: no {{${slot}}}`);
        return String(handed.get(slot));
      });
    },
  };
}

/**
 * Calls every word the object holds with sample arguments; the strict
 * translator throws on a missing key. `count` is the sample every first
 * argument takes: 2 asks for a plural's `other`, 1 for its `one`.
 */
function everyWord(node: unknown, path = 'words', count = 2): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node === 'function') {
    const calls = Object.entries(CLOSED_SETS).find(
      ([key]) => key === path,
    )?.[1] ?? [
      Array.from({ length: node.length }, (_, i) => (i === 0 ? count : 'x')),
    ];
    try {
      return calls.flatMap((args) => {
        const out: unknown = node(...args);
        return typeof out === 'string' ? [out] : everyWord(out, path, count);
      });
    } catch (error) {
      throw new Error(`${path}: ${(error as Error).message}`);
    }
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      key === 'lang' ? [] : everyWord(value, `${path}.${key}`, count),
    );
  }
  return [];
}

describe('clientCardWordsOf', () => {
  it.each(['bg', 'en'] as const)(
    'finds every word the presenters read in the %s catalogue',
    (lang) => {
      const words = clientCardWordsOf(translatorOf(lang), lang);
      const all = everyWord(words);
      expect(all.length).toBeGreaterThan(150);
      expect(
        all.every((word) => word.trim().length > 0 && !word.includes('{{')),
      ).toBe(true);
      expect(words.lang).toBe(lang);
    },
  );

  it('picks the plural form by the count', () => {
    const words = clientCardWordsOf(translatorOf('bg'), 'bg');
    expect(words.achievements.levels(1)).toBe('1 ниво');
    expect(words.achievements.levels(37)).toBe('37 нива');
    expect(words.achievements.levelsUnit(1)).toBe('ниво');
    expect(words.achievements.levelsUnit(37)).toBe('нива');
    expect(words.monthShort(9)).toBe('септ.');
  });

  it('reads the tile’s one-word repeat verb and its name from their own keys', () => {
    const bg = clientCardWordsOf(translatorOf('bg'), 'bg');
    expect(bg.actions.repeat).toBe('Повтори');
    expect(bg.actions.againName('19 август', 'Класическа подстрижка')).toBe(
      'Повтори посещението от 19 август: Класическа подстрижка',
    );
    expect(bg.head.since('март 2025 г.')).toBe('Клиент от март 2025 г.');
    const en = clientCardWordsOf(translatorOf('en'), 'en');
    expect(en.actions.repeat).toBe('Repeat');
    expect(en.actions.againName('19 August', 'Classic cut')).toBe(
      'Repeat the visit from 19 August: Classic cut',
    );
  });

  it('speaks the figures the screen abbreviates, the unit in words and in agreement', () => {
    const bg = clientCardWordsOf(translatorOf('bg'), 'bg');
    const page = bg.loyaltyPage;
    expect(
      page.rewardName(400, 'Продукт по избор', page.rewardMoreSuffix('92')),
    ).toBe('Продукт по избор, 400 точки, още 92');
    expect(page.rewardName(1, 'Стикер', '')).toBe('Стикер, 1 точка');
    expect(page.rewardName(1200, 'Сешоар', '')).toBe(
      `Сешоар, ${formatCount(1200, 'bg')} точки`,
    );
    expect(bg.reward.stack(2)).toBe('×2');
    expect(bg.history.statsInterval(1)).toBe(', средно на 1 седмица');
    expect(bg.history.statsInterval(4)).toBe(', средно на 4 седмици');
    const en = clientCardWordsOf(translatorOf('en'), 'en');
    expect(en.loyaltyPage.rewardName(1200, 'Hair dryer', '')).toBe(
      'Hair dryer, 1,200 points',
    );
    expect(en.history.statsInterval(1)).toBe(', every 1 week on average');
  });

  it('ends a sentence that ends on a year on one full stop', () => {
    const words = clientCardWordsOf(translatorOf('bg'), 'bg');
    expect(words.history.end('6.03.2025 г.')).toBe(
      'Това е всичко · първото посещение е на 6.03.2025 г.',
    );
    expect(words.history.end('6.03')).toBe(
      'Това е всичко · първото посещение е на 6.03.',
    );
  });

  it('says where a season closed without its dates (the subline holds them), the numeral bound to «ниво»', () => {
    const bg = clientCardWordsOf(translatorOf('bg'), 'bg');
    expect(bg.achievements.seasonEnded).toBe('Сезонът приключи.');
    expect(bg.achievements.seasonEndedAt('III')).toBe(
      'Сезонът приключи на ниво\u00a0III.',
    );
    expect(bg.achievements.nextWithThisVisit('II')).toBe(
      'Ниво\u00a0II с това посещение',
    );
    expect(bg.achievements.cueWithThisVisit('Рожден ден в салона', 'I')).toBe(
      'С това посещение: Рожден ден в салона, ниво\u00a0I',
    );
    expect(bg.loyaltyPage.stampsToNext(6)).toBe('Още 6 посещения');
    expect(bg.ledger.visitOf('Фейд')).toBe('Посещение: Фейд');
    const en = clientCardWordsOf(translatorOf('en'), 'en');
    expect(en.achievements.seasonEndedAt('III')).toBe(
      'The season ended at level\u00a0III.',
    );
    expect(en.achievements.cueNew('Visits', 'IV')).toBe(
      'New: Visits, level\u00a0IV',
    );
  });
});

describe('the words of revision 3 (client-card-revision-3 §6.1)', () => {
  const bg = clientCardWordsOf(translatorOf('bg'), 'bg');
  const en = clientCardWordsOf(translatorOf('en'), 'en');
  const RECORD_KINDS = [
    'longestRhythm',
    'mostVisitsInYear',
    'favouriteService',
    'firstVisit',
  ] as const;

  it.each(['bg', 'en'] as const)(
    'hands every sentence every slot it holds, in %s',
    (lang) => {
      const strict = strictTranslator(lang);
      const words = clientCardWordsOf(strict.translate, lang);
      expect(everyWord(words).length).toBeGreaterThan(300);
      expect(everyWord(words, 'words', 1).length).toBeGreaterThan(300);
    },
  );

  it.each(['bg', 'en'] as const)(
    'leaves no clientCard sentence of the %s catalogue unread: a key nobody words is dead copy',
    (lang) => {
      const strict = strictTranslator(lang);
      const words = clientCardWordsOf(strict.translate, lang);
      everyWord(words);
      everyWord(words, 'words', 1);
      // What the sample arguments cannot reach: a member's `null` path.
      words.reward.name('x', null);
      words.reward.appliedName('x', null);
      const unread = [...strict.sentences.keys()].filter(
        (key) => key.startsWith('clientCard.') && !strict.asked.has(key),
      );
      // The admin page reads it BY KEY (contract delta M1b-3 f); the card's
      // own member went in W4 with the built tile that read it.
      expect(unread).toEqual(['clientCard.loyalty.rhythmLabel']);
    },
  );

  it.each(['bg', 'en'] as const)(
    'holds none of the keys W4 removed or renamed (§6.1), nor a word nobody read, in %s',
    (lang) => {
      const { sentences } = strictTranslator(lang);
      const gone = [
        // §6.1: removed with the built pages.
        'clientCard.capsule.birthday',
        'clientCard.loyaltyPage.ready',
        'clientCard.loyaltyPage.stampCards',
        'clientCard.loyaltyPage.ledgerOlder',
        'clientCard.achievements.soon',
        'clientCard.achievements.latest',
        'clientCard.achievements.shelfAllName',
        // §6.1 changed their words; lead ruling G1-5 kept K1's `catalogTitle`
        // and `ledgerTitle` instead, so the old pair had no reader left.
        'clientCard.loyaltyPage.catalog',
        'clientCard.loyaltyPage.ledger',
        // §6.1: renamed to `visits.section.visits`.
        'clientCard.history.yearVisits.one',
        'clientCard.history.yearVisits.other',
        // Words no page read: the medal detail draws no related row, the
        // visits page no stats card, the ledger no referral source, and the
        // funnel's name is `visits.filter.label` (reuse first).
        'clientCard.achievement.allOfCategory',
        'clientCard.history.stats.spend',
        'clientCard.ledger.source.referral',
        'visits.filter.name',
      ];
      expect(gone.filter((key) => sentences.has(key))).toEqual([]);
      expect(sentences.has('visits.section.visits.one')).toBe(true);
      expect(sentences.has('visits.section.visits.other')).toBe(true);
      expect(sentences.get('clientCard.birthday.today')).toBe(
        lang === 'bg' ? 'Рожден ден днес' : 'Birthday today',
      );
    },
  );

  it.each(['bg', 'en'] as const)(
    'holds the rule’s, the admin page’s and the menu’s keys in %s',
    (lang) => {
      const { sentences } = strictTranslator(lang);
      const keys = Object.entries(KEYS_OTHER_FEATURES_READ).flatMap(
        ([root, tails]) => tails.map((tail) => `${root}.${tail}`),
      );
      expect(keys).toHaveLength(158);
      expect(
        keys.filter((key) => (sentences.get(key) ?? '').trim() === ''),
      ).toEqual([]);
      // The list IS the contract: a key these roots hold and the list does
      // not is a key nobody was told about (and under `rhythmRule`, one
      // that `rhythmRuleWords` does not read).
      expect(
        [...sentences.keys()]
          .filter((key) => /^(rhythmRule|admin\.rhythm)\./u.test(key))
          .filter((key) => !keys.includes(key)),
      ).toEqual([]);
    },
  );

  it('words the rule, its units and the menu’s entry as the table has them', () => {
    const t = translatorOf('bg');
    expect(t('rhythmRule.fixed', { interval: '6 седмици' })).toBe(
      'Посещение на всеки 6 седмици пази ритъма.',
    );
    expect(
      t('rhythmRule.short', { interval: '6 седмици', grace: '7 дни' }),
    ).toBe('На всеки 6 седмици · 7 дни гратис');
    expect(t('rhythmRule.weeks.one', { count: 1 })).toBe('1 седмица');
    expect(t('rhythmRule.weeksHalf', { count: 4 })).toBe('4½ седмици');
    expect(t('rhythmRule.days.other', { count: 7 })).toBe('7 дни');
    expect(t('landing.menu.loyaltyAdmin')).toBe('Лоялност');
    expect(t('admin.rhythm.title')).toBe('Ритъм');
    expect(translatorOf('en')('admin.rhythm.receipt', { date: '30.09' })).toBe(
      'Rule saved · from 30.09',
    );
  });

  it('words the hero’s quiet line as ONE sentence, and the tier ring for a reader', () => {
    expect(bg.head.cadence(4)).toBe('4 седмици');
    expect(bg.head.cadence(1)).toBe('1 седмица');
    expect(bg.head.sinceCadence('март 2025 г.', bg.head.cadence(4))).toBe(
      'Клиент от март 2025 г. · идва през 4 седмици',
    );
    expect(
      bg.head.tierName('Злато', bg.visitsModule.sectionVisits(7), 'Платина'),
    ).toBe('Злато, още 7 посещения до Платина');
    expect(bg.head.tierTopName('Платина')).toBe('Платина, най-високият статус');
    // The built line stays for a client without a cadence, and for the pass's foot.
    expect(bg.head.since('март 2025 г.')).toBe('Клиент от март 2025 г.');
    expect(en.head.sinceCadence('March 2025', en.head.cadence(4))).toBe(
      'Client since March 2025 · comes every 4 weeks',
    );
    expect(
      en.head.tierName('Gold', en.visitsModule.sectionVisits(7), 'Platinum'),
    ).toBe('Gold, 7 visits more to Platinum');
  });

  it('words the birthday card: the band, the day before it, the gift as one button', () => {
    expect(bg.birthday.today).toBe('Рожден ден днес');
    expect(bg.birthday.todayAge(34)).toBe('Рожден ден · 34 г.');
    expect(bg.birthday.gift).toBe('Подарък от салона');
    expect(bg.birthday.upcoming('петък', '2.10', 34)).toBe(
      'Рожден ден · петък, 2.10 · 34 г.',
    );
    expect(bg.birthday.upcoming('петък', '2.10', null)).toBe(
      'Рожден ден · петък, 2.10',
    );
    expect(bg.birthday.name(34)).toBe('Рожден ден днес, навършва 34 години');
    expect(bg.birthday.name(null)).toBe('Рожден ден днес');
    expect(bg.birthday.giftName(34, '−20 %')).toBe(
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай',
    );
    expect(bg.birthday.giftAppliedName(null, '−20 %')).toBe(
      'Рожден ден днес. Подарък: −20 %, с това посещение',
    );
    expect(en.birthday.todayAge(34)).toBe('Birthday · 34');
    expect(en.birthday.upcoming('Friday', '2 Oct', 34)).toBe(
      'Birthday · Friday, 2 Oct · 34',
    );
    expect(en.birthday.giftName(34, '−20%')).toBe(
      'Birthday today, turning 34. Gift: −20%, use',
    );
  });

  it('words the visit cards and the visits browser', () => {
    expect(bg.visitCard.last).toBe('Последно посещение');
    expect(bg.visitCard.next).toBe('Следващ час');
    expect(
      bg.visitCard.name(bg.visitCard.last, 'Фейд, 5 септември, Иван'),
    ).toBe('Последно посещение: Фейд, 5 септември, Иван');
    expect(bg.visitsModule.sectionVisits(1)).toBe('1 посещение');
    expect(bg.visitsModule.sectionVisits(3)).toBe('3 посещения');
    // The records' and the medals' count reads the renamed key: one sentence, two members.
    expect(bg.history.yearVisits(3)).toBe(bg.visitsModule.sectionVisits(3));
    expect(bg.history.yearVisits(1)).toBe('1 посещение');
    expect(en.visitCard.next).toBe('Next visit');
    expect(en.visitsModule.sectionVisits(1)).toBe('1 visit');
  });

  it('words the loyalty card: the unit in agreement, the name with whatever the card holds', () => {
    expect(bg.loyalty.points(371)).toBe('371 точки');
    expect(bg.loyalty.points(1)).toBe('1 точка');
    expect(bg.loyalty.points(12450)).toBe(`${formatCount(12450, 'bg')} точки`);
    expect(bg.loyalty.pointsWord(371)).toBe('точки');
    expect(bg.loyalty.pointsWord(1)).toBe('точка');
    expect(bg.loyalty.enoughForPoints('безплатно оформяне на брада')).toBe(
      'Стигат за безплатно оформяне на брада',
    );
    expect(bg.loyalty.moreTo(42, 'безплатно подстригване')).toBe(
      'Още 42 до безплатно подстригване',
    );
    expect(
      (['voucher', 'stamps', 'rhythm'] as const).map((holding) =>
        bg.loyalty.holding(holding),
      ),
    ).toEqual(['Ваучер', 'Печати', 'Ритъм']);
    expect(bg.loyalty.stampsOf(3, 10)).toBe('3 от 10');
    expect(
      bg.loyalty.cardName(
        bg.loyalty.points(371),
        'Стигат за безплатно оформяне на брада',
        'Ваучер 25,00 €, печати 3 от 10, ритъм 9 посещения',
      ),
    ).toBe(
      'Лоялност: 371 точки. Стигат за безплатно оформяне на брада. Ваучер 25,00 €, печати 3 от 10, ритъм 9 посещения.',
    );
    expect(en.loyalty.points(1)).toBe('1 point');
    expect(en.loyalty.moreTo(42, 'a free cut')).toBe('42 more to a free cut');
  });

  it('drops an absent fact with its joint: no doubled space, no doubled stop, the money’s no-break space kept', () => {
    const points = bg.loyalty.points(371);
    expect(bg.loyalty.cardName(points, null, 'Ваучер 25,00 €')).toBe(
      'Лоялност: 371 точки. Ваучер 25,00 €.',
    );
    expect(bg.loyalty.cardName(points, 'Стигат за фейд.', null)).toBe(
      'Лоялност: 371 точки. Стигат за фейд.',
    );
    expect(bg.loyalty.cardName(points, null, null)).toBe(
      'Лоялност: 371 точки.',
    );
    expect(bg.loyalty.cardName(points, '', '')).toBe('Лоялност: 371 точки.');
  });

  it('names the pass with the facts it has', () => {
    const page = bg.loyaltyPage;
    expect(page.passName('Георги Петров', 'Злато', 371, 'март 2025 г.')).toBe(
      'Карта за лоялност: Георги Петров, Злато, 371 точки за размяна, клиент от март 2025 г.',
    );
    expect(page.passName('Георги Петров', null, 371, null)).toBe(
      'Карта за лоялност: Георги Петров, 371 точки за размяна',
    );
    expect(page.passName(null, 'Злато', 371, null)).toBe(
      'Карта за лоялност: Злато, 371 точки за размяна',
    );
    expect(page.passName(null, null, 371, 'март 2025 г.')).toBe(
      'Карта за лоялност: 371 точки за размяна, клиент от март 2025 г.',
    );
    expect(page.expiring(40, '31.12')).toBe('40 т. изтичат на 31.12');
    expect(page.owes(40)).toBe('дължи 40 точки');
    expect(page.owes(1)).toBe('дължи 1 точка');
    expect(page.passFrozen).toBe('Замразено');
    expect(
      en.loyaltyPage.passName('Georgi Petrov', 'Gold', 371, 'March 2025'),
    ).toBe(
      'Loyalty card: Georgi Petrov, Gold, 371 points to spend, a client since March 2025',
    );
    expect(en.loyaltyPage.passName(null, null, 371, null)).toBe(
      'Loyalty card: 371 points to spend',
    );
  });

  it('words the wallet: the four discs, the holdings, the status, the two headings', () => {
    const page = bg.loyaltyPage;
    expect(page.actions).toMatchObject({
      label: 'Действия',
      use: 'Използвай',
      code: 'Код',
      catalog: 'Награди',
      history: 'История',
      useName: 'Използвай награда на това посещение',
      codeName: 'Код: въведи или сканирай',
      catalogName: 'Награди за точки',
      historyName: 'История на движението',
    });
    // The disc says the ticket's own word.
    expect(page.actions.use).toBe(bg.reward.use);
    expect(page.actions.useCount(2)).toBe('2 награди');
    expect(page.wallet).toBe('В портфейла');
    expect(page.walletName(3)).toBe('В портфейла, 3');
    expect(page.walletSum(3, '55,00 €')).toBe('3 · 55,00 €');
    expect(page.walletEmpty).toBe('Портфейлът е празен.');
    expect(page.voucher).toBe('Ваучер за подарък');
    expect(page.voucherDetail('50,00 €', '31.12')).toBe(
      'от 50,00 € · до 31.12',
    );
    expect(page.voucherDetail('50,00 €', null)).toBe('от 50,00 €');
    expect(page.voucherFullName('25,00 €', '50,00 €', '31 декември')).toBe(
      'Ваучер за подарък: 25,00 € от 50,00 €, важи до 31 декември',
    );
    expect(page.voucherFullName('25,00 €', '50,00 €', null)).toBe(
      'Ваучер за подарък: 25,00 € от 50,00 €',
    );
    expect(page.ticketName('безплатно подстригване', '28 октомври')).toBe(
      'Награда: безплатно подстригване, важи до 28 октомври',
    );
    expect(page.ticketName('безплатно подстригване', null)).toBe(
      'Награда: безплатно подстригване',
    );
    expect(page.stampCard).toBe('Карта с печати');
    expect(page.stampsFor(10, 'безплатно подстригване')).toBe(
      '10 печата за безплатно подстригване',
    );
    expect(page.stampsName(3, 10, 7, 'безплатно подстригване')).toBe(
      '3 от 10 печата, още 7 до безплатно подстригване',
    );
    expect(page.tierTo('Платина')).toBe('до Платина');
    expect(page.tierHighest).toBe('Най-високият статус');
    expect(page.inRhythm(9)).toBe('посещения в ритъм');
    expect(page.inRhythm(1)).toBe('посещение в ритъм');
    expect(page.catalogTitle).toBe('Награди за точки');
    expect(page.catalogListName(bg.loyalty.points(371), 2, 3)).toBe(
      'Награди за точки: 371 точки, стигат за 2 от 3 награди',
    );
    expect(page.ledgerTitle).toBe('Движение');
    expect(page.ledgerTitle).toBe(bg.ledgerPage.title);
    expect(page.ledgerAllName).toBe('Движение: всички записи');
    expect(en.loyaltyPage.catalogTitle).toBe('Rewards for points');
    expect(en.loyaltyPage.ledgerTitle).toBe('Activity');
    expect(en.loyaltyPage.voucherDetail('€50.00', '31/12')).toBe(
      'of €50.00 · until 31/12',
    );
  });

  it('keeps the built words a built presenter still composes, until Z1 deletes it (§7.1)', () => {
    expect(bg.loyaltyPage.tierTop(20)).toBe(
      'Най-високият статус · запазва се с 20 посещения за 12 месеца',
    );
    expect(bg.achievement.notStarted).toBe('Още не е започнато');
    expect(bg.achievement.levelName('II', '10 посещения', '', '')).toBe(
      'Ниво II: 10 посещения',
    );
    expect(bg.history.endAll).toBe('Това е всичко.');
  });

  it('words the rhythm’s phase, what holds it and why a period is protected', () => {
    const rhythm = bg.rhythm;
    expect(rhythm.phaseAtRisk('9.11')).toBe('До 9.11');
    expect(rhythm.phaseInGrace('16.11')).toBe('Гратис до 16.11');
    expect(rhythm.phaseFrozen).toBe('Защитен');
    expect(rhythm.phaseHeld('29.10')).toBe('Записан за 29.10');
    expect(rhythm.phaseBroken).toBe('Прекъснат');
    expect(rhythm.stateHeld('29.10')).toBe(
      'Записан е за 29.10 · срокът се пази.',
    );
    expect(rhythm.stateFrozenExcuse).toBe('Пропускът е за сметка на салона.');
    expect(
      (
        [
          'staffCancelled',
          'barberAbsence',
          'shopClosure',
          'closedDays',
          'clientPause',
        ] as const
      ).map((reason) => rhythm.reason(reason)),
    ).toEqual([
      'салонът отмени часа',
      'бръснарят отсъстваше',
      'салонът беше затворен',
      'почивни дни',
      'пауза по желание на клиента',
    ]);
    // One set: the built freeze reason is one of its members; the pause's own went with its reader.
    expect(rhythm.reason('freeze')).toBe(rhythm.reasonFreeze);
    expect(rhythm.reason('pause')).toBe('записването беше спряно');
    expect(
      rhythm.markProtected('септември', rhythm.reason('shopClosure')),
    ).toBe('септември · защита: салонът беше затворен');
    expect(rhythm.ruleMore).toBe('Цялото правило');
    expect(rhythm.ruleUpcoming('1.10', 'на всеки 5 седмици')).toBe(
      'От 1.10: на всеки 5 седмици',
    );
    expect(en.rhythm.phaseInGrace('16/11')).toBe('Grace until 16/11');
    expect(en.rhythm.reason('barberAbsence')).toBe('the barber was away');
  });

  it('signs a movement with the typographic minus and words the ledger', () => {
    const page = bg.ledgerPage;
    expect(page.title).toBe('Движение');
    expect(page.signed(27)).toBe('+27 т.');
    expect(page.signed(-250)).toBe('−250 т.');
    expect(page.signed(0)).toBe('0 т.');
    expect(page.signed(-12450)).toBe(`−${formatCount(12450, 'bg')} т.`);
    expect(page.points(371)).toBe('371 т.');
    expect(page.points(-40)).toBe('−40 т.');
    expect(page.subline('Георги Петров', page.points(371))).toBe(
      'Георги Петров · 371 т.',
    );
    expect(page.filterLabel).toBe('Вид');
    expect(
      (['all', 'points', 'rewards', 'status'] as const).map((kind) =>
        page.filter(kind),
      ),
    ).toEqual(['Всички', 'Точки', 'Награди', 'Статус']);
    // Reuse first: two of the chips say words the card already has.
    expect(page.filter('all')).toBe(bg.loyalty.all);
    expect(page.filter('status')).toBe(bg.loyaltyPage.tier);
    expect(page.empty).toBe('Още няма движение.');
    expect(page.emptyFiltered).toBe('Няма записи от този вид.');
    expect(bg.ledger.tier('Злато')).toBe('Статус: Злато');
    expect(bg.ledger.tierFrom('Сребро')).toBe('от Сребро');
    expect(bg.ledger.rewardGranted).toBe('получена награда');
    expect(bg.ledger.rewardRevoked).toBe('отнета награда');
    expect(bg.ledger.redeemed).toBe('размяна');
    expect(bg.ledger.achievement).toBe('постижение');
    expect(bg.ledger.verb('received')).toBe('Получена награда');
    expect(bg.ledger.verb('status')).toBe('Нов статус');
    expect(bg.failed.vouchers).toBe('Ваучерите не се заредиха.');
    expect(bg.failed.activity).toBe('Движението не се зареди.');
    expect(en.ledgerPage.signed(-250)).toBe('−250 pts');
    expect(en.ledgerPage.filter('rewards')).toBe('Rewards');
  });

  it('words the records: sentence-case labels, the page’s rows, a year as a meter', () => {
    const records = bg.records;
    expect(
      (['rhythm', 'visits', 'favourites'] as const).map((theme) =>
        records.group(theme),
      ),
    ).toEqual(['Ритъм', 'Посещения', 'Любими']);
    expect(records.byYear).toBe('По години');
    expect(
      (
        [
          'currentRhythm',
          'totalVisits',
          'last12Months',
          'preferredBarber',
          'usualServices',
        ] as const
      ).map((row) => records.row(row)),
    ).toEqual([
      'Ритъм сега',
      'Общо посещения',
      'Последните 12 месеца',
      'Бръснар по избор',
      'Обичайни услуги',
    ]);
    expect(RECORD_KINDS.map((kind) => records.label(kind))).toEqual([
      'Най-дълъг ритъм',
      'Най-много за година',
      'Любима услуга',
      'Първо посещение',
    ]);
    // A label is the glance's running-case record, in sentence case: one name, two cases.
    for (const lang of [bg, en]) {
      for (const kind of RECORD_KINDS) {
        expect(lang.records.label(kind).toLocaleLowerCase(lang.lang)).toBe(
          lang.achievements.record(kind),
        );
      }
    }
    expect(records.times(23)).toBe('23 пъти');
    expect(records.times(1)).toBe('1 път');
    expect(records.yearValue('2025')).toBe('2025 г.');
    expect(records.since('юни 2026 г.')).toBe('от юни 2026 г.');
    expect(records.yearName('2025', 13, true)).toBe(
      '2025: 13 посещения, рекорд',
    );
    expect(records.yearName('2026', 11, false)).toBe('2026: 11 посещения');
    expect(records.sentence('longestRhythm')).toBe('поредни посещения в ритъм');
    expect(records.sentence('mostVisitsInYear')).toBe(
      'посещения за една година',
    );
    expect(records.sentence('firstVisit')).toBe('първо посещение');
    expect(records.sentenceFavourite('фейд')).toBe('посещения с фейд');
    expect(records.empty).toBe('Рекордите идват с първите посещения.');
    expect(en.records.yearValue('2025')).toBe('2025');
    expect(en.records.times(1)).toBe('1 time');
    expect(en.records.yearName('2025', 13, true)).toBe(
      '2025: 13 visits, the record',
    );
  });

  it('words «Постижения»: a record as one button, the chips, the collection, the fold', () => {
    const page = bg.achievements;
    expect(page.recordsAllName).toBe('Всички рекорди');
    expect(
      page.recordName(
        bg.records.label('longestRhythm'),
        bg.visitsModule.sectionVisits(23),
        'септември 2026 г.',
        true,
      ),
    ).toBe('Най-дълъг ритъм: 23 посещения, септември 2026 г., нов рекорд');
    expect(
      page.recordName('Любима услуга', 'Фейд', bg.records.times(23), false),
    ).toBe('Любима услуга: Фейд, 23 пъти');
    expect(page.recordName('Общо посещения', '23', null, false)).toBe(
      'Общо посещения: 23',
    );
    expect(page.newRecord).toBe('Нов рекорд');
    expect(
      page.recordsLineName('любима услуга Фейд, най-много за година 13'),
    ).toBe('Рекорди: любима услуга Фейд, най-много за година 13');
    expect(page.chipsLabel).toBe('Категории');
    expect(page.chipSeasons).toBe('Сезони');
    expect(page.chipName('Етапи', 3, 5)).toBe('Етапи, 3 от 5 спечелени');
    expect(page.close).toBe('Почти спечелени');
    expect(page.collectionOf(42)).toBe('от 42 медала');
    expect(page.collectionName(18, 42, 38)).toBe(
      'Колекция: 18 от 42 медала, 38 спечелени нива',
    );
    expect(page.showAll(12)).toBe('Покажи всички 12');
    expect(page.categorySummary('Майсторство', 3, 5)).toBe(
      'Майсторство · 3 от 5 спечелени',
    );
    expect(en.achievements.collectionOf(42)).toBe('of 42 medals');
    expect(en.achievements.recordName('Longest rhythm', '23', null, true)).toBe(
      'Longest rhythm: 23, a new record',
    );
  });

  it('words the medal detail: the state line, the progress, how it is earned, the ladder, the verb', () => {
    const medal = bg.achievement;
    expect(
      medal.stateWithCategory(
        'Майсторство',
        medal.levelSince('II', '24.09.2025 г.'),
      ),
    ).toBe('Майсторство · Ниво II · от 24.09.2025 г.');
    expect(medal.stateWithCategory('Майсторство', medal.stateNotStarted)).toBe(
      'Майсторство · още не е започнато',
    );
    expect(medal.completeSince('3.06.2026 г.')).toBe(
      'Всички нива · последното на 3.06.2026 г.',
    );
    expect(medal.progressOf(25)).toBe('от 25');
    expect(medal.remaining(2, 'III')).toBe('Още 2 до ниво III');
    expect(medal.remaining(1, 'III')).toBe('Още 1 до ниво III');
    expect(medal.thisVisitCounts(24, 25)).toBe('С това посещение: 24 от 25');
    expect(en.achievement.thisVisitCounts(24, 25)).toBe(
      'With this visit: 24 of 25',
    );
    expect(medal.addToVisit('фейд')).toBe('Добави фейд');
    expect(medal.addToVisitName('Фейд')).toBe('Добави Фейд към посещението');
    // The receipt lowers the service as the verb does (X1-3); a Latin brand stays as written.
    expect(medal.added('Фейд')).toBe('Добавихме фейд към посещението.');
    expect(medal.added('SPA ден')).toBe('Добавихме SPA ден към посещението.');
    expect(en.achievement.added('Beard trim')).toBe(
      'Beard trim was added to the visit.',
    );
    expect(medal.howTitle).toBe('Как се печели');
    expect(medal.howService('фейд')).toBe(
      'Всяко посещение с фейд се брои, щом приключи.',
    );
    expect(medal.howBarber('Иван')).toBe(
      'Всяко посещение при Иван се брои, щом приключи.',
    );
    expect(medal.howShop('Център')).toBe(
      'Всяко посещение в Център се брои, щом приключи.',
    );
    expect(medal.how('visits')).toBe('Всяко завършено посещение се брои.');
    expect(medal.how('earlyBird')).toBe(
      'Брои се всяко посещение, започнало до 10:00.',
    );
    expect(medal.how('months')).toBe('Брои се всеки месец с посещение.');
    expect(medal.how('tenure')).toBe('Брои се времето от първото посещение.');
    expect(
      (
        [
          'anyBarberAnyShop',
          'anyServiceAnyShop',
          'anyBarberAnyService',
        ] as const
      ).map((open) => medal.who(open)),
    ).toEqual([
      'При всеки бръснар · във всеки салон',
      'Всяка услуга · във всеки салон',
      'При всеки бръснар · всяка услуга',
    ]);
    expect(medal.excluded).toBe('Отменени часове и неявявания не се броят.');
    expect(medal.moreCount(3)).toBe('+3');
    expect(medal.levelsTitle).toBe('Нива');
    expect(medal.levelRow('III', '25 посещения')).toBe(
      'Ниво III · 25 посещения',
    );
    expect(
      medal.levelRowName(
        'II',
        '10 посещения',
        medal.awardPoints(50),
        '24 септември 2025 г.',
      ),
    ).toBe(
      'Ниво II, 10 посещения, 50 точки, спечелено на 24 септември 2025 г.',
    );
    expect(medal.levelRowName('III', '25 посещения', null, null)).toBe(
      'Ниво III, 25 посещения',
    );
    expect(medal.awardBadge).toBe('Значка в профила');
    expect(medal.awardOneOff).toBe('Награда');
    expect(medal.visitsTitle).toBe('Броени посещения');
    expect(en.achievement.howTitle).toBe('How it is earned');
    expect(en.achievement.remaining(2, 'III')).toBe('2 more to level III');
    expect(en.achievement.how('weekend')).toBe(
      'Every visit on a Saturday or a Sunday counts.',
    );
  });

  it('words the visits page’s two quiet lines and its foot', () => {
    expect(
      bg.history.line(bg.visitsModule.sectionVisits(23), bg.head.cadence(4)),
    ).toBe('23 посещения · през 4 седмици');
    expect(bg.history.spendInline('492,50 €')).toBe('похарчени общо 492,50 €');
    expect(bg.history.first('1.03.2025 г.')).toBe(
      'Първо посещение: 1.03.2025 г.',
    );
    expect(
      en.history.line(en.visitsModule.sectionVisits(23), en.head.cadence(4)),
    ).toBe('23 visits · every 4 weeks');
  });
});

describe('the privacy group (audit-hardening Phase 3, WS-C)', () => {
  it('words «Лични данни» and its export in bg and en', () => {
    const bg = clientCardWordsOf(translatorOf('bg'), 'bg');
    const en = clientCardWordsOf(translatorOf('en'), 'en');
    expect(bg.privacy).toEqual({
      groupLabel: 'Лични данни',
      export: 'Изтегли данните',
      exportDone: 'Файлът е изтеглен.',
    });
    expect(en.privacy).toEqual({
      groupLabel: 'Personal data',
      export: 'Download the data',
      exportDone: 'The file is downloaded.',
    });
  });
});

describe('the erasure’s words (audit-hardening Phase 3, WS-D)', () => {
  it('words the rows, the lines and the ONE alert in bg and en, the figures grouped the locale’s way', () => {
    const bg = clientCardWordsOf(translatorOf('bg'), 'bg');
    const en = clientCardWordsOf(translatorOf('en'), 'en');
    const figures = {
      visits: 1200,
      notes: 2,
      photos: 3,
      accounts: 1,
      siblings: 0,
    };
    expect({
      ...bg.erasure,
      alertBody: bg.erasure.alertBody(figures),
    }).toEqual({
      erase: 'Изтрий личните данни',
      eraseSibling: 'Изтрий записа със същия телефон или имейл',
      erased: 'Изтрит клиент',
      eraseUnfinished: 'Изтриването още не е завършило. Опитай пак.',
      alertTitle: 'Да изтрием ли личните данни?',
      alertBody:
        'Посещения: 1200 · Бележки: 2 · Снимки: 3 · Профили за вход: 1 · ' +
        'Други записи със същия телефон или имейл: 0. Името, телефонът и ' +
        'имейлът изчезват, профилът за вход се изтрива. Посещенията и ' +
        'плащанията остават.',
      eraseConfirm: 'Изтрий',
      eraseKeep: 'Отказ',
    });
    expect({
      ...en.erasure,
      alertBody: en.erasure.alertBody(figures),
    }).toEqual({
      erase: 'Erase personal data',
      eraseSibling: 'Erase the record with the same phone or e-mail',
      erased: 'Erased client',
      eraseUnfinished: "The erasure isn't finished yet. Try again.",
      alertTitle: 'Erase personal data?',
      alertBody:
        'Visits: 1,200 · Notes: 2 · Photos: 3 · Sign-in accounts: 1 · ' +
        'Other records with this phone or e-mail: 0. The name, phone and ' +
        'e-mail are removed and the sign-in account is deleted. Visits and ' +
        'payments stay.',
      eraseConfirm: 'Erase',
      eraseKeep: 'Cancel',
    });
  });
});

describe('the gaps K1b fills (lead ruling G1-6)', () => {
  const bg = clientCardWordsOf(translatorOf('bg'), 'bg');
  const en = clientCardWordsOf(translatorOf('en'), 'en');

  /**
   * `METRICS` of the loyalty catalogue (`badge-vocabulary.ts`), id by id: a
   * feature names no domain lib, so the list is spelled here, and the two
   * assignments under it hold the words' union to the application's
   * `Metric`, member for member, when the spec is type-checked.
   */
  const METRICS = [
    'client.visits.completed',
    'client.bookings.selfService',
    'client.spend.major',
    'client.referrals.completed',
    'client.waitlist.booked',
    'client.points.lifetime',
    'shop.bookings.created',
    'client.services.distinct',
    'client.barbers.distinct',
    'client.locations.distinct',
    'client.months.distinct',
    'client.visits.earlyBird',
    'client.visits.weekend',
    'client.visits.onTime',
    'client.visits.party',
    'client.tenure.days',
  ] as const satisfies readonly Metric[];
  const wordOf: (metric: Metric) => AchievementHowWord = achievementMetricWord;
  const noOtherMetric = (metric: AchievementMetricWord): Metric => metric;

  it('says every metric of the catalogue with a word of its own, one answer for «Как се печели» and the progress card', () => {
    expect(METRICS).toHaveLength(16);
    expect(METRICS.map(noOtherMetric)).toEqual(METRICS);
    // Sixteen metrics, sixteen words: no two metrics are said alike.
    expect(METRICS.map(wordOf).sort()).toEqual([...HOW_WORDS].sort());
    expect(wordOf('client.visits.completed')).toBe('visits');
    expect(wordOf('client.locations.distinct')).toBe('shops');
    expect(wordOf('shop.bookings.created')).toBe('shopBookings');
    expect(wordOf('client.tenure.days')).toBe('tenure');
  });

  it.each<[AchievementHowWord, string, string]>([
    ['visits', 'завършено посещение', 'завършени посещения'],
    ['earlyBird', 'посещение до 10:00', 'посещения до 10:00'],
    [
      'weekend',
      'посещение в събота или неделя',
      'посещения в събота или неделя',
    ],
    ['onTime', 'посещение без закъснение', 'посещения без закъснение'],
    ['party', 'посещение с компания', 'посещения с компания'],
    ['selfService', 'час, запазен онлайн', 'часа, запазени онлайн'],
    ['waitlist', 'час от списъка на чакащите', 'часа от списъка на чакащите'],
    [
      'referrals',
      'приятел, дошъл по препоръка',
      'приятели, дошли по препоръка',
    ],
    ['services', 'различна услуга', 'различни услуги'],
    ['barbers', 'различен бръснар', 'различни бръснари'],
    ['shops', 'различен салон', 'различни салона'],
    ['months', 'месец с посещение', 'месеца с посещение'],
    ['spend', 'евро, платено в салона', 'евро, платени в салона'],
    [
      'points',
      'точка от посещения и постижения',
      'точки от посещения и постижения',
    ],
    ['tenure', 'ден от първото посещение', 'дни от първото посещение'],
    ['shopBookings', 'час, записан в салона', 'часа, записани в салона'],
  ])(
    'words what the progress figure counts, %s: under «0 от 1» and under «23 от 25»',
    (metric, one, other) => {
      expect(bg.achievement.what(metric, 1)).toBe(one);
      expect(bg.achievement.what(metric, 25)).toBe(other);
      // Nothing is 0 of 1 in the plural, and «0 от 3» is not a singular.
      expect(bg.achievement.what(metric, 0)).toBe(other);
    },
  );

  it.each(['bg', 'en'] as const)(
    'words every metric as a line UNDER a figure, in %s: no count of its own, the running case, no full stop',
    (lang) => {
      const words = lang === 'bg' ? bg : en;
      for (const metric of METRICS) {
        const word = wordOf(metric);
        const forms = [
          words.achievement.what(word, 1),
          words.achievement.what(word, 25),
        ];
        expect(new Set(forms).size).toBe(2);
        for (const form of forms) {
          expect(form).not.toMatch(/\{\{|\}\}|[.!?…]$|^\d/u);
          expect(form).toBe(form.trim());
          expect(form.charAt(0)).toBe(form.charAt(0).toLocaleLowerCase(lang));
        }
        // The same metric has its sentence in «Как се печели».
        expect(words.achievement.how(word)).toMatch(/[.]$/u);
      }
    },
  );

  it('words a visit count narrowed to a service, a barber or a shop, and the rhythm family', () => {
    const medal = bg.achievement;
    expect(medal.whatService('фейд', 25)).toBe('посещения с фейд');
    expect(medal.whatService('фейд', 1)).toBe('посещение с фейд');
    expect(medal.whatBarber('Иван', 10)).toBe('посещения при Иван');
    expect(medal.whatBarber('Иван', 1)).toBe('посещение при Иван');
    expect(medal.whatShop('Център', 10)).toBe('посещения в Център');
    expect(medal.whatShop('Център', 1)).toBe('посещение в Център');
    expect(medal.whatRhythm(26)).toBe('поредни посещения в ритъм');
    expect(medal.whatRhythm(1)).toBe('посещение в ритъм');
    // Reuse first: the medal says the records' own sentences.
    expect(medal.whatService('фейд', 25)).toBe(
      bg.records.sentenceFavourite('фейд', 25),
    );
    expect(medal.whatRhythm(26)).toBe(bg.records.sentence('longestRhythm', 26));
    expect(en.achievement.whatService('a fade', 1)).toBe('visit with a fade');
    expect(en.achievement.whatBarber('Ivan', 10)).toBe('visits with Ivan');
    expect(en.achievement.whatShop('Centre', 10)).toBe('visits at Centre');
    expect(en.achievement.whatRhythm(26)).toBe('visits in rhythm in a row');
  });

  it('agrees the records’ words with their figure, and keeps the plural for a caller that hands none', () => {
    const records = bg.records;
    expect(records.sentence('longestRhythm', 1)).toBe('посещение в ритъм');
    expect(records.sentence('longestRhythm', 23)).toBe(
      'поредни посещения в ритъм',
    );
    expect(records.sentence('mostVisitsInYear', 1)).toBe(
      'посещение за една година',
    );
    expect(records.sentence('mostVisitsInYear', 13)).toBe(
      'посещения за една година',
    );
    expect(records.sentenceFavourite('фейд', 1)).toBe('посещение с фейд');
    expect(records.sentence('longestRhythm')).toBe('поредни посещения в ритъм');
    expect(records.sentenceFavourite('фейд')).toBe('посещения с фейд');
    // The first visit's figure is a date: one form, whatever is handed.
    expect(records.sentence('firstVisit', 1)).toBe('първо посещение');
    expect(records.yearName('2026', 1, false)).toBe('2026: 1 посещение');
    expect(records.yearName('2026', 1, true)).toBe('2026: 1 посещение, рекорд');
    expect(en.records.sentence('mostVisitsInYear', 1)).toBe(
      'visit in one year',
    );
    expect(en.records.yearName('2026', 1, false)).toBe('2026: 1 visit');
  });

  it('agrees every counted sentence of revision 3 at 1', () => {
    const page = bg.loyaltyPage;
    expect(bg.birthday.name(1)).toBe('Рожден ден днес, навършва 1 година');
    expect(bg.birthday.giftName(1, '−20 %')).toBe(
      'Рожден ден днес, навършва 1 година. Подарък: −20 %, използвай',
    );
    expect(bg.birthday.name(21)).toBe('Рожден ден днес, навършва 21 години');
    expect(page.passName('Георги Петров', 'Злато', 1, null)).toBe(
      'Карта за лоялност: Георги Петров, Злато, 1 точка за размяна',
    );
    expect(page.passName(null, null, 1, 'март 2025 г.')).toBe(
      'Карта за лоялност: 1 точка за размяна, клиент от март 2025 г.',
    );
    expect(page.expiring(1, '31.12')).toBe('1 т. изтича на 31.12');
    expect(page.stampsFor(1, 'безплатно подстригване')).toBe(
      '1 печат за безплатно подстригване',
    );
    expect(page.stampsName(0, 1, 1, 'безплатно подстригване')).toBe(
      '0 от 1 печат, още 1 до безплатно подстригване',
    );
    // The form is the card's SIZE's, not what is filled: «1 от 10 печата».
    expect(page.stampsName(1, 10, 9, 'безплатно подстригване')).toBe(
      '1 от 10 печата, още 9 до безплатно подстригване',
    );
    expect(page.actions.useCount(1)).toBe('1 награда');
    expect(page.catalogListName(bg.loyalty.points(1), 0, 1)).toBe(
      'Награди за точки: 1 точка, стигат за 0 от 1 награда',
    );
    expect(page.catalogListName(bg.loyalty.points(1200), 1, 3)).toBe(
      `Награди за точки: ${formatCount(1200, 'bg')} точки, стигат за 1 от 3 награди`,
    );
    expect(bg.achievements.collectionOf(1)).toBe('от 1 медал');
    expect(bg.achievements.collectionName(1, 1, 1)).toBe(
      'Колекция: 1 от 1 медал, 1 спечелено ниво',
    );
    // Two counts, two nouns: each in its own form.
    expect(bg.achievements.collectionName(1, 42, 1)).toBe(
      'Колекция: 1 от 42 медала, 1 спечелено ниво',
    );
    expect(bg.achievements.collectionName(0, 1, 0)).toBe(
      'Колекция: 0 от 1 медал, 0 спечелени нива',
    );
    expect(bg.achievement.awardPoints(1)).toBe('1 точка');
    expect(bg.achievement.awardPoints(50)).toBe('50 точки');

    expect(en.birthday.name(1)).toBe('Birthday today, turning 1');
    expect(en.loyaltyPage.passName('Georgi Petrov', null, 1, null)).toBe(
      'Loyalty card: Georgi Petrov, 1 point to spend',
    );
    expect(en.loyaltyPage.expiring(1, '31/12')).toBe('1 pt expires on 31/12');
    expect(en.loyaltyPage.expiring(40, '31/12')).toBe('40 pts expire on 31/12');
    expect(en.loyaltyPage.stampsFor(1, 'a free cut')).toBe(
      '1 stamp for a free cut',
    );
    expect(en.loyaltyPage.actions.useCount(1)).toBe('1 reward');
    expect(en.loyaltyPage.catalogListName(en.loyalty.points(1), 0, 1)).toBe(
      'Rewards for points: 1 point, enough for 0 of 1 reward',
    );
    expect(en.achievements.collectionName(1, 1, 1)).toBe(
      'Collection: 1 of 1 medal, 1 level earned',
    );
    expect(en.achievements.collectionName(18, 42, 38)).toBe(
      'Collection: 18 of 42 medals, 38 levels earned',
    );
    expect(en.achievement.awardPoints(1)).toBe('1 point');
  });

  it('abbreviates one point as one: «1 т.», "1 pt"', () => {
    expect(bg.ledgerPage.signed(1)).toBe('+1 т.');
    expect(bg.ledgerPage.signed(-1)).toBe('−1 т.');
    expect(bg.ledgerPage.points(1)).toBe('1 т.');
    expect(en.ledgerPage.signed(1)).toBe('+1 pt');
    expect(en.ledgerPage.signed(-1)).toBe('−1 pt');
    expect(en.ledgerPage.signed(27)).toBe('+27 pts');
    expect(en.ledgerPage.signed(0)).toBe('0 pts');
    expect(en.ledgerPage.points(1)).toBe('1 pt');
    expect(en.ledgerPage.points(371)).toBe('371 pts');
  });

  it('agrees the built sentences revision 3 reuses at 1, and says every other count as it did', () => {
    const page = bg.loyaltyPage;
    expect(bg.achievements.summaryName(1)).toBe('1 спечелено ниво');
    expect(bg.achievements.summaryName(38)).toBe('38 спечелени нива');
    expect(bg.achievements.allName(1)).toBe('Всички постижения, 1 ниво');
    expect(bg.achievements.allName(37)).toBe('Всички постижения, 37 нива');
    expect(bg.achievements.dayGroupName('12.08', 1)).toBe(
      'Спечелено на 12.08: 1 ниво',
    );
    expect(bg.achievements.dayGroupName('12.08', 3)).toBe(
      'Спечелени на 12.08: 3 нива',
    );
    expect(page.tierQualifying(1)).toBe('1 посещение за 12 месеца');
    expect(page.tierQualifying(12)).toBe('12 посещения за 12 месеца');
    expect(page.tierTop(1)).toBe(
      'Най-високият статус · запазва се с 1 посещение за 12 месеца',
    );
    expect(page.tierName('Сребро', 1, 5, 'Злато')).toBe(
      'Сребро, 1 посещение за 12 месеца, още 5 до Злато',
    );
    expect(page.tierName('Сребро', 7, 1, 'Злато')).toBe(
      'Сребро, 7 посещения за 12 месеца, още 1 до Злато',
    );
    expect(bg.rhythm.stateAtRisk(1, '9.11')).toBe(
      'Последно преди 1 седмица · посещение до 9.11 пази ритъма.',
    );
    expect(bg.rhythm.stateAtRisk(6, '9.11')).toBe(
      'Последно преди 6 седмици · посещение до 9.11 пази ритъма.',
    );
    expect(bg.achievement.repeated(1, '12.08')).toBe(
      'Спечелено веднъж · на 12.08',
    );
    expect(bg.achievement.repeated(3, '12.08')).toBe(
      'Спечелено 3 пъти · последно на 12.08',
    );
    expect(bg.achievement.gavePoints(1)).toBe(', донесе 1 точка');
    expect(bg.achievement.gavePoints(50)).toBe(', донесе 50 точки');

    expect(en.achievements.summaryName(1)).toBe('1 level earned');
    expect(en.achievements.allName(1)).toBe('All achievements, 1 level');
    expect(en.loyaltyPage.tierQualifying(1)).toBe('1 visit in 12 months');
    expect(en.rhythm.stateAtRisk(1, '9/11')).toBe(
      'Last visit 1 week ago · a visit by 9/11 keeps the rhythm.',
    );
    expect(en.achievement.repeated(1, '12/08')).toBe('Earned once · on 12/08');
    expect(en.achievement.gavePoints(1)).toBe(', gave 1 point');
  });

  describe('the admin page’s words (its own feature reads them by key)', () => {
    const LANGS = ['bg', 'en'] as const;
    const said = (lang: 'bg' | 'en') => {
      const t = translatorOf(lang);
      const half = (side: 'back' | 'out', count: number) =>
        count === 0
          ? t(
              side === 'back'
                ? 'admin.rhythm.preview.nobodyBack'
                : 'admin.rhythm.preview.nobodyOut',
            )
          : t(`admin.rhythm.preview.${side}.${pluralForm(count, lang)}`, {
              count,
            });
      return {
        t,
        counted: (key: string, count: number) =>
          t(`${key}.${pluralForm(count, lang)}`, { count }),
        summary: (back: number, out: number) =>
          t('admin.rhythm.preview.summary', {
            back: half('back', back),
            out: half('out', out),
          }),
      };
    };

    it('makes the preview’s line of two halves, each with its nobody and its form at 1', () => {
      const { summary } = said('bg');
      expect(summary(17, 0)).toBe(
        '17 се връщат в ритъм · никой не излиза от ритъм',
      );
      expect(summary(0, 3)).toBe('никой не се връща · 3 излизат от ритъм');
      expect(summary(1, 1)).toBe('1 се връща в ритъм · 1 излиза от ритъм');
      expect(summary(0, 0)).toBe(
        'никой не се връща · никой не излиза от ритъм',
      );
      const english = said('en').summary;
      expect(english(17, 0)).toBe(
        '17 return to the rhythm · nobody leaves the rhythm',
      );
      expect(english(1, 1)).toBe(
        '1 returns to the rhythm · 1 leaves the rhythm',
      );
      expect(english(0, 3)).toBe('nobody returns · 3 leave the rhythm');
    });

    it('counts the clients and the visits a protection takes in agreement', () => {
      const { counted } = said('bg');
      expect(counted('admin.rhythm.preview.clients', 214)).toBe(
        '214 клиенти с посещение за 12 месеца',
      );
      expect(counted('admin.rhythm.preview.clients', 1)).toBe(
        '1 клиент с посещение за 12 месеца',
      );
      expect(counted('admin.rhythm.protections.everyValue', 5)).toBe(
        'на всеки 5 посещения',
      );
      expect(counted('admin.rhythm.protections.everyValue', 1)).toBe(
        'на всяко посещение',
      );
      expect(said('en').counted('admin.rhythm.preview.clients', 1)).toBe(
        '1 client with a visit in 12 months',
      );
    });

    it('words a history row’s change, the rest of a change, and the day the sheet answered', () => {
      const { t } = said('bg');
      const row = (date: string, change: string) =>
        t('admin.rhythm.history.row', { date, change });
      const interval = t('admin.rhythm.history.change.interval.fixed', {
        interval: '6 седмици',
      });
      expect(row('1.09', interval)).toBe('От 1.09 · интервал 6 седмици');
      expect(
        row(
          '1.09',
          t('admin.rhythm.history.more', { change: interval, count: 2 }),
        ),
      ).toBe('От 1.09 · интервал 6 седмици и още 2');
      expect(row('1.03.2025', t('admin.rhythm.history.first'))).toBe(
        'От 1.03.2025 · първо правило',
      );
      expect(
        row(
          '1.10',
          t('admin.rhythm.history.change.graceDays.days', { days: '7 дни' }),
        ),
      ).toBe('От 1.10 · гратис 7 дни');
      expect(
        row(
          '1.10',
          t('admin.rhythm.history.change.protections.on', { count: 2 }),
        ),
      ).toBe('От 1.10 · защити до 2 в запас');
      expect(row('1.10', t('admin.rhythm.history.change.enabled.off'))).toBe(
        'От 1.10 · ритъмът е изключен',
      );
      // A window of no days is said as its figure: one word per parameter.
      expect(
        row(
          '1.10',
          t('admin.rhythm.history.change.minGapDays', { days: '0 дни' }),
        ),
      ).toBe('От 1.10 · близки посещения 0 дни');
      expect(row('1.10', t('admin.rhythm.history.change.onBreak.hold'))).toBe(
        'От 1.10 · пропускът пази броя',
      );
      expect(t('admin.rhythm.effective.picked', { date: '12.10' })).toBe(
        'от 12.10',
      );
      // Lower case: the row's VALUE; the capsule's «От 1.10» opens a line.
      expect(t('admin.rhythm.scheduled', { date: '1.10' })).toBe('От 1.10');
      const english = said('en').t;
      expect(
        english('admin.rhythm.history.row', {
          date: '01/09',
          change: english('admin.rhythm.history.change.interval.fixed', {
            interval: '6 weeks',
          }),
        }),
      ).toBe('From 01/09 · interval 6 weeks');
      expect(english('admin.rhythm.effective.picked', { date: '12/10' })).toBe(
        'from 12/10',
      );
    });

    it.each(LANGS)(
      'has a change word for every parameter a version lists as changed, in the running case (%s)',
      (lang) => {
        // `StreakRuleChange.changed`, in the rule's own order (`STREAK_RULE_PARAMETERS`).
        const parameters = [
          'name',
          'enabled',
          'qualifier',
          'minGapDays',
          'bookingHold',
          'interval',
          'graceDays',
          'riskLeadDays',
          'protections',
          'excuses',
          'clientPause',
          'repair',
          'onBreak',
        ];
        const changes = [...sentencesOf(catalogueOf(lang))].filter(([key]) =>
          key.startsWith('admin.rhythm.history.change.'),
        );
        expect(
          [...new Set(changes.map(([key]) => key.split('.')[4]))].sort(),
        ).toEqual([...parameters].sort());
        for (const [, sentence] of changes) {
          expect(sentence).not.toMatch(/[.!?…]$/u);
          expect(sentence.charAt(0)).toBe(
            sentence.charAt(0).toLocaleLowerCase(lang),
          );
        }
      },
    );
  });

  it.each<['bg' | 'en', RegExp, readonly string[]]>([
    [
      'bg',
      /\{\{\s*\w+\s*\}\}\s(?:спечелени\s)?(?:посещения|точки|нива|седмици|пъти|дни|награди|медала|печата|клиенти|години|услуги|защити|часа|месеца)(?![\p{L}])/u,
      ['rhythmRule.protections', 'admin.rhythm.preview.capped'],
    ],
    [
      'en',
      /\{\{\s*\w+\s*\}\}\s(?:visits|points|levels|weeks|times|days|rewards|medals|stamps|clients|services|protections|months|pts)\b/u,
      [
        'clientCard.achievement.awardShort',
        'rhythmRule.protections',
        'admin.rhythm.preview.capped',
      ],
    ],
  ])(
    'leaves no count beside a plural noun in ONE form, in %s',
    (lang, counted, known) => {
      /*
       * What stays, and why: the built «+50 pts» takes its points as a
       * worded string (the built catalogue's name went in W4 with its page;
       * the wallet reads `catalogListName`);
       * `rhythmRule.protections` is read by `rhythmRuleWords` (the shared
       * visits lib), whose own spec pins every key of that root, so its
       * singular lands with that function (contract delta V3-4); the
       * preview's cap is 1 000, never 1.
       */
      const oneForm = [...sentencesOf(catalogueOf(lang))]
        .filter(([key]) =>
          /^(clientCard|visits|rhythmRule|admin\.rhythm)\./u.test(key),
        )
        .filter(([key]) => !/\.(one|other)$/u.test(key))
        .filter(([, sentence]) => counted.test(sentence))
        .map(([key]) => key);
      expect(oneForm).toEqual(known);
    },
  );
});

describe('the card’s dates and figures (R59)', () => {
  // The short and heard forms («12.08», «4 септември») are
  // `@creativo/ui/wall-clock`'s (`formatDayShort`, `formatDayLong`), proved
  // in `wall-clock.spec.ts`; the card's own forms stay here.
  it('prints a date that always names its year', () => {
    expect(dayWithYear(localDate('2026-03-06'), 'bg')).toBe('6.03.2026 г.');
  });

  it('spells a month someone has been a client since', () => {
    expect(monthYearLong(localDate('2025-03-06'), 'bg')).toBe('март 2025 г.');
  });

  it('prints a window as the locale’s own range', () => {
    expect(
      dayRange(
        localDate('2026-09-01'),
        localDate('2026-11-30'),
        localDate('2026-09-28'),
        'bg',
      ),
    ).toBe('1.09 – 30.11');
  });

  it('groups figures the locale’s way', () => {
    expect(formatCount(12450, 'bg')).toBe('12 450');
  });

  it('draws a monogram from the first letter', () => {
    expect(monogramOf('Фейд', 'bg')).toBe('Ф');
    expect(monogramOf('„Баща и син“', 'bg')).toBe('Б');
    expect(monogramOf('— 1 —', 'bg')).toBeNull();
  });
});
