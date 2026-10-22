import type { JournalFeed, PersonalRecordKind } from '@core/components';
import type {
  VisitCardVm,
  VisitLinePart,
  VisitRowVm,
  VisitSectionVm,
} from '@creativo/features/shared/visits';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ACHIEVEMENT_CHIPS,
  ACTIVITY_GROUPS,
  ACTIVITY_ROW,
  BIRTHDAY,
  HERO,
  LEDGER_PAGE,
  LOYALTY_GLANCE,
  MEDALS,
  MEDALS_GLANCE,
  MEDALS_PAGE,
  MEDAL_DETAIL,
  MEDAL_SECTIONS,
  OVERVIEW,
  PASS,
  RECORDS_PAGE,
  RECORD_CARDS,
  RECORD_ROWS,
  REWARD_TILES,
  VISITS_PAGE,
  VISIT_CARDS,
  WALLET,
  WALLET_ACTIONS,
  WALLET_HOLDINGS,
  WALLET_RHYTHM,
  WALLET_TIER,
} from '../testing/client-pages.vm-fixtures';
import type {
  ActivityGroupVm,
  ClientHeroVm,
  ClientOverviewVm,
  DetailActionVm,
  DetailHowVm,
  FeaturedRecordVm,
  LedgerPageVm,
  LinePart,
  MedalDetailVm,
  MedalsPageVm,
  RecordCardVm,
  RecordRowVm,
  RecordsPageVm,
  Slice,
  VisitCardsVm,
  VisitsPageVm,
  WalletActionId,
  WalletActionVm,
  WalletHoldingVm,
  WalletVm,
} from './client-pages.vm';
import type { RECORD_KIND_WORDS, RecordKindWord } from './client-card.words';

/*
 * THE PAGES' VIEW MODELS (client-card-revision-3 §4.9). The file is types
 * only: the type cases are checked by the compiler and pin the shapes the
 * presenters, the store and the bodies build against. The value cases
 * read the hand-built fixtures the presentational specs draw from
 * (`src/testing/client-pages.vm-fixtures.ts`) against the rules the
 * contract states in words — a limit, an order, a fact said once — so a
 * fixture can never teach a spec a model the pages do not produce.
 */

const joined = (line: readonly LinePart[]) =>
  line.map((part) => part.text).join('');
const facts = (line: readonly LinePart[]) =>
  line.filter((part) => part.fact).map((part) => part.text);

/** Every string of a fixture, by the path that holds it. */
function strings(
  value: unknown,
  path: string,
  out: [path: string, text: string][] = [],
): [path: string, text: string][] {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) {
    value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      strings(item, `${path}.${key}`, out);
    }
  }
  return out;
}

const EVERY_FIXTURE = {
  ACHIEVEMENT_CHIPS,
  ACTIVITY_GROUPS,
  ACTIVITY_ROW,
  BIRTHDAY,
  HERO,
  LEDGER_PAGE,
  LOYALTY_GLANCE,
  MEDALS,
  MEDALS_GLANCE,
  MEDALS_PAGE,
  MEDAL_DETAIL,
  MEDAL_SECTIONS,
  OVERVIEW,
  PASS,
  RECORDS_PAGE,
  RECORD_CARDS,
  RECORD_ROWS,
  REWARD_TILES,
  VISITS_PAGE,
  VISIT_CARDS,
  WALLET,
  WALLET_ACTIONS,
  WALLET_HOLDINGS,
  WALLET_RHYTHM,
  WALLET_TIER,
};

