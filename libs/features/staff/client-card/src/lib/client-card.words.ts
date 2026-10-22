import {
  type VisitTranslate,
  type VisitWaitlistWords,
  type VisitWords,
  visitWaitlistWordsOf,
  visitWordsOf,
} from '@creativo/features/shared/visits';
import {
  FreezeReason,
  JournalFeed,
  PersonalRecordKind,
  StreakExcuse,
  type StreakPeriodReason,
} from '@core/components';
import { pluralForm } from '@creativo/infrastructure/i18n';
import { figure, inSentence } from './client-card.format';

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
 * - a member that takes one of a closed set takes it as a literal union
 *   of the card's own words: a dictionary value of ecs-core
 *   (`PersonalRecordKind.FirstVisit`, `JournalFeed.All`, …) reaches it
 *   through ONE table keyed by that dictionary (`RECORD_KIND_WORDS`,
 *   `LEDGER_FILTER_WORDS`, `RHYTHM_REASON_WORDS`), so the words and the
 *   test ids keep their spelling.
 */

/** Transloco's `translate`, or anything shaped like it. */
export type ClientCardTranslate = VisitTranslate;

type Params = Readonly<Record<string, string | number>>;

/** What the glance's holdings line counts: a voucher's balance, a stamp card, the rhythm. */
export type LoyaltyHoldingWord = 'voucher' | 'stamps' | 'rhythm';

/**
 * Why a period of the rhythm is protected: a used protection, the account's
 * pause, one of the shop's excuses (`STREAK_EXCUSES`), the client's own pause.
 */
export type RhythmReasonWord =
  | 'freeze'
  | 'pause'
  | 'staffCancelled'
  | 'barberAbsence'
  | 'shopClosure'
  | 'closedDays'
  | 'clientPause';

/** The ledger page's pill, as its i18n key and its test id spell it (`JournalFeed`). */
export type LedgerFilterWord = 'all' | 'points' | 'rewards' | 'status';

/** Each pill of the ledger (`JournalFeed`) as the card words it: the SAME words and test ids as before the flip. */
export const LEDGER_FILTER_WORDS = {
  [JournalFeed.All]: 'all',
  [JournalFeed.Points]: 'points',
  [JournalFeed.Rewards]: 'rewards',
  [JournalFeed.Status]: 'status',
} as const satisfies Record<JournalFeed, LedgerFilterWord>;

/** The account's four records, as the card's keys and test ids spell them (`PersonalRecordKind`). */
export type RecordKindWord =
  'longestRhythm' | 'mostVisitsInYear' | 'favouriteService' | 'firstVisit';

/** Each record kind (`PersonalRecordKind`) as the card words it: its i18n keys and test ids. */
export const RECORD_KIND_WORDS = {
  [PersonalRecordKind.LongestRhythm]: 'longestRhythm',
  [PersonalRecordKind.MostVisitsInYear]: 'mostVisitsInYear',
  [PersonalRecordKind.FavouriteService]: 'favouriteService',
  [PersonalRecordKind.FirstVisit]: 'firstVisit',
} as const satisfies Record<PersonalRecordKind, RecordKindWord>;

/** What covered a protected period (`StreakPeriodReason`), as the rhythm's words name it. */
export const RHYTHM_REASON_WORDS = {
  [FreezeReason.Freeze]: 'freeze',
  [FreezeReason.Pause]: 'pause',
  [FreezeReason.ClientPause]: 'clientPause',
  [StreakExcuse.StaffCancelled]: 'staffCancelled',
  [StreakExcuse.BarberAbsence]: 'barberAbsence',
  [StreakExcuse.ShopClosure]: 'shopClosure',
  [StreakExcuse.ClosedDays]: 'closedDays',
} as const satisfies Record<StreakPeriodReason, RhythmReasonWord>;

/** The records page's five rows that are not a record of the account's. */
export type RecordRowWord =
  | 'currentRhythm'
  | 'totalVisits'
  | 'last12Months'
  | 'preferredBarber'
  | 'usualServices';

/** The records page's groups. */
export type RecordThemeWord = 'rhythm' | 'visits' | 'favourites';

