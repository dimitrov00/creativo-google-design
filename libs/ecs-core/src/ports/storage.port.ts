import type { BookingDraft } from '@core/components';
import type { Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';

/**
 * The browser's device storage (blueprint §4.2) — web-only, synchronous
 * like the API under it. Successor of `BOOKING_DRAFT_STORE` and
 * `KEY_VALUE_STORE`.
 *
 * The booking draft is the flat `BookingDraft` component (Phase 4a 4A-9):
 * the flow state, the contact slice, the day looked at and where the draft
 * came from — serialised as is, read back through `BookingDraft.read` (a
 * malformed origin restores `FRESH`). A stored value that is no draft (a
 * stale shape) reads as a malformed repository error and is cleared, never
 * migrated (CLAUDE.md §0); `BookingCartSystem.restore(draft, today)` prunes
 * the lapsed days of a good one.
 *
 * **The key is versioned** ({@link BookingDraftStorageKey}): the flatten pass
 * renamed the draft's fields, so the adapter stores under `…/v2` and never
 * reads the pre-flatten key — an old draft is dropped, not mis-read.
 */

/** The `sessionStorage` key the booking draft adapter reads and writes. */
export type BookingDraftStorageKey = 'creativo.booking-draft/v2';

/** The saved draft; `null` when there is none. */
export type LoadBookingDraft = () => Result<
  BookingDraft | null,
  RepositoryError
>;

export type SaveBookingDraft = (
  draft: BookingDraft,
) => Result<void, RepositoryError>;

export type ClearBookingDraft = () => Result<void, RepositoryError>;

/** A stored string; `null` when the key holds nothing. */
export type KvGet = (key: string) => Result<string | null, RepositoryError>;

export type KvSet = (
  key: string,
  value: string,
) => Result<void, RepositoryError>;

export type KvRemove = (key: string) => Result<void, RepositoryError>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The `/book` flow's draft — `sessionStorage`; `BOOKING_DRAFT_PORTS`. */
export type BookingDraftPorts = {
  readonly loadBookingDraft: LoadBookingDraft;
  readonly saveBookingDraft: SaveBookingDraft;
  readonly clearBookingDraft: ClearBookingDraft;
};

/** Per-device preferences — `localStorage`; `KEY_VALUE_PORTS`. */
export type KeyValuePorts = {
  readonly kvGet: KvGet;
  readonly kvSet: KvSet;
  readonly kvRemove: KvRemove;
};

/** The device-storage suite — an intersection of its bundles. */
export type StoragePorts = BookingDraftPorts & KeyValuePorts;
