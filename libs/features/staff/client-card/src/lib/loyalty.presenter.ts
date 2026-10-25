import type { LoyaltyAccount, StreakDefinition } from '@core/entities';
import {
  type LocalDate,
  type TimeZone,
  type UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  FreezeReason,
  type StreakHeadRule,
  StreakOutlook,
  StreakState,
} from '@core/components';
import {
  type GrantTicketRef,
  RewardSystem,
  type StreakOutlookAnswer,
  StreakRuleSystem,
  StreakSystem,
  type ValidLoyaltyCatalog,
} from '@core/systems';
import { streakPeriodReasonWords } from '@creativo/infrastructure/i18n';
import type { ClientCardGrant } from './client-card.contracts';
import { dayLong, dayShort, shopDayOf } from './client-card.format';
import { type RewardReadyVm } from './client-pages.vm';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';
import type { ClientCardWords } from './client-card.words';
import type { VisitNames } from './ledger.presenter';

/*
 * «ЛОЯЛНОСТ» — what the wallet (`wallet.presenter.ts`) and the glance
 * (`glance.presenter.ts`) share of the built page's helpers, as pure
 * functions: the held rewards as tickets, the rhythm's words and state
 * line, one slice mapped. The built page's own sections went with its
 * body in W4. A paused client's values are never zeroed, only frozen.
 */

/** The four loyalty flags as the store read them (`config/feature-flags.json`). */
export interface LoyaltyFlags {
  readonly points: boolean;
  readonly streaks: boolean;
  readonly achievements: boolean;
  readonly tiers: boolean;
}

// ── Ready rewards (E, LD) ───────────────────────────────────────────────

/** One ticket's grants, and whether it stands on this visit's bill. */
interface GrantGroup {
  readonly grants: readonly ClientCardGrant[];
  readonly applied: boolean;
}

/**
 * Identical ready grants — the same coupon, worded the same — are one
 * ticket; a grant ON THE BILL is a ticket of its own, stamped. Every ticket
 * in ONE order, the soonest to expire first, applied or not — so the one
 * «Използвай» used stays where it stood (the owner's coupon rule: «it
 * stays where it is and its button changes to remove», WP7 review r6).
 */
export function groupedGrants(
  ready: readonly ClientCardGrant[],
  onBill: readonly ClientCardGrant[],
): readonly GrantGroup[] {
  return RewardSystem.groupGrants(
    ready.map(ticketRefOf),
    onBill.map(ticketRefOf),
  ).map((ticket) => ({
    grants: ticket.grants.map((ref) => ref.source),
    applied: ticket.applied,
  }));
}

export function ticketOf(
  group: GrantGroup,
  others: number,
  today: LocalDate,
  words: ClientCardWords,
): RewardReadyVm {
  const first = group.grants[0] as ClientCardGrant;
  const detail = [
    first.expiresOn === null
      ? null
      : words.reward.until(dayShort(first.expiresOn, today, words.lang)),
    others > 0 ? words.reward.more(others) : null,
  ].filter((part): part is string => part !== null);
  return {
    grantId: first.grantId,
    title: first.title,
    value: first.valueLabel,
    detail: detail.length === 0 ? null : detail.join(' '),
    stack:
      !group.applied && group.grants.length > 1
        ? words.reward.stack(group.grants.length)
        : null,
    applied: group.applied,
    accessibleName: group.applied
      ? words.reward.appliedName(first.title, first.valueLabel)
      : words.reward.name(first.title, first.valueLabel),
    removeName: words.reward.removeName(first.title),
  };
}

/**
 * E — the glance's one ticket: the soonest to expire, «· още 1» when other
 * kinds are held too; stamped when it is on this visit's bill, so a used
 * reward stays on the card.
 */
export function glanceReward(
  grants: readonly ClientCardGrant[],
  today: LocalDate,
  words: ClientCardWords,
  onBill: readonly ClientCardGrant[] = [],
): RewardReadyVm | null {
  const groups = groupedGrants(grants, onBill);
  const first = groups[0];
  return first === undefined
    ? null
    : ticketOf(first, groups.length - 1, today, words);
}

