import { Injectable } from '@angular/core';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { TimeSlot } from '@creativo/domain/scheduling';
import {
  BookingDraft,
  BookingDraftStore,
  BookingDraftStoreError,
} from '@creativo/application/booking';

/** Single fixed slot — only one booking wizard can be in progress per tab session. */
const SESSION_STORAGE_KEY = 'creativo.booking-draft';

interface PersistedBookingDraft {
  readonly ownerId: string;
  readonly barberId: string | null;
  readonly locationId: string | null;
  readonly serviceIds: readonly string[];
  readonly timeSlot: { startIso: string; endIso: string; zone: string } | null;
}

function toPersistence(draft: BookingDraft): PersistedBookingDraft {
  return {
    ownerId: draft.ownerId.value,
    barberId: draft.barberId?.value ?? null,
    locationId: draft.locationId?.value ?? null,
    serviceIds: draft.serviceIds.map((id) => id.value),
    timeSlot: draft.timeSlot
      ? {
          startIso: draft.timeSlot.start.toISO(),
          endIso: draft.timeSlot.end.toISO(),
          zone: draft.timeSlot.start.zoneName,
        }
      : null,
  };
}

function toDomain(raw: unknown): Result<BookingDraft, BookingDraftStoreError> {
  if (typeof raw !== 'object' || raw === null) {
    return fail(
      new BookingDraftStoreError('Stored booking draft is not an object'),
    );
  }
  const data = raw as Partial<PersistedBookingDraft>;

  if (typeof data.ownerId !== 'string') {
    return fail(
      new BookingDraftStoreError('Stored booking draft is missing ownerId'),
    );
  }
  const ownerIdResult = UserId.create(data.ownerId);
  if (ownerIdResult.isFailure()) {
    return fail(
      new BookingDraftStoreError(
        'Stored booking draft has an invalid ownerId',
        ownerIdResult.error,
      ),
    );
  }

  let barberId: BarberId | null = null;
  if (data.barberId != null) {
    const barberIdResult = BarberId.create(data.barberId);
    if (barberIdResult.isFailure()) {
      return fail(
        new BookingDraftStoreError(
          'Stored booking draft has an invalid barberId',
          barberIdResult.error,
        ),
      );
    }
    barberId = barberIdResult.value;
  }

  let locationId: LocationId | null = null;
  if (data.locationId != null) {
    const locationIdResult = LocationId.create(data.locationId);
    if (locationIdResult.isFailure()) {
      return fail(
        new BookingDraftStoreError(
          'Stored booking draft has an invalid locationId',
          locationIdResult.error,
        ),
      );
    }
    locationId = locationIdResult.value;
  }

  const serviceIds: ServiceId[] = [];
  for (const rawServiceId of data.serviceIds ?? []) {
    const serviceIdResult = ServiceId.create(rawServiceId);
    if (serviceIdResult.isFailure()) {
      return fail(
        new BookingDraftStoreError(
          'Stored booking draft has an invalid serviceId',
          serviceIdResult.error,
        ),
      );
    }
    serviceIds.push(serviceIdResult.value);
  }

  let timeSlot: TimeSlot | null = null;
  if (data.timeSlot != null) {
    const timeSlotResult = TimeSlot.create(data.timeSlot);
    if (timeSlotResult.isFailure()) {
      return fail(
        new BookingDraftStoreError(
          'Stored booking draft has an invalid timeSlot',
          timeSlotResult.error,
        ),
      );
    }
    timeSlot = timeSlotResult.value;
  }

  return ok({
    ownerId: ownerIdResult.value,
    barberId,
    locationId,
    serviceIds,
    timeSlot,
  });
}

/**
 * `BookingDraftStore` backed by `sessionStorage` — cleared when the tab
 * closes, matching v2's "don't persist an abandoned booking across
 * devices/sessions" behavior. A corrupted/stale entry (e.g. an id format
 * that predates a schema change) surfaces as a clean `Result.fail` from
 * `load()`, never a thrown exception.
 */
@Injectable()
export class SessionStorageDraftStore implements BookingDraftStore {
  load(): Result<BookingDraft | null, BookingDraftStoreError> {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw === null) {
        return ok(null);
      }
      return toDomain(JSON.parse(raw));
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
        JSON.stringify(toPersistence(draft)),
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
