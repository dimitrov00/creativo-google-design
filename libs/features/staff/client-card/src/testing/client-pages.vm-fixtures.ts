/**
 * TEST SUPPORT for `staff-client-card` — never part of the lib's build
 * (`tsconfig.lib.json` excludes `src/testing/**`), imported by specs only.
 *
 * HAND-BUILT view models of revision 3's pages (client-card-revision-3
 * §4.9), for the specs of the PRESENTATIONAL pieces: a card, a list, a
 * grid that takes a view model and draws it (`lib-birthday-card`,
 * `lib-loyalty-glance`, `lib-medals-glance`, `lib-wallet-holdings`,
 * `lib-rhythm-card`, `lib-activity-list`, `lib-record-card`,
 * `lib-achievement-chips`, …). Such a spec pins what is DRAWN for a given
 * model, so it takes the model as a value: no store, no reader, no clock.
 *
 * What these are NOT: the output of a presenter. A presenter's spec, the
 * store's and a page body's build their models from the book
 * (`client-card.fixtures.ts`) and read what comes out; nothing here may
 * stand in for that, and no figure here is a figure of the seed.
 *
 * The people are the dev shop's: Георги Петров, a Gold client since March
 * 2025 who comes every four weeks, and Мартин Илиев, in the chair on his
 * birthday. «Today» is Monday 28 September 2026, the lib's fixture day.
 * Every string is final copy in Bulgarian, as the catalogue words it.
 *
 * Plain data, no imports but types: a spec may spread a fixture and
 * change one field to reach a state (`{ ...PASS.georgi, frozen: true }`),
 * and the builders at the top do the same for the shapes that repeat.
 */
import type {
  VisitCardVm,
  VisitRowVm,
  VisitSectionVm,
} from '@creativo/features/shared/visits';
import type { UiMark, UiStreakPeriod } from '@creativo/ui/controls';
import type {
  AchievementChipVm,
  AchievementTileVm,
  ActivityGroupVm,
  ActivityRowVm,
  BirthdayVm,
  ClientHeroVm,
  ClientOverviewVm,
  ClientPhotoVm,
  CollectionVm,
  DetailHowVm,
  DetailLevelVm,
  EventCardVm,
  FeaturedRecordVm,
  GaugeVm,
  LedgerPageVm,
  LoyaltyGlanceVm,
  MedalDetailVm,
  MedalSectionVm,
  MedalVm,
  MedalsGlanceVm,
  MedalsPageVm,
  PassVm,
  QuickActionVm,
  RecordCardVm,
  RecordRowVm,
  RecordsPageVm,
  RewardReadyVm,
  RewardTileVm,
  SeasonCardVm,
  StampCardVm,
  VisitCardsVm,
  VisitsPageVm,
  VoucherVm,
  WalletActionVm,
  WalletHoldingVm,
  WalletRhythmVm,
  WalletTierVm,
  WalletVm,
} from '../lib/client-pages.vm';

// ── Builders for the shapes that repeat ─────────────────────────────────

/** A gauge over 0 … `max`, named and read by one sentence. */
export function gaugeOf(
  value: number,
  max: number,
  valueText: string,
  options: { readonly label?: string; readonly marks?: readonly UiMark[] } = {},
): GaugeVm {
  return {
    value,
    min: 0,
    max,
    marks: options.marks ?? [],
    label: options.label ?? valueText,
    valueText,
  };
}

/** A medal: not started, faceless and unnamed unless the spec says otherwise. */
export function medalOf(
  seriesId: string,
  overrides: Partial<MedalVm> = {},
): MedalVm {
  return {
    seriesId,
    state: 'notStarted',
    icon: 'loyalty.badge',
    src: null,
    monogram: null,
    level: null,
    title: null,
    caption: null,
    value: null,
    valueText: null,
    isNew: false,
    accessibleName: overrides.title ?? seriesId,
    ...overrides,
  };
}

/** A family's tile: a tap opens its detail. */
export function tileOf(medal: MedalVm): AchievementTileVm {
  return { key: medal.seriesId, medal, opens: null };
}

/** A staff row of the shared visits list: a worked visit with Иван, unless the spec says otherwise. */
export function visitRowOf(
  id: string,
  overrides: Partial<VisitRowVm> = {},
): VisitRowVm {
  return {
    id,
    kind: 'visit',
    startMs: Date.UTC(2026, 8, 5, 7),
    sectionKey: '2026-09',
    upcoming: false,
    tile: { caption: 'сб', day: 5, tone: 'past' },
    leadingIcon: null,
    title: 'Фейд',
    struck: false,
    lines: [{ text: 'Център · Иван', hold: ' · Иван' }],
    quote: null,
    trailing: {
      kind: 'barber',
      avatarSrc: null,
      name: 'Иван Колев',
      several: false,
    },
    trailingFact: {
      kind: 'amount',
      text: '17,50 €',
      emphasis: 'primary',
      struck: false,
    },
    marks: [],
    outcome: 'worked',
    status: 'completed',
    accessibleName: 'Фейд, 5 септември, Иван Колев, Център, 17,50 €',
    testId: `history-row-${id}`,
    ...overrides,
  };
}

// ── The medals every page draws ─────────────────────────────────────────

/** Георги's families, one per state the ring draws (§3.8). */
export const MEDALS = {
  /** Earned, a next level under way: the arc, the rim numeral. */
  fade: medalOf('service-fade', {
    state: 'earned',
    icon: 'loyalty.badge.service',
    monogram: 'Ф',
    level: 'II',
    title: 'Фейд',
    caption: '23/25 до III',
    value: 0.92,
    valueText: '23 от 25 до ниво III',
    accessibleName:
      'Фейд, ниво II, спечелено на 24 септември 2025 г., 23 от 25 до ниво III',
  }),
  /** Earned, high on its ladder. */
  withIvan: medalOf('barber-ivan', {
    state: 'earned',
    icon: 'loyalty.badge.barber',
    monogram: 'И',
    level: 'IV',
    title: 'С Иван',
    caption: '22/25 до V',
    value: 0.88,
    valueText: '22 от 25 до ниво V',
    accessibleName: 'С Иван, ниво IV, спечелено на 11 юли, 22 от 25 до ниво V',
  }),
  /** The running season's medal; this visit completes its next level. */
  autumn: medalOf('season-autumn-2026', {
    state: 'earned',
    icon: 'loyalty.badge.autumn',
    level: 'I',
    title: 'Есен 2026',
    caption: 'с това посещение',
    value: 1,
    valueText: 'Ниво II с това посещение',
    accessibleName: 'Есен 2026, ниво I, ниво II с това посещение',
  }),
  /** In progress to the first level: a partial arc, no numeral. */
  saturday: medalOf('weekend-saturday', {
    state: 'inProgress',
    icon: 'loyalty.badge.weekend',
    title: 'Съботен',
    caption: '2/3 до I',
    value: 2 / 3,
    valueText: '2 от 3 до ниво I',
    accessibleName: 'Съботен, 2 от 3 до ниво I',
  }),
  /** Every level won: the full ring. */
  welcome: medalOf('welcome', {
    state: 'complete',
    icon: 'loyalty.badge.welcome',
    level: 'I',
    title: 'Добре дошъл',
    caption: '1.03.2025',
    accessibleName: 'Добре дошъл, спечелено на 1 март 2025 г.',
  }),
  /** Not started: the dashed silhouette; the requirement is never hidden. */
  referral: medalOf('referral', {
    icon: 'loyalty.badge.referral',
    title: 'Препоръка',
    caption: '0/1 до I',
    accessibleName:
      'Препоръка, още не е започнато: приятел, дошъл по препоръка',
  }),
  /** A long title, broken inside the word at 330 if it must be. */
  explorer: medalOf('explorer', {
    state: 'inProgress',
    icon: 'loyalty.badge.explorer',
    title: 'Изследовател',
    caption: '2/4 до II',
    value: 0.5,
    valueText: '2 от 4 до ниво II',
    accessibleName: 'Изследовател, 2 от 4 до ниво II',
  }),
  /** Two words, two lines under the disc. */
  classicCut: medalOf('service-classic', {
    icon: 'loyalty.badge.service',
    monogram: 'К',
    title: 'Класическа подстрижка',
    caption: '0/3 до I',
    accessibleName:
      'Класическа подстрижка, още не е започнато: посещения с класическа подстрижка',
  }),
} satisfies Record<string, MedalVm>;

// ── The glance: the hero ────────────────────────────────────────────────

export const HERO = {
  /** A Gold client, a quarter of the way to Platinum. */
  georgi: {
    name: 'Георги Петров',
    // The facts' words held by no-break spaces, the joint hung on one:
    // the card's one grammar (`client-card.format.ts`), which the page
    // parts into the facts of a centred line of facts.
    line: [
      { text: 'Клиент от ', fact: false },
      { text: 'март\u00a02025\u00a0г.', fact: true },
      { text: '\u00a0· идва през ', fact: false },
      { text: '4\u00a0седмици', fact: true },
    ],
    tier: {
      name: 'Злато',
      progress: 0.125,
      accessibleName: 'Злато, още 7 посещения до Платина',
    },
    avatarSrc: null,
    initialsFrom: 'Георги Петров',
    paused: false,
  },
  /** The top tier: a full ring. */
  topTier: {
    name: 'Мартин Илиев',
    line: [
      { text: 'Клиент от ', fact: false },
      { text: 'май\u00a02024\u00a0г.', fact: true },
      { text: '\u00a0· идва през ', fact: false },
      { text: '3\u00a0седмици', fact: true },
    ],
    tier: {
      name: 'Платина',
      progress: 1,
      accessibleName: 'Платина, най-високият статус',
    },
    avatarSrc: 'media/avatars/martin.jpg',
    initialsFrom: 'Мартин Илиев',
    paused: false,
  },
  /** Paused: the warning ring takes the tier ring's place; the plate stays. */
  paused: {
    name: 'Георги Петров',
    line: [
      { text: 'Онлайн записването е спряно до ', fact: false },
      { text: '12.10', fact: true },
    ],
    tier: {
      name: 'Злато',
      progress: 0.125,
      accessibleName: 'Злато, още 7 посещения до Платина',
    },
    avatarSrc: null,
    initialsFrom: 'Георги Петров',
    paused: true,
  },
  /** Before the first worked visit; `loyalty.tiers` says Bronze, nothing under way. */
  firstVisit: {
    name: 'Калоян Димов',
    line: [{ text: 'Първо посещение', fact: false }],
    tier: {
      name: 'Бронз',
      progress: 0,
      accessibleName: 'Бронз, още 6 посещения до Сребро',
    },
    avatarSrc: null,
    initialsFrom: 'Калоян Димов',
    paused: false,
  },
  /** A walk-in without a profile: no ring, no plate. */
  guest: {
    name: 'Стоян',
    line: [{ text: 'Гост\u00a0· без профил', fact: false }],
    tier: null,
    avatarSrc: null,
    initialsFrom: 'Стоян',
    paused: false,
  },
  /** Three lines of 28 at 330. */
  longName: {
    name: 'Александър Константинов-Христов',
    line: [
      { text: 'Клиент от ', fact: false },
      { text: 'януари\u00a02024\u00a0г.', fact: true },
      { text: '\u00a0· идва през ', fact: false },
      { text: '6\u00a0седмици', fact: true },
    ],
    tier: {
      name: 'Сребро',
      progress: 0.5,
      accessibleName: 'Сребро, още 3 посещения до Злато',
    },
    avatarSrc: null,
    initialsFrom: 'Александър Константинов-Христов',
    paused: false,
  },
  /** At 0 ms: the seat's snapshot, before `users/{uid}` answers. */
  loading: {
    name: 'Георги Петров',
    line: null,
    tier: null,
    avatarSrc: null,
    initialsFrom: 'Георги Петров',
    paused: false,
  },
} satisfies Record<string, ClientHeroVm>;

