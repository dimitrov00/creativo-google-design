import {
  AchievementOp,
  JournalEffect,
  JournalFeed,
  LabelCode,
  LedgerLine,
  PublicLabel,
  RedemptionOp,
  RewardOp,
} from '@core/components';
import type { JournalEntry } from '@core/entities';
import {
  BadgeSeriesId,
  type JournalEntryId,
  LocalDate,
  type UtcEpochMs,
} from '@core/primitives';

/*
 * «ДВИЖЕНИЕ» — THE JOURNAL AS A FEED, IN NUMBERS (client-card-revision-3
 * §2.2.5, §2.2.6, §4.7; `ledger.presenter.ts` `foldByEvent`,
 * `wholeMonthsOf`, `activityGroups`). Entries of one event become one: a
 * visit's seats, a level and the points it paid, a redemption and what it
 * cost; the events go by the shop's month (the entry's own `localDate`, T5
 * — no zone is read here), newest first, and a month's net is printed only
 * when the month is wholly loaded and wholly shown. Keys,
 * sums and balances only — the rows' words, glyphs and lines stay in the
 * presenter (a system that reshapes an entity for a template is the
 * `toViewModel()` mapper `angular-ui.md` bans).
 *
 * The rows are the `clientJournal` entries themselves, as the journal port
 * answers them (zero inbound mapping, Law 3): the visit an entry is about is
 * its root `appointmentId`, what it moved its effect's own fields, and a
 * level's family and number its label's `seriesId` / `level` parameters
 * (`LedgerSystem.levelOf`).
 */

/** A level's family and number, as an entry's label names them; either is `null` where the label does not. */
export type LedgerLevel = {
  /** The label's `seriesId`: a family only when it is text that is not blank. */
  readonly badgeSeriesId: BadgeSeriesId | null;
  /** The label's `level`: a level only when it is a whole number. */
  readonly level: number | null;
};

/** One EVENT of the journal: the entries that share it, newest first. */
export type LedgerEvent<E extends JournalEntry = JournalEntry> = {
  /** The event's newest entry. */
  readonly id: JournalEntryId;
  /** The newest entry's instant. */
  readonly utcEpochMs: UtcEpochMs;
  /** The newest entry's shop day — the month the event is filed under. */
  readonly localDate: LocalDate;
  /** Newest first. */
  readonly entries: readonly E[];
  /**
   * What the event moved: the sum of its point rows; read without them (the
   * pill «Награди»), what a redemption cost. `null` when no points moved.
   */
  readonly delta: number | null;
  /** The balance once the event's newest point row was folded in; `null` without one. */
  readonly balanceAfter: number | null;
};

/** One month of the feed, newest first. */
export type LedgerMonth<V extends LedgerEvent = LedgerEvent> = {
  /** `YYYY-MM` on the shop's calendar. */
  readonly key: string;
  readonly events: readonly V[];
  /** What the month's events moved, summed — only for a month wholly loaded and wholly shown, where something moved. */
  readonly net: number | null;
};

/**
 * The effects by rank: the highest one an event holds is what the row is
 * about. The feed reads five effects (`JournalFeed.effectsOf`); the others
 * rank after them, so they never word an event that holds one of the five.
 */
const EFFECT_RANK: Readonly<Record<JournalEffect, number>> = {
  [JournalEffect.Redemption]: 0,
  [JournalEffect.Reward]: 1,
  [JournalEffect.Tier]: 2,
  [JournalEffect.Achievement]: 3,
  [JournalEffect.Points]: 4,
  [JournalEffect.Streak]: 5,
  [JournalEffect.Freeze]: 6,
  [JournalEffect.Pause]: 7,
  [JournalEffect.VisitOutcome]: 8,
};

/** What one row of the feed is about, and the two facts its words turn on. */
export type LedgerLineAnswer = {
  readonly ledgerLine: LedgerLine;
  /** A LEVEL that paid points (the event moved some, or its label is a level's payout). */
  readonly paid: boolean;
  /** What was given is taken back: a revoked level, or REWARD_REVOKED. */
  readonly revoked: boolean;
};

