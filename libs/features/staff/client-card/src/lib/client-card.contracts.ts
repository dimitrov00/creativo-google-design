/**
 * What the client card is handed from outside (client-card-redesign §5.2.1):
 * who it is about and the visit it was opened from. The card reads
 * everything else itself (`ClientCardStore`); these are the facts only the
 * host has — the seat's snapshot, the editor's own grants and formatter,
 * the dashboard's catalogue.
 *
 * Plain values, no services: the visit editor builds them from what it
 * already holds, and a spec builds them by hand. The card injects no
 * catalogue service on purpose — `CatalogContentService` injects its
 * readers non-optionally, which would make every spec that mounts the card
 * provide the whole catalogue.
 */

/** The person on the seat, as the visit's draft has them. The head renders from this at once (S1). */
export interface ClientCardSubject {
  /** `DraftClient.id`: an account uid, or a `guest-…` id for a walk-in without a profile. */
  readonly id: string;
  /** The account uid; `null` for a guest, whose card reads nothing. */
  readonly userId: string | null;
  /** The seat's name, shown until `users/{uid}` answers (and for good, for a guest). */
  readonly label: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  readonly email: string | null;
  readonly avatarSrc: string | null;
}

/** One held reward, already worded by the editor's own discount formatter (no second formatter). */
export interface ClientCardGrant {
  readonly grantId: string;
  /** The coupon's name: «Безплатно подстригване». */
  readonly title: string;
  /**
   * The ticket's value line, as the discount page words it (the editor's
   * `couponValue`): the rule, «−20%», «Безплатна услуга» — `null` when the
   * name already says it («Безплатно подстригване»): the name alone.
   */
  readonly valueLabel: string | null;
  /** ISO date, or `null` when the grant does not expire. */
  readonly expiresOn: string | null;
  /**
   * The moment the grant's coupon was made for (`Coupon.occasion`,
   * revision 3 §4.6): the birthday card carries a grant only when its
   * coupon says `birthday` — a name is never parsed. Optional, and absent
   * reads as `null`: a host that does not know the coupon's occasion yet
   * (the editor, until its wiring wave) states nothing.
   */
  readonly occasion?: 'birthday' | null;
}

/**
 * The catalogue as the card needs it: names and art, resolved by the
 * dashboard. It satisfies the shared visit row's `VisitLookup`
 * structurally, so the dashboard builds ONE object for both.
 */
export interface ClientCardCatalog {
  serviceName(serviceId: string): string | null;
  serviceCoverSrc(serviceId: string): string | null;
  serviceCategory(
    serviceId: string,
  ): { readonly id: string; readonly name: string } | null;
  barberName(barberId: string): string | null;
  barberAvatarSrc(barberId: string): string | null;
  locationName(locationId: string): string | null;
  locationCoverSrc(locationId: string): string | null;
  /** The shop names a location in a fact line only when it has more than one. */
  readonly locationCount: number;
  /**
   * Owner art for a medal family (`BadgeSeries.art.path`, a Storage path)
   * as a URL the page can draw, resolved by the dashboard's media reader —
   * the card holds no storage reader of its own. Optional: without it (or
   * with `null`), a family draws its subject's art, its monogram or its
   * emblem, as §3.3.3 orders them.
   */
  badgeArtSrc?(path: string): string | null;
  /**
   * «28,00 €» — a service's price as the shop lists it, already worded:
   * «Как се печели» prints it under the service's cover (§2.4.3). Optional,
   * as `badgeArtSrc` is: without it (or with `null`) the cover stands
   * without a price (contract delta P4-1).
   */
  servicePrice?(serviceId: string): string | null;
  /**
   * Every barber of the shop, in the shop's own order — the faces «Как се
   * печели» draws for a family about the barbers. Optional: without it the
   * page draws the barbers the loyalty catalogue itself names (P4-1).
   */
  barberIds?(): readonly string[];
}

/**
 * One service of the visit on screen, as the draft holds it: what «с това
 * посещение» measures a family's next level against (a service, a barber,
 * an early-bird start).
 */
export interface ClientCardLeg {
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly minutes: number;
  readonly barberId: string | null;
  readonly startsAtIso: string;
}