// ── The glance: the birthday card ───────────────────────────────────────

const BIRTHDAY_GIFT: RewardReadyVm = {
  grantId: 'grant-birthday-2026',
  title: 'Рожден ден',
  value: '−20 %',
  detail: 'до 28.10',
  stack: null,
  applied: false,
  accessibleName: 'Рожден ден, −20 %, използвай',
  removeName: 'Премахни отстъпката: Рожден ден',
};

export const BIRTHDAY = {
  /** (a) The band over the gift's ticket: «Използвай». */
  gift: {
    kind: 'today',
    title: 'Рожден ден · 34 г.',
    gift: BIRTHDAY_GIFT,
    giftLabel: 'Подарък от салона',
    accessibleName:
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай',
  },
  /** (c) The gift on this visit's bill: stamped, «Премахни» where «Използвай» stood. */
  giftApplied: {
    kind: 'today',
    title: 'Рожден ден · 34 г.',
    gift: {
      ...BIRTHDAY_GIFT,
      applied: true,
      accessibleName: 'Рожден ден, −20 %, с това посещение',
    },
    giftLabel: 'Подарък от салона',
    accessibleName:
      'Рожден ден днес, навършва 34 години. Подарък: −20 %, с това посещение',
  },
  /** (b) The band alone: no gift held, a party member, offline, a paused client. */
  bandOnly: {
    kind: 'today',
    title: 'Рожден ден · 34 г.',
    gift: null,
    giftLabel: 'Подарък от салона',
    accessibleName: 'Рожден ден днес, навършва 34 години',
  },
  /** The year of birth is not on record: no age. */
  noAge: {
    kind: 'today',
    title: 'Рожден ден днес',
    gift: null,
    giftLabel: 'Подарък от салона',
    accessibleName: 'Рожден ден днес',
  },
  /** (d) Within the week: the quiet notice. */
  upcoming: {
    kind: 'upcoming',
    title: 'Рожден ден · петък, 2.10 · 34 г.',
    gift: null,
    giftLabel: 'Подарък от салона',
    accessibleName: 'Рожден ден · петък, 2.10 · 34 г.',
  },
} satisfies Record<string, BirthdayVm>;

// ── The glance: the visit cards ─────────────────────────────────────────

export const VISIT_CARD = {
  /** H1 — everything a last visit can carry: the figure, the quote, two thumbs. */
  last: {
    id: 'apt-2026-09-05',
    kind: 'last',
    label: 'Последно посещение',
    services: 'Фейд · Оформяне на брада',
    facts: [
      { text: '5.09', fact: true },
      { text: ' · Иван · Център', fact: false },
    ],
    figure: '27,50 €',
    quote: '„Къса отстрани, по-дълго отгоре“',
    capsule: null,
    barber: { name: 'Иван Колев', avatarSrc: null },
    photos: [
      {
        id: 'photo-0905-1',
        url: 'media/photos/0905-1.jpg',
        alt: 'Снимка от 5 септември',
      },
      {
        id: 'photo-0905-2',
        url: 'media/photos/0905-2.jpg',
        alt: 'Снимка от 5 септември',
      },
    ],
    accessibleName:
      'Последно посещение: Фейд · Оформяне на брада, 5 септември, Иван Колев, Център, 27,50 €, от клиента: „Къса отстрани, по-дълго отгоре“',
    testId: 'client-visit-last',
  },
  /** H1 at its least: the services and the facts. */
  lastBare: {
    id: 'apt-2026-08-08',
    kind: 'last',
    label: 'Последно посещение',
    services: 'Фейд',
    facts: [
      { text: '8.08', fact: true },
      { text: ' · Иван', fact: false },
    ],
    figure: '17,50 €',
    quote: null,
    capsule: null,
    barber: { name: 'Иван Колев', avatarSrc: null },
    photos: [],
    accessibleName: 'Последно посещение: Фейд, 8 август, Иван Колев, 17,50 €',
    testId: 'client-visit-last',
  },
  /** H2 — the time is the fact; the status is news. */
  next: {
    id: 'apt-2026-10-23',
    kind: 'next',
    label: 'Следващ час',
    services: 'Фейд',
    facts: [
      { text: 'пт, 23.10 · ', fact: false },
      { text: '10:00', fact: true },
      { text: ' · Иван', fact: false },
    ],
    figure: null,
    quote: null,
    capsule: { text: 'Потвърден', tone: 'accent' },
    barber: { name: 'Иван Колев', avatarSrc: null },
    photos: [],
    accessibleName:
      'Следващ час: Фейд, петък, 23 октомври, 10:00, Иван Колев, Потвърден',
    testId: 'client-visit-next',
  },
  /** H2, asked for and not yet confirmed; cut by two, so no face. */
  nextPending: {
    id: 'apt-2026-11-06',
    kind: 'next',
    label: 'Следващ час',
    services: 'Фейд · Оформяне на брада',
    facts: [
      { text: 'пт, 6.11 · ', fact: false },
      { text: '17:30', fact: true },
      { text: ' · Иван и Никола', fact: false },
    ],
    figure: null,
    quote: null,
    capsule: { text: 'Заявен', tone: 'neutral' },
    barber: null,
    photos: [],
    accessibleName:
      'Следващ час: Фейд · Оформяне на брада, петък, 6 ноември, 17:30, Иван Колев и Никола Стоев, Заявен',
    testId: 'client-visit-next',
  },
  /** H3 — a request waiting for a free slot: no capsule, no face, no figure. */
  waitlist: {
    id: 'waitlist-1',
    kind: 'waitlist',
    label: 'Чака свободен час',
    services: 'Класическа подстрижка',
    facts: [{ text: '8.10 – 9.10, следобед · още 1', fact: false }],
    figure: null,
    quote: null,
    capsule: null,
    barber: null,
    photos: [],
    accessibleName:
      'Класическа подстрижка, чака свободен час: четвъртък, 8 октомври и петък, 9 октомври, следобед · още 1',
    testId: 'client-visit-waitlist',
  },
  /** `/account`'s «Предстоящ час»: `increased`, no services line, no face. */
  accountUpcoming: {
    id: 'apt-2026-10-23',
    kind: 'next',
    label: 'Предстоящ час',
    services: 'Фейд',
    facts: [{ text: 'петък, 23 октомври · 10:00', fact: false }],
    figure: null,
    quote: null,
    capsule: { text: 'Потвърден', tone: 'accent' },
    barber: null,
    photos: [],
    accessibleName: 'Предстоящ час: Фейд, петък, 23 октомври, 10:00, Потвърден',
    testId: 'account-upcoming',
  },
} satisfies Record<string, VisitCardVm>;

export const VISIT_CARDS = {
  /** Every card. */
  full: {
    last: VISIT_CARD.last,
    next: VISIT_CARD.next,
    waitlist: VISIT_CARD.waitlist,
    count: 23,
  },
  /** The usual client: what we did last time, nothing booked. */
  lastOnly: {
    last: VISIT_CARD.lastBare,
    next: null,
    waitlist: null,
    count: 23,
  },
  /** A new client: no card; the heading's «0 ›» still pushes. */
  none: { last: null, next: null, waitlist: null, count: 0 },
} satisfies Record<string, VisitCardsVm>;

// ── The glance: loyalty, medals, photos, the overview ───────────────────

export const LOYALTY_GLANCE = {
  georgi: {
    figure: '371',
    unit: 'точки',
    sentence: 'Стигат за безплатно оформяне на брада',
    holdings: [
      { id: 'voucher', label: 'Ваучер', value: '25,00 €' },
      { id: 'stamps', label: 'Печати', value: '3 от 10' },
      { id: 'rhythm', label: 'Ритъм', value: '9' },
    ],
    accessibleName:
      'Лоялност: 371 точки. Стигат за безплатно оформяне на брада. Ваучер 25,00 €, печати 3 от 10, ритъм 9 посещения.',
  },
  /** Out of reach: how far the next reward is. */
  toNext: {
    figure: '78',
    unit: 'точки',
    sentence: 'Още 42 до безплатно оформяне на брада',
    holdings: [{ id: 'rhythm', label: 'Ритъм', value: '2' }],
    accessibleName:
      'Лоялност: 78 точки. Още 42 до безплатно оформяне на брада. Ритъм 2 посещения.',
  },
  /** `loyalty.points` off: the first holding leads as the figure. */
  pointsOff: {
    figure: '25,00 €',
    unit: null,
    sentence: null,
    holdings: [
      { id: 'voucher', label: 'Ваучер', value: '25,00 €' },
      { id: 'stamps', label: 'Печати', value: '3 от 10' },
    ],
    accessibleName: 'Лоялност: ваучер 25,00 €, печати 3 от 10.',
  },
  /** Welcome points and nothing held: no holdings line. */
  bare: {
    figure: '50',
    unit: 'точки',
    sentence: 'Още 70 до безплатно оформяне на брада',
    holdings: [],
    accessibleName:
      'Лоялност: 50 точки. Още 70 до безплатно оформяне на брада.',
  },
} satisfies Record<string, LoyaltyGlanceVm>;

/** The glance names its medals and captions none. */
function uncaptioned(medal: MedalVm): AchievementTileVm {
  return tileOf({ ...medal, caption: null });
}

export const MEDALS_GLANCE = {
  georgi: {
    levelCount: 38,
    tiles: [
      uncaptioned(MEDALS.fade),
      uncaptioned(MEDALS.withIvan),
      uncaptioned(MEDALS.autumn),
    ],
    cue: 'С това посещение: Есен 2026, ниво II',
    records: [
      { kind: 'favouriteService', label: 'Любима услуга', value: 'Фейд' },
      { kind: 'mostVisitsInYear', label: 'Най-много за година', value: '13' },
    ],
    recordsName: 'Рекорди: любима услуга Фейд, най-много за година 13',
  },
  /** One level earned, nothing to cue, no record yet. */
  first: {
    levelCount: 1,
    tiles: [uncaptioned(MEDALS.welcome)],
    cue: null,
    records: [],
    recordsName: null,
  },
} satisfies Record<string, MedalsGlanceVm>;

