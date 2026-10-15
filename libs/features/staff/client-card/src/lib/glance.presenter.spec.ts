import { describe, expect, it } from 'vitest';
import { AccountStatus, User } from '@creativo/application/accounts';
import { BookingLifecycle } from '@core/components';
import type {
  Appointment,
  ClientStatsRecord,
  GiftVoucher,
} from '@core/entities';
import { AppointmentId, AppointmentPhotoId } from '@core/primitives';
import {
  type GiftVoucherFields,
  type LoyaltyAccount,
  StreakDefinition,
} from '@creativo/application/engagement';
import { loyaltyFixtures } from '@creativo/application/engagement/testing';
import {
  type AchievementsContext,
  PENDING_RING,
} from './achievements.presenter';
import {
  type CapsulesInput,
  type HeadInput,
  type LoyaltyTilesInput,
  type VisitsModuleInput,
  medalStripVm,
} from './client-card.presenter';
import type { ClientCardGrant } from './client-card.contracts';
import type {
  AchievementsData,
  BirthdayVm,
  ClientCapsulesVm,
  ClientHeroVm,
  LinePart,
  LoyaltyGlanceVm,
  MedalsGlanceVm,
  VisitCardsVm,
} from './client-pages.vm';
import {
  type BirthdayInput,
  type HeroInput,
  type LoyaltyGlanceInput,
  birthdayVm,
  clientHeroVm,
  grantsBesideBirthday,
  loyaltyGlanceVm,
  medalsGlanceVm,
  overviewCapsulesVm,
  visitCardsVm,
} from './glance.presenter';
import { medalRingVm } from './medals.presenter';
import {
  GEORGI,
  GEORGI_CUSTOMER_ID,
  GEORGI_GRANT,
  GEORGI_NEXT_ID,
  GEORGI_NOTE,
  GEORGI_PREVIOUS_MS,
  GUEST,
  MARTIN,
  MARTIN_CUSTOMER_ID,
  MARTIN_PREVIOUS_MS,
  NBSP_EURO,
  NOW_MS,
  TODAY,
  achievementsContextOf,
  achievementsDataOf,
  at,
  contactOf,
  factMs,
  georgiContext,
  georgiHistory,
  georgiOpenContext,
  georgiPhotos,
  georgiUser,
  giftVoucherOf,
  loyaltyCatalogWith,
  martinContext,
  martinHistory,
  martinUser,
  martinWaitlist,
  must,
  pausedUntilOctober,
  seatOf,
  sofia,
  statsOf,
  subjectOf,
  visitOf,
  wallOf,
  wordsOf,
} from '../testing/client-card.fixtures';

/*
 * The glance's presenters over the BOOK (`client-card.fixtures.ts`): the
 * dev shop's two holders on Monday 28 September 2026, 12:40 in Sofia.
 * Георги's 10:00 fade is done; Мартин is in the chair on his birthday.
 * Every figure here is computed from the book and the loyalty fixtures,
 * never a wireframe's (LR7).
 */

const WORDS = wordsOf('bg');
const ENGLISH = wordsOf('en');
const GEORGI_BOOK = georgiHistory();
const GEORGI_STATS = statsOf(GEORGI, GEORGI_BOOK);
const MARTIN_BOOK = martinHistory();
const MARTIN_STATS = statsOf(MARTIN, MARTIN_BOOK);
const LOYALTY = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);
const MARTIN_LOYALTY = achievementsDataOf('martin', MARTIN_PREVIOUS_MS);

// ── The contract ────────────────────────────────────────────────────────

/*
 * The signatures the store composes (revision 3 §7.3), held at COMPILE
 * time: a type-check of this spec goes red when one of them moves, or
 * when an input stops being the built input it extends.
 */
const CONTRACT = {
  clientHeroVm,
  overviewCapsulesVm,
  birthdayVm,
  visitCardsVm,
  loyaltyGlanceVm,
  medalsGlanceVm,
} satisfies {
  readonly clientHeroVm: (input: HeroInput) => ClientHeroVm;
  readonly overviewCapsulesVm: (
    input: Omit<CapsulesInput, 'tier'>,
  ) => ClientCapsulesVm;
  readonly birthdayVm: (input: BirthdayInput) => BirthdayVm | null;
  readonly visitCardsVm: (input: VisitsModuleInput) => VisitCardsVm;
  readonly loyaltyGlanceVm: (
    input: LoyaltyGlanceInput,
  ) => LoyaltyGlanceVm | null;
  readonly medalsGlanceVm: (
    data: AchievementsData,
    ctx: AchievementsContext,
  ) => MedalsGlanceVm | null;
};

/** What each input adds to the built one it extends, and nothing else. */
type Added<New extends Built, Built> = Exclude<keyof New, keyof Built>;
const ADDED = {
  hero: ['tier'],
  loyalty: ['vouchers', 'ruleInForce'],
} satisfies {
  readonly hero: readonly Added<HeroInput, HeadInput>[];
  readonly loyalty: readonly Added<LoyaltyGlanceInput, LoyaltyTilesInput>[];
};

describe('the contract (§7.3)', () => {
  it('publishes the six presenters the store composes, each a function of its one input', () => {
    expect(
      Object.entries(CONTRACT).map(([name, presenter]) => [
        name,
        presenter.length,
      ]),
    ).toEqual([
      ['clientHeroVm', 1],
      ['overviewCapsulesVm', 1],
      ['birthdayVm', 1],
      ['visitCardsVm', 1],
      ['loyaltyGlanceVm', 1],
      ['medalsGlanceVm', 2],
    ]);
    expect(ADDED).toEqual({
      hero: ['tier'],
      loyalty: ['vouchers', 'ruleInForce'],
    });
  });
});

/** A space a line never breaks at, and the quiet lines' joint hung on it. */
const NB = '\u00a0';
const J = `${NB}· `;

/** A line as it reads, and the runs set apart in it. */
const read = (line: readonly LinePart[] | null) =>
  line === null
    ? null
    : {
        text: line.map((part) => part.text).join(''),
        facts: line.filter((part) => part.fact).map((part) => part.text),
      };

/** A line as it reads with its no-break spaces as plain ones: the sentence a reader hears. */
const plain = (line: readonly LinePart[] | null) =>
  read(line)?.text.replaceAll(NB, ' ') ?? null;

// ── A · the hero ────────────────────────────────────────────────────────

function heroOf(overrides: Partial<Parameters<typeof clientHeroVm>[0]> = {}) {
  return clientHeroVm({
    subject: subjectOf(GEORGI),
    user: georgiUser(),
    settled: true,
    stats: GEORGI_STATS,
    statsKnown: true,
    avatarSrc: null,
    nowMs: NOW_MS,
    words: WORDS,
    tier: { account: LOYALTY.account, catalog: LOYALTY.catalog },
    ...overrides,
  });
}

