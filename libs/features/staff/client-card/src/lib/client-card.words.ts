import {
  type VisitTranslate,
  type VisitWaitlistWords,
  type VisitWords,
  visitWaitlistWordsOf,
  visitWordsOf,
} from '@creativo/features/shared/visits';
import {
  JournalFeed,
  Metric,
  PersonalRecordKind,
  Role,
  type Roles,
  VisitPerspective,
} from '@core/components';
import {
  pluralForm,
  type StreakPeriodReasonWord,
} from '@creativo/infrastructure/i18n';
import { inSentence } from './client-card.format';
import type { RecordTheme } from './client-pages.vm';
import { formatCount } from '@creativo/ui/wall-clock';

/*
 * THE CARD'S WORDS — every key the presenters read, looked up ONCE per
 * language and handed to them as arguments (the shared visits'
 * `VisitWords` precedent). A presenter never injects Transloco and never
 * holds copy of its own: a spec words the card from the real catalogue,
 * and a key the catalogue lacks fails there, not on a screen.
 *
 * Reuse first (client-card-redesign §8.1): a word the app already has is
 * read from its existing key («Обади се», «Използвай», «Снимки»,
 * «Предстоящи»), and the visit rows' words come from the shared
 * list's own builder, so the card and «Моите часове» never word a row apart.
 *
 * REVISION 3 (client-card-revision-3 §6.1) ADDED to this table in W0 and
 * removed nothing until W4: a built page read the built members until its
 * body was re-drawn. W4 (Z4) deleted the keys §6.1 marks removed or renamed
 * and every member nothing read any more; a member only a built presenter
 * still composes (Z1 deletes those, §7.1) stays for one more sitting. In
 * the members it adds:
 *
 * - a COUNT is a `number`: the words group it the locale's way (`figure`)
 *   and choose the plural form, so a presenter never agrees a noun. Every
 *   sentence that holds a count beside a noun has its two forms in the
 *   catalogue (`.one` / `.other`, lead ruling G1-6), chosen by the count
 *   that GOVERNS the noun: the stamps' by the card's size, a catalogue's
 *   by its rewards, the progress card's words by the figure over them;
 * - a fact that is already worded is a `string`: a date, money, a level's
 *   numeral, a name, and every fact a `LinePart` is cut around (the
 *   presenter finds in the sentence exactly what it passed in);
 * - an absent fact is `null`: the words drop its slot WITH its joint («, »,
 *   « · »), so no sentence is assembled by hand and none ends on a comma;
 * - a member that takes one of a closed set takes it as a member of the
 *   card's own word dictionary (`LoyaltyHoldingWord`, `RecordKindWord`, …
 *   — `as const`, its VALUES the i18n key segment and the test id, an
 *   external contract, so they keep their spelling): a dictionary value of
 *   ecs-core (`PersonalRecordKind.FirstVisit`, `JournalFeed.All`, …)
 *   reaches it through ONE table keyed by that dictionary
 *   (`RECORD_KIND_WORDS`, `LEDGER_FILTER_WORDS` here;
 *   `streakPeriodReasonWords` in `@creativo/infrastructure/i18n`, read by
 *   two libs), and a presenter names a word by its member, never a bare
 *   literal.
 */

/** Transloco's `translate`, or anything shaped like it. */
export type ClientCardTranslate = VisitTranslate;

type Params = Readonly<Record<string, string | number>>;

/**
 * What the glance's holdings line counts: a voucher's balance, a stamp
 * card, the rhythm. Values: external contract — the i18n key segment
 * `clientCard.loyalty.holding.<word>` and the fact's test id
 * `client-loyalty-<word>` (`HoldingFactVm.id`).
 */
export const LoyaltyHoldingWord = {
  Voucher: 'voucher',
  Stamps: 'stamps',
  Rhythm: 'rhythm',
} as const;
export type LoyaltyHoldingWord =
  (typeof LoyaltyHoldingWord)[keyof typeof LoyaltyHoldingWord];

/**
 * Why a period of the rhythm is protected: a used protection, the account's
 * pause, one of the shop's excuses (`StreakRule.EXCUSES`), the client's own
 * pause — the word of `@creativo/infrastructure/i18n`'s ONE table
 * (`streakPeriodReasonWords`), which the admin rhythm page reads too.
 */
export type RhythmReasonWord = StreakPeriodReasonWord;

/**
 * The ledger page's pill. Values: external contract — the pill's test id
 * and the i18n key segment `clientCard.ledgerPage.filter.<word>`.
 */
export const LedgerFilterWord = {
  All: 'all',
  Points: 'points',
  Rewards: 'rewards',
  Status: 'status',
} as const;
export type LedgerFilterWord =
  (typeof LedgerFilterWord)[keyof typeof LedgerFilterWord];

/** Each pill of the ledger (`JournalFeed`) as the card words it: the SAME words and test ids as before the flip. */
export const LEDGER_FILTER_WORDS = {
  [JournalFeed.All]: LedgerFilterWord.All,
  [JournalFeed.Points]: LedgerFilterWord.Points,
  [JournalFeed.Rewards]: LedgerFilterWord.Rewards,
  [JournalFeed.Status]: LedgerFilterWord.Status,
} as const satisfies Record<JournalFeed, LedgerFilterWord>;

/**
 * What a ledger row says happened (`clientCard.ledger.verb.<word>`).
 * Values: external contract (that i18n key segment).
 */
export const LedgerVerbWord = {
  Earned: 'earned',
  Bonus: 'bonus',
  Spent: 'spent',
  Adjusted: 'adjusted',
  Reversed: 'reversed',
  Expired: 'expired',
  DebtCleared: 'debtCleared',
  Voided: 'voided',
  Received: 'received',
  Status: 'status',
} as const;
export type LedgerVerbWord =
  (typeof LedgerVerbWord)[keyof typeof LedgerVerbWord];

/**
 * The account's four records, as the card's keys and test ids spell them
 * (`PersonalRecordKind`). Values: external contract — the i18n key
 * segments (`clientCard.records.label.<word>`, …) and the record's test id
 * and `data-kind`.
 */
export const RecordKindWord = {
  LongestRhythm: 'longestRhythm',
  MostVisitsInYear: 'mostVisitsInYear',
  FavouriteService: 'favouriteService',
  FirstVisit: 'firstVisit',
} as const;
export type RecordKindWord =
  (typeof RecordKindWord)[keyof typeof RecordKindWord];

/** Each record kind (`PersonalRecordKind`) as the card words it: its i18n keys and test ids. */
export const RECORD_KIND_WORDS = {
  [PersonalRecordKind.LongestRhythm]: RecordKindWord.LongestRhythm,
  [PersonalRecordKind.MostVisitsInYear]: RecordKindWord.MostVisitsInYear,
  [PersonalRecordKind.FavouriteService]: RecordKindWord.FavouriteService,
  [PersonalRecordKind.FirstVisit]: RecordKindWord.FirstVisit,
} as const satisfies Record<PersonalRecordKind, RecordKindWord>;

/**
 * The records page's five rows that are not a record of the account's.
 * Values: external contract — the i18n key segment
 * `clientCard.records.row.<word>` and the row's test id.
 */
export const RecordRowWord = {
  CurrentRhythm: 'currentRhythm',
  TotalVisits: 'totalVisits',
  Last12Months: 'last12Months',
  PreferredBarber: 'preferredBarber',
  UsualServices: 'usualServices',
} as const;
export type RecordRowWord = (typeof RecordRowWord)[keyof typeof RecordRowWord];

/**
 * «Как се печели»: the sentence of a metric that names no subject. Values:
 * external contract — the i18n key segments `clientCard.achievement.how.<word>`
 * and `….what.<word>`.
 */
export const AchievementHowWord = {
  Visits: 'visits',
  EarlyBird: 'earlyBird',
  Weekend: 'weekend',
  OnTime: 'onTime',
  Party: 'party',
  SelfService: 'selfService',
  Waitlist: 'waitlist',
  Referrals: 'referrals',
  Services: 'services',
  Barbers: 'barbers',
  Shops: 'shops',
  Months: 'months',
  Spend: 'spend',
  Points: 'points',
  Tenure: 'tenure',
  ShopBookings: 'shopBookings',
} as const;
export type AchievementHowWord =
  (typeof AchievementHowWord)[keyof typeof AchievementHowWord];

/**
 * «Как се печели»: who and where, by what the family leaves open. Values:
 * external contract — the i18n key segment `clientCard.achievement.who.<word>`.
 */
export const AchievementWhoWord = {
  AnyBarberAnyShop: 'anyBarberAnyShop',
  AnyServiceAnyShop: 'anyServiceAnyShop',
  AnyBarberAnyService: 'anyBarberAnyService',
} as const;
export type AchievementWhoWord =
  (typeof AchievementWhoWord)[keyof typeof AchievementWhoWord];

/**
 * A family's metric by its id in the loyalty catalogue — ecs-core's
 * `Metric` itself, never a copy of its values (pass C, K-7).
 */
export type AchievementMetricWord = Metric;

/**
 * The word a metric is said with: ONE answer for «Как се печели»
 * (`achievement.how`) and for the words under the progress figure
 * (`achievement.what`), so the two never name a metric apart. Exhaustive:
 * a metric the catalogue gains does not compile here until it has its
 * word. A visit count narrowed to a service, a barber or a shop
 * (`MetricRef.where`) is worded by `howService` / `whatService` and their
 * siblings instead.
 */