export const QUICK_ACTIONS = [
  {
    id: 'call',
    icon: 'contact.phone',
    label: 'Обади се',
    href: 'tel:+359881234567',
    accessibleName: 'Обади се на Георги Петров, +359 88 123 4567',
  },
  {
    id: 'sms',
    icon: 'contact.sms',
    label: 'SMS',
    href: 'sms:+359881234567',
    accessibleName: 'SMS до Георги Петров',
  },
  {
    id: 'viber',
    icon: 'contact.viber',
    label: 'Viber',
    href: 'viber://chat?number=%2B359881234567',
    accessibleName: 'Viber до Георги Петров',
  },
  {
    id: 'same',
    icon: 'visit.repeat',
    label: 'Повтори',
    href: null,
    accessibleName:
      'Повтори посещението от 5 септември: Фейд · Оформяне на брада',
    // A drawn disc needs no legs; a spec of the editor's hop builds real
    // ones from the book (`client-card.fixtures.ts`).
    legs: [],
  },
] as const satisfies readonly QuickActionVm[];

export const REWARD_READY = {
  /** E — the name says it: the ticket is the name alone. */
  haircut: {
    grantId: 'grant-haircut',
    title: 'Безплатно подстригване',
    value: null,
    detail: 'до 28.10',
    stack: null,
    applied: false,
    accessibleName: 'Безплатно подстригване, използвай',
    removeName: 'Премахни отстъпката: Безплатно подстригване',
  },
  /** A value of its own, two identical grants, another kind held too. */
  percent: {
    grantId: 'grant-percent',
    title: 'Отстъпка за редовен клиент',
    value: '−10 %',
    detail: 'до 31.12 · още 1',
    stack: '×2',
    applied: false,
    accessibleName: 'Отстъпка за редовен клиент, −10 %, използвай',
    removeName: 'Премахни отстъпката: Отстъпка за редовен клиент',
  },
  /** On this visit's bill: stamped where it stood. */
  applied: {
    grantId: 'grant-haircut',
    title: 'Безплатно подстригване',
    value: null,
    detail: 'до 28.10',
    stack: null,
    applied: true,
    accessibleName: 'Безплатно подстригване, с това посещение',
    removeName: 'Премахни отстъпката: Безплатно подстригване',
  },
} satisfies Record<string, RewardReadyVm>;

export const PHOTOS = [
  {
    photoId: 'photo-0808',
    appointmentId: 'apt-2026-08-08',
    url: 'media/photos/0808.jpg',
    takenAtIso: '2026-08-08T11:05:00+03:00',
    dateLabel: '8.08',
    accessibleName: 'Снимка от 8 август',
    barberId: 'barber-ivan',
    width: 1080,
    height: 1350,
  },
  {
    photoId: 'photo-0711',
    appointmentId: 'apt-2026-07-11',
    url: 'media/photos/0711.jpg',
    takenAtIso: '2026-07-11T10:50:00+03:00',
    dateLabel: '11.07',
    accessibleName: 'Снимка от 11 юли',
    barberId: 'barber-ivan',
    width: 1080,
    height: 1350,
  },
  {
    photoId: 'photo-0613',
    appointmentId: 'apt-2026-06-13',
    url: 'media/photos/0613.jpg',
    takenAtIso: '2026-06-13T10:45:00+03:00',
    dateLabel: '13.06',
    accessibleName: 'Снимка от 13 юни',
    barberId: 'barber-ivan',
    width: null,
    height: null,
  },
] as const satisfies readonly ClientPhotoVm[];

export const OVERVIEW = {
  /** Every module present and read. */
  georgi: {
    actions: QUICK_ACTIONS,
    reward: { status: 'ready', data: REWARD_READY.haircut },
    visits: { status: 'ready', data: VISIT_CARDS.full },
    loyalty: { status: 'ready', data: LOYALTY_GLANCE.georgi },
    medals: { status: 'ready', data: MEDALS_GLANCE.georgi },
    photos: { status: 'ready', data: PHOTOS },
    canRemove: true,
    failed: [],
  },
  /** Мартин, in the chair on his birthday; two no-shows in ninety days. */
  birthday: {
    capsules: {
      status: 'ready',
      data: {
        shown: [
          {
            id: 'noShows',
            text: '2 неявявания',
            tone: 'warning',
            icon: null,
          },
        ],
        more: null,
      },
    },
    birthday: BIRTHDAY.gift,
    actions: QUICK_ACTIONS,
    visits: { status: 'ready', data: VISIT_CARDS.lastOnly },
    loyalty: { status: 'ready', data: LOYALTY_GLANCE.toNext },
    medals: { status: 'ready', data: MEDALS_GLANCE.first },
    canRemove: true,
    failed: [],
  },
  /** Behind the D-9 gate: the discs at once, every module a placeholder. */
  loading: {
    actions: QUICK_ACTIONS.slice(0, 3),
    reward: { status: 'loading' },
    visits: { status: 'loading' },
    loyalty: { status: 'loading' },
    medals: { status: 'loading' },
    photos: { status: 'loading' },
    canRemove: true,
    failed: [],
  },
  /** A new client: three discs, the welcome points, no medals, no photos. */
  newClient: {
    actions: QUICK_ACTIONS.slice(0, 3),
    visits: { status: 'ready', data: VISIT_CARDS.none },
    loyalty: { status: 'ready', data: LOYALTY_GLANCE.bare },
    canRemove: true,
    failed: [],
  },
  /** One module failed: its heading over «Опитай пак». */
  oneFailed: {
    actions: QUICK_ACTIONS,
    visits: { status: 'ready', data: VISIT_CARDS.lastOnly },
    loyalty: { status: 'failed' },
    medals: { status: 'ready', data: MEDALS_GLANCE.georgi },
    canRemove: true,
    failed: ['loyalty'],
  },
  /** Two failed: one notice under the head, the headings alone. */
  twoFailed: {
    actions: QUICK_ACTIONS,
    visits: { status: 'failed' },
    loyalty: { status: 'failed' },
    medals: { status: 'failed' },
    canRemove: true,
    failed: ['visits', 'loyalty', 'achievements'],
  },
  /** A guest with a phone on the seat: the discs and the exit, nothing else. */
  guest: {
    actions: QUICK_ACTIONS.slice(0, 3),
    canRemove: true,
    failed: [],
  },
} satisfies Record<string, ClientOverviewVm>;

// ── «Лоялност»: the wallet ──────────────────────────────────────────────

export const PASS = {
  georgi: {
    figure: '371',
    unit: 'точки',
    holder: 'Георги Петров',
    tier: 'Злато',
    since: 'Клиент от март 2025 г.',
    state: null,
    frozen: false,
    accessibleName:
      'Карта за лоялност: Георги Петров, Злато, 371 точки за размяна, клиент от март 2025 г.',
  },
  /** The state line says something: points about to expire. */
  expiring: {
    figure: '371',
    unit: 'точки',
    holder: 'Георги Петров',
    tier: 'Злато',
    since: 'Клиент от март 2025 г.',
    state: '40 т. изтичат на 31.12',
    frozen: false,
    accessibleName:
      'Карта за лоялност: Георги Петров, Злато, 371 точки за размяна, клиент от март 2025 г.',
  },
  /** Owes points: primary ink, never red. */
  owes: {
    figure: '−40',
    unit: 'точки',
    holder: 'Георги Петров',
    tier: 'Сребро',
    since: 'Клиент от март 2025 г.',
    state: 'дължи 40 точки',
    frozen: false,
    accessibleName:
      'Карта за лоялност: Георги Петров, Сребро, дължи 40 точки, клиент от март 2025 г.',
  },
  /** A paused client: the pass desaturates whole, nothing is zeroed. */
  frozen: {
    figure: '371',
    unit: 'точки',
    holder: 'Георги Петров',
    tier: 'Злато',
    since: 'Клиент от март 2025 г.',
    state: 'Замразено',
    frozen: true,
    accessibleName:
      'Карта за лоялност: Георги Петров, Злато, 371 точки за размяна, клиент от март 2025 г.',
  },
  /** `loyalty.points` and `loyalty.tiers` off: the tier's count, no plate. */
  pointsOff: {
    figure: '13',
    unit: 'посещения',
    holder: 'Георги Петров',
    tier: null,
    since: 'Клиент от март 2025 г.',
    state: null,
    frozen: false,
    accessibleName:
      'Карта за лоялност: Георги Петров, 13 посещения, клиент от март 2025 г.',
  },
  /** The holder takes two lines in the foot. */
  longName: {
    figure: '1 250',
    unit: 'точки',
    holder: 'Александър Константинов-Христов',
    tier: 'Платина',
    since: 'Клиент от януари 2024 г.',
    state: '40 т. изтичат на 31.12',
    frozen: false,
    accessibleName:
      'Карта за лоялност: Александър Константинов-Христов, Платина, 1 250 точки за размяна, клиент от януари 2024 г.',
  },
} satisfies Record<string, PassVm>;

export const VOUCHER = {
  /** Drawn from: what it was issued for and its validity are the ONE chip. */
  partial: {
    voucherId: 'voucher-1',
    title: 'Ваучер за подарък',
    balance: '25,00 €',
    detail: 'от 50,00 € · до 31.12',
    accessibleName:
      'Ваучер за подарък: 25,00 € от 50,00 €, важи до 31 декември',
  },
  /** Never expires. */
  open: {
    voucherId: 'voucher-2',
    title: 'Ваучер за подарък',
    balance: '30,00 €',
    detail: 'от 30,00 €',
    accessibleName: 'Ваучер за подарък: 30,00 € от 30,00 €',
  },
} satisfies Record<string, VoucherVm>;

const WALLET_ACTION = {
  use: {
    id: 'use',
    icon: 'promo.coupon',
    label: 'Използвай',
    prominence: 'accent',
    accessibleName: 'Използвай награда на това посещение',
    grantId: 'grant-haircut',
    count: null,
  },
  useSeveral: {
    id: 'use',
    icon: 'promo.coupon',
    label: 'Използвай',
    prominence: 'accent',
    accessibleName: 'Използвай награда на това посещение, 3 награди',
    grantId: null,
    count: 3,
  },
  code: {
    id: 'code',
    icon: 'loyalty.enterCode',
    label: 'Код',
    prominence: 'standard',
    accessibleName: 'Код: въведи или сканирай',
    grantId: null,
    count: null,
  },
  catalog: {
    id: 'catalog',
    icon: 'loyalty.reward',
    label: 'Награди',
    prominence: 'standard',
    accessibleName: 'Награди за точки',
    grantId: null,
    count: null,
  },
  history: {
    id: 'history',
    icon: 'loyalty.ledger',
    label: 'История',
    prominence: 'standard',
    accessibleName: 'История на движението',
    grantId: null,
    count: null,
  },
} satisfies Record<string, WalletActionVm>;