/** Георги's account with another standing on the tier track. */
function tierOf(tier: Partial<LoyaltyAccount['tier']>) {
  return {
    account: { ...LOYALTY.account, tier: { ...LOYALTY.account.tier, ...tier } },
    catalog: LOYALTY.catalog,
  };
}

describe('the hero (A)', () => {
  it('names the account, says tenure and cadence in ONE line with its two facts set apart, and wears the tier', () => {
    expect(
      heroOf({ avatarSrc: 'https://example.test/avatars/georgi.jpg' }),
    ).toEqual({
      name: 'Георги Петров',
      // The facts' words held together, the joint hung on a no-break
      // space: the page parts the line at it (review 3, round 4).
      line: [
        { text: 'Клиент от ', fact: false },
        { text: `март${NB}2025${NB}г.`, fact: true },
        { text: `${J}идва през `, fact: false },
        { text: `4${NB}седмици`, fact: true },
      ],
      // 14 qualifying visits between Gold's 12 and Platinum's 20.
      tier: {
        name: 'Злато',
        progress: 0.25,
        accessibleName: 'Злато, още 6 посещения до Платина',
      },
      avatarSrc: 'https://example.test/avatars/georgi.jpg',
      initialsFrom: 'Георги Петров',
      paused: false,
    });
  });

  it('cuts the line out of the catalogue’s own sentence: the runs joined are the sentence, letter for letter but for the spaces it holds', () => {
    expect(plain(heroOf().line)).toBe(
      WORDS.head.sinceCadence('март 2025 г.', WORDS.head.cadence(4)),
    );
    expect(read(heroOf({ words: ENGLISH }).line)).toEqual({
      text: `Client since March${NB}2025${J}comes every 4${NB}weeks`,
      facts: [`March${NB}2025`, `4${NB}weeks`],
    });
  });

  it('binds the words to their joint — the card’s one grammar — so a wrap parts after a «·», never before one and never inside a fact', () => {
    const line = must(heroOf().line);
    // No plain space before any middot; one after each.
    expect(read(line)?.text).not.toMatch(/ ·/u);
    expect(read(line)?.text).toMatch(/·(?= )/u);
    // Inside a fact every space is a no-break one.
    for (const fact of read(line)?.facts ?? []) {
      expect(fact).not.toContain(' ');
    }
    // The joint is the line's: the page parts the runs at it.
    expect(
      line
        .map((part) => part.text)
        .join('')
        .split(J),
    ).toEqual([`Клиент от март${NB}2025${NB}г.`, `идва през 4${NB}седмици`]);
  });

  it('renders from the seat at once: the line, the plate and the ring land together, behind the D-9 gate', () => {
    expect(heroOf({ user: null, settled: false, stats: null })).toEqual({
      name: 'Георги П.',
      line: null,
      tier: null,
      avatarSrc: null,
      initialsFrom: 'Георги П.',
      paused: false,
    });
    // The account may answer before the profile: the plate still waits.
    expect(heroOf({ settled: false }).tier).toBeNull();
  });

  it('renders from the seat before the card’s words have loaded', () => {
    expect(heroOf({ words: null })).toEqual({
      name: 'Георги Петров',
      line: null,
      tier: null,
      avatarSrc: null,
      initialsFrom: 'Георги Петров',
      paused: false,
    });
  });

  it('prefers the seat’s own picture', () => {
    const subject = subjectOf(GEORGI, {
      avatarSrc: 'https://example.test/seat.jpg',
    });
    expect(
      heroOf({ subject, avatarSrc: 'https://example.test/avatars/georgi.jpg' })
        .avatarSrc,
    ).toBe('https://example.test/seat.jpg');
  });

  it('says a pause and nothing else, its last day the one fact, and keeps the plate under the warning ring', () => {
    const paused = heroOf({ user: georgiUser(pausedUntilOctober()) });
    expect(paused.paused).toBe(true);
    expect(read(paused.line)).toEqual({
      text: 'Онлайн записването е спряно до 12.10',
      facts: ['12.10'],
    });
    // A sentence of its own keeps its plain spaces: it wraps where it must.
    expect(paused.tier?.name).toBe('Злато');
    const permanent = AccountStatus.blocked({ reason: 'manual' });
    expect(heroOf({ user: georgiUser(permanent) }).line).toEqual([
      { text: 'Онлайн записването е спряно за постоянно', fact: false },
    ]);
    // The profile says it: the stats need not have been read.
    expect(
      read(
        heroOf({
          user: georgiUser(pausedUntilOctober()),
          stats: null,
          statsKnown: false,
        }).line,
      )?.text,
    ).toBe('Онлайн записването е спряно до 12.10');
  });

  it('treats a pause that has run out as none', () => {
    const lapsed = AccountStatus.blocked({
      reason: 'manual',
      until: at('2026-09-01T00:00:00'),
    });
    const hero = heroOf({ user: georgiUser(lapsed) });
    expect(hero.paused).toBe(false);
    expect(read(hero.line)?.facts).toEqual([
      `март${NB}2025${NB}г.`,
      `4${NB}седмици`,
    ]);
  });

  it('says «Първо посещение» before the first worked visit and the tenure alone before a cadence is known', () => {
    expect(heroOf({ stats: null }).line).toEqual([
      { text: 'Първо посещение', fact: false },
    ]);
    expect(
      heroOf({
        stats: { ...GEORGI_STATS, lifetimeVisitsCompleted: 0 },
      }).line,
    ).toEqual([{ text: 'Първо посещение', fact: false }]);
    expect(
      heroOf({ stats: { ...GEORGI_STATS, avgCadenceDays: null } }).line,
    ).toEqual([
      { text: 'Клиент от ', fact: false },
      { text: `март${NB}2025${NB}г.`, fact: true },
    ]);
  });

  it('words the cadence in whole weeks, one at the least, agreed with its count', () => {
    const every = (avgCadenceDays: number) =>
      read(heroOf({ stats: { ...GEORGI_STATS, avgCadenceDays } }).line)
        ?.facts[1];
    expect(every(7)).toBe(`1${NB}седмица`);
    expect(every(3)).toBe(`1${NB}седмица`);
    expect(every(39.2)).toBe(`6${NB}седмици`);
  });

  it('claims no tenure when the stats were never read', () => {
    expect(heroOf({ stats: null, statsKnown: false }).line).toBeNull();
  });

  it('knows a guest from the seat: the line at once, no plate and no ring', () => {
    expect(
      heroOf({ subject: GUEST, user: null, stats: null, settled: false }),
    ).toEqual({
      name: 'Иво',
      // Two facts to the page, one sentence to a reader.
      line: [{ text: `Гост${J}без профил`, fact: false }],
      tier: null,
      avatarSrc: null,
      initialsFrom: 'Иво',
      paused: false,
    });
  });

  it('draws no tier without `loyalty.tiers`, and none the catalogue does not know', () => {
    expect(heroOf({ tier: null }).tier).toBeNull();
    expect(heroOf({ tier: tierOf({ current: 'diamond' }) }).tier).toBeNull();
  });

  it('fills the ring at the top of the track and says so', () => {
    expect(
      heroOf({
        tier: tierOf({
          current: 'platinum',
          qualifying: 23,
          next: null,
          remaining: null,
        }),
      }).tier,
    ).toEqual({
      name: 'Платина',
      progress: 1,
      accessibleName: 'Платина, най-високият статус',
    });
  });

  it('starts the ring empty at a tier’s own threshold and agrees the visits still to go', () => {
    expect(
      heroOf({
        tier: tierOf({
          current: 'bronze',
          qualifying: 0,
          next: 'silver',
          remaining: 6,
        }),
      }).tier,
    ).toEqual({
      name: 'Бронз',
      progress: 0,
      accessibleName: 'Бронз, още 6 посещения до Сребро',
    });
    expect(
      heroOf({
        tier: tierOf({ qualifying: 19, remaining: 1 }),
      }).tier,
    ).toEqual({
      name: 'Злато',
      progress: 0.875,
      accessibleName: 'Злато, още 1 посещение до Платина',
    });
  });

  it('draws the plate alone for a tier held above what the visits reached: nothing is promised', () => {
    const granted = {
      tierId: 'platinum',
      until: null,
      source: { kind: 'adjustment', adjustmentId: 'adj-1' },
    } as const;
    // Granted the top tier: the top of the track, whatever the visits say.
    expect(heroOf({ tier: tierOf({ override: granted }) }).tier).toEqual({
      name: 'Платина',
      progress: 1,
      accessibleName: 'Платина, най-високият статус',
    });
    // Granted Gold on Silver's visits: the account's next IS Gold.
    expect(
      heroOf({
        tier: tierOf({
          current: 'silver',
          qualifying: 9,
          next: 'gold',
          remaining: 3,
          override: { ...granted, tierId: 'gold' },
        }),
      }).tier,
    ).toEqual({ name: 'Злато', progress: null, accessibleName: 'Злато' });
  });

  it('words the tier in the card’s language', () => {
    expect(heroOf({ words: ENGLISH }).tier).toEqual({
      name: 'Gold',
      progress: 0.25,
      accessibleName: 'Gold, 6 visits more to Platinum',
    });
  });
});