describe('the pages’ view models: the shapes', () => {
  it('sets a quiet line as the shared visits’ runs', () => {
    expectTypeOf<LinePart>().toEqualTypeOf<VisitLinePart>();
    expectTypeOf<ClientHeroVm['line']>().toEqualTypeOf<
      readonly LinePart[] | null
    >();
    expectTypeOf<LedgerPageVm['subline']>().toEqualTypeOf<
      readonly LinePart[]
    >();
    expectTypeOf<MedalDetailVm['stateLine']>().toEqualTypeOf<
      readonly LinePart[]
    >();
    expectTypeOf<VisitsPageVm['line']>().toEqualTypeOf<readonly LinePart[]>();
  });

  it('draws the glance’s visits as the shared card, three of one shape', () => {
    expectTypeOf<VisitCardsVm['last']>().toEqualTypeOf<VisitCardVm | null>();
    expectTypeOf<VisitCardsVm['next']>().toEqualTypeOf<VisitCardVm | null>();
    expectTypeOf<
      VisitCardsVm['waitlist']
    >().toEqualTypeOf<VisitCardVm | null>();
  });

  it('makes every module of the overview a slice of its own, absent when it cannot exist', () => {
    expectTypeOf<ClientOverviewVm['visits']>().toEqualTypeOf<
      Slice<VisitCardsVm> | undefined
    >();
    // The discs, the exit and the failed regions are always stated.
    expectTypeOf<
      Pick<ClientOverviewVm, 'actions' | 'canRemove' | 'failed'>
    >().toExtend<ClientOverviewVm>();
  });

  it('names the wallet’s four discs and its three kinds of holding', () => {
    expectTypeOf<WalletActionId>().toEqualTypeOf<
      'use' | 'code' | 'catalog' | 'history'
    >();
    expectTypeOf<WalletActionVm['prominence']>().toEqualTypeOf<
      'standard' | 'accent'
    >();
    expectTypeOf<WalletHoldingVm['kind']>().toEqualTypeOf<
      'voucher' | 'ticket' | 'stamps'
    >();
    expectTypeOf<WalletVm['activity']>().toEqualTypeOf<
      Slice<readonly ActivityGroupVm[]> | undefined
    >();
  });

  it('filters the ledger by the journal’s own kinds', () => {
    expectTypeOf<LedgerPageVm['filter']>().toEqualTypeOf<JournalFeed>();
    expectTypeOf<NonNullable<LedgerPageVm['paging']>['kind']>().toEqualTypeOf<
      'more' | 'loading' | 'failed' | 'end'
    >();
  });

  it('keeps a record’s kind the domain’s and a row’s id the card’s own', () => {
    // The domain's kind (`PersonalRecordKind`) reaches the card as its word:
    // every kind has one, and the word is the test id's and the key's.
    expectTypeOf<RecordCardVm['kind']>().toEqualTypeOf<RecordKindWord>();
    expectTypeOf<
      keyof typeof RECORD_KIND_WORDS
    >().toEqualTypeOf<PersonalRecordKind>();
    expectTypeOf<RecordRowVm['id']>().toEqualTypeOf<string>();
    expectTypeOf<RecordRowVm['theme']>().toEqualTypeOf<
      'rhythm' | 'visits' | 'favourites'
    >();
    expectTypeOf<RecordsPageVm['featured']>().toEqualTypeOf<
      (RecordCardVm & { readonly sentence: string }) | null
    >();
    expectTypeOf<FeaturedRecordVm>().toExtend<RecordCardVm>();
  });

  it('words a medal’s detail in six blocks, the verb apart from the body', () => {
    expectTypeOf<MedalDetailVm['visits']>().toEqualTypeOf<
      readonly VisitRowVm[]
    >();
    expectTypeOf<
      MedalDetailVm['action']
    >().toEqualTypeOf<DetailActionVm | null>();
    expectTypeOf<MedalDetailVm['how']>().toEqualTypeOf<DetailHowVm | null>();
    expectTypeOf<DetailHowVm['ratio']>().toEqualTypeOf<'16 / 9' | '4 / 3'>();
    expectTypeOf<DetailHowVm['columns']>().toEqualTypeOf<1 | 2>();
    expectTypeOf<keyof MedalDetailVm['progress']>().toEqualTypeOf<
      'value' | 'unit' | 'what' | 'remaining' | 'thisVisit'
    >();
  });

  it('hands the visits page’s sections to the shared browser as they are', () => {
    expectTypeOf<VisitsPageVm['sections']>().toEqualTypeOf<
      readonly VisitSectionVm[]
    >();
    expectTypeOf<
      VisitsPageVm['paging']
    >().toEqualTypeOf<built.HistoryPagingVm | null>();
  });
});