export const WALLET_ACTIONS = {
  /** The owner's card, online, one ready ticket: four discs. */
  owner: [
    WALLET_ACTION.use,
    WALLET_ACTION.code,
    WALLET_ACTION.catalog,
    WALLET_ACTION.history,
  ],
  /** Several ready tickets: the count on the promoted disc. */
  several: [
    WALLET_ACTION.useSeveral,
    WALLET_ACTION.code,
    WALLET_ACTION.catalog,
    WALLET_ACTION.history,
  ],
  /** A party member, offline, a gone visit: the run closes up to two. */
  readOnly: [WALLET_ACTION.catalog, WALLET_ACTION.history],
  /** `loyalty.points` off on the owner's card: the code alone. */
  codeOnly: [WALLET_ACTION.code],
} satisfies Record<string, readonly WalletActionVm[]>;

export const STAMP_CARD: StampCardVm = {
  ruleId: 'punch-haircut',
  title: 'Безплатно подстригване',
  figure: '3 от 10',
  gauge: gaugeOf(3, 10, '3 от 10 печата, още 7 до безплатно подстригване', {
    label: 'Карта с печати',
  }),
  sentence: 'Още 7 посещения',
};

export const WALLET_HOLDINGS = {
  /** In the wallet's order: the voucher, the ticket, the stamp card. */
  georgi: [
    { kind: 'voucher', voucher: VOUCHER.partial },
    { kind: 'ticket', ticket: REWARD_READY.haircut },
    {
      kind: 'stamps',
      card: STAMP_CARD,
      line: '10 печата за безплатно подстригване',
    },
  ],
  /** Two vouchers: the heading's detail carries their sum. */
  vouchers: [
    { kind: 'voucher', voucher: VOUCHER.partial },
    { kind: 'voucher', voucher: VOUCHER.open },
    { kind: 'ticket', ticket: REWARD_READY.applied },
  ],
  /** Nothing held: «Портфейлът е празен.» */
  empty: [],
} satisfies Record<string, readonly WalletHoldingVm[]>;

const RHYTHM_PERIODS: readonly UiStreakPeriod[] = [
  {
    id: '2026-05',
    mark: 'kept',
    caption: 'май',
    description: 'май · посещение 16 май',
  },
  {
    id: '2026-06',
    mark: 'kept',
    caption: 'юни',
    description: 'юни · посещение 13 юни',
  },
  {
    id: '2026-07',
    mark: 'kept',
    caption: 'юли',
    description: 'юли · посещение 11 юли',
  },
  {
    id: '2026-08',
    mark: 'kept',
    caption: 'авг.',
    description: 'август · посещение 8 август',
  },
  {
    id: '2026-09',
    mark: 'kept',
    caption: 'септ.',
    description: 'септември · посещение 5 септември',
  },
  // The open mark is uncaptioned: the state line names its date.
  {
    id: 'current',
    mark: 'current',
    caption: '',
    description: 'текущ период · до 10 ноември',
  },
];

const RULE_FULL: readonly string[] = [
  'Посещение на всеки 6 седмици пази ритъма.',
  '7 дни гратис след срока.',
  'До 2 защити покриват пропуснат срок; нова на всеки 5 посещения в ритъм.',
  'Час, отменен от салона, не се брои за пропуск.',
  'Записан час до 14 дни след срока пази ритъма.',
  'След прекъсване посещение до 14 дни връща ритъма.',
];

export const WALLET_RHYTHM = {
  /** Healthy: the figure and the track say it; no capsule. */
  healthy: {
    figure: '9',
    unit: 'посещения в ритъм',
    phase: null,
    periods: RHYTHM_PERIODS,
    trackName: '9 посещения в ритъм, най-много 23, следващото до 10 ноември',
    stateLine: 'Следващото посещение до 10.11 пази ритъма.',
    best: 'Най-много: 23',
    protections: 'Автоматични защити: 2',
    ruleLine: 'На всеки 6 седмици · 7 дни гратис',
    ruleFull: RULE_FULL,
    ruleUpcoming: null,
    frozen: false,
  },
  /** The due date is near: the warning capsule beside the figure. */
  atRisk: {
    figure: '9',
    unit: 'посещения в ритъм',
    phase: { text: 'До 10.11', tone: 'warning' },
    periods: RHYTHM_PERIODS,
    trackName: '9 посещения в ритъм, най-много 23, следващото до 10 ноември',
    stateLine: 'Последно преди 5 седмици · посещение до 10.11 пази ритъма.',
    best: 'Най-много: 23',
    protections: null,
    ruleLine: 'На всеки 6 седмици · 7 дни гратис',
    ruleFull: RULE_FULL,
    ruleUpcoming: 'От 1.10: На всеки 5 седмици · 7 дни гратис',
    frozen: false,
  },
  /** A booking holds the due date. */
  held: {
    figure: '9',
    unit: 'посещения в ритъм',
    phase: { text: 'Записан за 29.10', tone: 'neutral' },
    periods: RHYTHM_PERIODS,
    trackName: '9 посещения в ритъм, най-много 23',
    stateLine: 'Записан е за 29.10 · срокът се пази.',
    best: 'Най-много: 23',
    protections: null,
    ruleLine: 'На всеки 6 седмици · 7 дни гратис',
    ruleFull: RULE_FULL,
    ruleUpcoming: null,
    frozen: false,
  },
  /** A first run of one: the singular, no best, no grace in the rule. */
  first: {
    figure: '1',
    unit: 'посещение в ритъм',
    phase: null,
    periods: RHYTHM_PERIODS.slice(4),
    trackName: '1 посещение в ритъм, следващото до 10 ноември',
    stateLine: 'Следващото посещение до 10.11 пази ритъма.',
    best: null,
    protections: null,
    ruleLine: 'На всеки 6 седмици',
    ruleFull: RULE_FULL.slice(0, 1),
    ruleUpcoming: null,
    frozen: false,
  },
  /** A paused client: the card draws frozen, its values kept. */
  frozen: {
    figure: '9',
    unit: 'посещения в ритъм',
    phase: null,
    periods: RHYTHM_PERIODS,
    trackName: '9 посещения в ритъм, най-много 23',
    stateLine: 'Замразено, докато записването е спряно',
    best: 'Най-много: 23',
    protections: null,
    ruleLine: 'На всеки 6 седмици · 7 дни гратис',
    ruleFull: RULE_FULL,
    ruleUpcoming: null,
    frozen: true,
  },
} satisfies Record<string, WalletRhythmVm>;

const TIER_MARKS: readonly UiMark[] = [
  { value: 0, label: 'Бронз' },
  { value: 6, label: 'Сребро' },
  { value: 12, label: 'Злато' },
  { value: 20, label: 'Платина' },
];

export const WALLET_TIER = {
  /** Gold, thirteen visits in twelve months: seven to Platinum. */
  gold: {
    ring: gaugeOf(1, 8, 'Злато, 13 посещения за 12 месеца, още 7 до Платина', {
      label: 'Статус',
    }),
    remaining: '7',
    line1: 'до Платина',
    line2: '13 посещения за 12 месеца',
    steps: gaugeOf(
      13,
      20,
      'Злато, 13 посещения за 12 месеца, още 7 до Платина',
      { label: 'Статус', marks: TIER_MARKS },
    ),
    accessibleName: 'Злато, 13 посещения за 12 месеца, още 7 до Платина',
  },
  /** The top: a full ring holding the check, the keeping rule under it. */
  top: {
    ring: gaugeOf(
      1,
      1,
      'Най-високият статус · запазва се с 20 посещения за 12 месеца',
      { label: 'Статус' },
    ),
    remaining: null,
    line1: 'Най-високият статус',
    line2: 'Запазва се с 20 посещения за 12 месеца',
    steps: gaugeOf(
      20,
      20,
      'Най-високият статус · запазва се с 20 посещения за 12 месеца',
      { label: 'Статус', marks: TIER_MARKS },
    ),
    accessibleName:
      'Най-високият статус · запазва се с 20 посещения за 12 месеца',
  },
} satisfies Record<string, WalletTierVm>;

export const REWARD_TILES = [
  {
    rewardId: 'reward-beard',
    title: 'Безплатно оформяне на брада',
    cost: '120 т.',
    affordable: true,
    missing: null,
    progress: null,
    src: 'media/services/beard.jpg',
    accessibleName: 'Безплатно оформяне на брада, 120 точки',
  },
  {
    rewardId: 'reward-haircut',
    title: 'Безплатно подстригване',
    cost: '250 т.',
    affordable: true,
    missing: null,
    progress: null,
    src: null,
    accessibleName: 'Безплатно подстригване, 250 точки',
  },
  {
    rewardId: 'reward-product',
    title: 'Продукт по избор',
    cost: '400 т.',
    affordable: false,
    missing: 'още 29 т.',
    progress: 0.9275,
    src: null,
    accessibleName: 'Продукт по избор, 400 точки, още 29',
  },
] as const satisfies readonly RewardTileVm[];