// ── B · the capsule row ─────────────────────────────────────────────────

describe('the capsules (B)', () => {
  const noShowsOf = (...days: readonly string[]): ClientStatsRecord => ({
    ...MARTIN_STATS,
    last365NoShows: days.map((day, index) => {
      const wall = wallOf(`${day}T12:30:00`);
      return {
        appointmentId: must(MARTIN_STATS.last365VisitsCompleted.at(index))
          .appointmentId,
        localDate: wall.localDate,
        startMinutes: wall.minute,
      };
    }),
  });
  const capsules = (stats: ClientStatsRecord | null) =>
    overviewCapsulesVm({
      user: martinUser(),
      stats,
      nowMs: NOW_MS,
      words: WORDS,
    });

  it('warns of the no-shows of the last 90 days from two on, behind the no-show glyph', () => {
    expect(capsules(noShowsOf('2026-08-01', '2026-09-10'))).toEqual({
      shown: [
        {
          id: 'noShows',
          text: '2 неявявания',
          tone: 'warning',
          icon: 'visit.noShow',
        },
      ],
      more: null,
    });
  });

  it('says neither the tier nor the birthday: the plate and the card do', () => {
    // Мартин, on his birthday, with nothing to warn of: the row is absent.
    expect(capsules(MARTIN_STATS)).toEqual({ shown: [], more: null });
  });

  it('stays silent under two, for no-shows older than 90 days, and without stats', () => {
    expect(capsules(noShowsOf('2026-09-10')).shown).toEqual([]);
    expect(capsules(noShowsOf('2026-03-01', '2026-09-10')).shown).toEqual([]);
    expect(capsules(null).shown).toEqual([]);
  });
});

// ── BD · the birthday card ──────────────────────────────────────────────

const BIRTHDAY_GRANT: ClientCardGrant = {
  grantId: 'grant-dev-martin-birthday',
  title: 'Рожден ден',
  valueLabel: '−20 %',
  expiresOn: '2026-10-28',
  occasion: 'birthday',
};

/** A client born on `birthDate`, read on `today`. */
function born(birthDate: string, today: string = TODAY): User {
  const user = User.reconstitute(
    {
      id: 'dev-client-9',
      phone: '+359881112233',
      firstName: 'Лили',
      lastName: 'Тодорова',
      roles: ['client'],
      status: AccountStatus.active(),
      birthDate,
    },
    at(`${today}T09:00:00`),
  );
  if (user.isFailure()) throw new Error('bad user');
  return user.value;
}

function birthdayOf(overrides: Partial<Parameters<typeof birthdayVm>[0]> = {}) {
  return birthdayVm({
    user: martinUser(),
    today: TODAY,
    grants: [],
    grantsOnBill: [],
    words: WORDS,
    ...overrides,
  });
}

