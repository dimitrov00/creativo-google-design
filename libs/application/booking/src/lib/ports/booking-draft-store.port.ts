import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { BookingDraft } from './booking-draft';
import { BookingDraftStoreError } from './booking-draft-store.errors';

/** Synchronous — mirrors the browser `sessionStorage` this is backed by (Goal 04). */
export interface BookingDraftStore {
  load(): Result<BookingDraft | null, BookingDraftStoreError>;
  save(draft: BookingDraft): Result<void, BookingDraftStoreError>;
  clear(): Result<void, BookingDraftStoreError>;
}

export const BOOKING_DRAFT_STORE = new InjectionToken<BookingDraftStore>(
  'BookingDraftStore',
);