/** One row per kind of §2.2.5, for the list's glyphs, inks and trailing edge. */
export const ACTIVITY_ROW = {
  visit: {
    entryId: 'entry-0905-visit',
    icon: 'loyalty.activity.visit',
    tone: 'accent',
    title: 'Фейд · Оформяне на брада',
    lines: [{ text: '5.09 · Иван' }],
    struck: false,
    amount: '+27 т.',
    balanceAfter: '371 т.',
    accessibleName:
      'Спечелени, Посещение: Фейд · Оформяне на брада, 5 септември, +27 т.',
  },
  level: {
    entryId: 'entry-0301-level',
    icon: 'loyalty.activity.level',
    tone: 'accent',
    title: 'Години с нас I',
    lines: [{ text: '1.03 · постижение' }],
    struck: false,
    amount: '+20 т.',
    balanceAfter: '198 т.',
    accessibleName: 'Бонус, Постижение: Години с нас I, 1 март, +20 т.',
  },
  /** A level that paid no points: no amount, no balance. */
  levelBare: {
    entryId: 'entry-0924-level',
    icon: 'loyalty.activity.level',
    tone: 'accent',
    title: 'Фейд II',
    lines: [{ text: '24.09.2025 г. · постижение' }],
    struck: false,
    amount: null,
    balanceAfter: null,
    accessibleName: 'Постижение: Фейд II, 24 септември 2025 г.',
  },
  redeemed: {
    entryId: 'entry-0620-redeemed',
    icon: 'loyalty.activity.redeemed',
    tone: 'neutral',
    title: 'Безплатно подстригване',
    lines: [{ text: '20.06 · размяна' }],
    struck: false,
    amount: '−250 т.',
    balanceAfter: '292 т.',
    accessibleName:
      'Използвани, Размяна: Безплатно подстригване, 20 юни, −250 т.',
  },
  granted: {
    entryId: 'entry-0516-granted',
    icon: 'loyalty.activity.granted',
    tone: 'accent',
    title: 'Отстъпка за редовен клиент',
    lines: [{ text: '16.05 · получена награда' }],
    struck: false,
    amount: null,
    balanceAfter: null,
    accessibleName: 'Получена награда, Отстъпка за редовен клиент, 16 май',
  },
  tier: {
    entryId: 'entry-0902-tier',
    icon: 'loyalty.activity.tier',
    tone: 'accent',
    title: 'Статус: Злато',
    lines: [{ text: '2.09 · от Сребро' }],
    struck: false,
    amount: null,
    balanceAfter: null,
    accessibleName: 'Нов статус, Статус: Злато, 2 септември, от Сребро',
  },
  adjusted: {
    entryId: 'entry-0418-goodwill',
    icon: 'loyalty.activity.adjusted',
    tone: 'neutral',
    title: 'Бонус от салона',
    lines: [{ text: '18.04' }],
    struck: false,
    amount: '+30 т.',
    balanceAfter: '228 т.',
    accessibleName: 'Бонус, Бонус от салона, 18 април, +30 т.',
  },
  expired: {
    entryId: 'entry-1231-expired',
    icon: 'loyalty.activity.expired',
    tone: 'neutral',
    title: 'Изтекли',
    lines: [{ text: '31.12.2025 г.' }],
    struck: false,
    amount: '−40 т.',
    balanceAfter: '131 т.',
    accessibleName: 'Изтекли, 31 декември 2025 г., −40 т.',
  },
  reversal: {
    entryId: 'entry-0405-reversal',
    icon: 'loyalty.activity.reversed',
    tone: 'neutral',
    title: 'Анулирано',
    lines: [{ text: 'отменя запис от 4.04 · 5.04' }],
    struck: false,
    amount: '−17 т.',
    balanceAfter: '198 т.',
    accessibleName: 'Анулирано, отменя запис от 4 април, 5 април, −17 т.',
  },
  /** The row a later entry reversed: struck. */
  reversed: {
    entryId: 'entry-0404-visit',
    icon: 'loyalty.activity.visit',
    tone: 'accent',
    title: 'Фейд',
    lines: [{ text: '4.04 · Иван' }],
    struck: true,
    amount: '+17 т.',
    balanceAfter: '215 т.',
    accessibleName: 'Спечелени, Посещение: Фейд, 4 април, +17 т., отменено',
  },
} satisfies Record<string, ActivityRowVm>;

const ACTIVITY_AUGUST: ActivityRowVm = {
  entryId: 'entry-0808-visit',
  icon: 'loyalty.activity.visit',
  tone: 'accent',
  title: 'Фейд',
  lines: [{ text: '8.08 · Иван' }],
  struck: false,
  amount: '+17 т.',
  balanceAfter: '344 т.',
  accessibleName: 'Спечелени, Посещение: Фейд, 8 август, +17 т.',
};

const ACTIVITY_JULY: ActivityRowVm = {
  entryId: 'entry-0711-visit',
  icon: 'loyalty.activity.visit',
  tone: 'accent',
  title: 'Фейд · Оформяне на брада',
  lines: [{ text: '11.07 · Иван и Никола' }],
  struck: false,
  amount: '+35 т.',
  balanceAfter: '327 т.',
  accessibleName:
    'Спечелени, Посещение: Фейд · Оформяне на брада, 11 юли, +35 т.',
};

export const ACTIVITY_GROUPS = {
  /** The wallet's feed: the newest five events; the oldest month is cut, so it prints no net. */
  newestFive: [
    {
      key: '2026-09',
      label: 'Септември 2026 г.',
      net: '+27 т.',
      rows: [ACTIVITY_ROW.visit, ACTIVITY_ROW.tier],
    },
    {
      key: '2026-08',
      label: 'Август 2026 г.',
      net: '+17 т.',
      rows: [ACTIVITY_AUGUST],
    },
    {
      key: '2026-07',
      label: 'Юли 2026 г.',
      net: '+35 т.',
      rows: [ACTIVITY_JULY],
    },
    {
      key: '2026-06',
      label: 'Юни 2026 г.',
      net: null,
      rows: [ACTIVITY_ROW.redeemed],
    },
  ],
  /** Every kind, a reversal and the row it struck among them. */
  everyKind: [
    {
      key: '2026-04',
      label: 'Април 2026 г.',
      net: '+30 т.',
      rows: [
        ACTIVITY_ROW.adjusted,
        ACTIVITY_ROW.reversal,
        ACTIVITY_ROW.reversed,
      ],
    },
    {
      key: '2026-03',
      label: 'Март 2026 г.',
      net: '+20 т.',
      rows: [ACTIVITY_ROW.level, ACTIVITY_ROW.granted],
    },
    {
      key: '2025-12',
      label: 'Декември 2025 г.',
      net: '−40 т.',
      rows: [ACTIVITY_ROW.expired],
    },
    {
      key: '2025-09',
      label: 'Септември 2025 г.',
      net: null,
      rows: [ACTIVITY_ROW.levelBare],
    },
  ],
  /** Under a filter, the one kind: «Статус». */
  statusOnly: [
    {
      key: '2026-09',
      label: 'Септември 2026 г.',
      net: null,
      rows: [ACTIVITY_ROW.tier],
    },
  ],
} satisfies Record<string, readonly ActivityGroupVm[]>;

export const WALLET = {
  /** The owner's card, every section present and read. */
  georgi: {
    frozen: false,
    pass: PASS.expiring,
    actions: WALLET_ACTIONS.owner,
    holdings: { status: 'ready', data: WALLET_HOLDINGS.georgi },
    holdingsDetail: '3',
    rhythm: WALLET_RHYTHM.healthy,
    tier: { status: 'ready', data: WALLET_TIER.gold },
    catalog: {
      status: 'ready',
      data: {
        name: 'Награди за точки: 371 точки, стигат за 2 от 3 награди',
        tiles: REWARD_TILES,
      },
    },
    activity: { status: 'ready', data: ACTIVITY_GROUPS.newestFive },
  },
  /** The account at once, the sections that ride a read of their own still on their way. */
  loading: {
    frozen: false,
    pass: PASS.georgi,
    actions: WALLET_ACTIONS.owner,
    holdings: { status: 'loading' },
    holdingsDetail: null,
    rhythm: WALLET_RHYTHM.healthy,
    tier: { status: 'loading' },
    catalog: { status: 'loading' },
    activity: { status: 'loading' },
  },
  /** An account with nothing held and no entry yet. */
  empty: {
    frozen: false,
    pass: { ...PASS.georgi, figure: '50', tier: 'Бронз', state: null },
    actions: WALLET_ACTIONS.readOnly,
    holdings: { status: 'ready', data: WALLET_HOLDINGS.empty },
    holdingsDetail: null,
    tier: { status: 'ready', data: WALLET_TIER.gold },
    catalog: {
      status: 'ready',
      data: {
        name: 'Награди за точки: 50 точки, стигат за 0 от 3 награди',
        tiles: REWARD_TILES,
      },
    },
  },
  /** A paused client: frozen whole, no tickets, no verbs that write. */
  paused: {
    frozen: true,
    pass: PASS.frozen,
    actions: WALLET_ACTIONS.readOnly,
    holdings: {
      status: 'ready',
      data: [{ kind: 'voucher', voucher: VOUCHER.partial }],
    },
    holdingsDetail: '1',
    rhythm: WALLET_RHYTHM.frozen,
    tier: { status: 'ready', data: WALLET_TIER.gold },
    activity: { status: 'ready', data: ACTIVITY_GROUPS.newestFive },
  },
  /** Two sections' own reads failed: each keeps its heading over a notice. */
  sectionsFailed: {
    frozen: false,
    pass: PASS.georgi,
    actions: WALLET_ACTIONS.owner,
    holdings: { status: 'failed' },
    holdingsDetail: null,
    rhythm: WALLET_RHYTHM.healthy,
    tier: { status: 'ready', data: WALLET_TIER.gold },
    catalog: { status: 'failed' },
    activity: { status: 'failed' },
  },
  /** Every loyalty flag but the vouchers' off: the pass, the holdings. */
  flagsOff: {
    frozen: false,
    pass: PASS.pointsOff,
    actions: WALLET_ACTIONS.codeOnly,
    holdings: { status: 'ready', data: WALLET_HOLDINGS.vouchers },
    holdingsDetail: '3 · 55,00 €',
  },
} satisfies Record<string, WalletVm>;

const LEDGER_SUBLINE = [
  { text: 'Георги Петров · ', fact: false },
  { text: '371 т.', fact: true },
] as const;

export const LEDGER_PAGE = {
  /** The first page, an older one waiting. */
  first: {
    status: 'ready',
    subline: LEDGER_SUBLINE,
    filter: 'all',
    groups: ACTIVITY_GROUPS.newestFive,
    paging: { kind: 'more' },
  },
  /** Every page read: «Това е всичко.» */
  whole: {
    status: 'ready',
    subline: LEDGER_SUBLINE,
    filter: 'all',
    groups: [...ACTIVITY_GROUPS.newestFive, ...ACTIVITY_GROUPS.everyKind],
    paging: { kind: 'end' },
  },
  /** A page on its way, and one that did not come. */
  loadingMore: {
    status: 'ready',
    subline: LEDGER_SUBLINE,
    filter: 'all',
    groups: ACTIVITY_GROUPS.newestFive,
    paging: { kind: 'loading' },
  },
  failedMore: {
    status: 'ready',
    subline: LEDGER_SUBLINE,
    filter: 'all',
    groups: ACTIVITY_GROUPS.newestFive,
    paging: { kind: 'failed' },
  },
  /** Narrowed to one kind. */
  status: {
    status: 'ready',
    subline: LEDGER_SUBLINE,
    filter: 'status',
    groups: ACTIVITY_GROUPS.statusOnly,
    paging: { kind: 'end' },
  },
  /** A kind nothing answers: «Няма записи от този вид.» */
  filteredEmpty: {
    status: 'ready',
    subline: LEDGER_SUBLINE,
    filter: 'rewards',
    groups: [],
    paging: { kind: 'end' },
  },
  /** No entry yet: «Още няма движение.» */
  empty: {
    status: 'ready',
    subline: [
      { text: 'Калоян Димов · ', fact: false },
      { text: '0 т.', fact: true },
    ],
    filter: 'all',
    groups: [],
    paging: { kind: 'end' },
  },
  loading: {
    status: 'loading',
    subline: LEDGER_SUBLINE,
    filter: 'all',
    groups: [],
    paging: null,
  },
  failed: {
    status: 'failed',
    subline: LEDGER_SUBLINE,
    filter: 'all',
    groups: [],
    paging: null,
  },
} satisfies Record<string, LedgerPageVm>;

// ── «Постижения» and «Рекорди» ──────────────────────────────────────────

