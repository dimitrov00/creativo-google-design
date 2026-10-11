import type {
  BookingCart,
  FlexibleWhen,
  WaitlistLifecycle,
} from '@core/components';
import type {
  LocationId,
  UserId,
  WaitlistRequestId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The identity slice of a waitlist request.
 *
 * - `ownerUserId` — REQUIRED and an ACCOUNT (D29): the request's whole value
 *   is telling its owner later, through their inbox; the rules' and index
 *   #17's key.
 * - `locationId` — `null` = any shop; a non-null request matches ONLY that
 *   shop.
 * - `localDates` — the query mirror of `flexibleDays[].localDate` (index
 *   #14).
 * - `utcEpochMs` — the first instant of the first flexible day
 *   (`ZonedTimeSystem.startOfLocalDay(localDates[0], location.timeZone)`,
 *   computed once at ingestion, F-28) — for range indexes only; no zone is
 *   stored (Law 7.2).
 * - `createdAtUtcMs` — the lifecycle stamp of the request itself.
 */
export type WaitlistRequestMeta = {
  readonly id: WaitlistRequestId;
  readonly ownerUserId: UserId;
  readonly locationId: LocationId | null;
  readonly localDates: readonly LocalDate[];
  readonly utcEpochMs: UtcEpochMs;
  readonly createdAtUtcMs: UtcEpochMs;
};

/**
 * A standing request to be told when the shop can fit a specific bag into
 * specific windows — `waitlistRequests/{id}` (`waitlist-document.ts:17-27`,
 * `waitlist-request.ts:50-61`). The cart is snapshotted in the one cart
 * serialisation, because a matcher days later has no draft to read and no
 * user to ask. Expiry is derived from `flexibleDays`, never stored.
 *
 * Flat (Law 6): the identity slice, the cart slice (`cartSeats`,
 * `cartNextSequence`), the flexible declaration (`flexibleDays`) and the
 * lifecycle slice (`waitlistStatus`, `waitlistStatusAtUtcMs`) — every
 * 1-to-1 field at the root.
 */
export type WaitlistRequest = WaitlistRequestMeta &
  BookingCart &
  FlexibleWhen &
  WaitlistLifecycle;
