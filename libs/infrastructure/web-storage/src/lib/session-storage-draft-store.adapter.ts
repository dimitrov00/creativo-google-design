import { Injectable } from '@angular/core';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  BookingDraft,
  BookingDraftStore,
  BookingDraftStoreError,
} from '@creativo/application/booking';

/** Single fixed slot — only one booking wizard can be in progress per tab session. */
const SESSION_STORAGE_KEY = 'creativo.booking-draft';

/**
 * Bumped whenever `BookingDraft`'s shape changes. A draft written by an older
 * build is DISCARDED rather than half-read: `sessionStorage` outlives a
 * deploy inside one tab, and a stale shape restored into the flow is a much
 * worse failure than starting over.
 */
const DRAFT_SCHEMA_VERSION = 3;

const STEPS = ['guests', 'services', 'schedule', 'review', 'confirmed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Shape guard only — NOT validation. Every id, label and counter inside is
 * re-validated by `BookingParty.reconstitute` / `BookingCart.reconstitute`
 * when the store rebuilds flow state, so duplicating those checks here
 * would be a second, drifting copy of the domain's rules. This function's
 * whole job is "is it the right shape to hand to them".
 */
function isDraftShaped(value: unknown): value is BookingDraft {
  if (!isRecord(value)) return false;
  if (typeof value['step'] !== 'string' || !STEPS.includes(value['step'])) {
    return false;
  }

  const party = value['party'];
  if (
    !isRecord(party) ||
    !Array.isArray(party['guests']) ||
    typeof party['nextSequence'] !== 'number' ||
    !(party['ownerId'] === null || typeof party['ownerId'] === 'string')
  ) {
    return false;
  }

  const cart = value['cart'];
  if (
    !isRecord(cart) ||
    !Array.isArray(cart['seats']) ||
    typeof cart['nextSequence'] !== 'number'
  ) {
    return false;
  }

  return (
    value['locationId'] === null || typeof value['locationId'] === 'string'
  );
}

/**
 * `BookingDraftStore` backed by `sessionStorage` — cleared when the tab
 * closes, matching v2's "don't persist an abandoned booking across
 * devices/sessions" behavior, and the reason an anonymous booker who signs
 * in mid-flow gets their party back: the auth round-trip stays in the tab.
 *
 * A corrupted, stale-schema or unparseable entry surfaces as a clean
 * `Result.fail` from `load()`, never a thrown exception.
 */
@Injectable()
export class SessionStorageDraftStore implements BookingDraftStore {
  load(): Result<BookingDraft | null, BookingDraftStoreError> {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw === null) {
        return ok(null);
      }

      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed['version'] !== DRAFT_SCHEMA_VERSION) {
        // Written by an older build — treat as absent rather than an error:
        // there is nothing the user did wrong and nothing to report.
        return ok(null);
      }
      if (!isDraftShaped(parsed['draft'])) {
        return fail(
          new BookingDraftStoreError('Stored booking draft is malformed'),
        );
      }
      return ok(parsed['draft']);
    } catch (error) {
      return fail(
        new BookingDraftStoreError('Failed to load booking draft', error),
      );
    }
  }

  save(draft: BookingDraft): Result<void, BookingDraftStoreError> {
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ version: DRAFT_SCHEMA_VERSION, draft }),
      );
      return ok(undefined);
    } catch (error) {
      return fail(
        new BookingDraftStoreError('Failed to save booking draft', error),
      );
    }
  }

  clear(): Result<void, BookingDraftStoreError> {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return ok(undefined);
    } catch (error) {
      return fail(
        new BookingDraftStoreError('Failed to clear booking draft', error),
      );
    }
  }
}