export const ACHIEVEMENT_CHIPS = [
  { id: 'all', label: 'Всички', accessibleName: 'Всички' },
  {
    id: 'milestones',
    label: 'Етапи',
    accessibleName: 'Етапи, 3 от 5 спечелени',
  },
  {
    id: 'mastery',
    label: 'Майсторство',
    accessibleName: 'Майсторство, 3 от 9 спечелени',
  },
  {
    id: 'barbers',
    label: 'Бръснари',
    accessibleName: 'Бръснари и салони, 4 от 6 спечелени',
  },
  { id: 'rhythm', label: 'Ритъм', accessibleName: 'Ритъм, 2 от 4 спечелени' },
  {
    id: 'special',
    label: 'Специални',
    accessibleName: 'Специални, 4 от 12 спечелени',
  },
  { id: 'seasons', label: 'Сезони', accessibleName: 'Сезони' },
] as const satisfies readonly AchievementChipVm[];

export const RECORD_CARD = {
  /** Set this month: the capsule «Нов рекорд». */
  longestRhythm: {
    id: 'longestRhythm',
    kind: 'longestRhythm',
    label: 'Най-дълъг ритъм',
    value: '23',
    detail: 'септември 2026 г.',
    icon: 'loyalty.record.longestRhythm',
    src: null,
    isNew: true,
    accessibleName: 'Най-дълъг ритъм: 23, септември 2026 г., нов рекорд',
  },
  mostVisitsInYear: {
    id: 'mostVisitsInYear',
    kind: 'mostVisitsInYear',
    label: 'Най-много за година',
    value: '13',
    detail: '2025 г.',
    icon: 'loyalty.record.mostVisitsInYear',
    src: null,
    isNew: false,
    accessibleName: 'Най-много за година: 13, 2025 г.',
  },
  /** The hero of a favourite is the SERVICE: its cover in the emblem's place. */
  favouriteService: {
    id: 'favouriteService',
    kind: 'favouriteService',
    label: 'Любима услуга',
    value: 'Фейд',
    detail: '23 пъти',
    icon: 'loyalty.record.favouriteService',
    src: 'media/services/fade.jpg',
    isNew: false,
    accessibleName: 'Любима услуга: Фейд, 23 пъти',
  },
  firstVisit: {
    id: 'firstVisit',
    kind: 'firstVisit',
    label: 'Първо посещение',
    value: '1 март',
    detail: '2025 г.',
    icon: 'loyalty.record.firstVisit',
    src: null,
    isNew: false,
    accessibleName: 'Първо посещение: 1 март, 2025 г.',
  },
} satisfies Record<string, RecordCardVm>;

export const RECORD_CARDS = [
  RECORD_CARD.longestRhythm,
  RECORD_CARD.mostVisitsInYear,
  RECORD_CARD.favouriteService,
  RECORD_CARD.firstVisit,
] as const satisfies readonly RecordCardVm[];

export const COLLECTION: CollectionVm = {
  ring: gaugeOf(18, 42, 'Колекция: 18 от 42 медала, 38 спечелени нива', {
    label: 'Колекция',
  }),
  figure: '18',
  line: 'от 42 медала',
  levels: '38 спечелени нива',
  accessibleName: 'Колекция: 18 от 42 медала, 38 спечелени нива',
};

/** A category's families past the ones with a face of their own: not started, numbered. */
function silhouettes(
  categoryId: string,
  count: number,
): readonly AchievementTileVm[] {
  return Array.from({ length: count }, (_, index) =>
    tileOf(
      medalOf(`${categoryId}-${index + 1}`, {
        title: `Медал ${index + 1}`,
        caption: '0/1 до I',
        accessibleName: `Медал ${index + 1}, още не е започнато`,
      }),
    ),
  );
}

export const MEDAL_SECTIONS = {
  /** Five families: earned → in progress → not started; shown whole. */
  milestones: {
    categoryId: 'milestones',
    title: 'Етапи',
    count: '3 от 5',
    tiles: [
      tileOf(MEDALS.welcome),
      tileOf(MEDALS.fade),
      tileOf(MEDALS.saturday),
      tileOf(MEDALS.referral),
      tileOf(MEDALS.classicCut),
    ],
    folded: null,
  },
  /** Exactly nine: three whole rows, still no fold. */
  mastery: {
    categoryId: 'mastery',
    title: 'Майсторство',
    count: '3 от 9',
    tiles: [
      tileOf(MEDALS.fade),
      tileOf(MEDALS.withIvan),
      tileOf(MEDALS.explorer),
      ...silhouettes('mastery', 6),
    ],
    folded: null,
  },
  /** Twelve: two rows show, then «Покажи всички 12». */
  special: {
    categoryId: 'special',
    title: 'Специални',
    count: '4 от 12',
    tiles: [
      tileOf(MEDALS.welcome),
      tileOf(MEDALS.saturday),
      ...silhouettes('special', 10),
    ],
    folded: 12,
  },
} satisfies Record<string, MedalSectionVm>;

export const SEASON_CARD: SeasonCardVm = {
  seasonId: 'autumn-2026',
  medal: { ...MEDALS.autumn, title: null, caption: null },
  gauge: gaugeOf(4, 10, 'Ниво II, още 2 посещения до III', {
    label: 'Есен 2026',
    marks: [
      { value: 1, label: null, short: 'I' },
      { value: 3, label: null, short: 'II' },
      { value: 6, label: null, short: 'III' },
      { value: 8, label: null, short: 'IV' },
      { value: 10, label: null, short: 'V' },
    ],
  }),
  sentence: 'Още 2 посещения до III',
  title: 'Есен 2026',
  dates: '2.09 – 1.12',
  families: [
    medalOf('autumn-warm', {
      state: 'inProgress',
      icon: 'loyalty.badge.autumn',
      title: 'Топъл',
      caption: '1/2',
      value: 0.5,
      valueText: '1 от 2',
      accessibleName: 'Топъл, 1 от 2 до ниво I',
    }),
    medalOf('autumn-morning', {
      state: 'inProgress',
      icon: 'loyalty.badge.fog',
      title: 'Есенен',
      caption: '2/3',
      value: 2 / 3,
      valueText: '2 от 3',
      accessibleName: 'Есенен, 2 от 3 до ниво I',
    }),
    medalOf('autumn-first', {
      state: 'complete',
      icon: 'loyalty.badge.handshake',
      level: 'I',
      title: 'Първи',
      caption: '5.09',
      accessibleName: 'Първи, спечелено на 5 септември',
    }),
    medalOf('autumn-pair', {
      icon: 'loyalty.badge.party',
      title: 'Двойка',
      caption: '0/1',
      accessibleName: 'Двойка, още не е започнато',
    }),
  ],
  familiesCaption: 'Сезонни: 1 от 4',
  accessibleName: 'Есен 2026, ниво II, до 1 декември',
};

export const EVENT_CARD: EventCardVm = {
  seasonId: 'beard-week-2026',
  title: 'Седмица на брадата',
  when: 'до 6.10',
  medals: [
    medalOf('beard-week-beard', {
      icon: 'loyalty.badge.grooming',
      title: 'Брада',
      accessibleName: 'Брада, още не е започнато',
    }),
    medalOf('beard-week-care', {
      icon: 'loyalty.badge.event',
      title: 'Грижа',
      accessibleName: 'Грижа, още не е започнато',
    }),
  ],
  count: '0 от 2',
  accessibleName: 'Седмица на брадата, 0 от 2, до 6 октомври',
};

export const MEDALS_PAGE = {
  /** The overview, the chip «Всички». */
  georgi: {
    records: RECORD_CARDS,
    chips: ACHIEVEMENT_CHIPS,
    close: [
      tileOf(MEDALS.autumn),
      tileOf(MEDALS.fade),
      tileOf(MEDALS.withIvan),
    ],
    season: SEASON_CARD,
    events: [EVENT_CARD],
    collection: COLLECTION,
    sections: [
      MEDAL_SECTIONS.milestones,
      MEDAL_SECTIONS.mastery,
      MEDAL_SECTIONS.special,
    ],
    archive: { count: '1', accessibleName: 'Минали сезони и събития, 1' },
    emptyHint: null,
  },
  /** Nothing earned, nothing under way: what the book already knows, and the silhouettes. */
  empty: {
    records: [RECORD_CARD.firstVisit],
    chips: ACHIEVEMENT_CHIPS.slice(0, 3),
    close: [],
    season: null,
    events: [],
    collection: {
      ring: gaugeOf(0, 42, 'Колекция: 0 от 42 медала, 0 спечелени нива', {
        label: 'Колекция',
      }),
      figure: '0',
      line: 'от 42 медала',
      levels: '0 спечелени нива',
      accessibleName: 'Колекция: 0 от 42 медала, 0 спечелени нива',
    },
    sections: [
      {
        categoryId: 'milestones',
        title: 'Етапи',
        count: '0 от 5',
        tiles: silhouettes('milestones', 5),
        folded: null,
      },
    ],
    archive: null,
    emptyHint: 'Първото постижение идва с първото посещение.',
  },
  /** `loyalty.streaks` off: three record cards, the third spans the row. */
  threeRecords: {
    records: RECORD_CARDS.slice(1),
    chips: ACHIEVEMENT_CHIPS,
    close: [tileOf(MEDALS.fade)],
    season: null,
    events: [],
    collection: COLLECTION,
    sections: [MEDAL_SECTIONS.milestones],
    archive: null,
    emptyHint: null,
  },
} satisfies Record<string, MedalsPageVm>;

