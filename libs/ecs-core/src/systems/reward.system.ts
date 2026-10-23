import {
  type LocalizedText,
  PointsReach,
  RedeemProblem,
  type RedemptionRecord,
} from '@core/components';
import type { RewardCatalogItem } from '@core/entities';
import { type CouponGrantId, LocalDate, type Locale } from '@core/primitives';

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
  RewardCatalogItem,
  | 'id'
  | 'cost'
  | 'enabled'
  | 'order'
  | 'availableFrom'
  | 'availableUntil'
  | 'perClientLimitCount'
  | 'perClientLimitWindowDays'
  | 'totalLimit'
  | 'redeemedCount'
>;

/** The client as the gate sees them. */
export type RedeemContext = {
  /** Signed: an owed (negative) balance never redeems. */
  readonly balance: number;
  readonly today: LocalDate;
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

/** One reward's tile: the reward as given, and how far the balance is from it. */
export type RewardTile<R extends RedeemableRewardRef = RedeemableRewardRef> = {
  readonly reward: R;
  readonly reach: RewardReach;
};

/** The catalogue as tiles, within reach first, and how many the points cover. */
export type RewardTiles<R extends RedeemableRewardRef = RedeemableRewardRef> = {
  readonly tiles: readonly RewardTile<R>[];
  /** The tiles the points cover — the first `withinReach` of `tiles`. */
  readonly withinReach: number;
};

/** What the balance reaches in the catalogue, and how far it is from it. */
export type PointsReachAnswer<
  R extends RedeemableRewardRef = RedeemableRewardRef,
> = {
  readonly pointsReach: PointsReach;
  /** The reward the sentence names: the costliest covered (ENOUGH_FOR), the cheapest out of reach (MORE_TO); `null` for NONE. */
  readonly reward: R | null;
  /** The points still missing — `reward.cost − balance` for MORE_TO, 0 otherwise. */
  readonly short: number;
};

/** What a ticket reads of a held grant: its id, what makes two grants one ticket, and when it expires. */
export type GrantTicketRef = {
  readonly grantId: CouponGrantId;
  /** Grants with one key are one ticket: the same coupon, worded the same. */
  readonly groupKey: string;
  readonly expiresOn: LocalDate | null;
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
    if (item.availableFrom !== null && ctx.today < item.availableFrom) {
      return RedeemProblem.NotYetAvailable;
    }
    if (item.availableUntil !== null && ctx.today > item.availableUntil) {
      return RedeemProblem.Ended;
    }
    if (item.totalLimit !== null && item.redeemedCount >= item.totalLimit) {
      return RedeemProblem.SoldOut;
    }
    if (ctx.paused) return RedeemProblem.Paused;
    if (ctx.balance < item.cost) return RedeemProblem.InsufficientPoints;
    const perCount = item.perClientLimitCount;
    const perWindowDays = item.perClientLimitWindowDays;
    if (perCount !== null && perWindowDays !== null) {
      let inWindow = 0;
      for (let i = 0; i < ctx.recent.length; i++) {
        const record = ctx.recent[i] as RedemptionRecord;
        if (
          record.rewardId === item.id &&
          LocalDate.daysBetween(record.on, ctx.today) < perWindowDays
        ) {
          inWindow += 1;
        }
      }
      if (inWindow >= perCount) return RedeemProblem.PerClientLimit;
    }
    return null;
  },

  /** The costliest reward the balance buys today (enabled, in its window, in stock); ties by catalogue order. */
  bestAffordable<R extends RedeemableRewardRef>(
    rewards: readonly R[],
    balance: number,
    today: LocalDate,
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
    today: LocalDate,
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
  offered<R extends Pick<RedeemableRewardRef, 'enabled' | 'availableUntil'>>(
    rewards: readonly R[],
    today: LocalDate,
  ): readonly R[] {
    const out: R[] = [];
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i] as R;
      if (
        reward.enabled &&
        (reward.availableUntil === null || reward.availableUntil >= today)
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
    today: LocalDate,
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
   * The catalogue as the wallet's tiles (`wallet.presenter.ts` `tilesOf`):
   * the rewards {@link RewardSystem.offered} today, each judged by
   * {@link RewardSystem.affordable} — the balance against the cost and
   * nothing else, so a paused client's reach is the points' — and a reward
   * nobody can take today (not yet open, sold out) is no tile. The ones the
   * points cover first; inside each half the catalogue's own order.
   */
  tiles<R extends RedeemableRewardRef>(
    rewards: readonly R[],
    balance: number,
    today: LocalDate,
  ): RewardTiles<R> {
    const offered = RewardSystem.offered(rewards, today);
    const within: RewardTile<R>[] = [];
    const beyond: RewardTile<R>[] = [];
    for (let i = 0; i < offered.length; i++) {
      const reward = offered[i] as R;
      const reach = RewardSystem.affordable(reward, balance, today);
      if (reach === null) continue;
      (reach.affordable ? within : beyond).push({ reward, reach });
    }
    return { tiles: [...within, ...beyond], withinReach: within.length };
  },

  /**
   * What the points buy, as the glance's sentence says it (`glance.presenter.ts`
   * `pointsSentence`): the costliest reward the balance covers
   * ({@link RewardSystem.bestAffordable}) → ENOUGH_FOR; else the cheapest
   * one it does not reach yet ({@link RewardSystem.nextAffordable}) →
   * MORE_TO, `short` = its cost less the balance; else NONE — over the
   * rewards as given. The glance's sentence asks
   * {@link RewardSystem.pointsReachBeyondHeld}, which first keeps only the
   * rewards it may name.
   */
  pointsReach<R extends RedeemableRewardRef>(
    rewards: readonly R[],
    balance: number,
    today: LocalDate,
  ): PointsReachAnswer<R> {
    const best = RewardSystem.bestAffordable(rewards, balance, today);
    if (best !== null) {
      return { pointsReach: PointsReach.EnoughFor, reward: best, short: 0 };
    }
    const next = RewardSystem.nextAffordable(rewards, balance, today);
    return next === null
      ? { pointsReach: PointsReach.None, reward: null, short: 0 }
      : {
          pointsReach: PointsReach.MoreTo,
          reward: next,
          short: next.cost - balance,
        };
  },

  /**
   * What the points buy beyond the rewards already in hand (DV5's held
   * rule, `glance.presenter.ts` `pointsSentence`): of the rewards
   * {@link RewardSystem.offered} today, none held on this visit — offered
   * by the ticket or already on the bill — then
   * {@link RewardSystem.pointsReach}. A held reward is known by the name
   * its coupon was stored under, in the card's `locale` (a grant carries no
   * reward id yet), so the answer does not flip with «Използвай» and
   * «Премахни».
   */
  pointsReachBeyondHeld<
    R extends RedeemableRewardRef & { readonly name: LocalizedText },
  >(
    rewards: readonly R[],
    heldNames: readonly string[],
    locale: Locale,
    balance: number,
    today: LocalDate,
  ): PointsReachAnswer<R> {
    const offered = RewardSystem.offered(rewards, today);
    const held = new Set(heldNames);
    const beyond: R[] = [];
    for (let i = 0; i < offered.length; i++) {
      const reward = offered[i] as R;
      if (!held.has(reward.name[locale])) beyond.push(reward);
    }
    return RewardSystem.pointsReach(beyond, balance, today);
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
function open(balance: number, today: LocalDate): RedeemContext {
  return { balance, today, paused: false, recent: [] };
}