/** The visit the card was opened from, and who is looking at it. */
export interface ClientCardContext {
  /** The visit on screen: «Този час» in the history, and excluded from «last visit» and the photo rail. */
  readonly appointmentId: string | null;
  /** The signed-in principal: the ‹role› gates and the admin-only money read. */
  readonly viewer: { readonly uid: string; readonly roles: readonly string[] };
  /** The subject is the appointment's owner — the only person whose held rewards the visit can use (§3.1.3). */
  readonly isOwner: boolean;
  /**
   * Over, one way or another (completed, cancelled, no-show): the client is
   * no longer in the chair, so nothing counts «с това посещение» and the
   * rhythm's mark is not «днес». NOT a lock: a finished visit stays
   * correctable (owner, 2026-09-09) — `gone` is the lock.
   */
  readonly settled: boolean;
  /**
   * Cancelled or a no-show — the editor's `gone()`: nothing happened, the
   * sheet reads rather than edits, so nothing the card offers can be
   * written to it (E the ready reward, the «Лоялност» page's usable
   * tickets, K «Махни от посещението», «Повтори»). A completed visit is
   * not gone: its reward, its person and its services can still change.
   */
  readonly gone: boolean;
  readonly partyOfOne: boolean;
  readonly legs: readonly ClientCardLeg[];
  /**
   * The visit's shop as the draft has it (a «Салон» relocate included):
   * the one metric of «с това посещение» the legs do not carry. `null`
   * while the draft has none.
   */
  readonly locationId: string | null;
  /**
   * The owner's held rewards READY TO USE — not on this visit's bill yet:
   * E and LD offer these. `[]` unless `isOwner`.
   */
  readonly grants: readonly ClientCardGrant[];
  /**
   * The owner's held rewards already on this visit's draft bill (the
   * ticket's «Използвай» or the discount page put them there). Still in
   * hand — nothing is saved — so F1 never names one as what the points are
   * «enough for» (DV5), before, after «Използвай» and after «Премахни»
   * alike. E and LD keep drawing them WHERE THEY STOOD, stamped, «Премахни»
   * where «Използвай» stood (the owner's coupon rule, WP7 review r6):
   * nothing «Използвай» uses leaves the card. `[]` unless `isOwner`.
   */
  readonly grantsOnBill: readonly ClientCardGrant[];
  readonly catalog: ClientCardCatalog;
}

/**
 * The section of the WALLET a way in opens on (revision 3 §2.2, §4.9);
 * `null` — from «Всички» and from the glance's loyalty card — is the
 * page's top: `catalog` is «Награди за точки», `stamps` the stamp cards,
 * `rhythm` the rhythm card, `wallet` «В портфейла», `status` the tier's
 * card. An anchor whose section is absent (a flag off, the rule off)
 * lands on the page's top. The wallet, the glance and the editor take
 * this one type (the built page's narrower `LoyaltyAnchor` went with its
 * last reader in W4, G1-4).
 */
export type WalletAnchor =
  'catalog' | 'stamps' | 'rhythm' | 'wallet' | 'status';

/**
 * Which page an `achievementCategory` scope is — the values of its
 * discriminator `achievementScope` (Law 6, Phase 4a 4A-13).
 */
export const AchievementScope = {
  Category: 'CATEGORY',
  Season: 'SEASON',
  Archive: 'ARCHIVE',
  Day: 'DAY',
} as const;

/**
 * What one `achievementCategory` page shows: a category's families, a
 * season's, the archive of ended seasons and events, or the levels earned
 * on one day (`YYYY-MM-DD`, the shop's calendar).
 */
export type AchievementScope =
  | {
      readonly achievementScope: typeof AchievementScope.Category;
      readonly categoryId: string;
    }
  | {
      readonly achievementScope: typeof AchievementScope.Season;
      readonly seasonId: string;
    }
  | { readonly achievementScope: typeof AchievementScope.Archive }
  | {
      readonly achievementScope: typeof AchievementScope.Day;
      readonly day: string;
    };

/**
 * A read the card retries as one: `profile` is `users/{uid}` (the gate the
 * rest waits for), the others are a module's data and its page's.
 * `vouchers` is the gift vouchers issued to the client record
 * (`COUPON_VOUCHER_PORTS`) and `activity` the record's journal feed
 * (`CLIENT_JOURNAL_PORTS`), the wallet's two reads of revision 3
 * (§4.5, §4.7).
 */
export type ClientCardRegion =
  | 'profile'
  | 'loyalty'
  | 'achievements'
  | 'visits'
  | 'photos'
  | 'history'
  | 'vouchers'
  | 'activity';
