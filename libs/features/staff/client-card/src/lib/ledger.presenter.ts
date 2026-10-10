import {
  type ActivityEntry,
  type ActivityKind,
  type LoyaltyCatalog,
  levelNumeral,
  sofiaDayOf,
} from '@creativo/application/engagement';
import { type LedgerEntryRef, LedgerSystem } from '@creativo/ecs-core';
import { visitSectionLabel } from '@creativo/features/shared/visits';
import type { UiIconName } from '@creativo/ui/controls';
import {
  LINE_JOINT,
  cardLocaleOf,
  dayLong,
  dayMonth,
  dayShort,
  runningCase,
  runsOf,
} from './client-card.format';
import type {
  ActivityGroupVm,
  ActivityRowVm,
  LedgerPageVm,
  LedgerPagingVm,
  SliceStatus,
} from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';

/*
 * «ДВИЖЕНИЕ» — the journal as a feed (client-card-revision-3 §2.2.5,
 * §2.2.6, §4.7), as pure functions: the wallet's newest five events and the
 * ledger page's every page are the SAME rows, built here once.
 *
 * The reader hands over one row per journal entry. Three steps make the
 * page of them:
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

/** One EVENT of the journal: the entries that share it, newest first. */
export interface ActivityEvent {
  /** The event's newest entry: the row's `…-entry-{id}` test id. */
  readonly id: string;
  /** The newest entry's instant. */
  readonly at: Date;
  /** Newest first. */
  readonly entries: readonly ActivityEntry[];
  /**
   * What the event moved: the sum of its point rows. An event read without
   * them (the pill «Награди» asks for `reward` and `redemption` rows alone)
   * says what a redemption cost. `null` when no points moved.
   */
  readonly delta: number | null;
  /** The balance once the event's newest point row was folded in; `null` without one. */
  readonly balanceAfter: number | null;
}

/** A label's parameter as text, or `null`. */
function textOf(entry: ActivityEntry, key: string): string | null {
  const value = new Map(Object.entries(entry.label.params)).get(key);
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A label's parameter as a whole number, or `null`. */
function countOf(entry: ActivityEntry, key: string): number | null {
  const value = new Map(Object.entries(entry.label.params)).get(key);
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * The visit a correlation id names: `appt:{appointmentId}` as the seed and
 * the engine write it, `appt:{appointmentId}:seat:{seatId}` as the first
 * round's journals do. `null` for an event that is no visit.
 */
function appointmentIdOf(correlationId: string): string | null {
  const [root, appointmentId] = correlationId.split(':');
  return root === 'appt' && appointmentId !== undefined && appointmentId !== ''
    ? appointmentId
    : null;
}

/** The ids a loaded row compensates: the rows that are struck. */
function voidedIds(entries: readonly ActivityEntry[]): ReadonlySet<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.reverses === null ? [] : [entry.reverses],
    ),
  );
}

/**
 * The entries as events, newest first. `whole` says the entries are
 * everything there is under the pill (no cursor is left); when they are
 * NOT, the page boundary may have cut the oldest event, so it is held back
 * until the next page, or the end, confirms it (§4.7). An event that is
 * the only one read is kept: a page never reads as empty while it holds a
 * row.
 */
export function foldByEvent(
  entries: readonly ActivityEntry[],
  whole: boolean,
): readonly ActivityEvent[] {
  return LedgerSystem.fold(entries.map(ledgerRefOf), whole).map((event) => {
    const rows = event.entries.map((ref) => ref.source);
    return {
      id: event.id,
      at: (rows[0] as ActivityEntry).at,
      entries: rows,
      delta: event.delta,
      balanceAfter: event.balanceAfter,
    };
  });
}

/**
 * The months the loaded entries hold WHOLE: every month newer than the
 * oldest one loaded, and the oldest too once nothing older is left
 * (`whole`). A month the page boundary may have cut is in doubt, and a
 * month in doubt prints no net.
 */
export function wholeMonthsOf(
  entries: readonly ActivityEntry[],
  whole: boolean,
): ReadonlySet<string> {
  return new Set(
    LedgerSystem.wholeMonths(entries.map(ledgerRefOf), whole, SHOP_ZONE),
  );
}

// ── 2 · Rows ────────────────────────────────────────────────────────────