describe('the birthday card (BD)', () => {
  it('is the band alone when no gift is held: the day and the age, a statement', () => {
    expect(birthdayOf()).toEqual({
      kind: 'today',
      title: 'Рожден ден · 34 г.',
      gift: null,
      giftLabel: 'Подарък от салона',
      accessibleName: 'Рожден ден днес, навършва 34 години',
    });
  });

  it('carries the gift under the band: the grant whose coupon says `birthday`', () => {
    expect(birthdayOf({ grants: [GEORGI_GRANT, BIRTHDAY_GRANT] })).toEqual({
      kind: 'today',
      title: 'Рожден ден · 34 г.',
      gift: {
        grantId: 'grant-dev-martin-birthday',
        title: 'Рожден ден',
        value: '−20 %',
        detail: 'до 28.10',
        stack: null,
        applied: false,
        accessibleName: 'Рожден ден, −20 %, използвай',
        removeName: 'Премахни отстъпката: Рожден ден',
      },
      giftLabel: 'Подарък от салона',
      accessibleName:
        'Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай',
    });
  });

  it('keeps the gift where it stood once it is on the bill, stamped', () => {
    const card = birthdayOf({ grantsOnBill: [BIRTHDAY_GRANT] });
    expect(card?.gift).toMatchObject({
      grantId: 'grant-dev-martin-birthday',
      applied: true,
      accessibleName: 'Рожден ден, −20 %, с това посещение',
    });
    expect(card?.accessibleName).toBe(
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, с това посещение',
    );
  });

  it('never reads a name: a grant titled «Рожден ден» with no occasion is no gift', () => {
    // A host that does not know the coupon's occasion states none.
    const named: ClientCardGrant = {
      grantId: BIRTHDAY_GRANT.grantId,
      title: BIRTHDAY_GRANT.title,
      valueLabel: BIRTHDAY_GRANT.valueLabel,
      expiresOn: BIRTHDAY_GRANT.expiresOn,
    };
    expect(birthdayOf({ grants: [named, GEORGI_GRANT] })?.gift).toBeNull();
    expect(
      birthdayOf({ grants: [{ ...BIRTHDAY_GRANT, occasion: null }] })?.gift,
    ).toBeNull();
  });

  it('says a gift whose name says it all by its name', () => {
    const card = birthdayOf({
      grants: [
        {
          ...BIRTHDAY_GRANT,
          title: 'Безплатно подстригване',
          valueLabel: null,
        },
      ],
    });
    expect(card?.gift?.value).toBeNull();
    expect(card?.accessibleName).toBe(
      'Рожден ден днес, навършва 34 години. Подарък: Безплатно подстригване, използвай',
    );
  });

  it('agrees the age, and says the day without a figure when no year can be the year of birth', () => {
    expect(birthdayOf({ user: born('2025-09-28') })?.accessibleName).toBe(
      'Рожден ден днес, навършва 1 година',
    );
    expect(birthdayOf({ user: born('1800-09-28') })).toMatchObject({
      title: 'Рожден ден днес',
      accessibleName: 'Рожден ден днес',
    });
    expect(birthdayOf({ user: born('2026-09-28') })?.title).toBe(
      'Рожден ден днес',
    );
  });

  it('is absent on any other day, for a guest and without a date of birth', () => {
    expect(birthdayOf({ user: georgiUser() })).toBeNull();
    expect(birthdayOf({ user: null })).toBeNull();
    const undated = User.reconstitute(
      {
        id: 'dev-client-9',
        phone: '+359881112233',
        firstName: 'Лили',
        lastName: 'Тодорова',
        roles: ['client'],
        status: AccountStatus.active(),
      },
      at('2026-09-28T09:00:00'),
    );
    if (undated.isFailure()) throw new Error('bad user');
    expect(birthdayOf({ user: undated.value })).toBeNull();
    // Yesterday's is over; it comes again in a year.
    expect(birthdayOf({ user: born('1992-09-27') })).toBeNull();
  });

  it('says a birthday within the week to come as one quiet line: a date, never a countdown, never a gift', () => {
    expect(
      birthdayOf({ user: born('1992-10-02'), grants: [BIRTHDAY_GRANT] }),
    ).toEqual({
      kind: 'upcoming',
      title: 'Рожден ден · петък, 2.10 · 34 г.',
      gift: null,
      giftLabel: 'Подарък от салона',
      accessibleName: 'Рожден ден · петък, 2.10 · 34 г.',
    });
    expect(birthdayOf({ user: born('1992-09-29') })?.title).toBe(
      'Рожден ден · вторник, 29.09 · 34 г.',
    );
    expect(birthdayOf({ user: born('1992-10-05') })?.title).toBe(
      'Рожден ден · понеделник, 5.10 · 34 г.',
    );
    expect(birthdayOf({ user: born('1992-10-06') })).toBeNull();
    expect(birthdayOf({ user: born('1800-10-02') })?.title).toBe(
      'Рожден ден · петък, 2.10',
    );
  });

  it('looks across the year’s end, and names the year the day falls in', () => {
    expect(
      birthdayOf({
        user: born('1990-01-02', '2026-12-29'),
        today: '2026-12-29',
      }),
    ).toMatchObject({
      kind: 'upcoming',
      title: 'Рожден ден · събота, 2.01.2027 г. · 37 г.',
    });
  });

  it('keeps a 29 February birthday on the 28th outside a leap year', () => {
    const leapling = born('2000-02-29', '2027-02-25');
    expect(birthdayOf({ user: leapling, today: '2027-02-25' })?.title).toBe(
      'Рожден ден · неделя, 28.02 · 27 г.',
    );
    expect(birthdayOf({ user: leapling, today: '2027-02-28' })).toMatchObject({
      kind: 'today',
      title: 'Рожден ден · 27 г.',
    });
    expect(birthdayOf({ user: leapling, today: '2028-02-25' })?.title).toBe(
      'Рожден ден · вторник, 29.02 · 28 г.',
    );
    // In a leap year the 28th is the day before, not the day.
    expect(birthdayOf({ user: leapling, today: '2028-02-28' })).toMatchObject({
      kind: 'upcoming',
      title: 'Рожден ден · вторник, 29.02 · 28 г.',
    });
  });

  it('words the card in its language', () => {
    expect(
      birthdayOf({ words: ENGLISH, grants: [BIRTHDAY_GRANT] }),
    ).toMatchObject({
      title: 'Birthday · 34',
      giftLabel: 'A gift from the shop',
      accessibleName: 'Birthday today, turning 34. Gift: −20 %, use',
    });
    expect(
      birthdayOf({ words: ENGLISH, user: born('1992-10-02') })?.title,
    ).toBe('Birthday · Friday, 10/2 · 34');
  });

  it('takes the gift out of the reward ticket’s grants while the card carries it, and only then', () => {
    const held = [GEORGI_GRANT, BIRTHDAY_GRANT];
    expect(grantsBesideBirthday(held, birthdayOf({ grants: held }))).toEqual([
      GEORGI_GRANT,
    ]);
    // The band alone (a party member, offline, a paused client): an
    // ordinary ticket, were it offered at all.
    expect(grantsBesideBirthday(held, birthdayOf())).toEqual(held);
    // Any other day, the week before included.
    expect(grantsBesideBirthday(held, null)).toEqual(held);
    expect(
      grantsBesideBirthday(
        held,
        birthdayOf({ user: born('1992-10-02'), grants: held }),
      ),
    ).toEqual(held);
  });
});

// ── H · «Посещения» ─────────────────────────────────────────────────────

/** A fade of Георги's still to come, with Нико, asked for and not yet confirmed. */
function fadeOn(id: string, iso: string): Appointment {
  const wall = wallOf(iso);
  const booked = sofia('2026-09-28T10:50:00');
  return visitOf({
    id,
    localDate: wall.localDate,
    seats: [
      seatOf({
        id: `${id}-s1`,
        who: GEORGI,
        serviceId: 'svc-fade',
        barberId: 'niko',
        minutes: 45,
        priceMinor: 1750,
        startMinutes: wall.minute,
      }),
    ],
    lifecycle: BookingLifecycle.pending(booked),
    contact: contactOf('Георги Петров', '+359881234567', null),
    bookedAtUtcMs: booked,
  });
}

