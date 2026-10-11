import type { BookingFlowState } from '@core/components';
import type { RepositoryError, Result } from '@core/primitives';

/**
 * The browser's device storage (blueprint §4.2) — `sessionStorage`,
 * web-only, synchronous like the API under it. Successor of
 * `BOOKING_DRAFT_STORE` and `KEY_VALUE_STORE`.
 *
 * The booking draft IS `BookingFlowState` — the plain component bags the
 * BookingFlowSystem steps over, serialised as is; there is no separate
 * `BookingDraft` shape and no `Reconstitute*Props`. A stored draft that
 * fails the `BookingFlowState` guard (a stale shape) reads as a malformed
 * repository error and is cleared, never migrated (CLAUDE.md §0);
 * `BookingCartSystem.restore(draft, today)` prunes the lapsed days of a good
 * one.
 *
 * **The key is versioned** ({@link BookingDraftStorageKey}): the flatten pass
 * renamed the draft's fields (`bookingFlowStep`, `cartSeats`,
 * `cartNextSequence`, `flexibleDays`, SCREAMING tags), so the adapter stores
 * under `…/v2` and never reads the pre-flatten key — an old draft is
 * dropped, not mis-read.
 */

/** The `sessionStorage` key the booking draft adapter reads and writes. */
export type BookingDraftStorageKey = 'creativo.booking-draft/v2';

/** The saved draft; `null` when there is none. */
export type LoadBookingDraft = () => Result<
  BookingFlowState | null,
  RepositoryError
>;

export type SaveBookingDraft = (
  draft: BookingFlowState,
) => Result<void, RepositoryError>;

export type ClearBookingDraft = () => Result<void, RepositoryError>;

/** A stored string; `null` when the key holds nothing. */
export type KvGet = (key: string) => Result<string | null, RepositoryError>;

export type KvSet = (
  key: string,
  value: string,
) => Result<void, RepositoryError>;

export type KvRemove = (key: string) => Result<void, RepositoryError>;

/** The device-storage bundle the web binds. */
export type StoragePorts = {
  readonly loadBookingDraft: LoadBookingDraft;
  readonly saveBookingDraft: SaveBookingDraft;
  readonly clearBookingDraft: ClearBookingDraft;
  readonly kvGet: KvGet;
  readonly kvSet: KvSet;
  readonly kvRemove: KvRemove;
};