describe('the hand-built fixtures: final copy', () => {
  const all = strings(EVERY_FIXTURE, 'fixtures');

  it('holds no unfilled slot, no stray value and no double space', () => {
    const broken = all.filter(
      ([, text]) =>
        /\{\{|\}\}|undefined|\bnull\b|NaN|\[object/.test(text) ||
        / {2}/.test(text),
    );
    expect(broken).toEqual([]);
  });

  it('names everything it names in one non-empty sentence', () => {
    const names = all.filter(([path]) =>
      /\.(accessibleName|lineName)$/.test(path),
    );
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter(([, text]) => text.trim().length < 3)).toEqual([]);
    // A name is heard, so it carries no glyph of the drawn line.
    expect(names.filter(([, text]) => /[›‹⌄]/.test(text))).toEqual([]);
  });

  it('writes a minus as a minus and money in the house form', () => {
    const signed = all.filter(([, text]) => /(^|\s)-\d/.test(text));
    expect(signed).toEqual([]);
    const money = all.filter(([, text]) => /€/.test(text));
    expect(money.length).toBeGreaterThan(10);
    // «28,00 €»: a comma, two decimals, a space before the sign.
    expect(money.filter(([, text]) => !/\d,\d{2} €/.test(text))).toEqual([]);
  });
});