describe('«Посещения» (H)', () => {
  const georgi = (
    overrides: Partial<Parameters<typeof visitCardsVm>[0]> = {},
  ) =>
    visitCardsVm({
      appointments: GEORGI_BOOK,
      subjectUserId: GEORGI,
      subjectCustomerId: GEORGI_CUSTOMER_ID,
      context: georgiContext(),
      photos: georgiPhotos(),
      waitlist: [],
      paused: false,
      count: 24,
      clientWords: true,
      nowMs: NOW_MS,
      words: WORDS,
      ...overrides,
    });

  it('draws the last visit that is not this one and the next one as cards of ONE order', () => {
    expect(georgi()).toEqual({
      last: {
        id: 'appt-hist-c1-23',
        kind: 'last',
        label: 'Последно посещение',
        services: 'Фейд',
        facts: [
          { text: '3.09', fact: true },
          { text: ' · Иван · Център', fact: false },
        ],
        figure: NBSP_EURO('17,50 €'),
        quote: `„${GEORGI_NOTE}“`,
        capsule: null,
        barber: {
          name: 'Иван',
          avatarSrc: 'https://example.test/barbers/ivan.jpg',
        },
        photos: [
          {
            id: 'photo-dev-georgi-2',
            url: 'https://example.test/photos/photo-dev-georgi-2.jpg',
            alt: 'Снимка от 3 септември',
          },
        ],
        accessibleName: NBSP_EURO(
          `Последно посещение: Фейд, 3 септември, Иван, Център, 17,50 €, от клиента: „${GEORGI_NOTE}“`,
        ),
        testId: 'client-visit-last',
      },
      next: {
        id: GEORGI_NEXT_ID,
        kind: 'next',
        label: 'Следващ час',
        services: 'Фейд',
        facts: [
          { text: 'пт, 2.10 · ', fact: false },
          { text: '10:00', fact: true },
          { text: ' · Иван', fact: false },
        ],
        figure: null,
        quote: null,
        capsule: { text: 'Потвърден', tone: 'accent' },
        barber: {
          name: 'Иван',
          avatarSrc: 'https://example.test/barbers/ivan.jpg',
        },
        photos: [],
        accessibleName:
          'Следващ час: Фейд, петък, 2 октомври в 10:00, Иван, Потвърден',
        testId: 'client-visit-next',
      },
      waitlist: null,
      count: 24,
    });
  });

  it('never features the visit on screen, nor lists it as next', () => {
    const vm = georgi({ context: georgiOpenContext() });
    expect(vm.last).toMatchObject({
      id: 'appt-dev-1',
      facts: [
        { text: 'днес', fact: true },
        { text: ' · Иван · Център', fact: false },
      ],
      photos: [{ id: 'photo-dev-georgi-1' }],
    });
    expect(vm.next).toBeNull();
  });

  it('shows three thumbs at most, the last visit’s own; a visit to come shows none', () => {
    const shot = must(georgiPhotos().at(1));
    const many = Array.from({ length: 5 }, (_, index) => ({
      ...shot,
      id: AppointmentPhotoId.of(`p-${index}`),
    }));
    const vm = georgi({
      photos: [
        must(georgiPhotos().at(0)),
        {
          ...shot,
          id: AppointmentPhotoId.of('p-ahead'),
          appointmentId: AppointmentId.of(GEORGI_NEXT_ID),
        },
        ...many,
      ],
    });
    expect(vm.last?.photos.map((photo) => photo.id)).toEqual([
      'p-0',
      'p-1',
      'p-2',
    ]);
    expect(vm.next?.photos).toEqual([]);
  });

  it('shows the SOONEST visit to come, whatever order the page holds them in', () => {
    const later = fadeOn('appt-dev-georgi-later', '2026-10-30T17:30:00');
    const sooner = fadeOn('appt-dev-georgi-sooner', '2026-09-30T09:00:00');
    expect(
      georgi({ appointments: [later, ...GEORGI_BOOK, sooner] }).next,
    ).toMatchObject({
      id: 'appt-dev-georgi-sooner',
      facts: [
        { text: 'ср, 30.09 · ', fact: false },
        { text: '09:00', fact: true },
        { text: ' · Нико', fact: false },
      ],
      // Asked for, not yet confirmed.
      capsule: { text: 'Заявен', tone: 'accent' },
    });
  });

  it('withholds the client’s own words from a viewer who may not read free text', () => {
    const vm = georgi({ clientWords: false });
    expect(vm.last?.quote).toBeNull();
    expect(vm.last?.accessibleName).not.toContain(GEORGI_NOTE);
  });

  it('draws no card for a new client; the count still stands', () => {
    expect(georgi({ appointments: [], count: 0 })).toEqual({
      last: null,
      next: null,
      waitlist: null,
      count: 0,
    });
  });

  const martin = (
    overrides: Partial<Parameters<typeof visitCardsVm>[0]> = {},
  ) =>
    visitCardsVm({
      appointments: MARTIN_BOOK,
      subjectUserId: MARTIN,
      subjectCustomerId: MARTIN_CUSTOMER_ID,
      context: martinContext(),
      photos: [],
      waitlist: [martinWaitlist()],
      paused: false,
      count: 13,
      clientWords: true,
      nowMs: NOW_MS,
      words: WORDS,
      ...overrides,
    });

  it('adds the request still waiting for a free slot: no capsule, no face, no figure', () => {
    const vm = martin();
    expect(vm.last).toMatchObject({
      id: 'appt-hist-c2-14',
      services: 'Класическа подстрижка',
      facts: [
        { text: '19.08', fact: true },
        { text: ' · Нико · Център', fact: false },
      ],
      figure: NBSP_EURO('15,00 €'),
    });
    expect(vm.next).toBeNull();
    expect(vm.waitlist).toEqual({
      id: 'waitlist-dev-martin',
      kind: 'waitlist',
      label: 'Чака свободен час',
      services: 'Класическа подстрижка',
      facts: [{ text: '8.10 – 9.10, следобед', fact: false }],
      figure: null,
      quote: null,
      capsule: null,
      barber: null,
      photos: [],
      accessibleName:
        'Класическа подстрижка, чака свободен час: 8 октомври и 9 октомври, следобед',
      testId: 'client-visit-waitlist',
    });
  });

  it('names the newest request and counts the others', () => {
    const older = martinWaitlist({
      id: 'waitlist-older',
      createdAtIso: '2026-09-20T10:00:00+03:00',
    });
    const vm = martin({ waitlist: [older, martinWaitlist()] });
    expect(vm.waitlist?.id).toBe('waitlist-dev-martin');
    expect(vm.waitlist?.facts).toEqual([
      { text: '8.10 – 9.10, следобед · още 1', fact: false },
    ]);
  });

  it('draws no waiting request while paused, once booked, when lapsed, when a visit was booked after it, or when the read did not answer', () => {
    expect(martin({ paused: true }).waitlist).toBeNull();
    expect(
      martin({ waitlist: [martinWaitlist({ status: 'booked' })] }).waitlist,
    ).toBeNull();
    expect(
      martin({ nowMs: at('2026-10-12T09:00:00').toMillis() }).waitlist,
    ).toBeNull();
    expect(georgi({ waitlist: [martinWaitlist()] }).waitlist).toBeNull();
    expect(martin({ waitlist: null }).waitlist).toBeNull();
  });
});

// ── F · «Лоялност» ──────────────────────────────────────────────────────

const RULE = must(
  LOYALTY.catalog.streakInForce('cadence', TODAY),
  'the rule in force',
);