/** «Как се печели»: the sentence of a metric that names no subject. */
export type AchievementHowWord =
  | 'visits'
  | 'earlyBird'
  | 'weekend'
  | 'onTime'
  | 'party'
  | 'selfService'
  | 'waitlist'
  | 'referrals'
  | 'services'
  | 'barbers'
  | 'shops'
  | 'months'
  | 'spend'
  | 'points'
  | 'tenure'
  | 'shopBookings';

/** «Как се печели»: who and where, by what the family leaves open. */
export type AchievementWhoWord =
  'anyBarberAnyShop' | 'anyServiceAnyShop' | 'anyBarberAnyService';

/**
 * A family's metric by its id in the loyalty catalogue: ecs-core's
 * `Metric` is assignable to it, member for member.
 */
export type AchievementMetricWord =
  | 'client.visits.completed'
  | 'client.bookings.selfService'
  | 'client.spend.major'
  | 'client.referrals.completed'
  | 'client.waitlist.booked'
  | 'client.points.lifetime'
  | 'shop.bookings.created'
  | 'client.services.distinct'
  | 'client.barbers.distinct'
  | 'client.locations.distinct'
  | 'client.months.distinct'
  | 'client.visits.earlyBird'
  | 'client.visits.weekend'
  | 'client.visits.onTime'
  | 'client.visits.party'
  | 'client.tenure.days';

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
    case 'client.visits.completed':
      return 'visits';
    case 'client.bookings.selfService':
      return 'selfService';
    case 'client.spend.major':
      return 'spend';
    case 'client.referrals.completed':
      return 'referrals';
    case 'client.waitlist.booked':
      return 'waitlist';
    case 'client.points.lifetime':
      return 'points';
    case 'shop.bookings.created':
      return 'shopBookings';
    case 'client.services.distinct':
      return 'services';
    case 'client.barbers.distinct':
      return 'barbers';
    case 'client.locations.distinct':
      return 'shops';
    case 'client.months.distinct':
      return 'months';
    case 'client.visits.earlyBird':
      return 'earlyBird';
    case 'client.visits.weekend':
      return 'weekend';
    case 'client.visits.onTime':
      return 'onTime';
    case 'client.visits.party':
      return 'party';
    case 'client.tenure.days':
      return 'tenure';
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
    readonly verb: (
      verb:
        | 'earned'
        | 'bonus'
        | 'spent'
        | 'adjusted'
        | 'reversed'
        | 'expired'
        | 'debtCleared'
        | 'voided'
        | 'received'
        | 'status',
    ) => string;
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
    readonly group: (theme: RecordThemeWord) => string;
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
      kind: Exclude<RecordKindWord, 'favouriteService'>,
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
    readonly record: (
      kind:
        | 'longestRhythm'
        | 'mostVisitsInYear'
        | 'favouriteService'
        | 'firstVisit',
    ) => string;
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
}

/**
 * The card's words in one language, from the catalogue once. `lang` picks
 * the plural forms and rides along for every `Intl` call.
 */