/** The welcome bonus's family — the one level the ledger names by the catalogue's own word, never by its family. */
const WELCOME_SERIES_ID: BadgeSeriesId = BadgeSeriesId.of('series-welcome');

function line(
  ledgerLine: LedgerLine,
  paid = false,
  revoked = false,
): LedgerLineAnswer {
  return { ledgerLine, paid, revoked };
}

/**
 * A row by what its label says moved the points (`ledger.presenter.ts`
 * `pointsDraft`): the rule's points are a level's payout when the label
 * names a family, else a visit's; the shop's own adjustments by their
 * source; anything else a correction.
 */
function pointsLineOf(entry: JournalEntry): LedgerLineAnswer {
  switch (entry.labelCode) {
    case LabelCode.PointsRule:
      return LedgerSystem.levelOf(entry).badgeSeriesId !== null
        ? line(LedgerLine.Level, true)
        : line(LedgerLine.VisitEarned);
    case LabelCode.PointsRedeemed:
      return line(LedgerLine.PointsRedeemed);
    case LabelCode.PointsGoodwill:
      return line(LedgerLine.Goodwill);
    case LabelCode.PointsServiceIssue:
      return line(LedgerLine.ServiceIssue);
    case LabelCode.PointsExpired:
      return line(LedgerLine.PointsExpired);
    case LabelCode.PointsDebtCleared:
      return line(LedgerLine.DebtCleared);
    default:
      return line(LedgerLine.Correction);
  }
}

/**
 * The ids the loaded rows compensate — the rows that are struck (each
 * row's `reverses`); the set {@link LedgerSystem.fold} keeps a struck row
 * apart by, and {@link LedgerSystem.isStruck} reads.
 */
function voided(entries: readonly JournalEntry[]): ReadonlySet<JournalEntryId> {
  const struck = new Set<JournalEntryId>();
  for (let i = 0; i < entries.length; i++) {
    const reverses = (entries[i] as JournalEntry).reverses;
    if (reverses !== null) struck.add(reverses);
  }
  return struck;
}

/**
 * What an entry folds with. A visit folds by its APPOINTMENT (the entry's
 * root `appointmentId`), so its seats are one row whatever correlation id
 * each carries. A LEVEL is an event of its own, the medal and the points
 * it paid. A row that compensates another, and a row that was compensated,
 * never fold with the event they belong to: each keeps a row of its own.
 */
function eventKeyOf(
  entry: JournalEntry,
  voided: ReadonlySet<JournalEntryId>,
): string {
  let event =
    entry.appointmentId === null
      ? entry.correlationId
      : `appt:${entry.appointmentId}`;
  const level = LedgerSystem.levelOf(entry);
  if (level.badgeSeriesId !== null) {
    event += `\u0000${level.badgeSeriesId}\u0000${level.level === null ? '' : String(level.level)}`;
  }
  if (entry.reverses !== null) return `reversal\u0000${event}`;
  return voided.has(entry.id) ? `voided\u0000${event}` : `event\u0000${event}`;
}

/** What a folded event moved, and the balance it left. */
function movementOf(entries: readonly JournalEntry[]): {
  readonly delta: number | null;
  readonly balanceAfter: number | null;
} {
  let delta: number | null = null;
  let balanceAfter: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as JournalEntry;
    if (entry.journalEffect !== JournalEffect.Points) continue;
    delta = (delta ?? 0) + entry.pointsDelta;
    // Newest first: the first point row met is the one the event ends on.
    if (balanceAfter === null) balanceAfter = entry.balanceAfter;
  }
  if (delta !== null) return { delta, balanceAfter };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as JournalEntry;
    if (entry.journalEffect !== JournalEffect.Redemption) continue;
    if (entry.redemptionOp === RedemptionOp.Redeemed) {
      return { delta: -entry.redemptionCost, balanceAfter };
    }
    if (entry.redemptionOp === RedemptionOp.Reversed) {
      return { delta: entry.redemptionCost, balanceAfter };
    }
  }
  return { delta: null, balanceAfter };
}

