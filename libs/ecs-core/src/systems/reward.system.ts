import type { DayKey } from '../components/day-key.data';
import {
  RedeemProblem,
  type RedemptionRecord,
} from '../components/reward-redemption.data';
import type { RewardCatalogItemEntity } from '../entities/reward-catalog-item.entity';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * WHAT POINTS BUY (client-card-redesign §4.2, `standing.ts:319-391`; the
 * wallet's reward tiles, `wallet.presenter.ts:938-955`; the held rewards as
 * tickets, `loyalty.presenter.ts:45` `groupedGrants` and `:188` `offered`).
 * The one redeem gate the callable decides with and the card words its
 * lock line with; what the balance buys and reaches; a tile's reach; the
 * held grants grouped into tickets. Verdicts, numbers and ids — never a
 * tile's words.
 */

/** What the gate reads of a reward. */
export type RedeemableRewardRef = Pick<
  RewardCatalogItemEntity,
  'id' | 'cost' | 'enabled' | 'order' | 'available' | 'limits' | 'redeemedCount'
>;

/** The client as the gate sees them. */
export type RedeemContext = {
  /** Signed: an owed (negative) balance never redeems. */
  readonly balance: number;
  readonly today: DayKey;
  /** A paused client earns but does not redeem. */
  readonly paused: boolean;
  /** The client's non-reversed redemptions. */
  readonly recent: readonly RedemptionRecord[];
};

/** How far a reward is from the balance, as its tile meters it. */
export type RewardReach = {
  /** The points cover it. */
  readonly affordable: boolean;
  /** The points still missing; 0 when covered. */
  readonly short: number;
  /** The meter, `0 … 0.999` — never full; `null` when covered. */
  readonly progress: number | null;
};

/** What a ticket reads of a held grant: its id, what makes two grants one ticket, and when it expires. */
export type GrantTicketRef = {
  readonly grantId: string;
  /** Grants with one key are one ticket: the same coupon, worded the same. */
  readonly groupKey: string;
  readonly expiresOn: DayKey | null;
};

/** One ticket: its grants, the soonest to expire first, and whether it stands on this visit's bill. */
export type GrantTicket<G extends GrantTicketRef = GrantTicketRef> = {
  readonly grants: readonly G[];
  readonly applied: boolean;
};

/** A grant that never expires sorts after every day. */
const NEVER = '9999-12-31';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function soonestFirst(a: GrantTicketRef, b: GrantTicketRef): number {
  return (
    compareText(a.expiresOn ?? NEVER, b.expiresOn ?? NEVER) ||
    compareText(a.grantId, b.grantId)
  );
}

