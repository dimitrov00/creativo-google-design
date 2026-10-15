import { defer, of, type Observable } from 'rxjs';
import {
  BookingLifecycle,
  BookingPolicy,
  CouponStatus,
  BarberStatus,
  LocationStatus,
  ServiceStatus,
  type VoucherCode,
} from '@core/components';
import {
  BusyKey,
  GrantStatus,
  Result,
  type AppointmentId,
  type CustomerId,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import type {
  Appointment,
  AppointmentNote,
  AppointmentPhoto,
  BarberBusyDay,
  BarberSchedule,
  Barber,
  CapacityMonth,
  ClientMoneyRecord,
  ClientStatsRecord,
  Coupon,
  CouponGrant,
  Customer,
  GiftVoucher,
  InboxNotification,
  ScheduleException,
  ServiceCategory,
  Service,
  ShopLocation,
  WaitlistRequest,
} from '@core/entities';
import type {
  AppointmentNotePorts,
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  CatalogReadPorts,
  ClientStatsReadPorts,
  CouponVoucherPorts,
  CustomerPorts,
  InboxPorts,
  ScheduleExceptionPorts,
  SchedulingReadPorts,
  WaitlistReadPorts,
} from '@core/ports';
import { PageStep, PagingSystem } from '@core/systems';

/**
 * The in-memory doubles of the web's named port bundles (flip-1 plan §3.1)
 * — one per `InjectionToken` of `ports.tokens.ts`, each over plain arrays
 * and maps, each returning EXACTLY its bundle type. Store and component
 * specs bind these; nobody re-implements a double.
 *
 * The rules every double keeps, so a spec reads them once:
 *
 * - A stream (`observe*`) emits ONCE, the state as it is when subscribed,
 *   then completes (`defer` + `of`, as `memoryObserveBusyDay` does): a
 *   write made later is seen by the NEXT subscription.
 * - A read double reads the arrays it was handed BY REFERENCE: a spec that
 *   keeps its array and pushes to it is read at the next call.
 * - A write double writes into the array or map it was handed, in place —
 *   share that one value with the read double of the same collection and
 *   the write is visible through it (an exception written through
 *   `memoryScheduleExceptionPorts` is observed by `memorySchedulingReadPorts`).
 * - Each query answers what its port's comment says the Firestore query
 *   answers — the same filter, order and bound — and nothing derived
 *   (availability is computed by the caller, never behind a port).
 * - Every answer is `Result.ok`; a spec that needs a failure wraps the one
 *   member it fails.
 */

/** One emission of `value()` as read at subscription time, as a stream port answers. */
function stream<T>(value: () => T): Observable<Result.Ok<T>> {
  return defer(() => of(Result.ok(value())));
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function bySortOrder<E extends { readonly sortOrder: number }>(
  a: E,
  b: E,
): number {
  return a.sortOrder - b.sortOrder;
}

/** The `BusyKey` a day-keyed document is stored under — its barber's on its shop day. */
function keyOf(day: Pick<BarberBusyDay, 'barberId' | 'localDate'>): BusyKey {
  return BusyKey.of(day.barberId, day.localDate);
}

// ── Scheduling ───────────────────────────────────────────────────────────

/** What `memorySchedulingReadPorts` reads; every collection empty, the policy the default, when omitted. */
export type SchedulingReadState = {
  readonly busyDays: readonly BarberBusyDay[];
  readonly exceptions: readonly ScheduleException[];
  readonly schedules: readonly BarberSchedule[];
  readonly locations: readonly ShopLocation[];
  readonly policy: BookingPolicy;
  readonly capacityMonths: readonly CapacityMonth[];
};

/**
 * `SCHEDULING_READ_PORTS` — the booking store's raw entity streams: a day's
 * busy blocks and exception by `BusyKey`, a roster by barber, a shop, the
 * policy (`BookingPolicy.DEFAULT` unless given) and a capacity month.
 */
export function memorySchedulingReadPorts(
  state: Partial<SchedulingReadState> = {},
): SchedulingReadPorts {
  return {
    observeBusyDay: (key) =>
      stream(
        () => (state.busyDays ?? []).find((day) => keyOf(day) === key) ?? null,
      ),
    observeExceptions: (key) =>
      stream(
        () =>
          (state.exceptions ?? []).find((entry) => keyOf(entry) === key) ??
          null,
      ),
    observeSchedule: (barberId) =>
      stream(
        () =>
          (state.schedules ?? []).find((entry) => entry.id === barberId) ??
          null,
      ),
    observeLocation: (locationId) =>
      stream(
        () =>
          (state.locations ?? []).find((entry) => entry.id === locationId) ??
          null,
      ),
    observePolicy: () => stream(() => state.policy ?? BookingPolicy.DEFAULT),
    observeCapacityMonth: (month) =>
      stream(
        () =>
          (state.capacityMonths ?? []).find((entry) => entry.id === month) ??
          null,
      ),
  };
}

/**
 * `SCHEDULE_EXCEPTION_PORTS` — the staff command over `exceptions`, written
 * IN PLACE: the stored body of every key (positions preserved, `null` when
 * absent) goes to `merge`; its answer replaces each key's document — `null`
 * deletes it — or its refusal writes nothing.
 */
export function memoryScheduleExceptionPorts(
  exceptions: ScheduleException[],
): ScheduleExceptionPorts {
  return {
    writeScheduleException: async (keys, merge) => {
      const stored = keys.map(
        (key) => exceptions.find((entry) => keyOf(entry) === key) ?? null,
      );
      const merged = merge(stored);
      if (!merged.ok) return merged;
      merged.value.forEach((next, i) => {
        const key = keys.at(i);
        const at = exceptions.findIndex((entry) => keyOf(entry) === key);
        if (next === null) {
          if (at >= 0) exceptions.splice(at, 1);
        } else if (at >= 0) {
          exceptions.splice(at, 1, next);
        } else {
          exceptions.push(next);
        }
      });
      return Result.ok(undefined);
    },
  };
}

/** A visit's start instant, oldest first. */
function earliestFirst(a: Appointment, b: Appointment): number {
  return a.utcEpochMs - b.utcEpochMs || byString(a.id, b.id);
}

/**
 * `APPOINTMENT_READ_PORTS` — the appointment readers over `appointments`:
 * one visit; a barber's day (`busyKeys` contains, every status); an
 * account's live visits by start and its newest `limit` (`ownerUserId`); a
 * client record's history pages (`subjectCustomerIds` contains, newest
 * first, the same-instant boundary kept by `PagingSystem`); and the staff
 * search window — the `limitPerSide` nearest each side of `nowUtcMs`,
 * merged oldest first.
 */
export function memoryAppointmentReadPorts(
  appointments: readonly Appointment[],
): AppointmentReadPorts {
  return {
    observeAppointment: (id) =>
      stream(() => appointments.find((entry) => entry.id === id) ?? null),
    observeBarberDay: (key) =>
      stream(() =>
        appointments.filter((entry) => entry.busyKeys.includes(key)),
      ),
    observeUpcoming: (ownerUserId) =>
      stream(() =>
        appointments
          .filter(
            (entry) =>
              entry.ownerUserId === ownerUserId &&
              BookingLifecycle.isLive(entry),
          )
          .sort(earliestFirst),
      ),
    observeHistory: (ownerUserId, limit) =>
      stream(() =>
        appointments
          .filter((entry) => entry.ownerUserId === ownerUserId)
          .sort((a, b) => earliestFirst(b, a))
          .slice(0, PagingSystem.pageSize(limit)),
      ),
    pageClientHistory: async (subjectCustomerId, beforeUtcMs, limit) => {
      const newestFirst = appointments
        .filter(
          (entry) =>
            entry.subjectCustomerIds.includes(subjectCustomerId) &&
            (beforeUtcMs === null || entry.utcEpochMs < beforeUtcMs),
        )
        .sort((a, b) => earliestFirst(b, a));
      const size = PagingSystem.pageSize(limit);
      const step = PagingSystem.nextCursor(
        newestFirst.slice(0, size + 1),
        size,
        (entry: Appointment): UtcEpochMs => entry.utcEpochMs,
      );
      if (step.pageStep === PageStep.Page) {
        return Result.ok({
          appointments: step.rows,
          nextBeforeUtcMs: step.cursor,
        });
      }
      const page = PagingSystem.sameInstantBoundary(
        step.newer,
        newestFirst.filter((entry) => entry.utcEpochMs === step.boundary),
        (entry) => entry.id,
        newestFirst.some((entry) => entry.utcEpochMs < step.boundary),
        step.boundary,
      );
      return Result.ok({
        appointments: page.rows,
        nextBeforeUtcMs: page.cursor,
      });
    },
    searchAppointmentWindow: async (nowUtcMs, limitPerSide) => {
      const past = appointments
        .filter((entry) => entry.utcEpochMs < nowUtcMs)
        .sort((a, b) => earliestFirst(b, a))
        .slice(0, limitPerSide);
      const upcoming = appointments
        .filter((entry) => entry.utcEpochMs >= nowUtcMs)
        .sort(earliestFirst)
        .slice(0, limitPerSide);
      return Result.ok([...past, ...upcoming].sort(earliestFirst));
    },
  };
}

/** `WAITLIST_READ_PORTS` — an account's own requests, newest first (`createdAtUtcMs desc`). */
export function memoryWaitlistReadPorts(
  requests: readonly WaitlistRequest[],
): WaitlistReadPorts {
  return {
    observeMyWaitlistRequests: (ownerUserId) =>
      stream(() =>
        requests
          .filter((entry) => entry.ownerUserId === ownerUserId)
          .sort(
            (a, b) =>
              b.createdAtUtcMs - a.createdAtUtcMs || byString(b.id, a.id),
          ),
      ),
  };
}

/** What `memoryClientStatsReadPorts` reads — the stats pairs, keyed by their client record. */
export type ClientStatsReadState = {
  readonly stats: readonly ClientStatsRecord[];
  readonly money: readonly ClientMoneyRecord[];
};

/**
 * `CLIENT_STATS_READ_PORTS` — `clientStats/{customerId}`, its
 * `restricted/money` (matched by the body's `customerId`), and the
 * document-id pages: one record more than asked is read and never handed
 * over, the cursor the page's last id while somebody is left.
 */
export function memoryClientStatsReadPorts(
  state: Partial<ClientStatsReadState> = {},
): ClientStatsReadPorts {
  return {
    loadClientStats: async (customerId) =>
      Result.ok(
        (state.stats ?? []).find((entry) => entry.id === customerId) ?? null,
      ),
    loadClientMoney: async (customerId) =>
      Result.ok(
        (state.money ?? []).find((entry) => entry.customerId === customerId) ??
          null,
      ),
    pageClientStats: async (afterCustomerId, limit) => {
      const size = PagingSystem.pageSize(limit);
      const read = [...(state.stats ?? [])]
        .sort((a, b) => byString(a.id, b.id))
        .filter(
          (entry) => afterCustomerId === null || entry.id > afterCustomerId,
        )
        .slice(0, size + 1);
      const step = PagingSystem.nextCursor(
        read,
        size,
        (entry): CustomerId => entry.id,
      );
      return Result.ok(
        step.pageStep === PageStep.Page
          ? { records: step.rows, nextAfterCustomerId: step.cursor }
          : { records: read.slice(0, size), nextAfterCustomerId: null },
      );
    },
  };
}

// ── Catalogue ────────────────────────────────────────────────────────────

/** What `memoryCatalogReadPorts` reads; every collection empty when omitted. */
export type CatalogReadState = {
  readonly services: readonly Service[];
  readonly barbers: readonly Barber[];
  readonly categories: readonly ServiceCategory[];
  readonly locations: readonly ShopLocation[];
};

/**
 * `CATALOG_PORTS` — the four live streams: ACTIVE services (in a category
 * when named), ACTIVE barbers (`locationIds` contains a named shop), every
 * category, ACTIVE shops — each by `sortOrder`.
 */
export function memoryCatalogReadPorts(
  state: Partial<CatalogReadState> = {},
): CatalogReadPorts {
  return {
    observeServices: (categoryId) =>
      stream(() =>
        (state.services ?? [])
          .filter(
            (entry) =>
              entry.serviceStatus === ServiceStatus.Active &&
              (categoryId === null || entry.categoryId === categoryId),
          )
          .sort(bySortOrder),
      ),
    observeBarbers: (locationId) =>
      stream(() =>
        (state.barbers ?? [])
          .filter(
            (entry) =>
              entry.barberStatus === BarberStatus.Active &&
              (locationId === null || entry.locationIds.includes(locationId)),
          )
          .sort(bySortOrder),
      ),
    observeCategories: () =>
      stream(() => [...(state.categories ?? [])].sort(bySortOrder)),
    observeLocations: () =>
      stream(() =>
        (state.locations ?? [])
          .filter((entry) => entry.locationStatus === LocationStatus.Active)
          .sort(bySortOrder),
      ),
  };
}

// ── Coupons, grants, vouchers ────────────────────────────────────────────

/** What `memoryCouponVoucherPorts` reads; every collection empty when omitted. */
export type CouponVoucherState = {
  readonly coupons: readonly Coupon[];
  readonly grants: readonly CouponGrant[];
  readonly vouchers: readonly GiftVoucher[];
};

/**
 * `COUPON_VOUCHER_PORTS` — an ENABLED coupon by its normalised code, every
 * enabled coupon, a grant by id, a client record's ACTIVE grants, a voucher
 * by code, a record's vouchers (`issuedToCustomerId`), and the coupons of a
 * set of ids WHATEVER their status (`loadCoupons`, no status filter).
 */
export function memoryCouponVoucherPorts(
  state: Partial<CouponVoucherState> = {},
): CouponVoucherPorts {
  const enabled = (coupon: Coupon): boolean =>
    coupon.couponStatus === CouponStatus.Enabled;
  return {
    findCouponByCode: async (code: VoucherCode) =>
      Result.ok(
        (state.coupons ?? []).find(
          (entry) => entry.code === code && enabled(entry),
        ) ?? null,
      ),
    listOpenCoupons: async () =>
      Result.ok((state.coupons ?? []).filter(enabled)),
    loadCouponGrant: async (id) =>
      Result.ok((state.grants ?? []).find((entry) => entry.id === id) ?? null),
    listUsableCouponGrants: async (customerId) =>
      Result.ok(
        (state.grants ?? []).filter(
          (entry) =>
            entry.customerId === customerId &&
            entry.grantStatus === GrantStatus.Active,
        ),
      ),
    findGiftVoucherByCode: async (code) =>
      Result.ok(
        (state.vouchers ?? []).find((entry) => entry.code === code) ?? null,
      ),
    listGiftVouchersForHolder: async (customerId) =>
      Result.ok(
        (state.vouchers ?? []).filter(
          (entry) => entry.issuedToCustomerId === customerId,
        ),
      ),
    loadCoupons: async (ids) =>
      Result.ok(
        (state.coupons ?? []).filter((entry) => ids.includes(entry.id)),
      ),
  };
}

// ── The inbox ────────────────────────────────────────────────────────────

/** The newest this many — `orderBy sentAtUtcMs desc limit 50`. */
const INBOX_LIMIT = 50;

/**
 * `INBOX_PORTS` — each account's inbox (`users/{uid}/notifications`) in
 * `inboxes`, written IN PLACE: the newest 50 by `sentAtUtcMs`; a read stamp
 * set on one notification, or on every unread one.
 */
export function memoryInboxPorts(
  inboxes: Map<UserId, InboxNotification[]>,
): InboxPorts {
  const inboxOf = (userId: UserId): InboxNotification[] => {
    const inbox = inboxes.get(userId);
    if (inbox !== undefined) return inbox;
    const created: InboxNotification[] = [];
    inboxes.set(userId, created);
    return created;
  };
  return {
    observeInbox: (userId) =>
      stream(() =>
        [...(inboxes.get(userId) ?? [])]
          .sort((a, b) => b.sentAtUtcMs - a.sentAtUtcMs || byString(b.id, a.id))
          .slice(0, INBOX_LIMIT),
      ),
    markNotificationRead: async (userId, id, readAtUtcMs) => {
      const inbox = inboxOf(userId);
      const at = inbox.findIndex((entry) => entry.id === id);
      const found = inbox.at(at);
      if (at >= 0 && found !== undefined) {
        inbox.splice(at, 1, { ...found, readAtUtcMs });
      }
      return Result.ok(undefined);
    },
    markAllNotificationsRead: async (userId, readAtUtcMs) => {
      const inbox = inboxOf(userId);
      inbox.forEach((entry, i) => {
        if (entry.readAtUtcMs === null) {
          inbox.splice(i, 1, { ...entry, readAtUtcMs });
        }
      });
      return Result.ok(undefined);
    },
  };
}

// ── Notes and photos ─────────────────────────────────────────────────────

/** `APPOINTMENT_NOTE_PORTS` — `appointmentNotes/{appointmentId}` in `notes`, written IN PLACE (`null` deletes). */
export function memoryAppointmentNotePorts(
  notes: Map<AppointmentId, AppointmentNote>,
): AppointmentNotePorts {
  return {
    observeAppointmentNote: (appointmentId) =>
      stream(() => notes.get(appointmentId) ?? null),
    saveAppointmentNote: async (appointmentId, note) => {
      if (note === null) notes.delete(appointmentId);
      else notes.set(appointmentId, note);
      return Result.ok(undefined);
    },
  };
}

/**
 * `APPOINTMENT_PHOTO_PORTS` — `appointmentPhotos` in `photos`, written IN
 * PLACE: a visit's photos, a save (by id), a delete, a client record's
 * newest `limit` (`takenAtUtcMs desc`), the count per visit — and the
 * upload, which stores nothing and answers today's object path
 * `appointmentPhotos/{appointmentId}/{id}` and a `memory://` URL of it.
 */
export function memoryAppointmentPhotoPorts(
  photos: AppointmentPhoto[],
): AppointmentPhotoPorts {
  return {
    observeAppointmentPhotos: (appointmentId) =>
      stream(() =>
        photos.filter((entry) => entry.appointmentId === appointmentId),
      ),
    saveAppointmentPhoto: async (photo) => {
      const at = photos.findIndex((entry) => entry.id === photo.id);
      if (at >= 0) photos.splice(at, 1, photo);
      else photos.push(photo);
      return Result.ok(undefined);
    },
    deleteAppointmentPhoto: async (photo) => {
      const at = photos.findIndex((entry) => entry.id === photo.id);
      if (at >= 0) photos.splice(at, 1);
      return Result.ok(undefined);
    },
    listClientPhotos: async (clientCustomerId, limit) =>
      Result.ok(
        photos
          .filter((entry) => entry.clientCustomerId === clientCustomerId)
          .sort(
            (a, b) => b.takenAtUtcMs - a.takenAtUtcMs || byString(b.id, a.id),
          )
          .slice(0, PagingSystem.pageSize(limit)),
      ),
    countPhotosByAppointment: async (appointmentIds) =>
      Result.ok(
        appointmentIds.map(
          (appointmentId) =>
            photos.filter((entry) => entry.appointmentId === appointmentId)
              .length,
        ),
      ),
    uploadPhotoBytes: async (photo) => {
      const path = `appointmentPhotos/${photo.appointmentId}/${photo.id}`;
      return Result.ok({ path, url: `memory://${path}` });
    },
  };
}

// ── The client record ────────────────────────────────────────────────────

/** `CUSTOMER_PORTS` — the record whose `userId` is the account (`userId ==`, `limit 1`), `null` when none. */
export function memoryCustomerPorts(
  customers: readonly Customer[],
): CustomerPorts {
  return {
    loadCustomerForUser: async (userId) =>
      Result.ok(customers.find((entry) => entry.userId === userId) ?? null),
  };
}
