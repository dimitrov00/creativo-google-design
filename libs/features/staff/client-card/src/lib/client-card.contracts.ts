import type { CouponOccasion, Email, Role } from '@core/components';
import type {
  AppointmentId,
  BadgeCategoryId,
  BarberId,
  CouponGrantId,
  DraftPersonKey,
  DurationMinutes,
  LocalDate,
  LocationId,
  MinuteOfDay,
  SeasonId,
  ServiceCategoryId,
  ServiceId,
  ServiceVariantId,
  UserId,
} from '@core/primitives';
import type { VisitLookup } from '@creativo/features/shared/visits';

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
 *
 * Every id is its brand, every day a `LocalDate`, every minute a
 * `MinuteOfDay` (Law 7.4): the host hands over what its entities hold, and
 * the card never re-parses a host's value (pass D, §2.6).
 */

/** The person on the seat, as the visit's draft has them. The head renders from this at once (S1). */
export interface ClientCardSubject {
  /** `DraftClient.id`: an account uid, or a `guest-…` key for a walk-in without a profile. */
  readonly id: DraftPersonKey;
  /** The account (`DraftPersonKey.accountOf`); `null` for a guest, whose card reads nothing. */
  readonly userId: UserId | null;
  /** The seat's name, shown until `users/{uid}` answers (and for good, for a guest). */
  readonly label: string;
  readonly phone: string | null;
  readonly phoneHref: string | null;
  readonly email: Email | null;
  readonly avatarSrc: string | null;
}

/** One held reward, already worded by the editor's own discount formatter (no second formatter). */
export interface ClientCardGrant {
  readonly grantId: CouponGrantId;
  /** The coupon's name: «Безплатно подстригване». */
  readonly title: string;
  /**
   * The ticket's value line, as the discount page words it (the editor's
   * `couponValue`): the rule, «−20%», «Безплатна услуга» — `null` when the
   * name already says it («Безплатно подстригване»): the name alone.
   */
  readonly valueLabel: string | null;
  /** The shop day the grant lapses on, or `null` when it does not expire. */
  readonly expiresOn: LocalDate | null;
  /**
   * The moment the grant's coupon was made for (`Coupon.couponOccasion`,
   * revision 3 §4.6), passed through as the coupon holds it: the birthday
   * card carries a grant only when its coupon says `BIRTHDAY` — a name is
   * never parsed. Optional, and absent reads as `null`: a host that does
   * not know the coupon's occasion states nothing.
   */
  readonly couponOccasion?: CouponOccasion | null;
}

/**
 * The catalogue as the card needs it: names and art, resolved by the
 * dashboard. It IS the shared visit row's `VisitLookup` and more, so the
 * dashboard builds ONE object for both. Its shop count is a plain number,
 * never a getter (pass D, D-7.6).
 */
export interface ClientCardCatalog extends VisitLookup {
  serviceCoverSrc(serviceId: ServiceId): string | null;
  serviceCategory(serviceId: ServiceId): {
    readonly id: ServiceCategoryId;
    readonly name: string;
  } | null;
  locationCoverSrc(locationId: LocationId): string | null;
  /**
   * Owner art for a medal family (`BadgeSeries.artPath`, a Storage path)
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
  servicePrice?(serviceId: ServiceId): string | null;
  /**
   * Every barber of the shop, in the shop's own order — the faces «Как се
   * печели» draws for a family about the barbers. Optional: without it the
   * page draws the barbers the loyalty catalogue itself names (P4-1).
   */
  barberIds?(): readonly BarberId[];
}

/**
 * One service of the visit on screen, as the draft holds it: what «с това
 * посещение» measures a family's next level against (a service, a barber).
 * When the visit starts is the context's, once (`ClientCardContext.start`).
 */
export interface ClientCardLeg {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly minutes: DurationMinutes;
  readonly barberId: BarberId | null;
}

/**
 * When the visit on screen starts, on the shop's wall clock (Law 7.3): its
 * shop day and minute. `startMinutes` is `null` for a drafted start that is
 * no minute of the day (an anchored track minute past midnight): such a
 * start starts on no day the card can read.
 */