export function achievementMetricWord(
  metric: AchievementMetricWord,
): AchievementHowWord {
  switch (metric) {
    case Metric.VisitsCompleted:
      return AchievementHowWord.Visits;
    case Metric.BookingsSelfService:
      return AchievementHowWord.SelfService;
    case Metric.SpendMajor:
      return AchievementHowWord.Spend;
    case Metric.ReferralsCompleted:
      return AchievementHowWord.Referrals;
    case Metric.WaitlistBooked:
      return AchievementHowWord.Waitlist;
    case Metric.PointsLifetime:
      return AchievementHowWord.Points;
    case Metric.ShopBookingsCreated:
      return AchievementHowWord.ShopBookings;
    case Metric.ServicesDistinct:
      return AchievementHowWord.Services;
    case Metric.BarbersDistinct:
      return AchievementHowWord.Barbers;
    case Metric.LocationsDistinct:
      return AchievementHowWord.Shops;
    case Metric.MonthsDistinct:
      return AchievementHowWord.Months;
    case Metric.VisitsEarlyBird:
      return AchievementHowWord.EarlyBird;
    case Metric.VisitsWeekend:
      return AchievementHowWord.Weekend;
    case Metric.VisitsOnTime:
      return AchievementHowWord.OnTime;
    case Metric.VisitsParty:
      return AchievementHowWord.Party;
    case Metric.TenureDays:
      return AchievementHowWord.Tenure;
  }
}

/**
 * A sentence that ends on a date ends on ONE full stop: `Intl`'s year in
 * bg carries its own abbreviation point («6.03.2025 г.»), so «…на
 * {{date}}.» would print «г..». Typography, not a rewrite of the date.
 */
function oneFinalStop(sentence: string): string {
  return sentence.replace(/\.\.$/u, '.');
}

/** The typographic minus (U+2212): a movement's direction is its sign, never a colour. */
const MINUS = '−';

