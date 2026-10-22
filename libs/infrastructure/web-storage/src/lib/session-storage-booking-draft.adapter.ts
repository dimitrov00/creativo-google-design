import { BookingDraft } from '@core/components';
import { RepositoryError, Result } from '@core/primitives';
import type { BookingDraftPorts, BookingDraftStorageKey } from '@core/ports';
import { storageReason } from './storage-reason';

/** The one slot — only one booking wizard is in progress per tab session. */
const KEY: BookingDraftStorageKey = 'creativo.booking-draft/v2';

/**
 * The `/book` flow's draft in `sessionStorage` — `BOOKING_DRAFT_PORTS`
 * (Phase 4a §3.10, 4A-9; the closure successor of the retired draft-store
 * class): cleared when the tab closes, so an abandoned booking never follows
 * the person to another device or session, and the reason an anonymous booker
 * who signs in mid-flow gets their party back — the auth round trip stays in
 * the tab.
 *
 * The draft is the flat `BookingDraft` component, stored as it is under a
 * VERSIONED key (`…/v2`): a draft written before the flatten pass sits under
 * the old key and is never read (greenfield — dropped, not half-read). A
 * stored value is read back through `BookingDraft.read`, never a cast: a
 * rebooking edge that does not parse restores `FRESH`; a value that is no
 * draft (unparseable JSON, an unknown step, a move that does not come back
 * whole) is `REPOSITORY_MALFORMED` and is cleared, so the flow starts fresh
 * — never a thrown exception.
 */
export const sessionStorageBookingDraftPorts = (): BookingDraftPorts => ({
  loadBookingDraft: () => {
    let raw: string | null;
    try {
      raw = sessionStorage.getItem(KEY);
    } catch (cause) {
      return Result.err(RepositoryError.readFailed(KEY, storageReason(cause)));
    }
    if (raw === null) return Result.ok(null);
    let draft: BookingDraft | null;
    try {
      draft = BookingDraft.read(JSON.parse(raw));
    } catch {
      draft = null;
    }
    if (draft !== null) return Result.ok(draft);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Nothing more to do: the read already answers that there is no draft.
    }
    return Result.err(
      RepositoryError.malformed(KEY, 'the stored value is no booking draft'),
    );
  },

  saveBookingDraft: (draft) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(draft));
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(RepositoryError.writeFailed(KEY, storageReason(cause)));
    }
  },

  clearBookingDraft: () => {
    try {
      sessionStorage.removeItem(KEY);
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(RepositoryError.writeFailed(KEY, storageReason(cause)));
    }
  },
});