export interface ClientCardStart {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay | null;
}

/** The signed-in principal: whose roles gate the card's ‹role› reads (pass D, D-10.6). */
export interface ClientCardViewer {
  readonly userId: UserId;
  readonly roles: readonly Role[];
}

/** The visit the card was opened from, and who is looking at it. */
export interface ClientCardContext {
  /** The visit on screen: «Този час» in the history, and excluded from «last visit» and the photo rail. `null` while creating. */
  readonly appointmentId: AppointmentId | null;
  /**
   * The signed-in principal: the ‹role› gates and the admin-only money
   * read. `null` reads as no roles at all.
   */
  readonly viewer: ClientCardViewer | null;
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
  /**
   * The drafted start of the visit on screen, on the shop's wall clock —
   * every leg starts there; `null` when the draft holds no start. The card
   * reads it as it is (in the chair today, an early start), and derives an
   * instant from it only where a rule needs one, on the shop's zone.
   */
  readonly start: ClientCardStart | null;
  readonly legs: readonly ClientCardLeg[];
  /**
   * The visit's shop as the draft has it (a «Салон» relocate included):
   * the one metric of «с това посещение» the legs do not carry. `null`
   * while the draft has none.
   */
  readonly locationId: LocationId | null;
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
 * Which page of the client stack the card's store titles
 * (`ClientCardStore.barTitle`) — the host maps its own page kinds onto
 * these (internal, SCREAMING: no observer outside the call, pass D,
 * D-8.3).
 */
export const ClientCardPage = {
  Client: 'CLIENT',
  ClientLoyalty: 'CLIENT_LOYALTY',
  ClientAchievements: 'CLIENT_ACHIEVEMENTS',
  ClientHistory: 'CLIENT_HISTORY',
  ClientLedger: 'CLIENT_LEDGER',
  ClientRecords: 'CLIENT_RECORDS',
  AchievementCategory: 'ACHIEVEMENT_CATEGORY',
  AchievementDetail: 'ACHIEVEMENT_DETAIL',
  Photo: 'PHOTO',
} as const;
export type ClientCardPage =
  (typeof ClientCardPage)[keyof typeof ClientCardPage];

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
export const WalletAnchor = {
  Catalog: 'catalog',
  Stamps: 'stamps',
  Rhythm: 'rhythm',
  Wallet: 'wallet',
  Status: 'status',
} as const;
/**
 * Values: external contract — the wallet tiles' test ids
 * (`client-loyalty-<anchor>`, the editor's push origin), so the dictionary
 * keeps their spelling (pass D, D-8.2).
 */
export type WalletAnchor = (typeof WalletAnchor)[keyof typeof WalletAnchor];

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
 * on one shop day.
 */
export type AchievementScope =
  | {
      readonly achievementScope: typeof AchievementScope.Category;
      readonly categoryId: BadgeCategoryId;
    }
  | {
      readonly achievementScope: typeof AchievementScope.Season;
      readonly seasonId: SeasonId;
    }
  | { readonly achievementScope: typeof AchievementScope.Archive }
  | {
      readonly achievementScope: typeof AchievementScope.Day;
      readonly day: LocalDate;
    };

/**
 * A read the card retries as one: `profile` is `users/{uid}` (the gate the
 * rest waits for), the others are a module's data and its page's.
 * `vouchers` is the gift vouchers issued to the client record
 * (`COUPON_VOUCHER_PORTS`) and `activity` the record's journal feed
 * (`CLIENT_JOURNAL_PORTS`), the wallet's two reads of revision 3
 * (§4.5, §4.7).
 */
export const ClientCardRegion = {
  Profile: 'profile',
  Loyalty: 'loyalty',
  Achievements: 'achievements',
  Visits: 'visits',
  Photos: 'photos',
  History: 'history',
  Vouchers: 'vouchers',
  Activity: 'activity',
} as const;
/**
 * Values: external contract — the glance's notice test ids
 * (`client-failed-<region>`, `client-retry-<region>`), so the dictionary
 * keeps their spelling (pass D, D-8.2).
 */
export type ClientCardRegion =
  (typeof ClientCardRegion)[keyof typeof ClientCardRegion];