export interface ActivityInput {
  /**
   * What a worked visit was, as the history's rows title it («Фейд ·
   * Оформяне на брада»), by the APPOINTMENT's id or by the visit's shop day
   * (`YYYY-MM-DD`): a row asks for its appointment first, then for its
   * day. A visit the map does not know reads «Посещение».
   */
  readonly visitTitles: ReadonlyMap<string, string>;
  /**
   * Who did it («Иван», «Иван и Никола»), under the same keys. Absent, or
   * without the visit, the row's line is its date alone.
   */
  readonly visitBarbers?: ReadonlyMap<string, string>;
  /**
   * The loyalty catalogue, which names a family, a reward and a tier;
   * `null` until it is read: a row whose subject cannot be named is
   * titled by what happened («Бонус», «Използвани», «Нов статус»).
   */
  readonly catalog: LoyaltyCatalog | null;
  readonly today: string;
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

/** The effects by rank: the highest one an event holds is what the row is about. */
const EFFECT_RANK = {
  redemption: 0,
  reward: 1,
  tier: 2,
  achievement: 3,
  points: 4,
} as const satisfies Record<ActivityEntry['effect']['kind'], number>;

/** The entry a row is worded by: the event's highest-ranked effect, its newest row first. */
function leadingOf(event: ActivityEvent): ActivityEntry | null {
  let leading: ActivityEntry | null = null;
  for (const entry of event.entries) {
    if (
      leading === null ||
      EFFECT_RANK[entry.effect.kind] < EFFECT_RANK[leading.effect.kind]
    ) {
      leading = entry;
    }
  }
  return leading;
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
  entry: ActivityEntry,
  input: ActivityInput,
): string | null {
  const rewardId = textOf(entry, 'reward');
  if (rewardId === null) return null;
  return (
    input.catalog?.rewards
      .find((reward) => reward.id === rewardId)
      ?.name.get(cardLocaleOf(input.words.lang)) ?? null
  );
}

function tierNameOf(tierId: string, input: ActivityInput): string | null {
  return (
    input.catalog?.tier(tierId)?.name.get(cardLocaleOf(input.words.lang)) ??
    null
  );
}

/** A level earned, by its family and numeral: «Години с нас I». */
function levelDraft(
  entry: ActivityEntry,
  paid: boolean,
  revoked: boolean,
  input: ActivityInput,
): RowDraft {
  const { words } = input;
  const ledger = words.ledger;
  const seriesId = textOf(entry, 'seriesId');
  const level = countOf(entry, 'level');
  const numeral = level === null ? '' : levelNumeral(level);
  const family =
    seriesId === null
      ? null
      : (input.catalog?.series(seriesId)?.title.get(cardLocaleOf(words.lang)) ??
        null);
  const welcome = seriesId === 'series-welcome';
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
    ? ledger.verb('bonus')
    : spoken === null
      ? capitalised(ledger.achievement, words.lang)
      : null;
  return {
    ...DRAFT,
    icon: 'loyalty.activity.level',
    tone: 'accent',
    verb,
    named,
    spoken,
    after: revoked
      ? runningCase(ledger.verb('voided'), words.lang)
      : named === null && !paid
        ? null
        : ledger.achievement,
  };
}

/** A row that compensates another: «Анулирано», and the row it takes back. */
function reversalDraft(
  entry: ActivityEntry,
  originals: ReadonlyMap<string, ActivityEntry>,
  input: ActivityInput,
): RowDraft {
  const { words, today } = input;
  const original =
    entry.reverses === null ? undefined : originals.get(entry.reverses);
  const day = original === undefined ? null : sofiaDayOf(original.at);
  return {
    ...DRAFT,
    icon: 'loyalty.activity.reversed',
    tone: 'neutral',
    verb: words.ledger.verb('reversed'),
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

/** A point row with no other effect beside it, by what its label says moved the points. */
function pointsDraft(
  event: ActivityEvent,
  entry: ActivityEntry,
  input: ActivityInput,
): RowDraft {
  const { words } = input;
  const ledger = words.ledger;
  const adjusted = (source: string): RowDraft => ({
    ...DRAFT,
    icon: 'loyalty.activity.adjusted',
    tone: 'neutral',
    verb: ledger.verb('adjusted'),
    named: source,
    spoken: source,
  });
  switch (entry.label.code) {
    case 'points.rule': {
      if (textOf(entry, 'seriesId') !== null) {
        return levelDraft(entry, true, false, input);
      }
      const keys = [
        appointmentIdOf(entry.correlationId),
        sofiaDayOf(event.at),
      ].filter((key): key is string => key !== null);
      const found = (names: ReadonlyMap<string, string> | undefined) =>
        keys
          .map((key) => names?.get(key)?.trim() ?? '')
          .find((name) => name !== '') ?? null;
      const services = found(input.visitTitles);
      const barbers = found(input.visitBarbers);
      return {
        ...DRAFT,
        icon: 'loyalty.activity.visit',
        tone: 'accent',
        verb: ledger.verb('earned'),
        named: services ?? ledger.visit,
        spoken: services === null ? ledger.visit : ledger.visitOf(services),
        after: barbers,
        held: barbers !== null,
      };
    }
    case 'points.redeemed': {
      const reward = rewardNameOf(entry, input);
      return {
        ...DRAFT,
        icon: 'loyalty.activity.redeemed',
        tone: 'neutral',
        verb: ledger.verb('spent'),
        named: reward,
        spoken: reward === null ? null : ledger.redemption(reward),
        after: ledger.redeemed,
      };
    }
    case 'points.goodwill':
      return adjusted(ledger.goodwill);
    case 'points.serviceIssue':
      return adjusted(ledger.serviceIssue);
    case 'points.expired':
      return {
        ...DRAFT,
        icon: 'loyalty.activity.expired',
        tone: 'neutral',
        verb: ledger.verb('expired'),
      };
    case 'points.debtCleared':
      return {
        ...DRAFT,
        icon: 'loyalty.activity.adjusted',
        tone: 'neutral',
        verb: ledger.verb('debtCleared'),
      };
    default:
      return adjusted(ledger.correction);
  }
}

/** What a row is about, by its event's leading effect (§2.2.5). */
function draftOf(
  event: ActivityEvent,
  leading: ActivityEntry,
  originals: ReadonlyMap<string, ActivityEntry>,
  input: ActivityInput,
): RowDraft {
  const { words } = input;
  const ledger = words.ledger;
  if (leading.reverses !== null)
    return reversalDraft(leading, originals, input);
  const effect = leading.effect;
  switch (effect.kind) {
    case 'redemption': {
      if (effect.op === 'reversed') {
        return reversalDraft(leading, originals, input);
      }
      const reward = rewardNameOf(leading, input);
      if (effect.op === 'expired') {
        return {
          ...DRAFT,
          icon: 'loyalty.activity.expired',
          tone: 'neutral',
          verb: ledger.verb('expired'),
          named: reward,
          spoken: reward,
          // Named by its reward, the row says what became of it on its line.
          after:
            reward === null
              ? null
              : runningCase(ledger.verb('expired'), words.lang),
        };
      }
      return {
        ...DRAFT,
        icon: 'loyalty.activity.redeemed',
        tone: 'neutral',
        verb: ledger.verb('spent'),
        named: reward,
        spoken: reward === null ? null : ledger.redemption(reward),
        after: ledger.redeemed,
      };
    }
    case 'reward': {
      const reward = rewardNameOf(leading, input);
      const revoked = effect.op === 'revoked';
      const happened = revoked ? ledger.rewardRevoked : ledger.rewardGranted;
      return {
        ...DRAFT,
        icon: 'loyalty.activity.granted',
        tone: 'accent',
        verb: revoked
          ? capitalised(happened, words.lang)
          : ledger.verb('received'),
        named: reward,
        spoken: reward,
        // The verb titles a reward nobody can name: its line is the date.
        after: reward === null ? null : happened,
      };
    }
    case 'tier': {
      const to = tierNameOf(effect.to, input);
      const from = tierNameOf(effect.from, input);
      const title = to === null ? null : ledger.tier(to);
      const origin = from === null ? null : ledger.tierFrom(from);
      return {
        ...DRAFT,
        icon: 'loyalty.activity.tier',
        tone: 'accent',
        verb: ledger.verb('status'),
        named: title,
        spoken: title,
        after: origin,
        said: origin,
      };
    }
    case 'achievement':
      return levelDraft(
        leading,
        event.delta !== null,
        effect.op === 'revoked',
        input,
      );
    case 'points':
      return pointsDraft(event, leading, input);
  }
}

function rowOf(
  event: ActivityEvent,
  originals: ReadonlyMap<string, ActivityEntry>,
  voided: ReadonlySet<string>,
  input: ActivityInput,
): ActivityRowVm | null {
  const leading = leadingOf(event);
  if (leading === null) return null;
  const { words, today } = input;
  const lang = words.lang;
  const draft = draftOf(event, leading, originals, input);
  const day = sofiaDayOf(event.at);
  const struck = event.entries.some((entry) => voided.has(entry.id));
  const cancelled = struck
    ? runningCase(words.ledger.verb('voided'), lang)
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
    title: draft.named ?? draft.verb ?? words.ledger.verb('adjusted'),
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
  const originals = new Map(loaded.map((entry) => [entry.id, entry]));
  const voided = voidedIds(loaded);
  // The months, the limit's cut and each month's net are
  // `LedgerSystem.months`; the rows and the words are this file's.
  const months = LedgerSystem.months(
    events.map((event) => ({
      id: event.id,
      atMs: event.at.getTime(),
      entries: event.entries.map(ledgerRefOf),
      delta: event.delta,
      balanceAfter: event.balanceAfter,
      source: event,
    })),
    input.limit ?? null,
    [...input.wholeMonths],
    SHOP_ZONE,
  );
  return months.flatMap((month): readonly ActivityGroupVm[] => {
    const rows = month.events.flatMap(({ source }) => {
      const row = rowOf(source, originals, voided, input);
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
  readonly status: SliceStatus;
  /** Every entry loaded so far under the pill, in any order. */
  readonly entries: readonly ActivityEntry[];
  /** The cursor of the next page; `null` = nothing older is left. */
  readonly next: number | null;
  readonly loadingMore: boolean;
  readonly failedMore: boolean;
  readonly filter: ActivityKind;
  /** The head's name; `''` until it is known: the line is the balance alone. */
  readonly holder: string;
  readonly balance: number;
  readonly online: boolean;
}

/**
 * The pills whose rows are the journal's POINT rows: only under them is a
 * month's net the month's. «Награди» and «Статус» read other rows, and the
 * sum of what THOSE moved is nobody's net.
 */
function netsUnder(filter: ActivityKind): boolean {
  return filter === 'all' || filter === 'points';
}

function pagingOf(input: LedgerPageInput): LedgerPagingVm | null {
  if (input.status !== 'ready') return null;
  if (input.loadingMore) return { kind: 'loading' };
  if (input.next === null) return { kind: 'end' };
  // Offline with a cursor left: nothing to offer, and nothing has ended.
  if (!input.online) return null;
  return { kind: input.failedMore ? 'failed' : 'more' };
}

/** The ledger page «Движение» (§2.2.6). */
export function ledgerPageVm(input: LedgerPageInput): LedgerPageVm {
  const { words } = input;
  const balance = words.ledgerPage.points(input.balance);
  const holder = input.holder.trim();
  const ready = input.status === 'ready';
  return {
    status: input.status,
    subline:
      holder === ''
        ? [{ text: balance, fact: true }]
        : runsOf(words.ledgerPage.subline(holder, balance), [balance]),
    filter: input.filter,
    groups: ready
      ? activityGroups(foldByEvent(input.entries, input.next === null), {
          ...input,
          wholeMonths: netsUnder(input.filter)
            ? input.wholeMonths
            : new Set<string>(),
        })
      : [],
    paging: pagingOf(input),
  };
}

// ── The bridge: the reader's row → ecs-core struct (Phase 4 deletes it) ──

/** The shop's zone: a row's month is read on its calendar. */
const SHOP_ZONE = 'Europe/Sofia';

/** A journal row as `LedgerSystem` folds it, the row riding along. */
function ledgerRefOf(
  entry: ActivityEntry,
): LedgerEntryRef & { readonly source: ActivityEntry } {
  const { effect } = entry;
  return {
    id: entry.id,
    seq: entry.seq,
    atMs: entry.at.getTime(),
    correlationId: entry.correlationId,
    reverses: entry.reverses,
    seriesId: textOf(entry, 'seriesId'),
    level: countOf(entry, 'level'),
    kind: effect.kind,
    pointsDelta: effect.kind === 'points' ? effect.delta : null,
    balanceAfter: effect.kind === 'points' ? effect.balanceAfter : null,
    redemptionOp: effect.kind === 'redemption' ? effect.op : null,
    cost: effect.kind === 'redemption' ? effect.cost : null,
    source: entry,
  };
}