/** The rule in force with some of its parts changed. */
function ruleWith(
  patch: Partial<ReturnType<StreakDefinition['toProps']>>,
): StreakDefinition {
  const rule = StreakDefinition.create({ ...RULE.toProps(), ...patch });
  if (rule.isFailure()) throw new Error('bad rule');
  return rule.value;
}

/** The fixture's vouchers, one field of a document edited, as flat bodies. */
function voucherOf(
  id: string,
  edit: Partial<GiftVoucherFields> = {},
): GiftVoucher {
  const document = must(
    new Map(Object.entries(loyaltyFixtures.vouchers)).get(id),
    `the voucher ${id}`,
  );
  return giftVoucherOf(id, { ...document, ...edit });
}

/** Георги's three: 25,00 € left of 50,00 €, one spent, one void. */
const GEORGI_VOUCHERS = [
  voucherOf('voucher-dev-georgi'),
  voucherOf('voucher-dev-georgi-spent'),
  voucherOf('voucher-dev-georgi-void'),
];

const ALL_FLAGS = {
  points: true,
  streaks: true,
  achievements: true,
  tiers: true,
} as const;

function loyaltyOf(
  overrides: Partial<Parameters<typeof loyaltyGlanceVm>[0]> = {},
) {
  return loyaltyGlanceVm({
    account: LOYALTY.account,
    catalog: LOYALTY.catalog,
    flags: ALL_FLAGS,
    visitsMs: GEORGI_STATS.last365VisitsCompleted.map(factMs),
    inChairToday: false,
    paused: false,
    today: TODAY,
    words: WORDS,
    heldRewards: [GEORGI_GRANT.title],
    vouchers: GEORGI_VOUCHERS,
    ruleInForce: RULE,
    ...overrides,
  });
}

const accountWith = (edit: Partial<LoyaltyAccount>): LoyaltyAccount => ({
  ...LOYALTY.account,
  ...edit,
});