export const LedgerSystem = {
  /** The welcome bonus's family (`series-welcome`): its level is named by the catalogue's own word. */
  WELCOME_SERIES_ID,

  /**
   * A level's family and number, read off the entry's label
   * (`PublicLabel.param`): the family is a `BadgeSeriesId` only when the
   * `seriesId` parameter is text that is not blank, the level only when the
   * `level` parameter is a whole number — a stored row is answered as
   * stored, so whatever else it holds names no level.
   */
  levelOf(entry: Pick<JournalEntry, 'labelParams'>): LedgerLevel {
    const series = PublicLabel.param(entry, 'seriesId');
    const level = PublicLabel.param(entry, 'level');
    return {
      badgeSeriesId:
        typeof series === 'string' && series.trim() !== ''
          ? BadgeSeriesId.of(series)
          : null,
      level:
        typeof level === 'number' && Number.isInteger(level) ? level : null,
    };
  },

  /**
   * The entries as events, newest first. `whole` says the entries are
   * everything there is under the pill (no cursor is left); when they are
   * NOT, the page boundary may have cut the oldest event, so it is held
   * back until the next page, or the end, confirms it. An event that is the
   * only one read is kept: a page never reads as empty while it holds a row.
   */
  fold<E extends JournalEntry>(
    entries: readonly E[],
    whole: boolean,
  ): readonly LedgerEvent<E>[] {
    const struck = voided(entries);
    const folded = new Map<string, E[]>();
    const newestFirst = [...entries].sort((a, b) => b.seq - a.seq);
    for (let i = 0; i < newestFirst.length; i++) {
      const entry = newestFirst[i] as E;
      const key = eventKeyOf(entry, struck);
      const event = folded.get(key);
      if (event === undefined) folded.set(key, [entry]);
      else event.push(entry);
    }
    const events: LedgerEvent<E>[] = [];
    for (const rows of folded.values()) {
      const newest = rows[0] as E;
      const movement = movementOf(rows);
      events.push({
        id: newest.id,
        utcEpochMs: newest.utcEpochMs,
        localDate: newest.localDate,
        entries: rows,
        delta: movement.delta,
        balanceAfter: movement.balanceAfter,
      });
    }
    return whole || events.length < 2 ? events : events.slice(0, -1);
  },

  /**
   * The months the loaded entries hold WHOLE, oldest first: every month
   * newer than the oldest one loaded, and the oldest too once nothing older
   * is left (`whole`). A month the page boundary may have cut is in doubt,
   * and a month in doubt prints no net.
   */
  wholeMonths(
    entries: readonly Pick<JournalEntry, 'localDate'>[],
    whole: boolean,
  ): readonly string[] {
    const months = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      months.add(
        LocalDate.monthKey(
          (entries[i] as Pick<JournalEntry, 'localDate'>).localDate,
        ),
      );
    }
    const sorted = [...months].sort();
    return whole ? sorted : sorted.slice(1);
  },

  /**
   * The events by the shop's month, newest first, the newest `limit` of
   * them only (`null` = every event). A month prints its net (the sum of
   * what its events moved) only when it is wholly loaded (`wholeMonths`),
   * wholly shown (the limit cut none of it), and something in it moved.
   */
  months<V extends LedgerEvent>(
    events: readonly V[],
    limit: number | null,
    wholeMonths: readonly string[],
  ): readonly LedgerMonth<V>[] {
    const ordered = [...events].sort(
      (a, b) => (b.entries[0]?.seq ?? 0) - (a.entries[0]?.seq ?? 0),
    );
    const shownCount = Math.min(
      ordered.length,
      Math.max(0, Math.floor(limit ?? ordered.length)),
    );
    const cut = new Set<string>();
    for (let i = shownCount; i < ordered.length; i++) {
      cut.add(LocalDate.monthKey((ordered[i] as V).localDate));
    }
    const months = new Map<string, V[]>();
    for (let i = 0; i < shownCount; i++) {
      const event = ordered[i] as V;
      const key = LocalDate.monthKey(event.localDate);
      const month = months.get(key);
      if (month === undefined) months.set(key, [event]);
      else month.push(event);
    }
    const whole = new Set(wholeMonths);
    const out: LedgerMonth<V>[] = [];
    for (const [key, month] of months) {
      let moved = false;
      let sum = 0;
      for (let i = 0; i < month.length; i++) {
        const delta = (month[i] as V).delta;
        if (delta === null) continue;
        moved = true;
        sum += delta;
      }
      out.push({
        key,
        events: month,
        net: whole.has(key) && !cut.has(key) && moved ? sum : null,
      });
    }
    return out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  },

  /** The entry a row is worded by: the event's highest-ranked effect, its newest row first; `null` for no entry. */
  leading<E extends JournalEntry>(event: LedgerEvent<E>): E | null {
    let leading: E | null = null;
    for (let i = 0; i < event.entries.length; i++) {
      const entry = event.entries[i] as E;
      if (
        leading === null ||
        EFFECT_RANK[entry.journalEffect] < EFFECT_RANK[leading.journalEffect]
      ) {
        leading = entry;
      }
    }
    return leading;
  },

  voided,

  /** A row is struck when any entry of its event was compensated (`voided`). */
  isStruck(
    event: Pick<LedgerEvent, 'entries'>,
    voided: ReadonlySet<JournalEntryId>,
  ): boolean {
    for (let i = 0; i < event.entries.length; i++) {
      if (voided.has((event.entries[i] as JournalEntry).id)) return true;
    }
    return false;
  },

  /**
   * What a row is about (`ledger.presenter.ts` `draftOf`), from its event's
   * leading entry ({@link LedgerSystem.leading}), first match wins: a row
   * that compensates another is a REVERSAL; a redemption taken back is a
   * REVERSAL too, one that lapsed REDEMPTION_EXPIRED, else
   * REDEMPTION_SPENT; a reward REWARD_REVOKED or REWARD_GRANTED; a tier
   * TIER; an achievement a LEVEL — `paid` when the event moved points,
   * `revoked` when the level was taken back; a point row, and a row of any
   * other effect, by what its label says moved the points (a level's
   * payout is a paid LEVEL, the rule's own points VISIT_EARNED, then
   * POINTS_REDEEMED, GOODWILL, SERVICE_ISSUE, POINTS_EXPIRED,
   * DEBT_CLEARED), any other label a CORRECTION.
   */
  lineOf(
    event: Pick<LedgerEvent, 'delta'>,
    leading: JournalEntry,
  ): LedgerLineAnswer {
    if (leading.reverses !== null) return line(LedgerLine.Reversal);
    switch (leading.journalEffect) {
      case JournalEffect.Redemption:
        if (leading.redemptionOp === RedemptionOp.Reversed) {
          return line(LedgerLine.Reversal);
        }
        return leading.redemptionOp === RedemptionOp.Expired
          ? line(LedgerLine.RedemptionExpired)
          : line(LedgerLine.RedemptionSpent);
      case JournalEffect.Reward:
        return leading.rewardOp === RewardOp.Revoked
          ? line(LedgerLine.RewardRevoked, false, true)
          : line(LedgerLine.RewardGranted);
      case JournalEffect.Tier:
        return line(LedgerLine.Tier);
      case JournalEffect.Achievement:
        return line(
          LedgerLine.Level,
          event.delta !== null,
          leading.achievementOp === AchievementOp.Revoked,
        );
      default:
        // The feed reads five effects (`JournalFeed.effectsOf`); a row of
        // another, answered as stored, is read by its label like a point row.
        return pointsLineOf(leading);
    }
  },

  /** The level is the welcome bonus's ({@link LedgerSystem.WELCOME_SERIES_ID}). */
  isWelcome(level: Pick<LedgerLevel, 'badgeSeriesId'>): boolean {
    return level.badgeSeriesId === WELCOME_SERIES_ID;
  },

  /**
   * The pills whose rows are the journal's POINT rows («Всички», «Точки»):
   * only under them is a month's net the month's. «Награди» and «Статус»
   * read other rows, and the sum of what THOSE moved is nobody's net.
   */
  netsUnder(feed: JournalFeed): boolean {
    return feed === JournalFeed.All || feed === JournalFeed.Points;
  },
} as const;