export function clientCardWordsOf(
  translate: ClientCardTranslate,
  lang: string,
): ClientCardWords {
  const t = (key: string, params?: Params) => translate(key, params);
  const plural = (key: string, count: number, params: Params = {}) =>
    translate(`${key}.${pluralForm(count, lang)}`, { count, ...params });
  /** A count as it prints: grouped the locale's way. */
  const n = (count: number) => figure(count, lang);
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
      t('clientCard.loyaltyPage.ticketUntilSuffix', { date }),
    );
  return {
    lang,
    visits: visitWordsOf(translate, lang, 'staff'),
    waitlist: visitWaitlistWordsOf(translate),
    monthShort: (month) => t(`visits.tile.month.${month}`),
    head: {
      since: (since) => t('clientCard.head.since', { since }),
      firstVisit: t('clientCard.head.firstVisit'),
      guest: t('clientCard.head.guest'),
      pausedUntil: (date) => t('clientCard.head.pausedUntil', { date }),
      pausedPermanent: t('clientCard.head.pausedPermanent'),
      sinceCadence: (since, cadence) =>
        t('clientCard.head.sinceCadence', { since, cadence }),
      cadence: (weeks) => counted('clientCard.head.cadence', weeks),
      tierName: (tier, remaining, next) =>
        t('clientCard.head.tierName', { tier, remaining, next }),
      tierTopName: (tier) => t('clientCard.head.tierTopName', { tier }),
    },
    birthday: {
      today: t('clientCard.birthday.today'),
      todayAge: (age) => t('clientCard.birthday.todayAge', { age: n(age) }),
      gift: t('clientCard.birthday.gift'),
      upcoming: (weekday, date, age) =>
        t('clientCard.birthday.upcoming', { weekday, date }) +
        (age === null
          ? ''
          : t('clientCard.birthday.upcomingAge', { age: n(age) })),
      name: (age) => t('clientCard.birthday.name', { age: ageSuffix(age) }),
      giftName: (age, value) =>
        t('clientCard.birthday.giftName', { age: ageSuffix(age), value }),
      giftAppliedName: (age, value) =>
        t('clientCard.birthday.giftAppliedName', {
          age: ageSuffix(age),
          value,
        }),
    },
    visitCard: {
      last: t('visits.card.last'),
      next: t('visits.card.next'),
      name: (label, sentence) => t('visits.card.name', { label, sentence }),
    },
    capsules: {
      label: t('clientCard.capsules.label'),
      noShows: (count) => plural('clientCard.capsule.noShows', count),
      more: (count) => t('clientCard.plusCount', { count }),
    },
    offline: t('clientCard.offline'),
    actions: {
      label: t('clientCard.actions.label'),
      call: t('staff.day.visitCall'),
      sms: t('clientCard.actions.sms'),
      viber: t('clientCard.actions.viber'),
      repeat: t('clientCard.actions.repeat'),
      callName: (name, phone) =>
        t('clientCard.actions.callName', { name, phone }),
      smsName: (name) => t('clientCard.actions.smsName', { name }),
      viberName: (name) => t('clientCard.actions.viberName', { name }),
      againName: (date, services) =>
        t('clientCard.actions.againName', { date, services }),
    },
    reward: {
      until: (date) => t('clientCard.reward.until', { date }),
      more: (count) => t('clientCard.reward.more', { count }),
      name: (title, value) =>
        value === null
          ? t('clientCard.reward.nameBare', { title })
          : t('clientCard.reward.name', { title, value }),
      appliedName: (title, value) =>
        value === null
          ? t('clientCard.reward.appliedNameBare', { title })
          : t('clientCard.reward.appliedName', { title, value }),
      stack: (count) =>
        t('clientCard.reward.stack', { count: figure(count, lang) }),
      use: t('staff.visit.useNow'),
      remove: t('staff.visit.remove'),
      removeName: (title) => `${t('staff.visit.removeDiscount')}: ${title}`,
    },
    visitsModule: {
      title: t('clientCard.visits.title'),
      allName: (count) => t('clientCard.visits.allName', { count }),
      upcoming: t('appointments.sections.upcoming'),
      filteredEmpty: t('appointments.empty.filtered'),
      more: t('visits.more'),
      retry: t('visits.retry'),
      filterClear: t('visits.filter.clear'),
      sectionVisits: (count) => counted('visits.section.visits', count),
    },
    loyalty: {
      title: t('clientCard.loyalty.title'),
      all: t('clientCard.loyalty.all'),
      allName: t('clientCard.loyalty.allName'),
      rhythmUnit: (count) => plural('clientCard.loyalty.rhythmUnit', count),
      points: (count) => counted('clientCard.loyalty.points', count),
      pointsWord: (count) => plural('clientCard.loyalty.pointsWord', count),
      enoughForPoints: (reward) =>
        t('clientCard.loyalty.enoughForPoints', { reward }),
      moreTo: (points, reward) =>
        t('clientCard.loyalty.moreTo', { points: n(points), reward }),
      holding: (holding) => t(`clientCard.loyalty.holding.${holding}`),
      stampsOf: (filled, size) =>
        t('clientCard.loyalty.stampsOf', { filled: n(filled), size: n(size) }),
      cardName: (points, sentence, holdings) =>
        withoutGaps(
          t('clientCard.loyalty.cardName', {
            points,
            sentence: slot(sentence, oneStop),
            holdings: slot(holdings, oneStop),
          }),
        ),
    },
    loyaltyPage: {
      rewardName: (cost, title, state) =>
        plural('clientCard.loyaltyPage.rewardName', cost, {
          count: figure(cost, lang),
          title,
          state,
        }),
      rewardMoreSuffix: (points) =>
        t('clientCard.loyaltyPage.rewardMoreSuffix', { points }),
      rhythm: t('clientCard.loyaltyPage.rhythm'),
      tier: t('clientCard.loyaltyPage.tier'),
      moreToGo: (points) => t('clientCard.loyaltyPage.moreToGo', { points }),
      stampsToNext: (count) =>
        plural('clientCard.loyaltyPage.stampsToNext', count),
      rhythmBest: (count) => t('clientCard.loyaltyPage.rhythmBest', { count }),
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
              t('clientCard.loyaltyPage.passTierSuffix', { tier: it }),
            ),
            points: n(points),
            since: slot(since, (it) =>
              t('clientCard.loyaltyPage.passSinceSuffix', { since: it }),
            ),
          }),
        ),
      expiring: (points, date) =>
        formed('clientCard.loyaltyPage.expiring', points, {
          points: n(points),
          date,
        }),
      passFrozen: t('clientCard.loyaltyPage.passFrozen'),
      owes: (points) =>
        t('clientCard.loyaltyPage.owes', {
          points: counted('clientCard.loyalty.points', points),
        }),
      actions: {
        label: t('clientCard.loyaltyPage.actions.label'),
        use: t('staff.visit.useNow'),
        code: t('clientCard.loyaltyPage.actions.code'),
        catalog: t('clientCard.loyaltyPage.actions.catalog'),
        history: t('clientCard.loyaltyPage.actions.history'),
        useName: t('clientCard.loyaltyPage.actions.useName'),
        codeName: t('clientCard.loyaltyPage.actions.codeName'),
        catalogName: t('clientCard.loyaltyPage.actions.catalogName'),
        historyName: t('clientCard.loyaltyPage.actions.historyName'),
        useCount: (count) => counted('clientCard.loyaltyPage.useCount', count),
      },
      wallet: t('clientCard.loyaltyPage.wallet'),
      walletName: (count) =>
        t('clientCard.loyaltyPage.walletName', { count: n(count) }),
      walletSum: (count, money) =>
        t('clientCard.loyaltyPage.walletSum', { count: n(count), money }),
      walletEmpty: t('clientCard.loyaltyPage.walletEmpty'),
      voucher: t('clientCard.loyaltyPage.voucher'),
      voucherDetail: (money, until) =>
        t('clientCard.loyaltyPage.voucherDetail', {
          money,
          until: slot(until, (date) =>
            t('clientCard.loyaltyPage.voucherUntil', { date }),
          ),
        }),
      voucherFullName: (balance, value, until) =>
        t('clientCard.loyaltyPage.voucherFullName', {
          balance,
          value,
          until: ticketUntil(until),
        }),
      ticketName: (title, until) =>
        t('clientCard.loyaltyPage.ticketName', {
          title,
          until: ticketUntil(until),
        }),
      stampCard: t('clientCard.loyaltyPage.stampCard'),
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
      tierTo: (next) => t('clientCard.loyaltyPage.tierTo', { next }),
      tierHighest: t('clientCard.loyaltyPage.tierHighest'),
      inRhythm: (count) => plural('clientCard.loyaltyPage.inRhythm', count),
      catalogTitle: t('clientCard.loyaltyPage.catalogTitle'),
      catalogListName: (points, affordable, total) =>
        formed('clientCard.loyaltyPage.catalogListName', total, {
          points,
          affordable: n(affordable),
          total: n(total),
        }),
      ledgerTitle: t('clientCard.ledgerPage.title'),
      ledgerAllName: t('clientCard.loyaltyPage.ledgerAllName'),
    },
    rhythm: {
      label: (count, best, next) =>
        plural('clientCard.rhythm.label', count, { best, next }),
      bestSuffix: (count) => t('clientCard.rhythm.bestSuffix', { count }),
      nextSuffix: (date) => t('clientCard.rhythm.nextSuffix', { date }),
      dueBy: (date) => t('clientCard.rhythm.dueBy', { date }),
      markKept: (period, date) =>
        t('clientCard.rhythm.mark.kept', { period, date }),
      markProtected: (period, reason) =>
        t('clientCard.rhythm.mark.protected', { period, reason }),
      markRepaired: (period) =>
        t('clientCard.rhythm.mark.repaired', { period }),
      markMissed: (period) => t('clientCard.rhythm.mark.missed', { period }),
      markCurrent: (date) => t('clientCard.rhythm.mark.current', { date }),
      reasonFreeze: t('clientCard.rhythm.reason.freeze'),
      stateActive: (date) => t('clientCard.rhythm.state.active', { date }),
      stateAtRisk: (weeks, date) =>
        formed('clientCard.rhythm.state.atRisk', weeks, { weeks, date }),
      stateInGrace: (date) => t('clientCard.rhythm.state.inGrace', { date }),
      stateFrozenFreeze: t('clientCard.rhythm.state.frozenFreeze'),
      stateBroken: (date) => t('clientCard.rhythm.state.broken', { date }),
      stateNone: t('clientCard.rhythm.state.none'),
      protections: (count) => t('clientCard.rhythm.protections', { count }),
      frozen: t('clientCard.frozen'),
      phaseAtRisk: (date) => t('clientCard.rhythm.phase.atRisk', { date }),
      phaseInGrace: (date) => t('clientCard.rhythm.phase.inGrace', { date }),
      phaseFrozen: t('clientCard.rhythm.phase.frozen'),
      phaseHeld: (date) => t('clientCard.rhythm.phase.held', { date }),
      phaseBroken: t('clientCard.rhythm.phase.broken'),
      stateHeld: (date) => t('clientCard.rhythm.state.held', { date }),
      stateFrozenExcuse: t('clientCard.rhythm.state.frozenExcuse'),
      reason: (reason) => t(`clientCard.rhythm.reason.${reason}`),
      ruleMore: t('clientCard.rhythm.ruleMore'),
      ruleUpcoming: (date, rule) => t('rhythmRule.upcoming', { date, rule }),
    },
    ledgerPage: {
      title: t('clientCard.ledgerPage.title'),
      subline: (name, points) =>
        t('clientCard.ledgerPage.subline', { name, points }),
      filterLabel: t('clientCard.ledgerPage.filter.label'),
      filter: (kind) => {
        switch (kind) {
          case 'all':
            return t('clientCard.loyalty.all');
          case 'status':
            return t('clientCard.loyaltyPage.tier');
          case 'points':
          case 'rewards':
            return t(`clientCard.ledgerPage.filter.${kind}`);
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
      empty: t('clientCard.ledgerPage.empty'),
      emptyFiltered: t('clientCard.ledgerPage.emptyFiltered'),
    },
    ledger: {
      verb: (verb) => t(`clientCard.ledger.verb.${verb}`),
      visit: t('clientCard.ledger.source.visit'),
      visitOf: (services) =>
        t('clientCard.ledger.source.visitOf', { services }),
      welcome: t('clientCard.ledger.source.welcome'),
      level: (title, level) =>
        t('clientCard.ledger.source.level', { title, level }),
      redemption: (reward) =>
        t('clientCard.ledger.source.redemption', { reward }),
      goodwill: t('clientCard.ledger.source.goodwill'),
      serviceIssue: t('clientCard.ledger.source.serviceIssue'),
      correction: t('clientCard.ledger.source.correction'),
      reverses: (date) => t('clientCard.ledger.source.reverses', { date }),
      tier: (to) => t('clientCard.ledger.source.tier', { to }),
      tierFrom: (from) => t('clientCard.ledger.source.tierFrom', { from }),
      rewardGranted: t('clientCard.ledger.source.rewardGranted'),
      rewardRevoked: t('clientCard.ledger.source.rewardRevoked'),
      redeemed: t('clientCard.ledger.source.redeemed'),
      achievement: t('clientCard.ledger.source.achievement'),
    },
    records: {
      group: (theme) => t(`clientCard.records.group.${theme}`),
      byYear: t('clientCard.records.byYear'),
      row: (row) => t(`clientCard.records.row.${row}`),
      label: (kind) => t(`clientCard.records.label.${kind}`),
      times: (count) => counted('clientCard.records.times', count),
      yearValue: (year) => t('clientCard.records.yearValue', { year }),
      since: (since) => t('clientCard.records.since', { since }),
      yearName: (year, count, record) =>
        formed('clientCard.records.yearName', count, {
          year,
          count: n(count),
          record: record ? t('clientCard.records.recordSuffix') : '',
        }),
      sentence: (kind, count) =>
        kind === 'firstVisit'
          ? t('clientCard.records.sentence.firstVisit')
          : t(`clientCard.records.sentence.${kind}.${formOf(count)}`),
      sentenceFavourite: (service, count) =>
        t(`clientCard.records.sentence.favouriteService.${formOf(count)}`, {
          service,
        }),
      empty: t('clientCard.records.empty'),
    },
    achievements: {
      title: t('clientCard.achievements.title'),
      levels: (count) => plural('clientCard.achievements.levels', count),
      // The summary's figure is its own run (`ui-metric [uiValue]`), so the
      // unit is the same plural sentence with the count left out: the form
      // is still chosen by the count.
      levelsUnit: (count) =>
        plural('clientCard.achievements.levels', count, { count: '' }).trim(),
      allName: (count) => plural('clientCard.achievements.allName', count),
      cueWithThisVisit: (title, level) =>
        t('clientCard.achievements.cueWithThisVisit', { title, level }),
      cueNew: (title, level) =>
        t('clientCard.achievements.cueNew', { title, level }),
      cueClose: (title, value, target, level) =>
        t('clientCard.achievements.cueClose', { title, value, target, level }),
      summaryName: (count) =>
        plural('clientCard.achievements.summaryName', count),
      seasonFact: (season, level) =>
        t('clientCard.achievements.seasonFact', { season, level }),
      eventsFact: (count) =>
        plural('clientCard.achievements.eventsFact', count),
      events: t('clientCard.achievements.events'),
      records: t('clientCard.achievements.records'),
      archive: t('clientCard.achievements.archive'),
      toLevel: (value, target, level) =>
        t('clientCard.achievements.toLevel', { value, target, level }),
      toLevelOn: (level, date) =>
        t('clientCard.achievements.toLevelOn', { level, date }),
      complete: t('clientCard.achievements.complete'),
      withThisVisit: t('clientCard.achievements.withThisVisit'),
      nextWithThisVisit: (level) =>
        t('clientCard.achievements.nextWithThisVisit', { level }),
      dayGroupName: (date, count) =>
        plural('clientCard.achievements.dayGroupName', count, { date }),
      dayTitle: (date) => t('clientCard.achievements.dayTitle', { date }),
      seasonNext: (count, level) =>
        plural('clientCard.achievements.seasonNext', count, { level }),
      seasonFamilies: (earned, total) =>
        t('clientCard.achievements.seasonFamilies', { earned, total }),
      familyCount: (earned, total) =>
        t('clientCard.achievements.familyCount', { earned, total }),
      eventUntil: (date) => t('clientCard.achievements.eventUntil', { date }),
      eventAnnounced: (date) =>
        t('clientCard.achievements.eventAnnounced', { date }),
      scopeSubline: (name, started, total) =>
        t('clientCard.achievements.scopeSubline', { name, started, total }),
      sectionGeneral: t('clientCard.achievements.sectionGeneral'),
      sectionBarbers: t('clientCard.achievements.sectionBarbers'),
      sectionShops: t('clientCard.achievements.sectionShops'),
      firstHint: t('clientCard.achievements.firstHint'),
      seasonEnded: t('clientCard.achievements.seasonEnded'),
      seasonEndedAt: (level) =>
        t('clientCard.achievements.seasonEndedAt', { level }),
      record: (kind) => t(`clientCard.achievements.record.${kind}`),
      favouriteValue: (service, count) =>
        t('clientCard.achievements.record.favouriteValue', { service, count }),
      favouriteCount: (count) =>
        t('clientCard.achievements.record.favouriteCount', { count }),
      isNew: t('clientCard.new'),
      recordsAllName: t('clientCard.achievements.recordsAllName'),
      recordName: (caption, value, detail, isNew) =>
        t('clientCard.achievements.recordName', {
          caption,
          value,
          detail: listed(detail),
          new: isNew ? t('clientCard.achievements.newRecordSuffix') : '',
        }),
      newRecord: t('clientCard.achievements.newRecord'),
      recordsLineName: (facts) =>
        t('clientCard.achievements.recordsLineName', { facts }),
      chipsLabel: t('clientCard.achievements.chips.label'),
      chipSeasons: t('clientCard.achievements.chips.seasons'),
      chipName: (category, earned, total) =>
        t('clientCard.achievements.chipName', {
          category,
          earned: n(earned),
          total: n(total),
        }),
      close: t('clientCard.achievements.close'),
      collectionOf,
      // Two counted nouns in one sentence: each arrives worded, in its own form.
      collectionName: (earned, total, levels) =>
        t('clientCard.achievements.collectionName', {
          earned: n(earned),
          of: collectionOf(total),
          levels: counted('clientCard.achievements.summaryName', levels),
        }),
      showAll: (count) =>
        t('clientCard.achievements.showAll', { count: n(count) }),
      categorySummary: (category, earned, total) =>
        t('clientCard.achievements.categorySummary', {
          category,
          earned: n(earned),
          total: n(total),
        }),
    },
    achievement: {
      stateToNext: (value, target, level) =>
        t('clientCard.achievement.stateToNext', { value, target, level }),
      stateToNextOn: (level, date) =>
        t('clientCard.achievement.stateToNextOn', { level, date }),
      repeated: (count, date) =>
        plural('clientCard.achievement.repeated', count, { date }),
      oneOffEarned: (date) =>
        t('clientCard.achievement.oneOffEarned', { date }),
      oneOffNotYet: t('clientCard.achievement.oneOffNotYet'),
      notStarted: t('clientCard.achievement.notStarted'),
      retired: t('clientCard.achievement.retired'),
      more: (scope) => t('clientCard.achievement.more', { scope }),
      ladderName: (level, max, value, target, next) =>
        t('clientCard.achievement.ladderName', {
          level,
          max,
          value,
          target,
          next,
        }),
      levelName: (level, requirement, earned, award) =>
        t('clientCard.achievement.levelName', {
          level,
          requirement,
          earned,
          award,
        }),
      earnedOn: (date) => t('clientCard.achievement.earnedOn', { date }),
      gavePoints: (points) =>
        formed('clientCard.achievement.gavePoints', points, { points }),
      gaveCoupon: (title) => t('clientCard.achievement.gaveCoupon', { title }),
      gaveFreeze: (count) => plural('clientCard.achievement.gaveFreeze', count),
      awardShort: (points) =>
        t('clientCard.achievement.awardShort', { points }),
      medalEarnedName: (title, level, date, next, isNew) =>
        t('clientCard.achievement.medalEarnedName', {
          title,
          level,
          date,
          next,
          new: isNew,
        }),
      medalProgressName: (title, value, target, level) =>
        t('clientCard.achievement.medalProgressName', {
          title,
          value,
          target,
          level,
        }),
      medalNotStartedName: (title, requirement) =>
        t('clientCard.achievement.medalNotStartedName', {
          title,
          requirement,
        }),
      newSuffix: t('clientCard.achievement.newSuffix'),
      nextSuffix: (value, target, level) =>
        t('clientCard.achievement.nextSuffix', { value, target, level }),
      nextOnSuffix: (level, date) =>
        t('clientCard.achievement.nextOnSuffix', { level, date }),
      stateWithCategory: (category, state) =>
        t('clientCard.achievement.stateWithCategory', { category, state }),
      levelSince: (level, date) =>
        t('clientCard.achievement.levelSince', { level, date }),
      completeSince: (date) =>
        t('clientCard.achievement.completeSince', { date }),
      stateNotStarted: t('clientCard.achievement.stateNotStarted'),
      progressOf: (target) =>
        t('clientCard.achievement.progressOf', { target: n(target) }),
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
        t('clientCard.achievement.thisVisitCounts', {
          value: n(value),
          target: n(target),
        }),
      addToVisit: (service) =>
        t('clientCard.achievement.addToVisit', { service }),
      addToVisitName: (service) =>
        t('clientCard.achievement.addToVisitName', { service }),
      // The receipt says the service as the verb does (X1-3): in the running case.
      added: (service) =>
        t('clientCard.achievement.added', {
          service: inSentence(service, lang),
        }),
      howTitle: t('clientCard.achievement.howTitle'),
      how: (metric) => t(`clientCard.achievement.how.${metric}`),
      howService: (service) =>
        t('clientCard.achievement.how.visitsService', { service }),
      howBarber: (barber) =>
        t('clientCard.achievement.how.visitsBarber', { barber }),
      howShop: (shop) => t('clientCard.achievement.how.visitsShop', { shop }),
      who: (open) => t(`clientCard.achievement.who.${open}`),
      excluded: t('clientCard.achievement.excluded'),
      moreCount: (count) =>
        t('clientCard.achievement.moreCount', { count: n(count) }),
      levelsTitle: t('clientCard.achievement.levels'),
      levelRow: (level, requirement) =>
        t('clientCard.achievement.levelRow', { level, requirement }),
      levelRowName: (level, requirement, reward, earnedOn) =>
        t('clientCard.achievement.levelRowName', {
          level,
          requirement,
          reward: listed(reward),
          earned: slot(earnedOn, (date) =>
            t('clientCard.achievement.levelEarnedSuffix', { date }),
          ),
        }),
      awardPoints: (points) =>
        formed('clientCard.achievement.award.points', points, {
          points: n(points),
        }),
      awardBadge: t('clientCard.achievement.award.badge'),
      awardOneOff: t('clientCard.achievement.award.oneOff'),
      visitsTitle: t('clientCard.achievement.visits'),
    },
    photos: {
      title: t('staff.visit.photos'),
      label: t('clientCard.photos.label'),
      name: (when) => t('staff.visit.photoOpen', { when }),
    },
    history: {
      visits: (count) => plural('clientCard.history.stats.visits', count),
      noShows: (count) => plural('clientCard.history.stats.noShows', count),
      cancelled: (count) => plural('clientCard.history.stats.cancelled', count),
      interval: t('clientCard.history.stats.interval'),
      intervalValue: (weeks) =>
        t('clientCard.history.stats.intervalValue', { weeks }),
      intervalUnit: t('clientCard.history.stats.intervalUnit'),
      statsInterval: (weeks) =>
        plural('clientCard.history.statsInterval', weeks, {
          count: figure(weeks, lang),
        }),
      statsName: (visits, interval, risk) =>
        t('clientCard.history.statsName', { visits, interval, risk }),
      noRisk: t('clientCard.history.noRisk'),
      spend: (money) => t('clientCard.history.spend', { money }),
      yearVisits: (count) => counted('visits.section.visits', count),
      end: (date) => oneFinalStop(t('clientCard.history.end', { date })),
      endAll: t('clientCard.history.endAll'),
      onlyThisVisit: t('clientCard.history.onlyThisVisit'),
      line: (visits, cadence) =>
        t('clientCard.history.line', { visits, cadence }),
      spendInline: (money) => t('clientCard.history.spendInline', { money }),
      first: (date) => t('clientCard.history.first', { date }),
    },
    failed: {
      profile: t('clientCard.failed.profile'),
      loyalty: t('clientCard.failed.loyalty'),
      achievements: t('clientCard.failed.achievements'),
      visits: t('clientCard.failed.visits'),
      photos: t('clientCard.failed.photos'),
      some: t('clientCard.failed.some'),
      vouchers: t('clientCard.failed.vouchers'),
      activity: t('clientCard.failed.activity'),
    },
    remove: t('staff.visit.removeClient'),
    exitsLabel: t('staff.visit.client.actions'),
  };
}