export const RewardSystem = {
  /**
   * The one redeem gate: switched off, not open yet, over, sold out, a
   * paused client, beyond the balance (an owed balance never redeems), the
   * per-client limit inside its window — first match wins; `null` lets the
   * reward through.
   */
  problem(item: RedeemableRewardRef, ctx: RedeemContext): RedeemProblem | null {
    if (!item.enabled) return RedeemProblem.Disabled;
    if (item.available.from !== null && ctx.today < item.available.from) {
      return RedeemProblem.NotYetAvailable;
    }
    if (item.available.until !== null && ctx.today > item.available.until) {
      return RedeemProblem.Ended;
    }
    if (item.limits.total !== null && item.redeemedCount >= item.limits.total) {
      return RedeemProblem.SoldOut;
    }
    if (ctx.paused) return RedeemProblem.Paused;
    if (ctx.balance < item.cost) return RedeemProblem.InsufficientPoints;
    const per = item.limits.perClient;
    if (per !== null) {
      let inWindow = 0;
      for (let i = 0; i < ctx.recent.length; i++) {
        const record = ctx.recent[i] as RedemptionRecord;
        if (
          record.rewardId === item.id &&
          ZonedTimeSystem.daysBetween(record.on, ctx.today) < per.windowDays
        ) {
          inWindow += 1;
        }
      }
      if (inWindow >= per.count) return RedeemProblem.PerClientLimit;
    }
    return null;
  },

  /** The costliest reward the balance buys today (enabled, in its window, in stock); ties by catalogue order. */
  bestAffordable<R extends RedeemableRewardRef>(
    rewards: readonly R[],
    balance: number,
    today: DayKey,
  ): R | null {
    let best: R | null = null;
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i] as R;
      if (RewardSystem.problem(reward, open(balance, today)) !== null) continue;
      if (
        best === null ||
        reward.cost > best.cost ||
        (reward.cost === best.cost && reward.order < best.order)
      ) {
        best = reward;
      }
    }
    return best;
  },

  /** The cheapest reward the balance does not reach yet — one that points alone keep from the client. */
  nextAffordable<R extends RedeemableRewardRef>(
    rewards: readonly R[],
    balance: number,
    today: DayKey,
  ): R | null {
    let next: R | null = null;
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i] as R;
      if (
        RewardSystem.problem(reward, open(balance, today)) !==
        RedeemProblem.InsufficientPoints
      ) {
        continue;
      }
      if (
        next === null ||
        reward.cost < next.cost ||
        (reward.cost === next.cost && reward.order < next.order)
      ) {
        next = reward;
      }
    }
    return next;
  },

  /** The rewards a catalogue offers today: enabled, not ended — in the order given. */
  offered<R extends Pick<RedeemableRewardRef, 'enabled' | 'available'>>(
    rewards: readonly R[],
    today: DayKey,
  ): readonly R[] {
    const out: R[] = [];
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i] as R;
      if (
        reward.enabled &&
        (reward.available.until === null || reward.available.until >= today)
      ) {
        out.push(reward);
      }
    }
    return out;
  },

  /**
   * A reward's tile, judged by the balance against the cost and nothing
   * else (a paused client's reach is the points'): `null` for a reward
   * nobody can take today (not yet offered, sold out, ended, off); else
   * whether the points cover it, what they miss, and the meter, from
   * nothing for an account that owes and never full.
   */
  affordable(
    item: RedeemableRewardRef,
    balance: number,
    today: DayKey,
  ): RewardReach | null {
    const problem = RewardSystem.problem(item, open(balance, today));
    if (problem !== null && problem !== RedeemProblem.InsufficientPoints) {
      return null;
    }
    const covered = problem === null;
    return {
      affordable: covered,
      short: Math.max(0, item.cost - balance),
      progress: covered
        ? null
        : Math.min(Math.max(balance, 0) / item.cost, 0.999),
    };
  },

  /**
   * Held grants as tickets: identical ready grants (one `groupKey`) are one
   * ticket; a grant ON THE BILL is a ticket of its own, applied. Every
   * ticket in ONE order, the soonest to expire first (then by grant id),
   * applied or not — so the one used stays where it stood.
   */
  groupGrants<G extends GrantTicketRef>(
    ready: readonly G[],
    onBill: readonly G[],
  ): readonly GrantTicket<G>[] {
    const groups = new Map<string, G[]>();
    for (let i = 0; i < ready.length; i++) {
      const grant = ready[i] as G;
      const group = groups.get(grant.groupKey);
      if (group === undefined) groups.set(grant.groupKey, [grant]);
      else group.push(grant);
    }
    const tickets: GrantTicket<G>[] = [];
    for (const group of groups.values()) {
      tickets.push({ grants: group.sort(soonestFirst), applied: false });
    }
    for (let i = 0; i < onBill.length; i++) {
      tickets.push({ grants: [onBill[i] as G], applied: true });
    }
    return tickets.sort((a, b) =>
      soonestFirst(a.grants[0] as G, b.grants[0] as G),
    );
  },
} as const;

/** The gate's context for a reward judged on points alone. */
function open(balance: number, today: DayKey): RedeemContext {
  return { balance, today, paused: false, recent: [] };
}