// ── The rhythm (§4.1, §4.2) ─────────────────────────────────────────────

/**
 * The rule the rhythm is judged by on the card's today
 * (`StreakRuleSystem.inForceOn`); `null` without a rhythm. A rule that is
 * switched OFF is still the rule in force: whoever draws the rhythm asks it
 * whether it is `enabled`.
 */
export function ruleInForceOf(
  rhythm: StreakDefinition | null,
  today: LocalDate,
): StreakHeadRule | null {
  return rhythm === null ? null : StreakRuleSystem.inForceOn(rhythm, today);
}

/** The rule that waits for its day (`StreakRuleSystem.upcomingOn`); `null` with nothing waiting, or without a rhythm. */
export function ruleUpcomingOf(
  rhythm: StreakDefinition | null,
  today: LocalDate,
): StreakHeadRule | null {
  return rhythm === null ? null : StreakRuleSystem.upcomingOn(rhythm, today);
}

/** The account's state of the rhythm (`StreakState.find`, a linear scan); `null` without a rhythm or a state. */
export function rhythmStateOf(
  account: Pick<LoyaltyAccount, 'streaks'>,
  rhythm: Pick<StreakDefinition, 'id'> | null,
): StreakState | null {
  return rhythm === null ? null : StreakState.find(account.streaks, rhythm.id);
}

/**
 * The track's sentence naming `due` — the day the next visit keeps the
 * rhythm by (`StreakSystem.outlook`'s `nextDue`), `null` to name none; the
 * best run is said only where `StreakSystem.record` gives one.
 */
export function rhythmTrackName(
  state: Pick<StreakState, 'current' | 'best'>,
  due: LocalDate | null,
  today: LocalDate,
  words: ClientCardWords,
): string {
  const best = StreakSystem.record(state);
  return words.rhythm.label(
    state.current,
    best === null ? '' : words.rhythm.bestSuffix(best),
    due === null
      ? ''
      : words.rhythm.nextSuffix(dayLong(due, today, words.lang)),
  );
}

/** LG's state line, and the day it names (`null` when it names none). */
interface RhythmStateLine {
  readonly line: string;
  readonly day: LocalDate | null;
}

/** What the card reads around the rhythm's state when it asks where the rhythm stands. */
export interface RhythmOutlookView {
  readonly paused: boolean;
  /** The next due date once the visit in the chair counts (`StreakSystem.inChairDue`). */
  readonly inChairDue: LocalDate | null;
  readonly today: LocalDate;
  /** The shop's zone (Law 7.2): where the last counted visit's stamp becomes its shop day. */
  readonly zone: TimeZone;
}

/**
 * Where the rhythm stands (`StreakSystem.outlook`), on the card's today.
 * The system is zone-blind (D-11): the last counted visit's stamp is read
 * here, on the shop's calendar, and handed over as its shop day.
 */
export function rhythmOutlookOf(
  state: StreakState,
  view: RhythmOutlookView,
): StreakOutlookAnswer {
  return StreakSystem.outlook(state, {
    today: view.today,
    inChairDue: view.inChairDue,
    paused: view.paused,
    lastQualifiedOn:
      state.lastQualifiedAtUtcMs === null
        ? null
        : shopDayOf(state.lastQualifiedAtUtcMs, view.zone),
  });
}

/** A fragment as a sentence's opening: its first letter raised. */
function capitalised(text: string, lang: string): string {
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
}

/** What carries a frozen period, as the line says it. */
function frozenLine(
  reason: FreezeReason | null,
  words: ClientCardWords,
): string {
  const rhythm = words.rhythm;
  switch (reason) {
    case FreezeReason.Freeze:
      return rhythm.stateFrozenFreeze;
    case FreezeReason.Excuse:
      return rhythm.stateFrozenExcuse;
    case FreezeReason.ClientPause:
      return capitalised(
        rhythm.reason(streakPeriodReasonWords[FreezeReason.ClientPause]),
        words.lang,
      );
    default:
      return rhythm.frozen;
  }
}

