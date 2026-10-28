import type { JournalEntry } from '@core/entities';
import {
  type AppointmentId,
  type JournalEntryId,
  type LocalDate,
  type TierId,
  defect,
} from '@core/primitives';
import {
  JournalEffectRecord,
  type JournalFeed,
  LedgerLine,
  PublicLabel,
} from '@core/components';
import {
  type LedgerEvent,
  LedgerSystem,
  LoyaltyCatalogSystem,
  type ValidLoyaltyCatalog,
} from '@core/systems';
import { visitSectionLabel } from '@creativo/features/shared/visits';
import type { UiIconName } from '@creativo/ui/controls';
import {
  LINE_JOINT,
  cardLocaleOf,
  dayLong,
  dayMonth,
  dayShort,
  levelNumeral,
  runningCase,
  runsOf,
} from './client-card.format';
import {
  type ActivityGroupVm,
  type ActivityRowVm,
  ActivityTone,
  type LedgerPageVm,
  type LedgerPagingVm,
} from './client-pages.vm';
import { LoadState, PagingState } from '@creativo/shared/view-state';
import { type ClientCardWords, LedgerVerbWord } from './client-card.words';

/*
 * «ДВИЖЕНИЕ» — the journal as a feed (client-card-revision-3 §2.2.5,
 * §2.2.6, §4.7), as pure functions: the wallet's newest five events and the
 * ledger page's every page are the SAME rows, built here once.
 *
 * The journal port hands over one row per entry, as stored
 * (`JournalEntry`). Three steps make the page of them:
 *
 * 1. `foldByEvent` — entries of one event become one: a visit's seats, a
 *    level and the points it paid, a redemption and what it cost;
 * 2. `activityGroups` — the events by month, each worded by its leading
 *    effect, a month's net printed only when the month is wholly loaded;
 * 3. `ledgerPageVm` — the page around them: the quiet line, the filter,
 *    the foot.
 *
 * Nothing here reads a clock, a store or a catalogue service: «today», the
 * names and the words arrive as arguments.
 */

/** The journal rows one page of «Движение» asks for (§2.2.6 LE). */
export const LEDGER_PAGE_READ = 30;

/** A family's numeral bound to its title: a wrap never parts them. */
const NUMERAL_JOINT = '\u00a0';

// ── 1 · Folding ─────────────────────────────────────────────────────────

/**
 * One EVENT of the journal (`LedgerSystem.fold`): the entries that share
 * it, newest first; the newest entry's id (the row's `…-entry-{id}` test
 * id), instant and shop day; what it moved and the balance it left.
 */
export type ActivityEvent = LedgerEvent<JournalEntry>;