/** A sentence inside a longer name ends on ONE full stop, whatever it ended on. */
function oneStop(sentence: string): string {
  return /[.!?…]$/u.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * What an absent slot leaves behind: doubled spaces inside, a space at an
 * end. Plain spaces only: the no-break space of «25,00 €» is typography.
 */
function withoutGaps(sentence: string): string {
  return sentence.replace(/ {2,}/gu, ' ').replace(/^ +| +$/gu, '');
}

/** «Карта: , Злато» → «Карта: Злато» — a name whose first fact is absent opens on the next one. */
function withoutEmptyLead(sentence: string): string {
  return sentence.replace(/: , /u, ': ');
}

export interface ClientCardWords {
  /** The language the words are in — every `Intl` call beside them uses it. */
  readonly lang: string;
  /** The shared rows' words, the staff perspective's («Не дойде», «Отказан от клиента»). */
  readonly visits: VisitWords;
  /** The glance's waitlist line. */
  readonly waitlist: VisitWaitlistWords;
  /** «яну.» … «дек.» — a month in a caption (`visits.tile.month.N`, LR4): `Intl`'s short month is numeric in bg. */
  readonly monthShort: (month: number) => string;
  readonly head: {
    /**
     * «Клиент от март 2025 г.» — tenure only: the cadence's one place is
     * the history's band («~4 седм. интервал», §3.6 HC), one fact, once.
     */
    readonly since: (since: string) => string;
    readonly firstVisit: string;
    readonly guest: string;
    readonly pausedUntil: (date: string) => string;
    readonly pausedPermanent: string;
    /**
     * «Клиент от март 2025 г. · идва през 4 седмици» — the hero's quiet
     * line, ONE sentence: the presenter cuts its `LinePart`s around the two
     * facts it passed in (`cadence` is `head.cadence(weeks)`).
     */
    readonly sinceCadence: (since: string, cadence: string) => string;
    /** «4 седмици» · «1 седмица» — the cadence as a fact. */
    readonly cadence: (weeks: number) => string;
    /**
     * «Злато, още 7 посещения до Платина» — the tier ring in words (heard
     * only); `remaining` is worded («7 посещения», `visitsModule.sectionVisits`).
     */
    readonly tierName: (
      tier: string,
      remaining: string,
      next: string,
    ) => string;
    /** «Платина, най-високият статус» — the full ring in words. */
    readonly tierTopName: (tier: string) => string;
  };
  /** The birthday card (the glance's BD): the band, the gift under it, the notice before the day. */
  readonly birthday: {
    /** «Рожден ден днес» — the band's title when the year of birth is unknown. */
    readonly today: string;
    /** «Рожден ден · 34 г.» — the band's title. */
    readonly todayAge: (age: number) => string;
    /** «Подарък от салона» — the gift's label on the ticket body. */
    readonly gift: string;
    /** «Рожден ден · петък, 2.10 · 34 г.» — the notice before the day; the age only when known. */
    readonly upcoming: (
      weekday: string,
      date: string,
      age: number | null,
    ) => string;
    /** «Рожден ден днес, навършва 34 години» — the band alone, heard. */
    readonly name: (age: number | null) => string;
    /** «Рожден ден днес, навършва 34 години. Подарък: −20 %, използвай» — the card as ONE button. */
    readonly giftName: (age: number | null, value: string) => string;
    /** «…Подарък: −20 %, с това посещение» — the gift already on the bill. */
    readonly giftAppliedName: (age: number | null, value: string) => string;
  };
  /** `lib-visit-card`'s labels on the glance (the waiting request's is `waitlist.waiting`). */
  readonly visitCard: {
    /** «Последно посещение» */
    readonly last: string;
    /** «Следващ час» */
    readonly next: string;
    /** «Последно посещение: Фейд, 5 септември, Иван» — the card as one sentence. */
    readonly name: (label: string, sentence: string) => string;
  };
  readonly capsules: {
    readonly label: string;
    readonly noShows: (count: number) => string;
    readonly more: (count: number) => string;
  };
  readonly offline: string;
  readonly actions: {
    readonly label: string;
    readonly call: string;
    readonly sms: string;
    readonly viber: string;
    /** «Повтори» — one word, so the tile's label holds one line (DV10). */
    readonly repeat: string;
    readonly callName: (name: string, phone: string) => string;
    readonly smsName: (name: string) => string;
    readonly viberName: (name: string) => string;
    readonly againName: (date: string, services: string) => string;
  };
  readonly reward: {
    readonly until: (date: string) => string;
    readonly more: (count: number) => string;
    /** «Рожден ден, −20%, използвай»; no value (the name says it): «Безплатно подстригване, използвай». */
    readonly name: (title: string, value: string | null) => string;
    /** An applied ticket: «Рожден ден, −20%, с това посещение»; «Безплатно подстригване, с това посещение». */
    readonly appliedName: (title: string, value: string | null) => string;
    /** «×2» — identical grants collapsed into one ticket (`[uiCouponBadge]`), the figure as on screen. */
    readonly stack: (count: number) => string;
    /** «Използвай» — the ticket's action word. */
    readonly use: string;
    /** «Премахни» — an applied ticket's action, the discount page's own word. */
    readonly remove: string;
    /** «Премахни отстъпката: Безплатно подстригване» — as the discount page names its own. */
    readonly removeName: (title: string) => string;
  };
  readonly visitsModule: {
    readonly title: string;
    readonly allName: (count: number) => string;
    readonly upcoming: string;
    readonly filteredEmpty: string;
    readonly more: string;
    readonly retry: string;
    /** «Покажи всички» — the filtered empty's way back (`visits.filter.clear`, the funnel's own word). */
    readonly filterClear: string;
    /** «3 посещения» · «1 посещение» — a month section's detail; the count inside a spoken sentence. */
    readonly sectionVisits: (count: number) => string;
  };
  readonly loyalty: {
    readonly title: string;
    readonly all: string;
    readonly allName: string;
    readonly rhythmUnit: (count: number) => string;
    /** «371 точки» · «1 точка» — the balance with its unit in words (a name, a sentence). */
    readonly points: (count: number) => string;
    /** «точки» · «точка» — the unit alone, beside a display figure (the glance's card, the pass). */
    readonly pointsWord: (count: number) => string;
    /** «Стигат за безплатно оформяне на брада» — the reward in the running case (`inSentence`). */
    readonly enoughForPoints: (reward: string) => string;
    /** «Още 42 до безплатно подстригване» — the points still missing, a count. */
    readonly moreTo: (points: number, reward: string) => string;
    /** «Ваучер» · «Печати» · «Ритъм» — a holding's label on the glance's card. */
    readonly holding: (holding: LoyaltyHoldingWord) => string;
    /** «3 от 10» — the stamps fact. */
    readonly stampsOf: (filled: number, size: number) => string;
    /**
     * «Лоялност: 371 точки. Стигат за безплатно оформяне на брада. Ваучер
     * 25,00 €, печати 3 от 10, ритъм 9 посещения.» — the card as ONE
     * button. `points` is worded (`points(371)`); the sentence and the
     * holdings each end on one full stop here, and an absent one leaves no gap.
     */
    readonly cardName: (
      points: string,
      sentence: string | null,
      holdings: string | null,
    ) => string;
  };
  readonly loyaltyPage: {
    /**
     * LE's row name: «Продукт по избор, 400 точки, още 92» — the unit in
     * words (a screen reader says «т» for «т.»), its form chosen by the
     * cost; `state` is the trailing «, …» (`rewardMoreSuffix` or a reason),
     * `''` when the reward is affordable.
     */
    readonly rewardName: (cost: number, title: string, state: string) => string;
    /** «, още 92» — the points still missing, as `rewardName`'s `state`. */
    readonly rewardMoreSuffix: (points: string) => string;
    readonly rhythm: string;
    readonly tier: string;
    readonly moreToGo: (points: string) => string;
    /** «Още 6 посещения» — the card's title already names the reward (one fact, once). */
    readonly stampsToNext: (count: number) => string;
    readonly rhythmBest: (count: number) => string;
    readonly tierQualifying: (count: number) => string;
    readonly tierTop: (count: number) => string;
    readonly tierName: (
      tier: string,
      count: number,
      remaining: number,
      next: string,
    ) => string;
    /**
     * «Карта за лоялност: Георги Петров, Злато, 371 точки за размяна,
     * клиент от март 2025 г.» — the pass as one group. The holder, the tier
     * and the tenure («март 2025 г.») are each absent when `null`.
     */
    readonly passName: (
      name: string | null,
      tier: string | null,
      points: number,
      since: string | null,
    ) => string;
    /** «40 т. изтичат на 31.12» — the pass's state line, only when an expiry is set. */
    readonly expiring: (points: number, date: string) => string;
    /** «Замразено» — the pass's state line for a paused client (the notice under it says why). */
    readonly passFrozen: string;
    /** «дължи 40 точки» — the pass's state line; primary ink, never red. */
    readonly owes: (points: number) => string;
    /** The four discs under the pass. */
    readonly actions: {
      /** «Действия» — the group's name. */
      readonly label: string;
      /** «Използвай» — the promoted disc (`staff.visit.useNow`, the ticket's own word). */
      readonly use: string;
      /** «Код» */
      readonly code: string;
      /** «Награди» */
      readonly catalog: string;
      /** «История» */
      readonly history: string;
      /** «Използвай награда на това посещение» */
      readonly useName: string;
      /** «Код: въведи или сканирай» */
      readonly codeName: string;
      /** «Награди за точки» */
      readonly catalogName: string;
      /** «История на движението» */
      readonly historyName: string;
      /** «2 награди» — the promoted disc's badge in words, with more than one ticket ready. */
      readonly useCount: (count: number) => string;
    };
    /** «В портфейла» — the holdings' heading. */
    readonly wallet: string;
    /** «В портфейла, 3» — the holdings' list. */
    readonly walletName: (count: number) => string;
    /** «3 · 55,00 €» — the heading's detail when vouchers are held. */
    readonly walletSum: (count: number, money: string) => string;
    /** «Портфейлът е празен.» */
    readonly walletEmpty: string;
    /** «Ваучер за подарък» — a voucher's title. */
    readonly voucher: string;
    /** «от 50,00 € · до 31.12» — a voucher's chip: what it was issued for, and its validity when it has one. */
    readonly voucherDetail: (money: string, until: string | null) => string;
    /** «Ваучер за подарък: 25,00 € от 50,00 €, важи до 31 декември» — `until` in words, a date someone hears. */
    readonly voucherFullName: (
      balance: string,
      value: string,
      until: string | null,
    ) => string;
    /** «Награда: безплатно подстригване, важи до 28 октомври» — a held ticket, static on this page. */
    readonly ticketName: (title: string, until: string | null) => string;
    /** «Карта с печати» — a stamp card's title. */
    readonly stampCard: string;
    /** «10 печата за безплатно подстригване» — a stamp card's line. */
    readonly stampsFor: (size: number, reward: string) => string;
    /** «3 от 10 печата, още 7 до безплатно подстригване» — the stamps' gauge, heard. */
    readonly stampsName: (
      filled: number,
      size: number,
      left: number,
      reward: string,
    ) => string;
    /** «до Платина» — the status card's first line. */
    readonly tierTo: (next: string) => string;
    /** «Най-високият статус» — the first line at the top (the keeping rule is the second: `tierQualifying`). */
    readonly tierHighest: string;
    /** «посещения в ритъм» · «посещение в ритъм» — the rhythm figure's unit. */
    readonly inRhythm: (count: number) => string;
    /** «Награди за точки» — the catalogue's heading on the wallet. */
    readonly catalogTitle: string;
    /**
     * «Награди за точки: 371 точки, стигат за 2 от 3 награди» — the grid's
     * name under that heading. `points` is WORDED (`loyalty.points(371)`,
     * as `loyalty.cardName` takes it); the rewards agree with `total`.
     */
    readonly catalogListName: (
      points: string,
      affordable: number,
      total: number,
    ) => string;
    /** «Движение» — the activity's heading on the wallet: the ledger page's own title. */
    readonly ledgerTitle: string;
    /** «Движение: всички записи» — the heading's «Всички». */
    readonly ledgerAllName: string;
  };
  readonly rhythm: {
    /** The track's sentence (`uiLabel`): «24 посещения в ритъм, най-много 26, следващото до 26 октомври». */
    readonly label: (count: number, best: string, next: string) => string;
    readonly bestSuffix: (count: number) => string;
    readonly nextSuffix: (date: string) => string;
    readonly dueBy: (date: string) => string;
    readonly markKept: (period: string, date: string) => string;
    readonly markProtected: (period: string, reason: string) => string;
    readonly markRepaired: (period: string) => string;
    readonly markMissed: (period: string) => string;
    readonly markCurrent: (date: string) => string;
    readonly reasonFreeze: string;
    readonly stateActive: (date: string) => string;
    readonly stateAtRisk: (weeks: number, date: string) => string;
    readonly stateInGrace: (date: string) => string;
    readonly stateFrozenFreeze: string;
    readonly stateBroken: (date: string) => string;
    readonly stateNone: string;
    readonly protections: (count: number) => string;
    /** «Замразено, докато записването е спряно» — a paused client's rhythm (`clientCard.frozen`). */
    readonly frozen: string;
    /*
     * The phase capsule: drawn only when the rhythm is NOT healthy (the
     * healthy phase has no word, the figure and the track say it).
     */
    /** «До 9.11» */
    readonly phaseAtRisk: (date: string) => string;
    /** «Гратис до 16.11» */
    readonly phaseInGrace: (date: string) => string;
    /** «Защитен» */
    readonly phaseFrozen: string;
    /** «Записан за 29.10» — a booked visit holds the due date. */
    readonly phaseHeld: (date: string) => string;
    /** «Прекъснат» */
    readonly phaseBroken: string;
    /** «Записан е за 29.10 · срокът се пази.» */
    readonly stateHeld: (date: string) => string;
    /** «Пропускът е за сметка на салона.» — a miss the shop's excuse covers. */
    readonly stateFrozenExcuse: string;
    /** «салонът отмени часа» — why a period is protected, `markProtected`'s `reason`. */
    readonly reason: (reason: RhythmReasonWord) => string;
    /** «Цялото правило» — the rule line's button (it unfolds the rule in place). */
    readonly ruleMore: string;
    /**
     * «От 1.10: на всеки 5 седмици» — a scheduled rule (`rhythmRule.upcoming`):
     * `rule` is the coming rule's short form in the running case.
     */
    readonly ruleUpcoming: (date: string, rule: string) => string;
  };
  /** The ledger page «Движение» and the wallet's activity rows. */
  readonly ledgerPage: {
    /** «Движение» */
    readonly title: string;
    /** «Георги Петров · 371 т.» — ONE sentence; `points` is the fact (`ledgerPage.points(371)`). */
    readonly subline: (name: string, points: string) => string;
    /** «Вид» — the filter's toolbar. */
    readonly filterLabel: string;
    /** «Всички» · «Точки» · «Награди» · «Статус» */
    readonly filter: (kind: LedgerFilterWord) => string;
    /**
     * «+27 т.» · «−250 т.» · «0 т.» — a movement or a month's net. The sign
     * is the typographic minus (U+2212): it carries the direction, never a colour.
     */
    readonly signed: (delta: number) => string;
    /** «371 т.» — a balance (the row's balance after, the subline's fact, a reward's cost). */
    readonly points: (points: number) => string;
    /** «Още няма движение.» */
    readonly empty: string;
    /** «Няма записи от този вид.» */
    readonly emptyFiltered: string;
  };
  readonly ledger: {
    readonly verb: (verb: LedgerVerbWord) => string;
    readonly visit: string;
    /** «Посещение: Фейд, Оформяне на брада» — a visit row's spoken source. */
    readonly visitOf: (services: string) => string;
    readonly welcome: string;
    readonly level: (title: string, level: string) => string;
    readonly redemption: (reward: string) => string;
    readonly goodwill: string;
    readonly serviceIssue: string;
    readonly correction: string;
    readonly reverses: (date: string) => string;
    /** «Статус: Злато» — a tier change's title. */
    readonly tier: (to: string) => string;
    /** «от Сребро» — a tier change's line. */
    readonly tierFrom: (from: string) => string;
    /** «получена награда» */
    readonly rewardGranted: string;
    /** «отнета награда» */
    readonly rewardRevoked: string;
    /** «размяна» */
    readonly redeemed: string;
    /** «постижение» */
    readonly achievement: string;
  };
  /** «Рекорди»: the four cards on «Постижения» and the page of their own. */
  readonly records: {
    /** «Ритъм» · «Посещения» · «Любими» — a group's heading. */
    readonly group: (theme: RecordTheme) => string;
    /** «По години» */
    readonly byYear: string;
    /** «Ритъм сега» · «Общо посещения» · … — a row that is not a record of the account's. */
    readonly row: (row: RecordRowWord) => string;
    /** «Най-дълъг ритъм» — a record's label, sentence case (`achievements.record` is the running case). */
    readonly label: (kind: RecordKindWord) => string;
    /** «23 пъти» · «1 път» — a favourite's detail. */
    readonly times: (count: number) => string;
    /** «2025 г.» — a record's year. */
    readonly yearValue: (year: string) => string;
    /** «от юни 2026 г.» — the day a run began. */
    readonly since: (since: string) => string;
    /** «2025: 13 посещения, рекорд» — a year's meter, heard. */
    readonly yearName: (year: string, count: number, record: boolean) => string;
    /**
     * «поредни посещения в ритъм» · «посещение в ритъм» — the featured
     * record's words under its figure. `count` is that figure and chooses
     * the form (without it: the plural); the first visit's figure is a
     * date, its words take none.
     */
    readonly sentence: (
      kind: Exclude<RecordKindWord, typeof RecordKindWord.FavouriteService>,
      count?: number,
    ) => string;
    /**
     * «посещения с фейд» · «посещение с фейд» — the featured favourite's
     * words; the service in the running case, `count` as `sentence` takes it.
     */
    readonly sentenceFavourite: (service: string, count?: number) => string;
    /** «Рекордите идват с първите посещения.» */
    readonly empty: string;
  };
  readonly achievements: {
    readonly title: string;
    readonly levels: (count: number) => string;
    readonly levelsUnit: (count: number) => string;
    readonly allName: (count: number) => string;
    readonly cueWithThisVisit: (title: string, level: string) => string;
    readonly cueNew: (title: string, level: string) => string;
    readonly cueClose: (
      title: string,
      value: number,
      target: number,
      level: string,
    ) => string;
    readonly summaryName: (count: number) => string;
    readonly seasonFact: (season: string, level: string) => string;
    readonly eventsFact: (count: number) => string;
    readonly events: string;
    readonly records: string;
    readonly archive: string;
    readonly toLevel: (value: number, target: number, level: string) => string;
    /**
     * «II на 1.03.2027» — a calendar-driven family's caption (tenure): the
     * day its next level lands, never a count of days.
     */
    readonly toLevelOn: (level: string, date: string) => string;
    readonly complete: string;
    readonly withThisVisit: string;
    /** «Ниво III с това посещение» — the open visit completes the next level. */
    readonly nextWithThisVisit: (level: string) => string;
    readonly dayGroupName: (date: string, count: number) => string;
    readonly dayTitle: (date: string) => string;
    readonly seasonNext: (count: number, level: string) => string;
    /**
     * «Сезонни: 1 от 4», «1 от 1» — the families EARNED (a level, a filled
     * disc) of the total: beside medals a bare «N от M» reads as earned, so
     * it is (wave D r6). Started is worded where it prints (`scopeSubline`).
     */
    readonly seasonFamilies: (earned: number, total: number) => string;
    readonly familyCount: (earned: number, total: number) => string;
    readonly eventUntil: (date: string) => string;
    readonly eventAnnounced: (date: string) => string;
    readonly scopeSubline: (
      name: string,
      started: number,
      total: number,
    ) => string;
    readonly sectionGeneral: string;
    readonly sectionBarbers: string;
    readonly sectionShops: string;
    readonly firstHint: string;
    /** «Сезонът приключи.» — the subline holds the dates, the rim and the track the level. */
    readonly seasonEnded: string;
    /** «Сезонът приключи на ниво III.» — heard only (a track's or a ladder's value text): the level is drawn. */
    readonly seasonEndedAt: (level: string) => string;
    readonly record: (kind: RecordKindWord) => string;
    readonly favouriteValue: (service: string, count: string) => string;
    /** «×24» — the favourite service's figure: a count of times. */
    readonly favouriteCount: (count: string) => string;
    /** «Ново» — the quiet marker (never a celebration on a staff surface). */
    readonly isNew: string;
    /** «Всички рекорди» — the records heading's «Всички». */
    readonly recordsAllName: string;
    /**
     * «Най-дълъг ритъм: 23 посещения, септември 2026 г., нов рекорд» — a
     * record card as one button; the detail and the capsule only when present.
     */
    readonly recordName: (
      caption: string,
      value: string,
      detail: string | null,
      isNew: boolean,
    ) => string;
    /** «Нов рекорд» — the capsule of a record set in the last 30 days. */
    readonly newRecord: string;
    /** «Рекорди: любима услуга Фейд, най-много за година 13» — the glance's records line as a button. */
    readonly recordsLineName: (facts: string) => string;
    /** «Категории» — the chips' toolbar. */
    readonly chipsLabel: string;
    /** «Сезони» — the chip a season or an event adds. */
    readonly chipSeasons: string;
    /** «Етапи, 3 от 5 спечелени» — a chip, heard (no count is printed on it). */
    readonly chipName: (
      category: string,
      earned: number,
      total: number,
    ) => string;
    /** «Почти спечелени» */
    readonly close: string;
    /** «от 42 медала» — the collection's first line, beside the ring's figure. */
    readonly collectionOf: (total: number) => string;
    /** «Колекция: 18 от 42 медала, 38 спечелени нива» — the ring as a meter. */
    readonly collectionName: (
      earned: number,
      total: number,
      levels: number,
    ) => string;
    /** «Покажи всички 12» — a folded category's way to its whole. */
    readonly showAll: (count: number) => string;
    /** «Майсторство · 3 от 5 спечелени» — the category view's quiet line. */
    readonly categorySummary: (
      category: string,
      earned: number,
      total: number,
    ) => string;
  };
  readonly achievement: {
    readonly stateToNext: (
      value: number,
      target: number,
      level: string,
    ) => string;
    /** «Ниво II на 1.03.2027» — a calendar-driven family's state line (tenure). */
    readonly stateToNextOn: (level: string, date: string) => string;
    readonly repeated: (count: number, date: string) => string;
    readonly oneOffEarned: (date: string) => string;
    readonly oneOffNotYet: string;
    readonly notStarted: string;
    readonly retired: string;
    readonly more: (scope: string) => string;
    readonly ladderName: (
      level: string,
      max: string,
      value: number,
      target: number,
      next: string,
    ) => string;
    readonly levelName: (
      level: string,
      requirement: string,
      earned: string,
      award: string,
    ) => string;
    readonly earnedOn: (date: string) => string;
    readonly gavePoints: (points: number) => string;
    readonly gaveCoupon: (title: string) => string;
    readonly gaveFreeze: (count: number) => string;
    readonly awardShort: (points: string) => string;
    readonly medalEarnedName: (
      title: string,
      level: string,
      date: string,
      next: string,
      isNew: string,
    ) => string;
    readonly medalProgressName: (
      title: string,
      value: number,
      target: number,
      level: string,
    ) => string;
    readonly medalNotStartedName: (
      title: string,
      requirement: string,
    ) => string;
    readonly newSuffix: string;
    readonly nextSuffix: (
      value: number,
      target: number,
      level: string,
    ) => string;
    /** «, ниво II на 1 март 2027 г.» — `nextSuffix` for a calendar-driven family. */
    readonly nextOnSuffix: (level: string, date: string) => string;
    /*
     * THE MEDAL DETAIL of revision 3 (§2.4): the stage's state line, the
     * progress card, «Как се печели», the ladder, the dock's verb.
     */
    /** «Майсторство · Ниво II · от 24.09.2025 г.» — the state line, ONE sentence (the date is its fact). */
    readonly stateWithCategory: (category: string, state: string) => string;
    /** «Ниво II · от 24.09.2025 г.» — `stateWithCategory`'s state: the highest level earned. */
    readonly levelSince: (level: string, date: string) => string;
    /** «Всички нива · последното на 3.06.2026 г.» — the state of a ladder climbed to its top. */
    readonly completeSince: (date: string) => string;
    /** «още не е започнато» — the state in the running case (`notStarted` opens a line of its own). */
    readonly stateNotStarted: string;
    /** «от 25» — the progress figure's unit. */
    readonly progressOf: (target: number) => string;
    /**
     * «завършени посещения» · «приятели, дошли по препоръка» — WHAT the
     * progress figure counts, the line under «23 от 25»: the words of the
     * family's metric (`achievementMetricWord`), in the form the figure
     * asks for. `count` is the figure the words stand under, the next
     * level's threshold: «0 от 1» reads «приятел, дошъл по препоръка».
     */
    readonly what: (metric: AchievementHowWord, count: number) => string;
    /** «посещения с фейд» — a visit count narrowed to a service, in the running case: the records' own sentence. */
    readonly whatService: (service: string, count: number) => string;
    /** «посещения при Иван» — narrowed to a barber. */
    readonly whatBarber: (barber: string, count: number) => string;
    /** «посещения в Център» — narrowed to a shop. */
    readonly whatShop: (shop: string, count: number) => string;
    /** «поредни посещения в ритъм» — the rhythm family (no metric: its figure is the best run), the record's own sentence. */
    readonly whatRhythm: (count: number) => string;
    /** «Още 2 до ниво III» */
    readonly remaining: (count: number, level: string) => string;
    /** «С това посещение: 24 от 25» — the visit's legs already hold what is counted; the glance's cue grammar. */
    readonly thisVisitCounts: (value: number, target: number) => string;
    /** «Добави фейд» — the dock's verb; the service in the running case (`inSentence`). */
    readonly addToVisit: (service: string) => string;
    /** «Добави Фейд към посещението» — the verb's name, the service as written. */
    readonly addToVisitName: (service: string) => string;
    /** «Добавихме фейд към посещението.» — the receipt; the service in the running case, as the verb says it (X1-3). */
    readonly added: (service: string) => string;
    /** «Как се печели» — the block's heading. */
    readonly howTitle: string;
    /** «Всяко завършено посещение се брои.» — the sentence of a metric that names no subject. */
    readonly how: (metric: AchievementHowWord) => string;
    /** «Всяко посещение с фейд се брои, щом приключи.» — the service in the running case. */
    readonly howService: (service: string) => string;
    /** «Всяко посещение при Иван се брои, щом приключи.» */
    readonly howBarber: (barber: string) => string;
    /** «Всяко посещение в Център се брои, щом приключи.» */
    readonly howShop: (shop: string) => string;
    /** «При всеки бръснар · във всеки салон» — who and where. */
    readonly who: (open: AchievementWhoWord) => string;
    /** «Отменени часове и неявявания не се броят.» — the exclusion, once. */
    readonly excluded: string;
    /** «+3» — the covers folded into the fourth. */
    readonly moreCount: (count: number) => string;
    /** «Нива» — the ladder's heading. */
    readonly levelsTitle: string;
    /** «Ниво III · 25 посещения» — a ladder row's first line. */
    readonly levelRow: (level: string, requirement: string) => string;
    /**
     * «Ниво II, 10 посещения, 50 точки, спечелено на 24 септември 2025 г.»
     * — a ladder row, heard; the reward and the day only when present.
     */
    readonly levelRowName: (
      level: string,
      requirement: string,
      reward: string | null,
      earnedOn: string | null,
    ) => string;
    /** «50 точки» — what a level gives. */
    readonly awardPoints: (points: number) => string;
    /** «Значка в профила» — a level that gives no points and no reward. */
    readonly awardBadge: string;
    /** «Награда» — a one-off family's single row. */
    readonly awardOneOff: string;
    /** «Броени посещения» — the heading over the visits that counted. */
    readonly visitsTitle: string;
  };
  readonly photos: {
    readonly title: string;
    readonly label: string;
    readonly name: (when: string) => string;
  };
  readonly history: {
    readonly visits: (count: number) => string;
    readonly noShows: (count: number) => string;
    readonly cancelled: (count: number) => string;
    readonly interval: string;
    /** «~6» — the interval cell's figure; its unit is `intervalUnit`, at the unit's rung. */
    readonly intervalValue: (weeks: number) => string;
    /** «седм.» — ui-metric's unit slot, as «388 т.» and «41 нива» (wave D r6). */
    readonly intervalUnit: string;
    /**
     * «, средно на 4 седмици» — `statsName`'s `{{interval}}` slot: the
     * cadence in words, never the cell's «~4 седм.» (a screen reader says
     * «тилда» and «седм»).
     */
    readonly statsInterval: (weeks: number) => string;
    readonly statsName: (
      visits: string,
      interval: string,
      risk: string,
    ) => string;
    readonly noRisk: string;
    readonly spend: (money: string) => string;
    /**
     * «13 посещения» · «1 посещение» — a visit count the records and the
     * medals say: `visits.section.visits`, the key W4 renamed to, so it is
     * the same sentence as `visitsModule.sectionVisits`.
     */
    readonly yearVisits: (count: number) => string;
    readonly end: (date: string) => string;
    /**
     * «Това е всичко.» — the end of a complete list whose last row IS the
     * first visit: the row above already prints its date.
     */
    readonly endAll: string;
    readonly onlyThisVisit: string;
    /**
     * «23 посещения · през 4 седмици» — the visits page's first quiet line,
     * ONE sentence: `visits` is worded (`visitsModule.sectionVisits`),
     * `cadence` is `head.cadence(weeks)`.
     */
    readonly line: (visits: string, cadence: string) => string;
    /** «похарчени общо 492,50 €» — the second line's sum, an admin's only. */
    readonly spendInline: (money: string) => string;
    /** «Първо посещение: 1.03.2025 г.» — the foot of a complete list. */
    readonly first: (date: string) => string;
  };
  readonly failed: {
    readonly profile: string;
    readonly loyalty: string;
    readonly achievements: string;
    readonly visits: string;
    readonly photos: string;
    readonly some: string;
    /** «Ваучерите не се заредиха.» */
    readonly vouchers: string;
    /** «Движението не се зареди.» */
    readonly activity: string;
  };
  readonly remove: string;
  readonly exitsLabel: string;
  /**
   * L — «Лични данни»: an admin's data-subject acts (audit-hardening
   * Phase 3). A refusal's words are `errors.<errorCode>`, worded by the
   * presenter through `wordPipelineError`, never held here.
   */
  readonly privacy: ClientPrivacyWords;
  /**
   * L — the erasure's words in the same group (audit-hardening Phase 3,
   * WS-D; the catalogue's `clientCard.privacy.erase*` / `alert*` keys). A
   * refusal's words are `errors.<errorCode>`, as the export's.
   */
  readonly erasure: ClientErasureWords;
  /**
   * The «Роли» block's words (security hardening S-WS-E, S-RU-13; the
   * catalogue's `clientCard.roles.*`). A refusal's words are
   * `errors.<errorCode>`, worded by the presenter through
   * `wordPipelineError`, never held here.
   */
  readonly roles: ClientRolesWords;
}

/** L — the privacy group's own words (`clientCard.privacy.*`). */
export interface ClientPrivacyWords {
  /** «Лични данни» — the group's name for a reader. */
  readonly groupLabel: string;
  /** «Изтегли данните». */
  readonly export: string;
  /** «Файлът е изтеглен.» */
  readonly exportDone: string;
}

/** A role the «Роли» block can grant or take away — a member of `Roles.ASSIGNABLE` (every role but the sysadmin). */
export type AssignableRole = (typeof Roles.ASSIGNABLE)[number];

/** The «Роли» block's own words (`clientCard.roles.*`). */
export interface ClientRolesWords {
  /** «Роли» — the group's name for a reader. */
  readonly groupLabel: string;
  /** Each assignable role's name: «Клиент», «Бръснар», «Рецепция», «Съдържание», «Администратор». */
  readonly role: { readonly [R in AssignableRole]: string };
  /** «Запази ролите». */
  readonly save: string;
  /** «Ролите са запазени. Важат от следващото влизане.» */
  readonly saved: string;
}

/** The figures the erasure's alert prints — each a server census count, or the siblings' number. */
export interface ErasureAlertFigures {
  readonly visits: number;
  readonly notes: number;
  readonly photos: number;
  readonly accounts: number;
  readonly siblings: number;
}

/** L — the erasure's words (`clientCard.privacy.erase*`, `clientCard.privacy.alert*`). */
export interface ClientErasureWords {
  /** «Изтрий личните данни» — the record's row, whatever the system offers (erase, resume, re-sweep). */
  readonly erase: string;
  /** «Изтрий записа със същия телефон или имейл» — a sibling record's row; never its name. */
  readonly eraseSibling: string;
  /** «Изтрит клиент» — an erased record's line. */
  readonly erased: string;
  /** «Изтриването още не е завършило. Опитай пак.» */
  readonly eraseUnfinished: string;
  /** «Да изтрием ли личните данни?» — the alert's question. */
  readonly alertTitle: string;
  /** The alert's message: the census in figures, then what goes and what stays. */
  readonly alertBody: (figures: ErasureAlertFigures) => string;
  /** «Изтрий» — the alert's destructive answer. */
  readonly eraseConfirm: string;
  /** «Отказ» — the alert's safe answer. */
  readonly eraseKeep: string;
}

/**
 * The card's words in one language, from the catalogue once. `lang` picks
 * the plural forms and rides along for every `Intl` call.
 */
export function clientCardWordsOf(
  translate: ClientCardTranslate,
  lang: string,
): ClientCardWords {
  const plural = (key: string, count: number, params: Params = {}) =>
    translate(`${key}.${pluralForm(count, lang)}`, { count, ...params });
  /** A count as it prints: grouped the locale's way. */
  const n = (count: number) => formatCount(count, lang);
  /** A plural sentence whose count prints grouped («1 200 точки»). */
  const counted = (key: string, count: number, params: Params = {}) =>
    plural(key, count, { count: n(count), ...params });
  /** A sentence whose form one of its OWN slots chooses (the stamps' by the card's size). */
  const formed = (key: string, by: number, params: Params) =>
    translate(`${key}.${pluralForm(by, lang)}`, params);
  /** The form a count asks for; with no count, the plural. */
  const formOf = (count: number | undefined) =>
    count === undefined ? 'other' : pluralForm(count, lang);
  /** An optional slot: the catalogue's own suffix, or nothing. */
  const slot = (fact: string | null, suffix: (fact: string) => string) =>
    fact === null || fact === '' ? '' : suffix(fact);
  /** «, …» — a fact joining a spoken sentence; the joint goes with an absent fact. */
  const listed = (fact: string | null) => slot(fact, (it) => `, ${it}`);
  const ageSuffix = (age: number | null) =>
    age === null
      ? ''
      : formed('clientCard.birthday.ageSuffix', age, { age: n(age) });
  const collectionOf = (total: number) =>
    formed('clientCard.achievements.collectionOf', total, { total: n(total) });
  const ticketUntil = (until: string | null) =>
    slot(until, (date) =>
      translate('clientCard.loyaltyPage.ticketUntilSuffix', { date }),
    );
  return {
    lang,
    visits: visitWordsOf(translate, lang, VisitPerspective.Staff),
    waitlist: visitWaitlistWordsOf(translate),
    monthShort: (month) => translate(`visits.tile.month.${month}`),
    head: {
      since: (since) => translate('clientCard.head.since', { since }),
      firstVisit: translate('clientCard.head.firstVisit'),
      guest: translate('clientCard.head.guest'),
      pausedUntil: (date) => translate('clientCard.head.pausedUntil', { date }),
      pausedPermanent: translate('clientCard.head.pausedPermanent'),
      sinceCadence: (since, cadence) =>
        translate('clientCard.head.sinceCadence', { since, cadence }),
      cadence: (weeks) => counted('clientCard.head.cadence', weeks),
      tierName: (tier, remaining, next) =>
        translate('clientCard.head.tierName', { tier, remaining, next }),
      tierTopName: (tier) => translate('clientCard.head.tierTopName', { tier }),
    },
    birthday: {
      today: translate('clientCard.birthday.today'),
      todayAge: (age) =>
        translate('clientCard.birthday.todayAge', { age: n(age) }),
      gift: translate('clientCard.birthday.gift'),
      upcoming: (weekday, date, age) =>
        translate('clientCard.birthday.upcoming', { weekday, date }) +
        (age === null
          ? ''
          : translate('clientCard.birthday.upcomingAge', { age: n(age) })),
      name: (age) =>
        translate('clientCard.birthday.name', { age: ageSuffix(age) }),
      giftName: (age, value) =>
        translate('clientCard.birthday.giftName', {
          age: ageSuffix(age),
          value,
        }),
      giftAppliedName: (age, value) =>
        translate('clientCard.birthday.giftAppliedName', {
          age: ageSuffix(age),
          value,
        }),
    },
    visitCard: {
      last: translate('visits.card.last'),
      next: translate('visits.card.next'),
      name: (label, sentence) =>
        translate('visits.card.name', { label, sentence }),
    },
    capsules: {
      label: translate('clientCard.capsules.label'),
      noShows: (count) => plural('clientCard.capsule.noShows', count),
      more: (count) => translate('clientCard.plusCount', { count }),
    },
    offline: translate('clientCard.offline'),
    actions: {
      label: translate('clientCard.actions.label'),
      call: translate('staff.day.visitCall'),
      sms: translate('clientCard.actions.sms'),
      viber: translate('clientCard.actions.viber'),
      repeat: translate('clientCard.actions.repeat'),
      callName: (name, phone) =>
        translate('clientCard.actions.callName', { name, phone }),
      smsName: (name) => translate('clientCard.actions.smsName', { name }),
      viberName: (name) => translate('clientCard.actions.viberName', { name }),
      againName: (date, services) =>
        translate('clientCard.actions.againName', { date, services }),
    },
    reward: {
      until: (date) => translate('clientCard.reward.until', { date }),
      more: (count) => translate('clientCard.reward.more', { count }),
      name: (title, value) =>
        value === null
          ? translate('clientCard.reward.nameBare', { title })
          : translate('clientCard.reward.name', { title, value }),
      appliedName: (title, value) =>
        value === null
          ? translate('clientCard.reward.appliedNameBare', { title })
          : translate('clientCard.reward.appliedName', { title, value }),
      stack: (count) =>
        translate('clientCard.reward.stack', {
          count: formatCount(count, lang),
        }),
      use: translate('staff.visit.useNow'),
      remove: translate('staff.visit.remove'),
      removeName: (title) =>
        `${translate('staff.visit.removeDiscount')}: ${title}`,
    },
    visitsModule: {
      title: translate('clientCard.visits.title'),
      allName: (count) => translate('clientCard.visits.allName', { count }),
      upcoming: translate('appointments.sections.upcoming'),
      filteredEmpty: translate('appointments.empty.filtered'),
      more: translate('visits.more'),
      retry: translate('visits.retry'),
      filterClear: translate('visits.filter.clear'),
      sectionVisits: (count) => counted('visits.section.visits', count),
    },
    loyalty: {
      title: translate('clientCard.loyalty.title'),
      all: translate('clientCard.loyalty.all'),
      allName: translate('clientCard.loyalty.allName'),
      rhythmUnit: (count) => plural('clientCard.loyalty.rhythmUnit', count),
      points: (count) => counted('clientCard.loyalty.points', count),
      pointsWord: (count) => plural('clientCard.loyalty.pointsWord', count),
      enoughForPoints: (reward) =>
        translate('clientCard.loyalty.enoughForPoints', { reward }),
      moreTo: (points, reward) =>
        translate('clientCard.loyalty.moreTo', { points: n(points), reward }),
      holding: (holding) => translate(`clientCard.loyalty.holding.${holding}`),
      stampsOf: (filled, size) =>
        translate('clientCard.loyalty.stampsOf', {
          filled: n(filled),
          size: n(size),
        }),
      cardName: (points, sentence, holdings) =>
        withoutGaps(
          translate('clientCard.loyalty.cardName', {
            points,
            sentence: slot(sentence, oneStop),
            holdings: slot(holdings, oneStop),
          }),
        ),
    },
    loyaltyPage: {
      rewardName: (cost, title, state) =>
        plural('clientCard.loyaltyPage.rewardName', cost, {
          count: formatCount(cost, lang),
          title,
          state,
        }),
      rewardMoreSuffix: (points) =>
        translate('clientCard.loyaltyPage.rewardMoreSuffix', { points }),
      rhythm: translate('clientCard.loyaltyPage.rhythm'),
      tier: translate('clientCard.loyaltyPage.tier'),
      moreToGo: (points) =>
        translate('clientCard.loyaltyPage.moreToGo', { points }),
      stampsToNext: (count) =>
        plural('clientCard.loyaltyPage.stampsToNext', count),
      rhythmBest: (count) =>
        translate('clientCard.loyaltyPage.rhythmBest', { count }),
      tierQualifying: (count) =>
        plural('clientCard.loyaltyPage.tierQualifying', count),
      tierTop: (count) => plural('clientCard.loyaltyPage.tierTop', count),
      tierName: (tier, count, remaining, next) =>
        plural('clientCard.loyaltyPage.tierName', count, {
          tier,
          remaining,
          next,
        }),
      passName: (name, tier, points, since) =>
        withoutEmptyLead(
          formed('clientCard.loyaltyPage.passName', points, {
            name: name ?? '',
            tier: slot(tier, (it) =>
              translate('clientCard.loyaltyPage.passTierSuffix', { tier: it }),
            ),
            points: n(points),
            since: slot(since, (it) =>
              translate('clientCard.loyaltyPage.passSinceSuffix', {
                since: it,
              }),
            ),
          }),
        ),
      expiring: (points, date) =>
        formed('clientCard.loyaltyPage.expiring', points, {
          points: n(points),
          date,
        }),
      passFrozen: translate('clientCard.loyaltyPage.passFrozen'),
      owes: (points) =>
        translate('clientCard.loyaltyPage.owes', {
          points: counted('clientCard.loyalty.points', points),
        }),
      actions: {
        label: translate('clientCard.loyaltyPage.actions.label'),
        use: translate('staff.visit.useNow'),
        code: translate('clientCard.loyaltyPage.actions.code'),
        catalog: translate('clientCard.loyaltyPage.actions.catalog'),
        history: translate('clientCard.loyaltyPage.actions.history'),
        useName: translate('clientCard.loyaltyPage.actions.useName'),
        codeName: translate('clientCard.loyaltyPage.actions.codeName'),
        catalogName: translate('clientCard.loyaltyPage.actions.catalogName'),
        historyName: translate('clientCard.loyaltyPage.actions.historyName'),
        useCount: (count) => counted('clientCard.loyaltyPage.useCount', count),
      },
      wallet: translate('clientCard.loyaltyPage.wallet'),
      walletName: (count) =>
        translate('clientCard.loyaltyPage.walletName', { count: n(count) }),
      walletSum: (count, money) =>
        translate('clientCard.loyaltyPage.walletSum', {
          count: n(count),
          money,
        }),
      walletEmpty: translate('clientCard.loyaltyPage.walletEmpty'),
      voucher: translate('clientCard.loyaltyPage.voucher'),
      voucherDetail: (money, until) =>
        translate('clientCard.loyaltyPage.voucherDetail', {
          money,
          until: slot(until, (date) =>
            translate('clientCard.loyaltyPage.voucherUntil', { date }),
          ),
        }),
      voucherFullName: (balance, value, until) =>
        translate('clientCard.loyaltyPage.voucherFullName', {
          balance,
          value,
          until: ticketUntil(until),
        }),
      ticketName: (title, until) =>
        translate('clientCard.loyaltyPage.ticketName', {
          title,
          until: ticketUntil(until),
        }),
      stampCard: translate('clientCard.loyaltyPage.stampCard'),
      stampsFor: (size, reward) =>
        formed('clientCard.loyaltyPage.stampsFor', size, {
          size: n(size),
          reward,
        }),
      stampsName: (filled, size, left, reward) =>
        formed('clientCard.loyaltyPage.stampsName', size, {
          filled: n(filled),
          size: n(size),
          left: n(left),
          reward,
        }),
      tierTo: (next) => translate('clientCard.loyaltyPage.tierTo', { next }),
      tierHighest: translate('clientCard.loyaltyPage.tierHighest'),
      inRhythm: (count) => plural('clientCard.loyaltyPage.inRhythm', count),
      catalogTitle: translate('clientCard.loyaltyPage.catalogTitle'),
      catalogListName: (points, affordable, total) =>
        formed('clientCard.loyaltyPage.catalogListName', total, {
          points,
          affordable: n(affordable),
          total: n(total),
        }),
      ledgerTitle: translate('clientCard.ledgerPage.title'),
      ledgerAllName: translate('clientCard.loyaltyPage.ledgerAllName'),
    },
    rhythm: {
      label: (count, best, next) =>
        plural('clientCard.rhythm.label', count, { best, next }),
      bestSuffix: (count) =>
        translate('clientCard.rhythm.bestSuffix', { count }),
      nextSuffix: (date) => translate('clientCard.rhythm.nextSuffix', { date }),
      dueBy: (date) => translate('clientCard.rhythm.dueBy', { date }),
      markKept: (period, date) =>
        translate('clientCard.rhythm.mark.kept', { period, date }),
      markProtected: (period, reason) =>
        translate('clientCard.rhythm.mark.protected', { period, reason }),
      markRepaired: (period) =>
        translate('clientCard.rhythm.mark.repaired', { period }),
      markMissed: (period) =>
        translate('clientCard.rhythm.mark.missed', { period }),
      markCurrent: (date) =>
        translate('clientCard.rhythm.mark.current', { date }),
      reasonFreeze: translate('clientCard.rhythm.reason.freeze'),
      stateActive: (date) =>
        translate('clientCard.rhythm.state.active', { date }),
      stateAtRisk: (weeks, date) =>
        formed('clientCard.rhythm.state.atRisk', weeks, { weeks, date }),
      stateInGrace: (date) =>
        translate('clientCard.rhythm.state.inGrace', { date }),
      stateFrozenFreeze: translate('clientCard.rhythm.state.frozenFreeze'),
      stateBroken: (date) =>
        translate('clientCard.rhythm.state.broken', { date }),
      stateNone: translate('clientCard.rhythm.state.none'),
      protections: (count) =>
        translate('clientCard.rhythm.protections', { count }),
      frozen: translate('clientCard.frozen'),
      phaseAtRisk: (date) =>
        translate('clientCard.rhythm.phase.atRisk', { date }),
      phaseInGrace: (date) =>
        translate('clientCard.rhythm.phase.inGrace', { date }),
      phaseFrozen: translate('clientCard.rhythm.phase.frozen'),
      phaseHeld: (date) => translate('clientCard.rhythm.phase.held', { date }),
      phaseBroken: translate('clientCard.rhythm.phase.broken'),
      stateHeld: (date) => translate('clientCard.rhythm.state.held', { date }),
      stateFrozenExcuse: translate('clientCard.rhythm.state.frozenExcuse'),
      reason: (reason) => translate(`clientCard.rhythm.reason.${reason}`),
      ruleMore: translate('clientCard.rhythm.ruleMore'),
      ruleUpcoming: (date, rule) =>
        translate('rhythmRule.upcoming', { date, rule }),
    },
    ledgerPage: {
      title: translate('clientCard.ledgerPage.title'),
      subline: (name, points) =>
        translate('clientCard.ledgerPage.subline', { name, points }),
      filterLabel: translate('clientCard.ledgerPage.filter.label'),
      filter: (kind) => {
        switch (kind) {
          case LedgerFilterWord.All:
            return translate('clientCard.loyalty.all');
          case LedgerFilterWord.Status:
            return translate('clientCard.loyaltyPage.tier');
          case LedgerFilterWord.Points:
          case LedgerFilterWord.Rewards:
            return translate(`clientCard.ledgerPage.filter.${kind}`);
        }
      },
      signed: (delta) =>
        formed('clientCard.ledgerPage.signed', Math.abs(delta), {
          sign: delta > 0 ? '+' : delta < 0 ? MINUS : '',
          points: n(Math.abs(delta)),
        }),
      points: (points) =>
        formed('clientCard.ledgerPage.signed', Math.abs(points), {
          sign: points < 0 ? MINUS : '',
          points: n(Math.abs(points)),
        }),
      empty: translate('clientCard.ledgerPage.empty'),
      emptyFiltered: translate('clientCard.ledgerPage.emptyFiltered'),
    },
    ledger: {
      verb: (verb) => translate(`clientCard.ledger.verb.${verb}`),
      visit: translate('clientCard.ledger.source.visit'),
      visitOf: (services) =>
        translate('clientCard.ledger.source.visitOf', { services }),
      welcome: translate('clientCard.ledger.source.welcome'),
      level: (title, level) =>
        translate('clientCard.ledger.source.level', { title, level }),
      redemption: (reward) =>
        translate('clientCard.ledger.source.redemption', { reward }),
      goodwill: translate('clientCard.ledger.source.goodwill'),
      serviceIssue: translate('clientCard.ledger.source.serviceIssue'),
      correction: translate('clientCard.ledger.source.correction'),
      reverses: (date) =>
        translate('clientCard.ledger.source.reverses', { date }),
      tier: (to) => translate('clientCard.ledger.source.tier', { to }),
      tierFrom: (from) =>
        translate('clientCard.ledger.source.tierFrom', { from }),
      rewardGranted: translate('clientCard.ledger.source.rewardGranted'),
      rewardRevoked: translate('clientCard.ledger.source.rewardRevoked'),
      redeemed: translate('clientCard.ledger.source.redeemed'),
      achievement: translate('clientCard.ledger.source.achievement'),
    },
    records: {
      group: (theme) => translate(`clientCard.records.group.${theme}`),
      byYear: translate('clientCard.records.byYear'),
      row: (row) => translate(`clientCard.records.row.${row}`),
      label: (kind) => translate(`clientCard.records.label.${kind}`),
      times: (count) => counted('clientCard.records.times', count),
      yearValue: (year) => translate('clientCard.records.yearValue', { year }),
      since: (since) => translate('clientCard.records.since', { since }),
      yearName: (year, count, record) =>
        formed('clientCard.records.yearName', count, {
          year,
          count: n(count),
          record: record ? translate('clientCard.records.recordSuffix') : '',
        }),
      sentence: (kind, count) =>
        kind === RecordKindWord.FirstVisit
          ? translate('clientCard.records.sentence.firstVisit')
          : translate(`clientCard.records.sentence.${kind}.${formOf(count)}`),
      sentenceFavourite: (service, count) =>
        translate(
          `clientCard.records.sentence.favouriteService.${formOf(count)}`,
          {
            service,
          },
        ),
      empty: translate('clientCard.records.empty'),
    },
    achievements: {
      title: translate('clientCard.achievements.title'),
      levels: (count) => plural('clientCard.achievements.levels', count),
      // The summary's figure is its own run (`ui-metric [uiValue]`), so the
      // unit is the same plural sentence with the count left out: the form
      // is still chosen by the count.
      levelsUnit: (count) =>
        plural('clientCard.achievements.levels', count, { count: '' }).trim(),
      allName: (count) => plural('clientCard.achievements.allName', count),
      cueWithThisVisit: (title, level) =>
        translate('clientCard.achievements.cueWithThisVisit', { title, level }),
      cueNew: (title, level) =>
        translate('clientCard.achievements.cueNew', { title, level }),
      cueClose: (title, value, target, level) =>
        translate('clientCard.achievements.cueClose', {
          title,
          value,
          target,
          level,
        }),
      summaryName: (count) =>
        plural('clientCard.achievements.summaryName', count),
      seasonFact: (season, level) =>
        translate('clientCard.achievements.seasonFact', { season, level }),
      eventsFact: (count) =>
        plural('clientCard.achievements.eventsFact', count),
      events: translate('clientCard.achievements.events'),
      records: translate('clientCard.achievements.records'),
      archive: translate('clientCard.achievements.archive'),
      toLevel: (value, target, level) =>
        translate('clientCard.achievements.toLevel', { value, target, level }),
      toLevelOn: (level, date) =>
        translate('clientCard.achievements.toLevelOn', { level, date }),
      complete: translate('clientCard.achievements.complete'),
      withThisVisit: translate('clientCard.achievements.withThisVisit'),
      nextWithThisVisit: (level) =>
        translate('clientCard.achievements.nextWithThisVisit', { level }),
      dayGroupName: (date, count) =>
        plural('clientCard.achievements.dayGroupName', count, { date }),
      dayTitle: (date) =>
        translate('clientCard.achievements.dayTitle', { date }),
      seasonNext: (count, level) =>
        plural('clientCard.achievements.seasonNext', count, { level }),
      seasonFamilies: (earned, total) =>
        translate('clientCard.achievements.seasonFamilies', { earned, total }),
      familyCount: (earned, total) =>
        translate('clientCard.achievements.familyCount', { earned, total }),
      eventUntil: (date) =>
        translate('clientCard.achievements.eventUntil', { date }),
      eventAnnounced: (date) =>
        translate('clientCard.achievements.eventAnnounced', { date }),
      scopeSubline: (name, started, total) =>
        translate('clientCard.achievements.scopeSubline', {
          name,
          started,
          total,
        }),
      sectionGeneral: translate('clientCard.achievements.sectionGeneral'),
      sectionBarbers: translate('clientCard.achievements.sectionBarbers'),
      sectionShops: translate('clientCard.achievements.sectionShops'),
      firstHint: translate('clientCard.achievements.firstHint'),
      seasonEnded: translate('clientCard.achievements.seasonEnded'),
      seasonEndedAt: (level) =>
        translate('clientCard.achievements.seasonEndedAt', { level }),
      record: (kind) => translate(`clientCard.achievements.record.${kind}`),
      favouriteValue: (service, count) =>
        translate('clientCard.achievements.record.favouriteValue', {
          service,
          count,
        }),
      favouriteCount: (count) =>
        translate('clientCard.achievements.record.favouriteCount', { count }),
      isNew: translate('clientCard.new'),
      recordsAllName: translate('clientCard.achievements.recordsAllName'),
      recordName: (caption, value, detail, isNew) =>
        translate('clientCard.achievements.recordName', {
          caption,
          value,
          detail: listed(detail),
          new: isNew
            ? translate('clientCard.achievements.newRecordSuffix')
            : '',
        }),
      newRecord: translate('clientCard.achievements.newRecord'),
      recordsLineName: (facts) =>
        translate('clientCard.achievements.recordsLineName', { facts }),
      chipsLabel: translate('clientCard.achievements.chips.label'),
      chipSeasons: translate('clientCard.achievements.chips.seasons'),
      chipName: (category, earned, total) =>
        translate('clientCard.achievements.chipName', {
          category,
          earned: n(earned),
          total: n(total),
        }),
      close: translate('clientCard.achievements.close'),
      collectionOf,
      // Two counted nouns in one sentence: each arrives worded, in its own form.
      collectionName: (earned, total, levels) =>
        translate('clientCard.achievements.collectionName', {
          earned: n(earned),
          of: collectionOf(total),
          levels: counted('clientCard.achievements.summaryName', levels),
        }),
      showAll: (count) =>
        translate('clientCard.achievements.showAll', { count: n(count) }),
      categorySummary: (category, earned, total) =>
        translate('clientCard.achievements.categorySummary', {
          category,
          earned: n(earned),
          total: n(total),
        }),
    },
    achievement: {
      stateToNext: (value, target, level) =>
        translate('clientCard.achievement.stateToNext', {
          value,
          target,
          level,
        }),
      stateToNextOn: (level, date) =>
        translate('clientCard.achievement.stateToNextOn', { level, date }),
      repeated: (count, date) =>
        plural('clientCard.achievement.repeated', count, { date }),
      oneOffEarned: (date) =>
        translate('clientCard.achievement.oneOffEarned', { date }),
      oneOffNotYet: translate('clientCard.achievement.oneOffNotYet'),
      notStarted: translate('clientCard.achievement.notStarted'),
      retired: translate('clientCard.achievement.retired'),
      more: (scope) => translate('clientCard.achievement.more', { scope }),
      ladderName: (level, max, value, target, next) =>
        translate('clientCard.achievement.ladderName', {
          level,
          max,
          value,
          target,
          next,
        }),
      levelName: (level, requirement, earned, award) =>
        translate('clientCard.achievement.levelName', {
          level,
          requirement,
          earned,
          award,
        }),
      earnedOn: (date) =>
        translate('clientCard.achievement.earnedOn', { date }),
      gavePoints: (points) =>
        formed('clientCard.achievement.gavePoints', points, { points }),
      gaveCoupon: (title) =>
        translate('clientCard.achievement.gaveCoupon', { title }),
      gaveFreeze: (count) => plural('clientCard.achievement.gaveFreeze', count),
      awardShort: (points) =>
        translate('clientCard.achievement.awardShort', { points }),
      medalEarnedName: (title, level, date, next, isNew) =>
        translate('clientCard.achievement.medalEarnedName', {
          title,
          level,
          date,
          next,
          new: isNew,
        }),
      medalProgressName: (title, value, target, level) =>
        translate('clientCard.achievement.medalProgressName', {
          title,
          value,
          target,
          level,
        }),
      medalNotStartedName: (title, requirement) =>
        translate('clientCard.achievement.medalNotStartedName', {
          title,
          requirement,
        }),
      newSuffix: translate('clientCard.achievement.newSuffix'),
      nextSuffix: (value, target, level) =>
        translate('clientCard.achievement.nextSuffix', {
          value,
          target,
          level,
        }),
      nextOnSuffix: (level, date) =>
        translate('clientCard.achievement.nextOnSuffix', { level, date }),
      stateWithCategory: (category, state) =>
        translate('clientCard.achievement.stateWithCategory', {
          category,
          state,
        }),
      levelSince: (level, date) =>
        translate('clientCard.achievement.levelSince', { level, date }),
      completeSince: (date) =>
        translate('clientCard.achievement.completeSince', { date }),
      stateNotStarted: translate('clientCard.achievement.stateNotStarted'),
      progressOf: (target) =>
        translate('clientCard.achievement.progressOf', { target: n(target) }),
      what: (metric, count) =>
        plural(`clientCard.achievement.what.${metric}`, count),
      // Reuse first: the records already say «посещения с фейд» and
      // «поредни посещения в ритъм»; the medal says them with their keys.
      whatService: (service, count) =>
        plural('clientCard.records.sentence.favouriteService', count, {
          service,
        }),
      whatBarber: (barber, count) =>
        plural('clientCard.achievement.what.visitsBarber', count, { barber }),
      whatShop: (shop, count) =>
        plural('clientCard.achievement.what.visitsShop', count, { shop }),
      whatRhythm: (count) =>
        plural('clientCard.records.sentence.longestRhythm', count),
      remaining: (count, level) =>
        counted('clientCard.achievement.remaining', count, { level }),
      thisVisitCounts: (value, target) =>
        translate('clientCard.achievement.thisVisitCounts', {
          value: n(value),
          target: n(target),
        }),
      addToVisit: (service) =>
        translate('clientCard.achievement.addToVisit', { service }),
      addToVisitName: (service) =>
        translate('clientCard.achievement.addToVisitName', { service }),
      // The receipt says the service as the verb does (X1-3): in the running case.
      added: (service) =>
        translate('clientCard.achievement.added', {
          service: inSentence(service, lang),
        }),
      howTitle: translate('clientCard.achievement.howTitle'),
      how: (metric) => translate(`clientCard.achievement.how.${metric}`),
      howService: (service) =>
        translate('clientCard.achievement.how.visitsService', { service }),
      howBarber: (barber) =>
        translate('clientCard.achievement.how.visitsBarber', { barber }),
      howShop: (shop) =>
        translate('clientCard.achievement.how.visitsShop', { shop }),
      who: (open) => translate(`clientCard.achievement.who.${open}`),
      excluded: translate('clientCard.achievement.excluded'),
      moreCount: (count) =>
        translate('clientCard.achievement.moreCount', { count: n(count) }),
      levelsTitle: translate('clientCard.achievement.levels'),
      levelRow: (level, requirement) =>
        translate('clientCard.achievement.levelRow', { level, requirement }),
      levelRowName: (level, requirement, reward, earnedOn) =>
        translate('clientCard.achievement.levelRowName', {
          level,
          requirement,
          reward: listed(reward),
          earned: slot(earnedOn, (date) =>
            translate('clientCard.achievement.levelEarnedSuffix', { date }),
          ),
        }),
      awardPoints: (points) =>
        formed('clientCard.achievement.award.points', points, {
          points: n(points),
        }),
      awardBadge: translate('clientCard.achievement.award.badge'),
      awardOneOff: translate('clientCard.achievement.award.oneOff'),
      visitsTitle: translate('clientCard.achievement.visits'),
    },
    photos: {
      title: translate('staff.visit.photos'),
      label: translate('clientCard.photos.label'),
      name: (when) => translate('staff.visit.photoOpen', { when }),
    },
    history: {
      visits: (count) => plural('clientCard.history.stats.visits', count),
      noShows: (count) => plural('clientCard.history.stats.noShows', count),
      cancelled: (count) => plural('clientCard.history.stats.cancelled', count),
      interval: translate('clientCard.history.stats.interval'),
      intervalValue: (weeks) =>
        translate('clientCard.history.stats.intervalValue', { weeks }),
      intervalUnit: translate('clientCard.history.stats.intervalUnit'),
      statsInterval: (weeks) =>
        plural('clientCard.history.statsInterval', weeks, {
          count: formatCount(weeks, lang),
        }),
      statsName: (visits, interval, risk) =>
        translate('clientCard.history.statsName', { visits, interval, risk }),
      noRisk: translate('clientCard.history.noRisk'),
      spend: (money) => translate('clientCard.history.spend', { money }),
      yearVisits: (count) => counted('visits.section.visits', count),
      end: (date) =>
        oneFinalStop(translate('clientCard.history.end', { date })),
      endAll: translate('clientCard.history.endAll'),
      onlyThisVisit: translate('clientCard.history.onlyThisVisit'),
      line: (visits, cadence) =>
        translate('clientCard.history.line', { visits, cadence }),
      spendInline: (money) =>
        translate('clientCard.history.spendInline', { money }),
      first: (date) => translate('clientCard.history.first', { date }),
    },
    failed: {
      profile: translate('clientCard.failed.profile'),
      loyalty: translate('clientCard.failed.loyalty'),
      achievements: translate('clientCard.failed.achievements'),
      visits: translate('clientCard.failed.visits'),
      photos: translate('clientCard.failed.photos'),
      some: translate('clientCard.failed.some'),
      vouchers: translate('clientCard.failed.vouchers'),
      activity: translate('clientCard.failed.activity'),
    },
    remove: translate('staff.visit.removeClient'),
    exitsLabel: translate('staff.visit.client.actions'),
    privacy: {
      groupLabel: translate('clientCard.privacy.groupLabel'),
      export: translate('clientCard.privacy.export'),
      exportDone: translate('clientCard.privacy.exportDone'),
    },
    erasure: {
      erase: translate('clientCard.privacy.erase'),
      eraseSibling: translate('clientCard.privacy.eraseSibling'),
      erased: translate('clientCard.privacy.erased'),
      eraseUnfinished: translate('clientCard.privacy.eraseUnfinished'),
      alertTitle: translate('clientCard.privacy.alertTitle'),
      alertBody: (figures) =>
        translate('clientCard.privacy.alertBody', {
          visits: n(figures.visits),
          notes: n(figures.notes),
          photos: n(figures.photos),
          accounts: n(figures.accounts),
          siblings: n(figures.siblings),
        }),
      eraseConfirm: translate('clientCard.privacy.eraseConfirm'),
      eraseKeep: translate('clientCard.privacy.eraseKeep'),
    },
    roles: {
      groupLabel: translate('clientCard.roles.groupLabel'),
      role: {
        [Role.Client]: translate('clientCard.roles.role.client'),
        [Role.Barber]: translate('clientCard.roles.role.barber'),
        [Role.Receptionist]: translate('clientCard.roles.role.receptionist'),
        [Role.ContentManager]: translate(
          'clientCard.roles.role.content_manager',
        ),
        [Role.Admin]: translate('clientCard.roles.role.admin'),
      },
      save: translate('clientCard.roles.save'),
      saved: translate('clientCard.roles.saved'),
    },
  };
}