describe('«Лоялност» (F1)', () => {
  it('is ONE card: the points, what they buy beyond the reward in hand, and what else is held', () => {
    expect(loyaltyOf()).toEqual({
      figure: '358',
      unit: 'точки',
      // «Безплатно подстригване» is on the ticket: the points add the next best.
      sentence: 'Стигат за безплатно оформяне на брада',
      holdings: [
        { id: 'voucher', label: 'Ваучер', value: NBSP_EURO('25,00 €') },
        { id: 'stamps', label: 'Печати', value: '4 от 10' },
        { id: 'rhythm', label: 'Ритъм', value: '24' },
      ],
      accessibleName: NBSP_EURO(
        'Лоялност: 358 точки. Стигат за безплатно оформяне на брада. Ваучер 25,00 €, печати 4 от 10, ритъм 24 посещения.',
      ),
    });
  });

  it('names the costliest reward in reach when none is in hand, in the running case', () => {
    expect(loyaltyOf({ heldRewards: [] })?.sentence).toBe(
      'Стигат за безплатно подстригване',
    );
    expect(loyaltyOf({ heldRewards: undefined })?.sentence).toBe(
      'Стигат за безплатно подстригване',
    );
  });

  it('says how far the next reward is when none is in reach', () => {
    expect(
      loyaltyOf({ account: accountWith({ balance: 78 }), heldRewards: [] }),
    ).toMatchObject({
      figure: '78',
      sentence: 'Още 42 до безплатно оформяне на брада',
    });
    // Everything in reach is in hand: the next one out of reach.
    expect(
      loyaltyOf({
        heldRewards: ['Безплатно подстригване', 'Безплатно оформяне на брада'],
      })?.sentence,
    ).toBe('Още 42 до продукт по избор');
  });

  it('leaves a Latin name and an acronym as written inside the sentence', () => {
    const renamed = (bg: string) =>
      loyaltyCatalogWith((documents) => ({
        ...documents,
        rewardsCatalog: Object.fromEntries(
          Object.entries(documents.rewardsCatalog).map(([id, reward]) => [
            id,
            id === 'reward-cut'
              ? { ...reward, name: { ...reward.name, bg } }
              : reward,
          ]),
        ),
      }));
    const sentenceOf = (bg: string) =>
      loyaltyOf({ catalog: renamed(bg), heldRewards: [] })?.sentence;
    expect(sentenceOf('SPA ден')).toBe('Стигат за SPA ден');
    expect(sentenceOf('VIP грижа')).toBe('Стигат за VIP грижа');
    expect(sentenceOf('Barber box')).toBe('Стигат за Barber box');
    expect(sentenceOf('ВИП грижа')).toBe('Стигат за ВИП грижа');
    expect(sentenceOf('Подстригване „Класик“')).toBe(
      'Стигат за подстригване „Класик“',
    );
    expect(loyaltyOf({ words: ENGLISH, heldRewards: [] })?.sentence).toBe(
      'Enough for Free haircut',
    );
  });

  it('prints the figure alone when no reward is left to name, or the catalogue was not read', () => {
    const nothing = loyaltyOf({
      heldRewards: [
        'Безплатно подстригване',
        'Безплатно оформяне на брада',
        'Продукт по избор',
      ],
      vouchers: null,
      flags: { ...ALL_FLAGS, achievements: false, streaks: false },
    });
    expect(nothing).toEqual({
      figure: '358',
      unit: 'точки',
      sentence: null,
      holdings: [],
      accessibleName: 'Лоялност: 358 точки.',
    });
    expect(loyaltyOf({ catalog: null })).toMatchObject({
      figure: '358',
      sentence: null,
      accessibleName: NBSP_EURO(
        'Лоялност: 358 точки. Ваучер 25,00 €, печати 4 от 10, ритъм 24 посещения.',
      ),
    });
  });

  it('agrees the unit with the balance, groups a large one, and prints what is owed with the true minus', () => {
    expect(loyaltyOf({ account: accountWith({ balance: 1 }) })).toMatchObject({
      figure: '1',
      unit: 'точка',
    });
    expect(
      loyaltyOf({ account: accountWith({ balance: 12450 }) })?.figure,
    ).toBe('12 450');
    expect(
      loyaltyOf({ account: accountWith({ balance: -40 }), heldRewards: [] }),
    ).toMatchObject({
      figure: '−40',
      unit: 'точки',
      sentence: 'Още 160 до безплатно оформяне на брада',
    });
  });

  it('counts only the vouchers that still pay: active, not empty, not past their last day, as one sum', () => {
    const voucherFact = (vouchers: readonly GiftVoucher[] | null) =>
      loyaltyOf({ vouchers })?.holdings.find(
        (holding) => holding.id === 'voucher',
      )?.value;
    expect(voucherFact(GEORGI_VOUCHERS)).toBe(NBSP_EURO('25,00 €'));
    expect(
      voucherFact([
        ...GEORGI_VOUCHERS,
        voucherOf('voucher-dev-martin'),
        voucherOf('voucher-dev-five'),
      ]),
    ).toBe(NBSP_EURO('55,00 €'));
    expect(
      voucherFact([
        voucherOf('voucher-dev-georgi-spent'),
        voucherOf('voucher-dev-georgi-void'),
      ]),
    ).toBeUndefined();
    const lastDay = (iso: string) =>
      voucherOf('voucher-dev-georgi', {
        expiresAt: { iso, zone: 'Europe/Sofia' },
      });
    expect(voucherFact([lastDay('2026-09-27T23:59:59.999+03:00')])).toBe(
      undefined,
    );
    expect(voucherFact([lastDay('2026-09-28T23:59:59.999+03:00')])).toBe(
      NBSP_EURO('25,00 €'),
    );
    expect(voucherFact([])).toBeUndefined();
    expect(voucherFact(null)).toBeUndefined();
  });

  it('draws only the facts its flags and its data allow', () => {
    const ids = (overrides: Parameters<typeof loyaltyOf>[0]) =>
      loyaltyOf(overrides)?.holdings.map((holding) => holding.id);
    expect(ids({ flags: { ...ALL_FLAGS, achievements: false } })).toEqual([
      'voucher',
      'rhythm',
    ]);
    expect(ids({ flags: { ...ALL_FLAGS, streaks: false } })).toEqual([
      'voucher',
      'stamps',
    ]);
    expect(ids({ account: accountWith({ punchCards: [] }) })).toEqual([
      'voucher',
      'rhythm',
    ]);
    expect(ids({ account: accountWith({ streaks: {} }) })).toEqual([
      'voucher',
      'stamps',
    ]);
  });

  it('says no rhythm under a rule that is off, unknown, or another rhythm’s', () => {
    const rhythm = (ruleInForce: StreakDefinition | null) =>
      loyaltyOf({ ruleInForce })?.holdings.some(
        (holding) => holding.id === 'rhythm',
      );
    expect(rhythm(RULE)).toBe(true);
    expect(rhythm(ruleWith({ enabled: false }))).toBe(false);
    expect(rhythm(null)).toBe(false);
    expect(rhythm(ruleWith({ id: 'seasonal' }))).toBe(false);
  });

  it('says no rhythm for a run that was lost, and agrees a run of one', () => {
    const cadence = must(
      new Map(Object.entries(LOYALTY.account.streaks)).get('cadence'),
    );
    const run = (current: number) =>
      loyaltyOf({
        account: accountWith({ streaks: { cadence: { ...cadence, current } } }),
      });
    expect(run(0)?.holdings.map((holding) => holding.id)).toEqual([
      'voucher',
      'stamps',
    ]);
    expect(run(1)?.accessibleName).toBe(
      NBSP_EURO(
        'Лоялност: 358 точки. Стигат за безплатно оформяне на брада. Ваучер 25,00 €, печати 4 от 10, ритъм 1 посещение.',
      ),
    );
  });

  it('never zeroes a paused client’s values; the rhythm, frozen, is the wallet’s to say', () => {
    expect(loyaltyOf({ paused: true })).toMatchObject({
      figure: '358',
      unit: 'точки',
      sentence: 'Стигат за безплатно оформяне на брада',
      holdings: [
        { id: 'voucher', label: 'Ваучер', value: NBSP_EURO('25,00 €') },
        { id: 'stamps', label: 'Печати', value: '4 от 10' },
      ],
    });
  });

  it('leads with the first holding when `loyalty.points` is off, the line still naming it', () => {
    const flags = { ...ALL_FLAGS, points: false };
    expect(loyaltyOf({ flags })).toEqual({
      figure: NBSP_EURO('25,00 €'),
      unit: null,
      sentence: null,
      holdings: [
        { id: 'voucher', label: 'Ваучер', value: NBSP_EURO('25,00 €') },
        { id: 'stamps', label: 'Печати', value: '4 от 10' },
        { id: 'rhythm', label: 'Ритъм', value: '24' },
      ],
      accessibleName: NBSP_EURO(
        'Лоялност: ваучер 25,00 €, печати 4 от 10, ритъм 24 посещения.',
      ),
    });
    expect(loyaltyOf({ flags, vouchers: null })).toMatchObject({
      figure: '4 от 10',
      unit: null,
      accessibleName: 'Лоялност: печати 4 от 10, ритъм 24 посещения.',
    });
  });

  it('is absent with nothing to say', () => {
    expect(
      loyaltyOf({
        flags: {
          points: false,
          streaks: false,
          achievements: false,
          tiers: true,
        },
        vouchers: null,
      }),
    ).toBeNull();
    expect(
      loyaltyOf({
        flags: { ...ALL_FLAGS, points: false },
        account: accountWith({ punchCards: [], streaks: {} }),
        vouchers: [],
      }),
    ).toBeNull();
  });

  it('words the card in its language', () => {
    // The host words a grant in the card's language, as it words the card.
    expect(
      loyaltyOf({ words: ENGLISH, heldRewards: ['Free haircut'] }),
    ).toMatchObject({
      unit: 'points',
      sentence: 'Enough for Free beard trim',
      accessibleName:
        'Loyalty: 358 points. Enough for Free beard trim. Voucher €25.00, stamps 4 of 10, rhythm 24 visits.',
    });
  });
});

// ── G · «Постижения» ────────────────────────────────────────────────────

