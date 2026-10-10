import type { BookingCart } from '../components/cart-line.data';
import type { DayKey } from '../components/day-key.data';
import type { FlexibleWhen } from '../components/flexible-when.data';
import type { WaitlistStatus } from '../components/waitlist-status.data';
import type { LocationId } from './location.entity';
import type { UserId } from './user.entity';

/**
 * `wl_` + the first 40 hex of the pipeline's `hash(WaitlistSystem.idBasis(cmd))`
 * — deterministic, so a retried request lands on its own document (the basis
 * keeps the shop, as today's id hash does).
 */
export type WaitlistRequestId = string & { readonly __brand: unique symbol };
export const WaitlistRequestId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): WaitlistRequestId => raw as WaitlistRequestId,
} as const;

/**
 * A standing request to be told when the shop can fit a specific bag into
 * specific windows — `waitlistRequests/{id}` (`waitlist-document.ts:17-27`,
 * `waitlist-request.ts:50-61`). The owner is REQUIRED: its whole value is
 * being told later. The cart is snapshotted in the one cart serialisation,
 * because a matcher days later has no draft to read and no user to ask.
 * Expiry is derived from `when`, never stored.
 *
 * Declared changes: `createdAtIso` → `createdAtMs`; `status` string →
 * `{ kind; atMs }` (index #14 on `status.kind`); the stored `id` and the
 * `ownerId` duplicate of `ownerUserId` dropped.
 */
export type WaitlistRequestEntity = {
  readonly id: WaitlistRequestId;
  /** The rules' and index #17's key. */
  readonly ownerUserId: UserId;
  /** `null` = any shop; a non-null request matches ONLY that shop. */
  readonly locationId: LocationId | null;
  /** The windows are resolved in the request's zone. */
  readonly zone: string;
  readonly cart: BookingCart;
  /** The per-day windows, persisted verbatim. */
  readonly when: FlexibleWhen;
  /** Derived query mirror of `when.days[].dayKey` (index #14). */
  readonly dayKeys: readonly DayKey[];
  readonly status: WaitlistStatus;
  readonly createdAtMs: number;
};
