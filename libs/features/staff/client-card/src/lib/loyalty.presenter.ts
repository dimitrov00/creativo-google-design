import {
  type LoyaltyAccount,
  type LoyaltyCatalog,
  type RewardCatalogItem,
  type StreakState,
  sofiaDayOf,
} from '@creativo/application/engagement';
import type { ClientCardGrant } from './client-card.contracts';
import { dayLong, dayShort, daysBetweenDays } from './client-card.format';
import type { RewardReadyVm, Slice } from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';

/*
 * «ЛОЯЛНОСТ» — what the wallet (`wallet.presenter.ts`) and the glance
 * (`glance.presenter.ts`) share of the built page's helpers, as pure
 * functions: the held rewards as tickets, what is offered today, the
 * rhythm's words and state line, one slice mapped. The built page's own
 * sections went with its body in W4. A paused client's values are never
 * zeroed, only frozen.
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
  const groups = new Map<string, ClientCardGrant[]>();
  for (const grant of ready) {
    const key = `${grant.title}\u0000${grant.valueLabel ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), grant]);
  }
  const soonestFirst = (a: ClientCardGrant, b: ClientCardGrant) =>
    (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') ||
    a.grantId.localeCompare(b.grantId);
  const firstOf = (group: GrantGroup) => group.grants[0] as ClientCardGrant;
  return [
    ...[...groups.values()].map((group) => ({
      grants: [...group].sort(soonestFirst),
      applied: false,
    })),
    ...onBill.map((grant) => ({ grants: [grant], applied: true })),
  ].sort((a, b) => soonestFirst(firstOf(a), firstOf(b)));
}

export function ticketOf(
  group: GrantGroup,
  others: number,
  today: string,
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
  today: string,
  words: ClientCardWords,
  onBill: readonly ClientCardGrant[] = [],
): RewardReadyVm | null {
  const groups = groupedGrants(grants, onBill);
  const first = groups[0];
  return first === undefined
    ? null
    : ticketOf(first, groups.length - 1, today, words);
}

/** The track's one sentence: «24 посещения в ритъм, най-много 26, следващото до 9 ноември». */
export function rhythmLabel(
  state: StreakState,
  inChairDue: string | null,
  today: string,
  words: ClientCardWords,
): string {
  const due = inChairDue ?? state.dueBy;
  return words.rhythm.label(
    state.current,
    state.best > state.current ? words.rhythm.bestSuffix(state.best) : '',
    due === null
      ? ''
      : words.rhythm.nextSuffix(dayLong(due, today, words.lang)),
  );
}

/** LG's state line, and the day it names (`null` when it names none). */
interface RhythmStateLine {
  readonly line: string;
  readonly day: string | null;
}

/** Where the rhythm stands, as coaching for staff (old spec §5A.3.4): never loss language. */
export function rhythmStateLine(
  state: StreakState,
  paused: boolean,
  inChairDue: string | null,
  today: string,
  words: ClientCardWords,
): RhythmStateLine {
  const rhythm = words.rhythm;
  const lang = words.lang;
  const none = (line: string): RhythmStateLine => ({ line, day: null });
  const naming = (
    worded: (date: string) => string,
    day: string,
  ): RhythmStateLine => ({ line: worded(dayShort(day, today, lang)), day });
  if (paused) return none(rhythm.frozen);
  // The visit in the chair keeps the rhythm: say when the next one is due.
  if (inChairDue !== null) return naming(rhythm.stateActive, inChairDue);
  if (state.current === 0 && state.lastQualifiedAt === null) {
    return none(rhythm.stateNone);
  }
  const phase = state.phase;
  switch (phase.kind) {
    case 'active':
      return state.dueBy === null
        ? none(rhythm.stateNone)
        : naming(rhythm.stateActive, state.dueBy);
    case 'atRisk': {
      const last =
        state.lastQualifiedAt === null
          ? null
          : sofiaDayOf(state.lastQualifiedAt);
      const weeks =
        last === null
          ? 0
          : Math.max(1, Math.round(daysBetweenDays(last, today) / 7));
      return naming((date) => rhythm.stateAtRisk(weeks, date), phase.dueBy);
    }
    case 'inGrace':
      return naming(rhythm.stateInGrace, phase.graceUntil);
    case 'frozen':
      return none(
        phase.reason === 'freeze' ? rhythm.stateFrozenFreeze : rhythm.frozen,
      );
    case 'broken':
      return naming(rhythm.stateBroken, phase.repairableUntil);
  }
}

/** The rewards a catalogue offers today: enabled, not ended. */
export function offered(
  catalog: LoyaltyCatalog,
  today: string,
): readonly RewardCatalogItem[] {
  return catalog.rewards.filter(
    (reward) =>
      reward.enabled &&
      (reward.available.until === null || reward.available.until >= today),
  );
}

export interface LoyaltyPageInput {
  readonly account: LoyaltyAccount;
  /** `null` = no catalogue reader bound: the sections that need it are absent. */
  readonly catalog: Slice<LoyaltyCatalog> | null;
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
  readonly visitsMs: readonly number[];
  /** The worked visits of a lifetime — LG says «Винаги» for a run that long (`RhythmInput`). */
  readonly lifetimeVisits?: number | null;
  /**
   * A worked visit's services by its shop day, as the history rows word
   * them — what the wallet's activity rows name a visit by; absent =
   * «Посещение».
   */
  readonly visitTitles?: ReadonlyMap<string, string>;
  readonly inChairToday: boolean;
  readonly today: string;
  readonly words: ClientCardWords;
}

export function sliceMap<T, U>(
  slice: Slice<T> | null,
  map: (data: T) => U | null,
): Slice<U> | undefined {
  if (slice === null) return undefined;
  if (slice.status !== 'ready') return slice;
  const data = map(slice.data);
  return data === null ? undefined : { status: 'ready', data };
}