describe('«Постижения» (G)', () => {
  const settled = achievementsContextOf(georgiContext(), 'Георги Петров');
  const open = achievementsContextOf(georgiOpenContext(), 'Георги Петров');

  it('names three medals and captions none: the newest level, then the two closest', () => {
    const vm = must(medalsGlanceVm(LOYALTY, settled));
    expect(vm.levelCount).toBe(37);
    expect(
      vm.tiles.map((tile) => [
        tile.key,
        tile.opens,
        tile.medal.title,
        tile.medal.caption,
      ]),
    ).toEqual([
      ['series-rhythm', null, 'В ритъм', null],
      ['series-svc-fade', null, 'Фейд', null],
      ['series-self-service', null, 'Онлайн записване', null],
    ]);
  });

  it('draws each medal as the collection draws it, in its ring: one face on the glance and one push away', () => {
    for (const [data, ctx] of [
      [LOYALTY, settled],
      [LOYALTY, open],
      [
        MARTIN_LOYALTY,
        achievementsContextOf(martinContext(), 'Мартин Илиев', true),
      ],
    ] as const) {
      const vm = must(medalsGlanceVm(data, ctx));
      expect(vm.tiles).toHaveLength(3);
      for (const tile of vm.tiles) {
        const series = must(data.catalog.series(tile.key));
        expect(tile.medal).toEqual({
          ...medalRingVm(series, data, ctx, 'large'),
          caption: null,
        });
      }
    }
  });

  it('wears the ring’s four forms: a full ring, an arc between two thresholds, and nothing to reach', () => {
    const vm = must(medalsGlanceVm(LOYALTY, settled));
    expect(
      vm.tiles.map(({ medal }) => [medal.seriesId, medal.state, medal.level]),
    ).toEqual([
      // Every level won: the full ring under the top numeral.
      ['series-rhythm', 'complete', 'V'],
      ['series-svc-fade', 'earned', 'II'],
      ['series-self-service', 'earned', 'II'],
    ]);
    // 24 between II = 10 and III = 25: 14 of 15, not 24 of 25.
    expect(vm.tiles[1]?.medal).toMatchObject({
      src: 'https://example.test/covers/fade.jpg',
      value: 14 / 15,
      valueText: '24 от 25 до ниво III',
    });
    // 7 between II = 5 and III = 10.
    expect(vm.tiles[2]?.medal.value).toBe(0.4);
  });

  it('cues what is new once: no medal wears «Ново»', () => {
    const vm = must(medalsGlanceVm(LOYALTY, settled));
    expect(vm.cue).toBe('Ново: В ритъм, ниво\u00a0V');
    expect(vm.tiles.map((tile) => tile.medal.isNew)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('shows the medals and the cue of the built strip, slot for slot', () => {
    for (const ctx of [settled, open]) {
      const strip = medalStripVm(LOYALTY, ctx);
      const vm = must(medalsGlanceVm(LOYALTY, ctx));
      expect(vm.cue).toBe(strip.cue);
      expect(vm.tiles.map((tile) => tile.medal.seriesId)).toEqual(
        strip.medals.map((medal) => medal.seriesId),
      );
    }
  });

  it('leads with the family this very visit completes, its ring all but closed (only `complete` closes it, review 3 F8)', () => {
    const vm = must(medalsGlanceVm(LOYALTY, open));
    expect(vm.cue).toBe('С това посещение: Посещения, ниво\u00a0IV');
    expect(
      vm.tiles.map(({ medal }) => [medal.seriesId, medal.state, medal.value]),
    ).toEqual([
      ['series-visits', 'earned', PENDING_RING],
      ['series-rhythm', 'complete', 1],
      ['series-svc-fade', 'earned', PENDING_RING],
    ]);
    expect(vm.tiles[0]?.medal.valueText).toBe('Ниво\u00a0IV с това посещение');
  });

  it('puts Мартин’s birthday visit first with the pending face, and draws an ended season without an arc', () => {
    const vm = must(
      medalsGlanceVm(
        MARTIN_LOYALTY,
        achievementsContextOf(martinContext(), 'Мартин Илиев', true),
      ),
    );
    expect(vm.levelCount).toBe(28);
    // A single act has no levels: no «ниво I» (review 3, F9).
    expect(vm.cue).toBe('Рожден ден в салона с това посещение');
    expect(
      vm.tiles.map(({ medal }) => [medal.title, medal.state, medal.value]),
    ).toEqual([
      // Never the dashed silhouette: the one thing to say now.
      ['Рожден ден в салона', 'inProgress', PENDING_RING],
      // The season ended at II: nothing is left to be drawn towards.
      ['Лято 2026', 'earned', null],
      // 9 between II = 8 and III = 12.
      ['Цяла година', 'earned', 0.25],
    ]);
  });

  it('draws a single act done in a full ring with no numeral', () => {
    const welcome = must(LOYALTY.progress.get('series-welcome'));
    const vm = must(
      medalsGlanceVm(
        { ...LOYALTY, progress: new Map([['series-welcome', welcome]]) },
        settled,
      ),
    );
    expect(vm.levelCount).toBe(1);
    expect(vm.tiles[0]?.medal).toMatchObject({
      seriesId: 'series-welcome',
      title: 'Добре дошъл',
      state: 'complete',
      level: null,
      caption: null,
      isNew: false,
    });
  });

  it('draws the way to the first level from nought, and a family not started without an arc', () => {
    const weekend = must(LOYALTY.progress.get('series-weekend'));
    const welcome = must(LOYALTY.progress.get('series-welcome'));
    const vm = must(
      medalsGlanceVm(
        {
          ...LOYALTY,
          progress: new Map([
            ['series-welcome', welcome],
            ['series-weekend', weekend],
          ]),
        },
        settled,
      ),
    );
    const saturday = must(
      vm.tiles.find((tile) => tile.key === 'series-weekend'),
    ).medal;
    expect(saturday).toMatchObject({
      title: 'Съботен',
      state: 'inProgress',
      level: null,
      value: 2 / 3,
      valueText: '2 от 3 до ниво I',
    });
    for (const { medal } of vm.tiles) {
      if (medal.state === 'notStarted') expect(medal.value).toBeNull();
    }
  });

  it('says the first two records that exist as one quiet line, never the rhythm’s', () => {
    const vm = must(medalsGlanceVm(LOYALTY, settled));
    expect(vm.records).toEqual([
      { kind: 'favouriteService', label: 'Любима услуга', value: 'Фейд' },
      { kind: 'mostVisitsInYear', label: 'Най-много за година', value: '13' },
    ]);
    expect(vm.recordsName).toBe(
      'Рекорди: любима услуга Фейд, най-много за година 13',
    );
  });

  it('lets the first visit step in, skips a favourite it cannot name, and has no line without a record', () => {
    const recordsOf = (keep: (kind: string) => boolean, serviceId?: string) =>
      must(
        medalsGlanceVm(
          {
            ...LOYALTY,
            account: {
              ...LOYALTY.account,
              records: LOYALTY.account.records
                .filter((record) => keep(record.kind))
                .map((record) =>
                  record.kind === 'favouriteService' && serviceId !== undefined
                    ? { ...record, serviceId }
                    : record,
                ),
            },
          },
          settled,
        ),
      );
    expect(recordsOf((kind) => kind !== 'mostVisitsInYear')).toMatchObject({
      records: [
        { kind: 'favouriteService', label: 'Любима услуга', value: 'Фейд' },
        {
          kind: 'firstVisit',
          label: 'Първо посещение',
          value: '6.03.2025 г.',
        },
      ],
      recordsName: 'Рекорди: любима услуга Фейд, първо посещение 6.03.2025 г.',
    });
    expect(
      recordsOf(() => true, 'svc-gone').records.map((record) => record.kind),
    ).toEqual(['mostVisitsInYear', 'firstVisit']);
    expect(recordsOf((kind) => kind === 'longestRhythm')).toMatchObject({
      records: [],
      recordsName: null,
    });
  });

  it('is absent before the first earned level', () => {
    expect(
      medalsGlanceVm({ ...LOYALTY, progress: new Map() }, settled),
    ).toBeNull();
  });

  it('words the card in its language', () => {
    const vm = must(
      medalsGlanceVm(
        LOYALTY,
        achievementsContextOf(georgiContext(), 'Georgi Petrov', false, ENGLISH),
      ),
    );
    // The service's name is the shop's catalogue's, as the dashboard hands it.
    expect(vm.recordsName).toBe(
      'Records: favourite service Фейд, most in a year 13',
    );
    expect(vm.records.map((record) => record.label)).toEqual([
      'Favourite service',
      'Most in a year',
    ]);
  });
});
