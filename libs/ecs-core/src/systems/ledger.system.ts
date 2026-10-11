import { JournalEffect, RedemptionOp } from '../components/journal-effect.data';
import type {
  BadgeSeriesId,
  CorrelationId,
  JournalEntryId,
} from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

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
 */

/** The effects a feed row is about — the five the activity feed reads, a subset of `JournalEffect`. */
export type LedgerEffectKind =
  | typeof JournalEffect.Points
  | typeof JournalEffect.Achievement
  | typeof JournalEffect.Tier
  | typeof JournalEffect.Reward
  | typeof JournalEffect.Redemption;

/**
 * One client-visible journal row, as the feed folds it. Every field is
 * present; the ones an effect does not carry are `null`. It carries its
 * instant AND its shop day (T5): the month a row falls in is read off
 * `localDate`, never computed from the instant here.
 */
export type LedgerEntryRef = {
  readonly id: JournalEntryId;
  readonly seq: number;
  readonly utcEpochMs: UtcEpochMs;
  readonly localDate: LocalDate;
  /** Entries of one event share it: `appt:{appointmentId}[:seat:{seatId}]` for a visit. */
  readonly correlationId: CorrelationId;
  /** The entry this row compensates. */
  readonly reverses: JournalEntryId | null;
  /** A level's family (the label's `seriesId`); `null` on other rows. */
  readonly badgeSeriesId: BadgeSeriesId | null;
  /** A level's number (the label's `level`); `null` on other rows. */
  readonly level: number | null;
  readonly journalEffect: LedgerEffectKind;
  /** A point row's signed delta; `null` on other rows. */
  readonly pointsDelta: number | null;
  /** The balance once a point row was folded in; `null` on other rows. */
  readonly balanceAfter: number | null;
  /** A redemption row's op; `null` on other rows. */
  readonly redemptionOp: RedemptionOp | null;
  /** A redemption row's cost; `null` on other rows. */
  readonly cost: number | null;
};

/** One EVENT of the journal: the entries that share it, newest first. */
export type LedgerEvent<E extends LedgerEntryRef = LedgerEntryRef> = {
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

/** The effects by rank: the highest one an event holds is what the row is about. */
const EFFECT_RANK = {
  [JournalEffect.Redemption]: 0,
  [JournalEffect.Reward]: 1,
  [JournalEffect.Tier]: 2,
  [JournalEffect.Achievement]: 3,
  [JournalEffect.Points]: 4,
} as const;

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
function voidedIds(entries: readonly LedgerEntryRef[]): Set<string> {
  const voided = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const reverses = (entries[i] as LedgerEntryRef).reverses;
    if (reverses !== null) voided.add(reverses);
  }
  return voided;
}

/**
 * What an entry folds with. A visit folds by its APPOINTMENT, so its seats
 * are one row under either spelling of the id. A LEVEL is an event of its
 * own, the medal and the points it paid. A row that compensates another,
 * and a row that was compensated, never fold with the event they belong
 * to: each keeps a row of its own.
 */
function eventKeyOf(
  entry: LedgerEntryRef,
  voided: ReadonlySet<string>,
): string {
  const appointmentId = appointmentIdOf(entry.correlationId);
  let event =
    appointmentId === null ? entry.correlationId : `appt:${appointmentId}`;
  if (entry.badgeSeriesId !== null) {
    event += `\u0000${entry.badgeSeriesId}\u0000${entry.level === null ? '' : String(entry.level)}`;
  }
  if (entry.reverses !== null) return `reversal\u0000${event}`;
  return voided.has(entry.id) ? `voided\u0000${event}` : `event\u0000${event}`;
}

/** What a folded event moved, and the balance it left. */
function movementOf(entries: readonly LedgerEntryRef[]): {
  readonly delta: number | null;
  readonly balanceAfter: number | null;
} {
  let delta: number | null = null;
  let balanceAfter: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as LedgerEntryRef;
    if (entry.journalEffect !== JournalEffect.Points) continue;
    delta = (delta ?? 0) + (entry.pointsDelta ?? 0);
    // Newest first: the first point row met is the one the event ends on.
    if (balanceAfter === null) balanceAfter = entry.balanceAfter;
  }
  if (delta !== null) return { delta, balanceAfter };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as LedgerEntryRef;
    if (entry.journalEffect !== JournalEffect.Redemption) continue;
    if (entry.redemptionOp === RedemptionOp.Redeemed) {
      return { delta: -(entry.cost ?? 0), balanceAfter };
    }
    if (entry.redemptionOp === RedemptionOp.Reversed) {
      return { delta: entry.cost ?? 0, balanceAfter };
    }
  }
  return { delta: null, balanceAfter };
}

export const LedgerSystem = {
  /**
   * The entries as events, newest first. `whole` says the entries are
   * everything there is under the pill (no cursor is left); when they are
   * NOT, the page boundary may have cut the oldest event, so it is held
   * back until the next page, or the end, confirms it. An event that is the
   * only one read is kept: a page never reads as empty while it holds a row.
   */
  fold<E extends LedgerEntryRef>(
    entries: readonly E[],
    whole: boolean,
  ): readonly LedgerEvent<E>[] {
    const voided = voidedIds(entries);
    const folded = new Map<string, E[]>();
    const newestFirst = [...entries].sort((a, b) => b.seq - a.seq);
    for (let i = 0; i < newestFirst.length; i++) {
      const entry = newestFirst[i] as E;
      const key = eventKeyOf(entry, voided);
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

  /** The shop-calendar month a shop day falls in: `YYYY-MM`. */
  monthOf(localDate: LocalDate): string {
    return LocalDate.monthKey(localDate);
  },

  /**
   * The months the loaded entries hold WHOLE, oldest first: every month
   * newer than the oldest one loaded, and the oldest too once nothing older
   * is left (`whole`). A month the page boundary may have cut is in doubt,
   * and a month in doubt prints no net.
   */
  wholeMonths(
    entries: readonly LedgerEntryRef[],
    whole: boolean,
  ): readonly string[] {
    const months = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      months.add(
        LedgerSystem.monthOf((entries[i] as LedgerEntryRef).localDate),
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
      cut.add(LedgerSystem.monthOf((ordered[i] as V).localDate));
    }
    const months = new Map<string, V[]>();
    for (let i = 0; i < shownCount; i++) {
      const event = ordered[i] as V;
      const key = LedgerSystem.monthOf(event.localDate);
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
  leading<E extends LedgerEntryRef>(event: LedgerEvent<E>): E | null {
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
} as const;