/**
 * The outlook's line, and the day it names (`StreakOutlookAnswer.day`), as
 * coaching for staff (old spec §5A.3.4): never loss language.
 */
export function rhythmLineOf(
  outlook: StreakOutlookAnswer,
  today: LocalDate,
  words: ClientCardWords,
): RhythmStateLine {
  const rhythm = words.rhythm;
  const day = outlook.day;
  const none = (line: string): RhythmStateLine => ({ line, day: null });
  const naming = (worded: (date: string) => string): RhythmStateLine =>
    day === null
      ? defect(`${outlook.streakOutlook} names a day`)
      : { line: worded(dayShort(day, today, words.lang)), day };
  switch (outlook.streakOutlook) {
    case StreakOutlook.Paused:
      return none(rhythm.frozen);
    case StreakOutlook.InChair:
    case StreakOutlook.Due:
      return naming(rhythm.stateActive);
    case StreakOutlook.NotStarted:
    case StreakOutlook.BrokenFinal:
    case StreakOutlook.DueNone:
      return none(rhythm.stateNone);
    case StreakOutlook.Frozen:
      return none(frozenLine(outlook.phaseFreezeReason, words));
    case StreakOutlook.BrokenRepairable:
      return naming(rhythm.stateBroken);
    case StreakOutlook.Held:
      return naming(rhythm.stateHeld);
    case StreakOutlook.AtRisk:
      return naming((date) => rhythm.stateAtRisk(outlook.weeksSinceLast, date));
    case StreakOutlook.InGrace:
      return naming(rhythm.stateInGrace);
  }
}

export interface LoyaltyPageInput {
  /** `loyaltyAccounts/{customerId}` as stored. */
  readonly account: LoyaltyAccount;
  /** `null` = no catalogue reader bound: the sections that need it are absent. */
  readonly catalog: LoadSlice<ValidLoyaltyCatalog> | null;
  readonly flags: LoyaltyFlags;
  readonly paused: boolean;
  /**
   * The owner's held rewards when using one can be written now (the
   * subject owns the visit, it is open, the device online, the client not
   * paused); `[]` otherwise.
   */
  readonly usableGrants: readonly ClientCardGrant[];
  /**
   * Of the owner's held rewards, those already on this visit's bill —
   * drawn stamped where they stand, «Премахни» (WP7 review r6); under the
   * same gate as `usableGrants`. Absent = none.
   */
  readonly usableGrantsOnBill?: readonly ClientCardGrant[];
  /** The stats' worked visits of the last year, each as its start instant on the shop's zone. */
  readonly visitsMs: readonly UtcEpochMs[];
  /** The worked visits of a lifetime — LG says «Винаги» for a run that long (`RhythmInput`). */
  readonly lifetimeVisits?: number | null;
  /**
   * A worked visit's services by its appointment and by its shop day, as
   * the history rows word them — what the wallet's activity rows name a
   * visit by; absent = «Посещение».
   */
  readonly visitTitles?: VisitNames;
  readonly inChairToday: boolean;
  /** The shop calendar's today, on the shop's zone. */
  readonly today: LocalDate;
  /** The shop's zone (Law 7.2): where a stamp's shop day is read. */
  readonly zone: TimeZone;
  readonly words: ClientCardWords;
}

export function sliceMap<T, U>(
  slice: LoadSlice<T> | null,
  map: (data: T) => U | null,
): LoadSlice<U> | undefined {
  if (slice === null) return undefined;
  if (slice.loadState !== LoadState.Ready) return slice;
  const data = map(slice.data);
  return data === null ? undefined : LoadSlice.ready(data);
}

// ── The card's own values → ecs-core structs ──────────────────────────────

/**
 * A held grant as `RewardSystem.groupGrants` reads it: identical grants —
 * the same coupon, worded the same — share a key, and the grant rides along.
 */
function ticketRefOf(grant: ClientCardGrant): GrantTicketRef & {
  readonly source: ClientCardGrant;
} {
  return {
    grantId: grant.grantId,
    groupKey: `${grant.title}\u0000${grant.valueLabel ?? ''}`,
    expiresOn: grant.expiresOn,
    source: grant,
  };
}