/** The nine rows of §2.3.4, by id. */
export const RECORD_ROWS = {
  longestRhythm: {
    id: 'longestRhythm',
    theme: 'rhythm',
    title: 'Най-дълъг ритъм',
    figure: '23',
    line: 'септември 2026 г.',
    icon: 'loyalty.record.longestRhythm',
    src: null,
    faceName: null,
    accessibleName: 'Най-дълъг ритъм: 23, септември 2026 г.',
  },
  currentRhythm: {
    id: 'currentRhythm',
    theme: 'rhythm',
    title: 'Ритъм сега',
    figure: '9',
    line: 'от юни 2026 г.',
    icon: 'loyalty.record.currentRhythm',
    src: null,
    faceName: null,
    accessibleName: 'Ритъм сега: 9, от юни 2026 г.',
  },
  totalVisits: {
    id: 'totalVisits',
    theme: 'visits',
    title: 'Общо посещения',
    figure: '23',
    line: null,
    icon: 'loyalty.record.totalVisits',
    src: null,
    faceName: null,
    accessibleName: 'Общо посещения: 23',
  },
  last12Months: {
    id: 'last12Months',
    theme: 'visits',
    title: 'Последните 12 месеца',
    figure: '13',
    line: null,
    icon: 'loyalty.record.last12Months',
    src: null,
    faceName: null,
    accessibleName: 'Последните 12 месеца: 13',
  },
  mostVisitsInYear: {
    id: 'mostVisitsInYear',
    theme: 'visits',
    title: 'Най-много за година',
    figure: '13',
    line: '2025 г.',
    icon: 'loyalty.record.mostVisitsInYear',
    src: null,
    faceName: null,
    accessibleName: 'Най-много за година: 13, 2025 г.',
  },
  firstVisit: {
    id: 'firstVisit',
    theme: 'visits',
    title: 'Първо посещение',
    figure: '1.03.2025 г.',
    line: null,
    icon: 'loyalty.record.firstVisit',
    src: null,
    faceName: null,
    accessibleName: 'Първо посещение: 1 март 2025 г.',
  },
  /** A picture leads: the service's cover. */
  favouriteService: {
    id: 'favouriteService',
    theme: 'favourites',
    title: 'Любима услуга',
    figure: 'Фейд',
    line: '23 пъти',
    icon: null,
    src: 'media/services/fade.jpg',
    faceName: null,
    accessibleName: 'Любима услуга: Фейд, 23 пъти',
  },
  /** A face leads; without a picture, the barber's initials. */
  preferredBarber: {
    id: 'preferredBarber',
    theme: 'favourites',
    title: 'Бръснар по избор',
    figure: 'Иван',
    line: null,
    icon: null,
    src: null,
    faceName: 'Иван Колев',
    accessibleName: 'Бръснар по избор: Иван Колев',
  },
  /** At 330 the value goes under its title. */
  usualServices: {
    id: 'usualServices',
    theme: 'favourites',
    title: 'Обичайни услуги',
    figure: 'Фейд · Оформяне на брада',
    line: null,
    icon: 'loyalty.record.usualServices',
    src: null,
    faceName: null,
    accessibleName: 'Обичайни услуги: Фейд, Оформяне на брада',
  },
} satisfies Record<string, RecordRowVm>;

const FEATURED_RECORD: FeaturedRecordVm = {
  ...RECORD_CARD.longestRhythm,
  sentence: 'поредни посещения в ритъм',
  accessibleName:
    'Най-дълъг ритъм: 23 поредни посещения в ритъм, септември 2026 г., нов рекорд',
};

export const RECORDS_PAGE = {
  /** The whole history is loaded: «По години» draws. */
  georgi: {
    subline: 'Георги Петров',
    featured: FEATURED_RECORD,
    groups: [
      // The featured record's row is not repeated in its group.
      { theme: 'rhythm', title: 'Ритъм', rows: [RECORD_ROWS.currentRhythm] },
      {
        theme: 'visits',
        title: 'Посещения',
        rows: [
          RECORD_ROWS.totalVisits,
          RECORD_ROWS.last12Months,
          RECORD_ROWS.mostVisitsInYear,
          RECORD_ROWS.firstVisit,
        ],
      },
      {
        theme: 'favourites',
        title: 'Любими',
        rows: [
          RECORD_ROWS.favouriteService,
          RECORD_ROWS.preferredBarber,
          RECORD_ROWS.usualServices,
        ],
      },
    ],
    years: [
      {
        year: '2026',
        count: '11',
        gauge: gaugeOf(11, 13, '2026: 11 посещения', { label: '2026' }),
        record: false,
        accessibleName: '2026: 11 посещения',
      },
      {
        year: '2025',
        count: '13',
        gauge: gaugeOf(13, 13, '2025: 13 посещения, рекорд', {
          label: '2025',
        }),
        record: true,
        accessibleName: '2025: 13 посещения, рекорд',
      },
    ],
  },
  /** A cursor is left, the rule is off: no «По години», no «Ритъм» group. */
  partial: {
    subline: 'Георги Петров',
    featured: {
      ...RECORD_CARD.mostVisitsInYear,
      sentence: 'посещения за една година',
    },
    groups: [
      {
        theme: 'visits',
        title: 'Посещения',
        rows: [
          RECORD_ROWS.totalVisits,
          RECORD_ROWS.last12Months,
          RECORD_ROWS.firstVisit,
        ],
      },
      {
        theme: 'favourites',
        title: 'Любими',
        rows: [RECORD_ROWS.favouriteService],
      },
    ],
    years: null,
  },
  /** No record yet: «Рекордите идват с първите посещения.» */
  empty: {
    subline: 'Калоян Димов',
    featured: null,
    groups: [],
    years: null,
  },
} satisfies Record<string, RecordsPageVm>;

// ── A medal's detail ────────────────────────────────────────────────────

const HOW_FADE: DetailHowVm = {
  sentence: 'Всяко посещение с фейд се брои, щом приключи.',
  pictures: [
    {
      key: 'service-fade',
      title: 'Фейд',
      caption: '28,00 €',
      src: 'media/services/fade.jpg',
      more: null,
    },
    {
      key: 'service-fade-beard',
      title: 'Фейд и оформяне на брада',
      caption: '38,00 €',
      src: 'media/services/fade-beard.jpg',
      more: null,
    },
  ],
  ratio: '4 / 3',
  columns: 2,
  faces: [
    { name: 'Иван Колев', src: null },
    { name: 'Никола Стоев', src: null },
    { name: 'Симеон Данов', src: null },
  ],
  who: 'При всеки бръснар · във всеки салон',
  excluded: 'Отменени часове и неявявания не се броят.',
  steps: [],
};

/** A rung of the ladder of medals: `regular`, unnamed, its numeral on a passed one. */
function rung(
  level: number,
  numeral: string,
  passed: boolean,
): DetailLevelVm['medal'] {
  return medalOf('service-fade', {
    state: passed ? 'complete' : 'notStarted',
    icon: 'loyalty.badge.service',
    monogram: 'Ф',
    level: passed ? numeral : null,
    accessibleName: `Фейд, ниво ${level}`,
  });
}

const LADDER_FADE: readonly DetailLevelVm[] = [
  {
    level: 1,
    medal: rung(1, 'I', true),
    title: 'Ниво I · 3 посещения',
    reward: 'Значка в профила',
    earnedOn: '16.04.2025',
    tone: 'passed',
    accessibleName:
      'Ниво I, 3 посещения, Значка в профила, спечелено на 16 април 2025 г.',
  },
  {
    level: 2,
    medal: rung(2, 'II', true),
    title: 'Ниво II · 10 посещения',
    reward: '50 точки',
    earnedOn: '24.09.2025',
    tone: 'passed',
    accessibleName:
      'Ниво II, 10 посещения, 50 точки, спечелено на 24 септември 2025 г.',
  },
  {
    level: 3,
    medal: rung(3, 'III', false),
    title: 'Ниво III · 25 посещения',
    reward: '50 точки',
    earnedOn: null,
    tone: 'next',
    accessibleName: 'Ниво III, 25 посещения, 50 точки',
  },
  {
    level: 4,
    medal: rung(4, 'IV', false),
    title: 'Ниво IV · 50 посещения',
    reward: 'Безплатно оформяне на брада',
    earnedOn: null,
    tone: 'later',
    accessibleName: 'Ниво IV, 50 посещения, Безплатно оформяне на брада',
  },
  {
    level: 5,
    medal: rung(5, 'V', false),
    title: 'Ниво V · 100 посещения',
    reward: 'Безплатен фейд',
    earnedOn: null,
    tone: 'later',
    accessibleName: 'Ниво V, 100 посещения, Безплатен фейд',
  },
];

const COUNTED_VISITS: readonly VisitRowVm[] = [
  visitRowOf('apt-2026-09-28', {
    startMs: Date.UTC(2026, 8, 28, 7),
    upcoming: false,
    tile: { caption: 'пн', day: 28, tone: 'upcoming' },
    lines: [{ text: '10:00 · Иван', hold: ' · Иван' }],
    trailingFact: { kind: 'badge', text: 'Този час' },
    outcome: 'open',
    status: 'confirmed',
    accessibleName: 'Фейд, днес, 10:00, Иван Колев, Този час',
  }),
  visitRowOf('apt-2026-09-05', {
    title: 'Фейд · Оформяне на брада',
    marks: [{ icon: 'client.photos', label: '2 снимки', count: 2 }],
    trailingFact: {
      kind: 'amount',
      text: '27,50 €',
      emphasis: 'primary',
      struck: false,
    },
    accessibleName:
      'Фейд · Оформяне на брада, 5 септември, Иван Колев, Център, 27,50 €, 2 снимки',
  }),
  visitRowOf('apt-2026-08-08', {
    startMs: Date.UTC(2026, 7, 8, 7),
    sectionKey: '2026-08',
    tile: { caption: 'сб', day: 8, tone: 'past' },
    marks: [{ icon: 'client.photos', label: '1 снимка', count: 1 }],
    accessibleName: 'Фейд, 8 август, Иван Колев, Център, 17,50 €, 1 снимка',
  }),
];