describe('the hand-built fixtures: the glance', () => {
  it('joins the hero’s line from its runs, the facts in primary ink, their words held and the joint hung on no-break spaces', () => {
    expect(joined(HERO.georgi.line)).toBe(
      'Клиент от март\u00a02025\u00a0г.\u00a0· идва през 4\u00a0седмици',
    );
    expect(facts(HERO.georgi.line)).toEqual([
      'март\u00a02025\u00a0г.',
      '4\u00a0седмици',
    ]);
    expect(joined(HERO.paused.line)).toBe(
      'Онлайн записването е спряно до 12.10',
    );
    expect(facts(HERO.guest.line)).toEqual([]);
    expect(HERO.loading.line).toBeNull();
  });

  it('gives a guest no tier and the top tier a full ring', () => {
    expect(HERO.guest.tier).toBeNull();
    expect(HERO.topTier.tier.progress).toBe(1);
    for (const hero of Object.values(HERO)) {
      const progress = hero.tier?.progress ?? 0;
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  it('carries a birthday gift today only, and never on the notice', () => {
    expect(BIRTHDAY.gift.gift.applied).toBe(false);
    expect(BIRTHDAY.giftApplied.gift.applied).toBe(true);
    expect(BIRTHDAY.bandOnly.gift).toBeNull();
    expect(BIRTHDAY.upcoming.kind).toBe('upcoming');
    expect(BIRTHDAY.upcoming.gift).toBeNull();
  });

  it('draws the three visit cards in ONE order, each under its own test id', () => {
    const { last, next, waitlist } = VISIT_CARDS.full;
    expect([last.kind, next.kind, waitlist.kind]).toEqual([
      'last',
      'next',
      'waitlist',
    ]);
    expect([last.testId, next.testId, waitlist.testId]).toEqual([
      'client-visit-last',
      'client-visit-next',
      'client-visit-waitlist',
    ]);
    expect(last.photos.length).toBeLessThanOrEqual(3);
    expect(VISIT_CARDS.none.count).toBe(0);
  });

  it('holds at most three medals, named and uncaptioned, and two records that are never the rhythm’s', () => {
    for (const glance of Object.values(MEDALS_GLANCE)) {
      expect(glance.tiles.length).toBeLessThanOrEqual(3);
      expect(glance.records.length).toBeLessThanOrEqual(2);
      for (const tile of glance.tiles) {
        expect(tile.medal.title).not.toBeNull();
        expect(tile.medal.caption).toBeNull();
      }
      expect(glance.records.map((record) => record.kind)).not.toContain(
        'longestRhythm',
      );
      expect(glance.recordsName === null).toBe(glance.records.length === 0);
    }
  });

  it('leads the loyalty card with a holding where the points are off', () => {
    expect(LOYALTY_GLANCE.pointsOff.unit).toBeNull();
    expect(LOYALTY_GLANCE.pointsOff.figure).toBe(
      LOYALTY_GLANCE.pointsOff.holdings[0]?.value,
    );
    expect(LOYALTY_GLANCE.georgi.holdings.map((holding) => holding.id)).toEqual(
      ['voucher', 'stamps', 'rhythm'],
    );
  });

  it('states a failed module’s region beside its failed slice', () => {
    expect(OVERVIEW.oneFailed.loyalty.status).toBe('failed');
    expect(OVERVIEW.oneFailed.failed).toEqual(['loyalty']);
    expect(OVERVIEW.twoFailed.failed.length).toBeGreaterThanOrEqual(2);
    expect(OVERVIEW.georgi.failed).toEqual([]);
    // A guest: the discs and the exit, no module.
    expect(Object.keys(OVERVIEW.guest).sort()).toEqual([
      'actions',
      'canRemove',
      'failed',
    ]);
  });
});

describe('the hand-built fixtures: the wallet and the ledger', () => {
  it('promotes ONE disc at most, and «Използвай» names a grant or counts them', () => {
    for (const actions of Object.values(WALLET_ACTIONS)) {
      expect(
        actions.filter((action) => action.prominence === 'accent').length,
      ).toBeLessThanOrEqual(1);
      expect(new Set(actions.map((action) => action.id)).size).toBe(
        actions.length,
      );
      for (const action of actions) {
        if (action.id === 'use') {
          expect(action.grantId === null).not.toBe(action.count === null);
        } else {
          expect(action.grantId).toBeNull();
          expect(action.count).toBeNull();
        }
      }
    }
  });

  it('files the holdings as the wallet does: vouchers, tickets, stamp cards', () => {
    const order = { voucher: 0, ticket: 1, stamps: 2 };
    for (const holdings of Object.values(WALLET_HOLDINGS)) {
      const ranks = holdings.map((holding) => order[holding.kind]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('shows the phase capsule only while the rhythm is not healthy', () => {
    expect(WALLET_RHYTHM.healthy.phase).toBeNull();
    expect(WALLET_RHYTHM.atRisk.phase.tone).toBe('warning');
    for (const rhythm of Object.values(WALLET_RHYTHM)) {
      expect(rhythm.periods.length).toBeLessThanOrEqual(8);
      expect(rhythm.ruleFull.length).toBeGreaterThan(0);
      expect(
        rhythm.periods.filter((period) => period.mark === 'current').length,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('holds what remains in the ring, and nothing at the top', () => {
    expect(WALLET_TIER.gold.remaining).toBe('7');
    expect(WALLET_TIER.top.remaining).toBeNull();
    expect(WALLET_TIER.top.ring.value).toBe(WALLET_TIER.top.ring.max);
    for (const tier of Object.values(WALLET_TIER)) {
      expect(tier.steps.marks.map((mark) => mark.label)).toEqual([
        'Бронз',
        'Сребро',
        'Злато',
        'Платина',
      ]);
      expect(tier.steps.value).toBeLessThanOrEqual(tier.steps.max);
    }
  });

  it('puts the rewards within reach first, and meters only the ones out of reach', () => {
    const reach = REWARD_TILES.map((tile) => tile.affordable);
    expect(reach).toEqual([...reach].sort((a, b) => Number(b) - Number(a)));
    for (const tile of REWARD_TILES) {
      expect(tile.missing === null).toBe(tile.affordable);
      expect(tile.progress === null).toBe(tile.affordable);
      if (tile.progress !== null) {
        expect(tile.progress).toBeGreaterThanOrEqual(0);
        expect(tile.progress).toBeLessThan(1);
      }
    }
  });

  it('prints an amount over its balance, or neither', () => {
    for (const row of Object.values(ACTIVITY_ROW)) {
      expect(row.amount === null).toBe(row.balanceAfter === null);
      if (row.amount !== null) expect(row.amount).toMatch(/^[+−]\d.* т\.$/);
      expect(row.lines.length).toBe(1);
    }
    expect(ACTIVITY_ROW.reversed.struck).toBe(true);
    expect(ACTIVITY_ROW.reversal.struck).toBe(false);
  });

  it('groups the journal by month, newest first', () => {
    for (const groups of Object.values(ACTIVITY_GROUPS)) {
      const keys = groups.map((group) => group.key);
      expect(keys.every((key) => /^\d{4}-\d{2}$/.test(key))).toBe(true);
      expect(keys).toEqual([...keys].sort().reverse());
      expect(groups.every((group) => group.rows.length > 0)).toBe(true);
    }
    // The wallet's feed is the newest five events.
    const feed: readonly ActivityGroupVm[] = ACTIVITY_GROUPS.newestFive;
    expect(feed.flatMap((group) => group.rows).length).toBe(5);
    // The month the page boundary cut prints no net.
    expect(ACTIVITY_GROUPS.newestFive.at(-1)?.net).toBeNull();
  });

  it('keeps a paused wallet’s values, and takes its tickets and its verbs', () => {
    expect(WALLET.paused.frozen).toBe(true);
    expect(WALLET.paused.pass.frozen).toBe(true);
    expect(WALLET.paused.pass.figure).toBe(WALLET.georgi.pass.figure);
    expect(WALLET.paused.rhythm.frozen).toBe(true);
    expect(
      WALLET.paused.holdings.data.map((holding) => holding.kind),
    ).not.toContain('ticket');
    expect(WALLET.paused.actions.map((action) => action.id)).toEqual([
      'catalog',
      'history',
    ]);
  });

  it('pages the ledger, and states no foot before the first page', () => {
    expect(joined(LEDGER_PAGE.first.subline)).toBe('Георги Петров · 371 т.');
    expect(facts(LEDGER_PAGE.first.subline)).toEqual(['371 т.']);
    expect(LEDGER_PAGE.loading.paging).toBeNull();
    expect(LEDGER_PAGE.failed.paging).toBeNull();
    expect(LEDGER_PAGE.filteredEmpty.groups).toEqual([]);
    expect(LEDGER_PAGE.filteredEmpty.filter).not.toBe('all');
  });
});

describe('the hand-built fixtures: medals, records, a medal’s detail', () => {
  it('draws one medal per state of the ring', () => {
    expect(new Set(Object.values(MEDALS).map((medal) => medal.state))).toEqual(
      new Set(['notStarted', 'inProgress', 'earned', 'complete']),
    );
    for (const medal of Object.values(MEDALS)) {
      // The numeral is the highest EARNED level: none before the first.
      if (medal.state === 'notStarted' || medal.state === 'inProgress') {
        expect(medal.level).toBeNull();
      } else {
        expect(medal.level).not.toBeNull();
      }
      if (medal.value !== null) {
        expect(medal.value).toBeGreaterThan(0);
        expect(medal.value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('opens the chips with «Всички» and prints a count on none', () => {
    expect(ACHIEVEMENT_CHIPS[0].id).toBe('all');
    expect(ACHIEVEMENT_CHIPS.filter((chip) => /\d/.test(chip.label))).toEqual(
      [],
    );
    expect(new Set(ACHIEVEMENT_CHIPS.map((chip) => chip.id)).size).toBe(
      ACHIEVEMENT_CHIPS.length,
    );
  });

  it('folds a category only past nine families, and says how many it holds', () => {
    for (const section of Object.values(MEDAL_SECTIONS)) {
      expect(section.folded === null).toBe(section.tiles.length <= 9);
      if (section.folded !== null) {
        expect(section.folded).toBe(section.tiles.length);
      }
    }
    expect(MEDAL_SECTIONS.mastery.tiles.length).toBe(9);
    expect(MEDAL_SECTIONS.special.folded).toBe(12);
  });

  it('puts the records first and «Почти спечелени» on one row', () => {
    for (const page of Object.values(MEDALS_PAGE) as readonly MedalsPageVm[]) {
      expect(page.records.length).toBeLessThanOrEqual(4);
      expect(page.close.length).toBeLessThanOrEqual(3);
      expect(page.chips[0]?.id).toBe('all');
    }
    expect(MEDALS_PAGE.empty.emptyHint).not.toBeNull();
    expect(MEDALS_PAGE.georgi.emptyHint).toBeNull();
    expect(MEDALS_PAGE.threeRecords.records.length).toBe(3);
  });

  it('never repeats the featured record as a row of its group', () => {
    for (const page of Object.values(
      RECORDS_PAGE,
    ) as readonly RecordsPageVm[]) {
      const rows = page.groups.flatMap((group) => group.rows);
      expect(rows.map((row) => row.id)).not.toContain(page.featured?.id);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
      for (const group of page.groups) {
        expect(group.rows.length).toBeGreaterThan(0);
        expect(group.rows.every((row) => row.theme === group.theme)).toBe(true);
      }
      expect(page.groups.map((group) => group.theme)).toEqual(
        (['rhythm', 'visits', 'favourites'] as const).filter((theme) =>
          page.groups.some((group) => group.theme === theme),
        ),
      );
    }
    expect(Object.keys(RECORD_ROWS)).toEqual([
      'longestRhythm',
      'currentRhythm',
      'totalVisits',
      'last12Months',
      'mostVisitsInYear',
      'firstVisit',
      'favouriteService',
      'preferredBarber',
      'usualServices',
    ]);
  });

  it('leads a record’s row with a glyph, a picture or a face: one of them', () => {
    for (const row of Object.values(RECORD_ROWS)) {
      const leads = [row.icon, row.src, row.faceName].filter(
        (lead) => lead !== null,
      );
      expect(leads.length).toBe(1);
    }
  });

  it('marks one record year, against which the others are metered', () => {
    const years = RECORDS_PAGE.georgi.years;
    expect(years.filter((year) => year.record).length).toBe(1);
    for (const year of years) {
      expect(year.gauge.value).toBeLessThanOrEqual(year.gauge.max);
    }
    expect(RECORDS_PAGE.partial.years).toBeNull();
  });

  it('climbs the ladder in order: a passed level is a full medal, the rest silhouettes', () => {
    for (const detail of Object.values(
      MEDAL_DETAIL,
    ) as readonly MedalDetailVm[]) {
      const levels = detail.ladder.map((level) => level.level);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      for (const level of detail.ladder) {
        expect(level.medal.state).toBe(
          level.tone === 'passed' ? 'complete' : 'notStarted',
        );
        expect(level.earnedOn === null).toBe(level.tone !== 'passed');
      }
      expect(
        detail.ladder.filter((level) => level.tone === 'next').length,
      ).toBeLessThanOrEqual(1);
      expect(detail.visits.length).toBeLessThanOrEqual(5);
      expect(detail.related?.tiles.length ?? 0).toBeLessThanOrEqual(3);
      expect(detail.how?.steps ?? []).toEqual([]);
      // The hero medal stands alone: the title and the state line say it.
      expect(detail.medal.title).toBeNull();
      expect(detail.medal.caption).toBeNull();
    }
  });

  it('says the count once, and what this visit adds only when it counts', () => {
    expect(MEDAL_DETAIL.fade.progress.thisVisit).toBeNull();
    expect(MEDAL_DETAIL.fade.action).not.toBeNull();
    // The visit already holds the service: the line, and no verb.
    expect(MEDAL_DETAIL.countsThisVisit.progress.thisVisit).not.toBeNull();
    expect(MEDAL_DETAIL.countsThisVisit.action).toBeNull();
    expect(MEDAL_DETAIL.retired.how).toBeNull();
    expect(MEDAL_DETAIL.retired.action).toBeNull();
    expect(joined(MEDAL_DETAIL.fade.stateLine)).toBe(
      'Майсторство · Ниво II · от 24.09.2025 г.',
    );
  });

  it('draws one cover across the card, or two to four in a 2-up grid', () => {
    for (const detail of Object.values(
      MEDAL_DETAIL,
    ) as readonly MedalDetailVm[]) {
      const how = detail.how;
      if (how === null) continue;
      expect(how.pictures.length).toBeLessThanOrEqual(4);
      if (how.pictures.length >= 2) {
        expect(how.columns).toBe(2);
        expect(how.ratio).toBe('4 / 3');
      } else {
        expect(how.columns).toBe(1);
      }
    }
  });
});

describe('the hand-built fixtures: the visits page', () => {
  it('joins the two quiet lines from their runs', () => {
    expect(joined(VISITS_PAGE.admin.line)).toBe(
      '23 посещения · през 4 седмици',
    );
    expect(facts(VISITS_PAGE.admin.line)).toEqual(['23', '4']);
    expect(joined(VISITS_PAGE.admin.facts)).toBe(
      'Без неявявания и откази от клиента · похарчени общо 492,50 €',
    );
    expect(facts(VISITS_PAGE.admin.facts)).toEqual(['492,50 €']);
    // A barber reads no money.
    expect(VISITS_PAGE.barber.facts).toBeNull();
  });

  it('files «Предстоящи» first, then months newest first, under the history’s ids', () => {
    const sections = VISITS_PAGE.barber.sections;
    expect(sections[0]?.key).toBe('upcoming');
    const months = sections.slice(1).map((section) => section.key);
    expect(months.every((key) => /^\d{4}-\d{2}$/.test(key))).toBe(true);
    expect(months).toEqual([...months].sort().reverse());
    for (const section of sections) {
      expect(section.testId).toBe(
        section.key === 'upcoming'
          ? 'history-upcoming'
          : `history-month-${section.key}`,
      );
      for (const row of section.rows) {
        expect(row.sectionKey).toBe(section.key);
        expect(row.testId).toBe(`history-row-${row.id}`);
      }
    }
  });

  it('ends a staff row with one fact, the face on the trailing edge', () => {
    const rows = VISITS_PAGE.barber.sections.flatMap((section) => section.rows);
    expect(
      new Set(rows.map((row) => row.trailingFact?.kind ?? 'none')),
    ).toEqual(new Set(['none', 'badge', 'amount', 'status']));
    for (const row of rows) {
      expect(row.trailing?.kind).toBe('barber');
      // An hour that did not happen is struck, and never fades as well.
      expect(row.struck).toBe(
        row.outcome === 'no_show' || row.outcome === 'cancelled',
      );
    }
  });

  it('offers only the filters the rows can answer, the choice in force among them', () => {
    for (const page of Object.values(VISITS_PAGE) as readonly VisitsPageVm[]) {
      expect(page.offeredFilters).toContain('all');
      expect(page.offeredFilters).toContain(page.filter);
      expect(page.paging === null).toBe(page.status !== 'ready');
    }
    expect(VISITS_PAGE.filteredEmpty.sections).toEqual([]);
  });
});