/** A label's parameter as text that is not blank, or `null` (`PublicLabel.param`). */
function textOf(entry: JournalEntry, name: string): string | null {
  const value = PublicLabel.param(entry, name);
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * The months the loaded entries hold WHOLE: every month newer than the
 * oldest one loaded, and the oldest too once nothing older is left
 * (`whole`). A month the page boundary may have cut is in doubt, and a
 * month in doubt prints no net.
 */
export function wholeMonthsOf(
  entries: readonly JournalEntry[],
  whole: boolean,
): ReadonlySet<string> {
  return new Set(LedgerSystem.wholeMonths(entries, whole));
}

// ── 2 · Rows ────────────────────────────────────────────────────────────

/**
 * What the history's rows say of each worked visit, by its APPOINTMENT and
 * by its shop day — two key spaces, two maps: a row asks for its
 * appointment first, then for its day.
 */
export interface VisitNames {
  readonly byAppointment: ReadonlyMap<AppointmentId, string>;
  readonly byDay: ReadonlyMap<LocalDate, string>;
}

/** No visit named at all: every visit row reads «Посещение». */
export const NO_VISIT_NAMES: VisitNames = {
  byAppointment: new Map(),
  byDay: new Map(),
};

export interface ActivityInput {
  /**
   * What a worked visit was, as the history's rows title it («Фейд ·
   * Оформяне на брада»), by the APPOINTMENT's id or by the visit's shop
   * day: a row asks for its appointment first, then for its day. A visit
   * the maps do not know reads «Посещение».
   */
  readonly visitTitles: VisitNames;
  /**
   * Who did it («Иван», «Иван и Никола»), under the same keys. Absent, or
   * without the visit, the row's line is its date alone.
   */
  readonly visitBarbers?: VisitNames;
  /**
   * The loyalty catalogue, which names a family, a reward and a tier;
   * `null` until it is read: a row whose subject cannot be named is
   * titled by what happened («Бонус», «Използвани», «Нов статус»).
   */
  readonly catalog: ValidLoyaltyCatalog | null;
  /** The shop calendar's today, on the shop's zone. */
  readonly today: LocalDate;
  /** The months that are wholly loaded (`wholeMonthsOf`): only they print a net. */
  readonly wholeMonths: ReadonlySet<string>;
  /**
   * The newest events only (the wallet's five). A month the limit cuts
   * prints no net: a figure over rows that do not add up to it reads as a
   * mistake. Absent = every event.
   */
  readonly limit?: number;
  readonly words: ClientCardWords;
}

/** A row before its date, its amount and its sentence are added. */
interface RowDraft {
  readonly icon: UiIconName;
  readonly tone: ActivityRowVm['tone'];
  /** What the sentence opens on; `null` where the source says it all («Постижение: Фейд II»). */
  readonly verb: string | null;
  /** The source as the title names it; `null` = the verb titles the row. */
  readonly named: string | null;
  /** The source as the sentence speaks it; `null` = the verb alone. */
  readonly spoken: string | null;
  /** The line's words BEFORE the date («отменя запис от 4.04»). */
  readonly before: string | null;
  /** The line's words AFTER the date («Иван», «постижение», «от Сребро»). */
  readonly after: string | null;
  /** `after` is who did it: the run no ellipsis takes. */
  readonly held: boolean;
  /** What the sentence adds after its date («от Сребро»). */
  readonly said: string | null;
}

const DRAFT: Pick<
  RowDraft,
  'spoken' | 'before' | 'after' | 'held' | 'said' | 'named'
> = {
  named: null,
  spoken: null,
  before: null,
  after: null,
  held: false,
  said: null,
};

/** A fragment as a title or a sentence's opening: its first letter raised. */
function capitalised(text: string, lang: string): string {
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
}

function rewardNameOf(
  entry: JournalEntry,
  input: ActivityInput,
): string | null {
  const rewardId = textOf(entry, 'reward');
  if (rewardId === null) return null;
  return (
    input.catalog?.rewards.find((reward) => reward.id === rewardId)?.name[
      cardLocaleOf(input.words.lang)
    ] ?? null
  );
}

function tierNameOf(tierId: TierId, input: ActivityInput): string | null {
  return input.catalog === null
    ? null
    : (LoyaltyCatalogSystem.tier(input.catalog, tierId)?.name[
        cardLocaleOf(input.words.lang)
      ] ?? null);
}

/** A level earned, by its family and numeral: «Години с нас I». */
function levelDraft(
  entry: JournalEntry,
  paid: boolean,
  revoked: boolean,
  input: ActivityInput,
): RowDraft {
  const { words } = input;
  const ledger = words.ledger;
  const earned = LedgerSystem.levelOf(entry);
  const { badgeSeriesId: seriesId, level } = earned;
  const numeral = level === null ? '' : levelNumeral(level);
  const family =
    seriesId === null || input.catalog === null
      ? null
      : (LoyaltyCatalogSystem.series(input.catalog, seriesId)?.title[
          cardLocaleOf(words.lang)
        ] ?? null);
  const welcome = LedgerSystem.isWelcome(earned);
  const named = welcome
    ? ledger.welcome
    : family === null
      ? null
      : numeral === ''
        ? family
        : `${family}${NUMERAL_JOINT}${numeral}`;
  const spoken = welcome
    ? ledger.welcome
    : family === null
      ? null
      : ledger.level(family, numeral).trim();
  // A level that paid nothing is no «Бонус»: its source is the sentence,
  // and a family nobody can name is titled by what it is.
  const verb = paid
    ? ledger.verb(LedgerVerbWord.Bonus)
    : spoken === null
      ? capitalised(ledger.achievement, words.lang)
      : null;
  return {
    ...DRAFT,
    icon: 'loyalty.activity.level',
    tone: ActivityTone.Accent,
    verb,
    named,
    spoken,
    after: revoked
      ? runningCase(ledger.verb(LedgerVerbWord.Voided), words.lang)
      : named === null && !paid
        ? null
        : ledger.achievement,
  };
}

/** A row that compensates another: «Анулирано», and the row it takes back. */
function reversalDraft(
  entry: JournalEntry,
  originals: ReadonlyMap<JournalEntryId, JournalEntry>,
  input: ActivityInput,
): RowDraft {
  const { words, today } = input;
  const original =
    entry.reverses === null ? undefined : originals.get(entry.reverses);
  // The struck row's own shop day, as stored (T5).
  const day = original === undefined ? null : original.localDate;
  return {
    ...DRAFT,
    icon: 'loyalty.activity.reversed',
    tone: ActivityTone.Neutral,
    verb: words.ledger.verb(LedgerVerbWord.Reversed),
    before:
      day === null
        ? null
        : words.ledger.reverses(dayShort(day, today, words.lang)),
    // A date someone hears says its month in words.
    spoken:
      day === null
        ? null
        : words.ledger.reverses(dayLong(day, today, words.lang)),
  };
}

/** The points a visit earned: named by what the history calls the visit, and who did it. */
function visitDraft(
  event: ActivityEvent,
  entry: JournalEntry,
  input: ActivityInput,
): RowDraft {
  const ledger = input.words.ledger;
  // The visit is the entry's own (`appointmentId`), then its event's day.
  const appointmentId = entry.appointmentId;
  const found = (names: VisitNames | undefined) =>
    [
      appointmentId === null
        ? ''
        : (names?.byAppointment.get(appointmentId) ?? ''),
      names?.byDay.get(event.localDate) ?? '',
    ]
      .map((name) => name.trim())
      .find((name) => name !== '') ?? null;
  const services = found(input.visitTitles);
  const barbers = found(input.visitBarbers);
  return {
    ...DRAFT,
    icon: 'loyalty.activity.visit',
    tone: ActivityTone.Accent,
    verb: ledger.verb(LedgerVerbWord.Earned),
    named: services ?? ledger.visit,
    spoken: services === null ? ledger.visit : ledger.visitOf(services),
    after: barbers,
    held: barbers !== null,
  };
}

/** A shop's own adjustment of the points, by its source. */
function adjustedDraft(source: string, input: ActivityInput): RowDraft {
  return {
    ...DRAFT,
    icon: 'loyalty.activity.adjusted',
    tone: ActivityTone.Neutral,
    verb: input.words.ledger.verb(LedgerVerbWord.Adjusted),
    named: source,
    spoken: source,
  };
}

/** A reward taken for points, named by its reward. */
function spentDraft(entry: JournalEntry, input: ActivityInput): RowDraft {
  const ledger = input.words.ledger;
  const reward = rewardNameOf(entry, input);
  return {
    ...DRAFT,
    icon: 'loyalty.activity.redeemed',
    tone: ActivityTone.Neutral,
    verb: ledger.verb(LedgerVerbWord.Spent),
    named: reward,
    spoken: reward === null ? null : ledger.redemption(reward),
    after: ledger.redeemed,
  };
}

/** A reward that lapsed unused: named by its reward, the row says what became of it on its line. */
function lapsedDraft(entry: JournalEntry, input: ActivityInput): RowDraft {
  const { words } = input;
  const ledger = words.ledger;
  const reward = rewardNameOf(entry, input);
  return {
    ...DRAFT,
    icon: 'loyalty.activity.expired',
    tone: ActivityTone.Neutral,
    verb: ledger.verb(LedgerVerbWord.Expired),
    named: reward,
    spoken: reward,
    after:
      reward === null
        ? null
        : runningCase(ledger.verb(LedgerVerbWord.Expired), words.lang),
  };
}

/** A reward given, or taken back. */
function rewardDraft(
  entry: JournalEntry,
  revoked: boolean,
  input: ActivityInput,
): RowDraft {
  const { words } = input;
  const ledger = words.ledger;
  const reward = rewardNameOf(entry, input);
  const happened = revoked ? ledger.rewardRevoked : ledger.rewardGranted;
  return {
    ...DRAFT,
    icon: 'loyalty.activity.granted',
    tone: ActivityTone.Accent,
    verb: revoked
      ? capitalised(happened, words.lang)
      : ledger.verb(LedgerVerbWord.Received),
    named: reward,
    spoken: reward,
    // The verb titles a reward nobody can name: its line is the date.
    after: reward === null ? null : happened,
  };
}

/** A new status, and the one it was reached from. */
function tierDraft(
  entry: JournalEntry & JournalEffectRecord.Tier,
  input: ActivityInput,
): RowDraft {
  const ledger = input.words.ledger;
  const to = tierNameOf(entry.tierTo, input);
  const from = tierNameOf(entry.tierFrom, input);
  const title = to === null ? null : ledger.tier(to);
  const origin = from === null ? null : ledger.tierFrom(from);
  return {
    ...DRAFT,
    icon: 'loyalty.activity.tier',
    tone: ActivityTone.Accent,
    verb: ledger.verb(LedgerVerbWord.Status),
    named: title,
    spoken: title,
    after: origin,
    said: origin,
  };
}

/**
 * What a row is about (§2.2.5): `LedgerSystem.lineOf` reads its event's
 * leading entry; each of its tags is worded here.
 */
function draftOf(
  event: ActivityEvent,
  leading: JournalEntry,
  originals: ReadonlyMap<JournalEntryId, JournalEntry>,
  input: ActivityInput,
): RowDraft {
  const ledger = input.words.ledger;
  const line = LedgerSystem.lineOf(event, leading);
  switch (line.ledgerLine) {
    case LedgerLine.Reversal:
      return reversalDraft(leading, originals, input);
    case LedgerLine.RedemptionSpent:
    case LedgerLine.PointsRedeemed:
      return spentDraft(leading, input);
    case LedgerLine.RedemptionExpired:
      return lapsedDraft(leading, input);
    case LedgerLine.RewardGranted:
    case LedgerLine.RewardRevoked:
      return rewardDraft(leading, line.revoked, input);
    case LedgerLine.Tier:
      // `lineOf` answers TIER for a tier entry alone; the guard narrows its type.
      return JournalEffectRecord.isTier(leading)
        ? tierDraft(leading, input)
        : defect(`${line.ledgerLine} reads a tier entry`);
    case LedgerLine.Level:
      return levelDraft(leading, line.paid, line.revoked, input);
    case LedgerLine.VisitEarned:
      return visitDraft(event, leading, input);
    case LedgerLine.Goodwill:
      return adjustedDraft(ledger.goodwill, input);
    case LedgerLine.ServiceIssue:
      return adjustedDraft(ledger.serviceIssue, input);
    case LedgerLine.PointsExpired:
      return {
        ...DRAFT,
        icon: 'loyalty.activity.expired',
        tone: ActivityTone.Neutral,
        verb: ledger.verb(LedgerVerbWord.Expired),
      };
    case LedgerLine.DebtCleared:
      return {
        ...DRAFT,
        icon: 'loyalty.activity.adjusted',
        tone: ActivityTone.Neutral,
        verb: ledger.verb(LedgerVerbWord.DebtCleared),
      };
    case LedgerLine.Correction:
      return adjustedDraft(ledger.correction, input);
  }
}

function rowOf(
  event: ActivityEvent,
  originals: ReadonlyMap<JournalEntryId, JournalEntry>,
  voided: ReadonlySet<JournalEntryId>,
  input: ActivityInput,
): ActivityRowVm | null {
  const leading = LedgerSystem.leading(event);
  if (leading === null) return null;
  const { words, today } = input;
  const lang = words.lang;
  const draft = draftOf(event, leading, originals, input);
  // The event's own shop day, as stored (T5).
  const day = event.localDate;
  const struck = LedgerSystem.isStruck(event, voided);
  const cancelled = struck
    ? runningCase(words.ledger.verb(LedgerVerbWord.Voided), lang)
    : null;
  // The row's day says no year: the month heading over it owns one (a
  // reversed entry's day, another month's, keeps its own).
  const lead = [draft.before, dayMonth(day, lang)]
    .filter((part): part is string => part !== null)
    .join(LINE_JOINT);
  const hold =
    draft.after !== null && draft.held ? `${LINE_JOINT}${draft.after}` : null;
  const text = [lead, draft.after, cancelled]
    .filter((part): part is string => part !== null)
    .join(LINE_JOINT);
  const amount =
    event.delta === null ? null : words.ledgerPage.signed(event.delta);
  return {
    entryId: event.id,
    icon: draft.icon,
    tone: draft.tone,
    title:
      draft.named ?? draft.verb ?? words.ledger.verb(LedgerVerbWord.Adjusted),
    lines: [hold !== null && text.endsWith(hold) ? { text, hold } : { text }],
    struck,
    amount,
    balanceAfter:
      event.balanceAfter === null
        ? null
        : words.ledgerPage.points(event.balanceAfter),
    accessibleName: [
      draft.verb,
      draft.spoken,
      dayLong(day, today, lang),
      draft.said,
      amount,
      cancelled,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(', '),
  };
}

/**
 * The events by month, newest first, each a row (§2.2.5): its leading
 * effect's glyph, its source as the title, the date on its line, the
 * signed amount over the balance it left. A month prints its net (the sum
 * of what its events moved) only when it is wholly loaded, wholly shown,
 * and something in it moved points.
 */
export function activityGroups(
  events: readonly ActivityEvent[],
  input: ActivityInput,
): readonly ActivityGroupVm[] {
  const { words } = input;
  const loaded = events.flatMap((event) => event.entries);
  const originals = new Map<JournalEntryId, JournalEntry>(
    loaded.map((entry) => [entry.id, entry]),
  );
  const voided = LedgerSystem.voided(loaded);
  // The months, the limit's cut and each month's net are
  // `LedgerSystem.months` (by each event's stored shop day, T5); the rows
  // and the words are this file's.
  const months = LedgerSystem.months(events, input.limit ?? null, [
    ...input.wholeMonths,
  ]);
  return months.flatMap((month): readonly ActivityGroupVm[] => {
    const rows = month.events.flatMap((event) => {
      const row = rowOf(event, originals, voided, input);
      return row === null ? [] : [row];
    });
    if (rows.length === 0) return [];
    return [
      {
        key: month.key,
        label: visitSectionLabel(month.key, words.lang),
        net: month.net === null ? null : words.ledgerPage.signed(month.net),
        rows,
      },
    ];
  });
}

// ── 3 · The page ────────────────────────────────────────────────────────

export interface LedgerPageInput extends ActivityInput {
  /** The first page's read. */
  readonly loadState: LoadState;
  /** Every entry loaded so far under the pill, in any order. */
  readonly entries: readonly JournalEntry[];
  /** The cursor of the next page; `null` = nothing older is left. */
  readonly next: number | null;
  readonly loadingMore: boolean;
  readonly failedMore: boolean;
  readonly filter: JournalFeed;
  /** The head's name; `''` until it is known: the line is the balance alone. */
  readonly holder: string;
  readonly balance: number;
  readonly online: boolean;
}

function pagingOf(input: LedgerPageInput): LedgerPagingVm | null {
  if (input.loadState !== LoadState.Ready) return null;
  if (input.loadingMore) return { pagingState: PagingState.Loading };
  if (input.next === null) return { pagingState: PagingState.End };
  // Offline with a cursor left: nothing to offer, and nothing has ended.
  if (!input.online) return null;
  return {
    pagingState: input.failedMore ? PagingState.Failed : PagingState.More,
  };
}

/** The ledger page «Движение» (§2.2.6). */
export function ledgerPageVm(input: LedgerPageInput): LedgerPageVm {
  const { words } = input;
  const balance = words.ledgerPage.points(input.balance);
  const holder = input.holder.trim();
  const ready = input.loadState === LoadState.Ready;
  return {
    loadState: input.loadState,
    subline:
      holder === ''
        ? [{ text: balance, fact: true }]
        : runsOf(words.ledgerPage.subline(holder, balance), [balance]),
    filter: input.filter,
    groups: ready
      ? activityGroups(LedgerSystem.fold(input.entries, input.next === null), {
          ...input,
          // Only under the pills of POINT rows is a month's net the month's
          // (`LedgerSystem.netsUnder`).
          wholeMonths: LedgerSystem.netsUnder(input.filter)
            ? input.wholeMonths
            : new Set<string>(),
        })
      : [],
    paging: pagingOf(input),
  };
}