export const MEDAL_DETAIL = {
  /** «Фейд»: 23 of 25 to level III; the visit does not hold a fade yet, so the dock offers it. */
  fade: {
    seriesId: 'service-fade',
    categoryId: 'mastery',
    title: 'Фейд',
    medal: { ...MEDALS.fade, title: null, caption: null },
    stateLine: [
      { text: 'Майсторство · Ниво II · от ', fact: false },
      { text: '24.09.2025 г.', fact: true },
    ],
    progress: {
      value: '23',
      unit: 'от 25',
      what: 'посещения с фейд',
      remaining: 'Още 2 до ниво III',
      thisVisit: null,
    },
    how: HOW_FADE,
    ladder: LADDER_FADE,
    visits: COUNTED_VISITS.slice(1),
    related: {
      title: 'Още от Майсторство',
      icon: 'loyalty.category.mastery',
      tiles: [
        tileOf(MEDALS.withIvan),
        tileOf(MEDALS.explorer),
        tileOf(MEDALS.classicCut),
      ],
    },
    action: {
      serviceId: 'service-fade',
      label: 'Добави фейд',
      accessibleName: 'Добави Фейд към посещението',
    },
  },
  /** This visit already holds what counts: the third line, and no verb. */
  countsThisVisit: {
    seriesId: 'service-fade',
    categoryId: 'mastery',
    title: 'Фейд',
    medal: { ...MEDALS.fade, title: null, caption: null },
    stateLine: [
      { text: 'Майсторство · Ниво II · от ', fact: false },
      { text: '24.09.2025 г.', fact: true },
    ],
    progress: {
      value: '23',
      unit: 'от 25',
      what: 'посещения с фейд',
      remaining: 'Още 2 до ниво III',
      thisVisit: 'С това посещение: 24 от 25',
    },
    how: HOW_FADE,
    ladder: LADDER_FADE,
    visits: COUNTED_VISITS,
    related: null,
    action: null,
  },
  /** Not started: the whole page, the requirement never hidden. */
  notStarted: {
    seriesId: 'service-classic',
    categoryId: 'mastery',
    title: 'Класическа подстрижка',
    medal: { ...MEDALS.classicCut, title: null, caption: null },
    stateLine: [{ text: 'Майсторство · още не е започнато', fact: false }],
    progress: {
      value: '0',
      unit: 'от 3',
      what: 'посещения с класическа подстрижка',
      remaining: 'Още 3 до ниво I',
      thisVisit: null,
    },
    how: {
      ...HOW_FADE,
      sentence:
        'Всяко посещение с класическа подстрижка се брои, щом приключи.',
      pictures: [
        {
          key: 'service-classic',
          title: 'Класическа подстрижка',
          caption: '22,00 €',
          src: null,
          more: null,
        },
      ],
      ratio: '16 / 9',
      columns: 1,
    },
    ladder: LADDER_FADE.slice(0, 3).map((level, index) => ({
      ...level,
      medal: rung(level.level, '', false),
      earnedOn: null,
      tone: index === 0 ? ('next' as const) : ('later' as const),
    })),
    visits: [],
    related: null,
    action: {
      serviceId: 'service-classic',
      label: 'Добави класическа подстрижка',
      accessibleName: 'Добави Класическа подстрижка към посещението',
    },
  },
  /** A one-off family, earned: the state is the figure, one «Награда» row. */
  oneOff: {
    seriesId: 'welcome',
    categoryId: 'milestones',
    title: 'Добре дошъл',
    medal: { ...MEDALS.welcome, title: null, caption: null },
    stateLine: [
      { text: 'Етапи · Спечелено на ', fact: false },
      { text: '1.03.2025 г.', fact: true },
    ],
    progress: {
      value: '1.03.2025 г.',
      unit: null,
      what: 'първо посещение',
      remaining: null,
      thisVisit: null,
    },
    how: {
      sentence: 'Първото завършено посещение в салона.',
      pictures: [],
      ratio: '16 / 9',
      columns: 1,
      faces: HOW_FADE.faces,
      who: 'При всеки бръснар · във всеки салон',
      excluded: null,
      steps: [],
    },
    ladder: [
      {
        level: 1,
        medal: medalOf('welcome', {
          state: 'complete',
          icon: 'loyalty.badge.welcome',
          level: 'I',
          accessibleName: 'Добре дошъл',
        }),
        title: 'Награда',
        reward: '50 точки',
        earnedOn: '1.03.2025',
        tone: 'passed',
        accessibleName: 'Награда, 50 точки, спечелено на 1 март 2025 г.',
      },
    ],
    visits: [],
    related: null,
    action: null,
  },
  /** Retired: «Как се печели» and the verb are absent. */
  retired: {
    seriesId: 'retired-family',
    categoryId: null,
    title: 'Лятна събота',
    medal: medalOf('retired-family', {
      state: 'earned',
      icon: 'loyalty.badge.summer',
      level: 'I',
      accessibleName: 'Лятна събота, ниво I',
    }),
    stateLine: [{ text: 'Вече не се присъжда.', fact: false }],
    progress: {
      value: '3',
      unit: null,
      what: 'летни съботи',
      remaining: null,
      thisVisit: null,
    },
    how: null,
    ladder: LADDER_FADE.slice(0, 1),
    visits: [],
    related: null,
    action: null,
  },
} satisfies Record<string, MedalDetailVm>;

// ── «Посещения» ─────────────────────────────────────────────────────────

const UPCOMING_ROW = visitRowOf('apt-2026-10-23', {
  startMs: Date.UTC(2026, 9, 23, 7),
  sectionKey: 'upcoming',
  upcoming: true,
  tile: { caption: 'пт', day: 23, tone: 'upcoming' },
  lines: [{ text: '10:00 · Иван', hold: ' · Иван' }],
  trailingFact: null,
  outcome: 'open',
  status: 'confirmed',
  accessibleName: 'Фейд, петък, 23 октомври, 10:00, Иван Колев',
});

const SEVERAL_ROW = visitRowOf('apt-2026-07-11', {
  startMs: Date.UTC(2026, 6, 11, 7),
  sectionKey: '2026-07',
  tile: { caption: 'сб', day: 11, tone: 'past' },
  title: 'Фейд · Оформяне на брада',
  lines: [{ text: 'Център' }],
  // Cut by two: no face, and its column still reserved.
  trailing: {
    kind: 'barber',
    avatarSrc: null,
    name: '2 бръснари',
    several: true,
  },
  trailingFact: {
    kind: 'amount',
    text: '35,00 €',
    emphasis: 'primary',
    struck: false,
  },
  marks: [{ icon: 'promo.voucher', label: 'платено с ваучер', count: null }],
  accessibleName:
    'Фейд · Оформяне на брада, 11 юли, Иван Колев и Никола Стоев, Център, 35,00 €, платено с ваучер',
});

const NO_SHOW_ROW = visitRowOf('apt-2026-06-27', {
  startMs: Date.UTC(2026, 5, 27, 7),
  sectionKey: '2026-06',
  tile: { caption: 'сб', day: 27, tone: 'hollow' },
  struck: true,
  lines: [{ text: 'Иван' }],
  trailingFact: {
    kind: 'status',
    icon: 'visit.noShow',
    text: 'Не дойде',
    tone: 'warning',
  },
  outcome: 'no_show',
  status: 'no_show',
  accessibleName: 'Фейд, 27 юни, Иван Колев, Не дойде',
});

const CANCELLED_ROW = visitRowOf('apt-2026-06-20', {
  startMs: Date.UTC(2026, 5, 20, 7),
  sectionKey: '2026-06',
  tile: { caption: 'сб', day: 20, tone: 'hollow' },
  struck: true,
  lines: [{ text: 'Отказан от клиента · Иван', hold: ' · Иван' }],
  trailingFact: {
    kind: 'amount',
    text: '17,50 €',
    emphasis: 'secondary',
    struck: true,
  },
  outcome: 'cancelled',
  status: 'cancelled',
  accessibleName: 'Фейд, 20 юни, Иван Колев, Отказан от клиента, 17,50 €',
});

export const VISIT_ROWS = {
  current: COUNTED_VISITS[0] as VisitRowVm,
  worked: COUNTED_VISITS[1] as VisitRowVm,
  upcoming: UPCOMING_ROW,
  several: SEVERAL_ROW,
  noShow: NO_SHOW_ROW,
  cancelled: CANCELLED_ROW,
} satisfies Record<string, VisitRowVm>;

export const VISIT_SECTIONS = [
  {
    key: 'upcoming',
    label: 'Предстоящи',
    detail: null,
    rows: [UPCOMING_ROW],
    testId: 'history-upcoming',
  },
  {
    key: '2026-09',
    label: 'Септември 2026 г.',
    // One worked visit: the heading alone.
    detail: null,
    rows: [COUNTED_VISITS[0] as VisitRowVm, COUNTED_VISITS[1] as VisitRowVm],
    testId: 'history-month-2026-09',
  },
  {
    key: '2026-08',
    label: 'Август 2026 г.',
    detail: null,
    rows: [COUNTED_VISITS[2] as VisitRowVm],
    testId: 'history-month-2026-08',
  },
  {
    key: '2026-07',
    label: 'Юли 2026 г.',
    detail: null,
    rows: [SEVERAL_ROW],
    testId: 'history-month-2026-07',
  },
  {
    key: '2026-06',
    label: 'Юни 2026 г.',
    detail: null,
    rows: [NO_SHOW_ROW, CANCELLED_ROW],
    testId: 'history-month-2026-06',
  },
] as const satisfies readonly VisitSectionVm[];

const VISITS_LINE = [
  { text: '23', fact: true },
  { text: ' посещения · през ', fact: false },
  { text: '4', fact: true },
  { text: ' седмици', fact: false },
] as const;

export const VISITS_PAGE = {
  /** An admin viewing: the spend joins the second line. */
  admin: {
    status: 'ready',
    line: VISITS_LINE,
    lineName: 'Общо: 23 посещения, средно на 4 седмици',
    facts: [
      {
        text: 'Без неявявания и откази от клиента · похарчени общо ',
        fact: false,
      },
      { text: '492,50 €', fact: true },
    ],
    cells: [
      { id: 'visits', value: '23', caption: 'посещения' },
      { id: 'cadence', value: '~4', unit: 'седм.', caption: 'интервал' },
    ],
    filter: 'all',
    offeredFilters: ['all', 'upcoming', 'completed'],
    sections: VISIT_SECTIONS.slice(0, 4),
    paging: { kind: 'more', endLabel: null },
  },
  /** A barber viewing a client with a no-show and a cancellation: no money, the risks in the line. */
  barber: {
    status: 'ready',
    line: [
      ...VISITS_LINE,
      { text: ' · ', fact: false },
      { text: '1', fact: true },
      { text: ' неявяване · ', fact: false },
      { text: '1', fact: true },
      { text: ' отказ от клиента', fact: false },
    ],
    lineName:
      'Общо: 23 посещения, средно на 4 седмици, 1 неявяване, 1 отказ от клиента',
    facts: null,
    cells: [
      { id: 'visits', value: '23', caption: 'посещения' },
      { id: 'cadence', value: '~4', unit: 'седм.', caption: 'интервал' },
      { id: 'noShows', value: '1', caption: 'неявяване' },
      { id: 'cancelled', value: '1', caption: 'отказ от клиента' },
    ],
    filter: 'all',
    offeredFilters: ['all', 'upcoming', 'completed', 'no_show', 'cancelled'],
    sections: VISIT_SECTIONS,
    paging: {
      kind: 'end',
      endLabel: 'Това е всичко · първото посещение е на 1.03.2025 г.',
    },
  },
  /** Narrowed to a filter nothing on the loaded pages answers. */
  filteredEmpty: {
    status: 'ready',
    line: VISITS_LINE,
    lineName: 'Общо: 23 посещения, средно на 4 седмици',
    facts: null,
    cells: [{ id: 'visits', value: '23', caption: 'посещения' }],
    filter: 'no_show',
    offeredFilters: ['all', 'upcoming', 'completed', 'no_show'],
    sections: [],
    paging: { kind: 'more', endLabel: null },
  },
  /** Before the first worked visit: this visit under «Предстоящи». */
  first: {
    status: 'ready',
    line: [{ text: 'Първо посещение', fact: false }],
    lineName: 'Първо посещение',
    facts: null,
    cells: [],
    filter: 'all',
    offeredFilters: ['all'],
    sections: VISIT_SECTIONS.slice(0, 1),
    paging: { kind: 'end', endLabel: 'Това е първото посещение.' },
  },
  loading: {
    status: 'loading',
    line: VISITS_LINE,
    lineName: 'Общо: 23 посещения, средно на 4 седмици',
    facts: null,
    cells: [],
    filter: 'all',
    offeredFilters: ['all'],
    sections: [],
    paging: null,
  },
  failed: {
    status: 'failed',
    line: VISITS_LINE,
    lineName: 'Общо: 23 посещения, средно на 4 седмици',
    facts: null,
    cells: [],
    filter: 'all',
    offeredFilters: ['all'],
    sections: [],
    paging: null,
  },
} satisfies Record<string, VisitsPageVm>;
