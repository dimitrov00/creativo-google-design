import { WalletAction } from '@core/components';
import type { CouponGrantId } from '@core/primitives';

/*
 * THE WALLET'S GATES AND DISCS (client-card-revision-3 §2.2.3; the
 * `wallet.presenter.ts` `ticketGroups` / `canWrite` / `walletActions`, the
 * store's `rewardsUsable`). Whether the person's tickets are drawn, whether
 * anything can be written to the visit now, and which discs stand under the
 * pass, in their order. Booleans, tags and ids — the discs' words, glyphs
 * and prominence are the presenter's one table.
 */

/** The visit, the device and the client around a write to the visit on screen. */
export type VisitEditView = {
  /** Cancelled or a no-show: nothing can be written to the visit. */
  readonly visitGone: boolean;
  readonly online: boolean;
  /** The client is paused: their rewards are out of reach. */
  readonly paused: boolean;
};

/** The visit and the device around the wallet. */
export type WalletView = VisitEditView & {
  /** The subject owns the appointment: only the owner's rewards can be spent on it. */
  readonly isOwner: boolean;
};

/** What the discs are decided from. */
export type WalletActionsInput = {
  /** `WalletSystem.writable` of the card. */
  readonly writable: boolean;
  /** `loyalty.points` is on. */
  readonly pointsOn: boolean;
  /** «Награди за точки» has somewhere to land (its read on its way, failed, or a tile to show). */
  readonly catalogStands: boolean;
  /** The first grant of each held ticket NOT on the bill yet, in the tickets' order. */
  readonly readyGrantIds: readonly CouponGrantId[];
};

/** The discs that stand, in their order, and what «Използвай» applies. */
export type WalletActions = {
  readonly actions: readonly WalletAction[];
  /** The one ready ticket's grant «Използвай» applies; `null` with several (or none). */
  readonly useGrantId: CouponGrantId | null;
  /** How many tickets are ready when more than one is; `null` with one (or none). */
  readonly useCount: number | null;
};

export const WalletSystem = {
  /**
   * The held tickets are drawn: a companion's rewards cannot be spent on
   * this visit, and a paused client's are out of reach — neither draws any.
   * Read-only ways in (offline, a gone visit) keep them on show.
   */
  ticketsShown(view: WalletView): boolean {
    return view.isOwner && !view.paused;
  },

  /**
   * Something can be written to the visit now, for this person: the
   * subject owns it and the visit can be edited
   * ({@link WalletSystem.visitEditable}: not paused — so the tickets are
   * drawn, {@link WalletSystem.ticketsShown} — not gone, online). The one
   * gate of the discs that write and of the store's `rewardsUsable`.
   */
  writable(view: WalletView): boolean {
    return view.isOwner && WalletSystem.visitEditable(view);
  },

  /**
   * The visit on screen can be edited now, whoever's rewards are in play:
   * the client is not paused, the visit is not gone (cancelled or a
   * no-show), and the device is online. The one visit-write gate — of
   * {@link WalletSystem.writable} (which adds the owner) and of a medal
   * detail's verb (`AchievementsSystem.serviceToAdd`).
   */
  visitEditable(view: VisitEditView): boolean {
    return !view.paused && !view.visitGone && view.online;
  },

  /**
   * The discs that work today, in their order (§2.2.3) — one that cannot be
   * used is absent and the run closes up: USE while the visit is writable
   * and a ticket is ready (naming its grant when it is the only one,
   * counting them when several are), CODE while writable, CATALOG with
   * points on while its section stands, HISTORY with points on.
   */
  actions(input: WalletActionsInput): WalletActions {
    const actions: WalletAction[] = [];
    let useGrantId: CouponGrantId | null = null;
    let useCount: number | null = null;
    const ready = input.writable ? input.readyGrantIds.length : 0;
    if (ready > 0) {
      actions.push(WalletAction.Use);
      if (ready > 1) useCount = ready;
      else useGrantId = input.readyGrantIds[0] as CouponGrantId;
    }
    if (input.writable) actions.push(WalletAction.Code);
    if (input.pointsOn && input.catalogStands) {
      actions.push(WalletAction.Catalog);
    }
    if (input.pointsOn) actions.push(WalletAction.History);
    return { actions, useGrantId, useCount };
  },
} as const;
