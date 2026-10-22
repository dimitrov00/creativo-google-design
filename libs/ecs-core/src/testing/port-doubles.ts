import { BehaviorSubject, defer, map, of, type Observable } from 'rxjs';
import {
  type AuthClaims,
  BookingLifecycle,
  BookingPolicy,
  CouponStatus,
  BarberStatus,
  ImpersonationStatus,
  JournalVisibility,
  LocationStatus,
  ParsedIdentifier,
  ServiceStatus,
  type VoucherCode,
} from '@core/components';
import {
  BusyKey,
  GrantStatus,
  IdentifierChannel,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
  Result,
  type AppointmentId,
  type CustomerId,
  type OtpId,
  type StreakDefinitionId,
  type TenantId,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  Collections,
  Subcollections,
  type Appointment,
  type AppointmentNote,
  type AppointmentPhoto,
  type AuditEntry,
  type BadgeProgress,
  type BarberBusyDay,
  type BarberSchedule,
  type Barber,
  type CapacityMonth,
  type ClientMoneyRecord,
  type ClientStatsRecord,
  type Coupon,
  type CouponGrant,
  type Customer,
  type GiftVoucher,
  type ImpersonationSession,
  type InboxNotification,
  type JournalEntry,
  type LoyaltyAccount,
  type Otp,
  type ScheduleException,
  type SeasonProgress,
  type ServiceCategory,
  type Service,
  type ShopLocation,
  type StreakDefinition,
  type StreakDefinitionVersion,
  type User,
  type WaitlistRequest,
} from '@core/entities';
import type {
  AppointmentNotePorts,
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  AuthAdminPorts,
  AuthUserLookupPorts,
  CatalogReadPorts,
  ClientJournalPorts,
  ClientStatsReadPorts,
  CouponVoucherPorts,
  CustomerPorts,
  ImpersonationReadPorts,
  InboxPorts,
  LoyaltyAccountReadPorts,
  LoyaltyCatalog,
  LoyaltyCatalogReadPorts,
  OtpCryptoPorts,
  OtpDeliveryPorts,
  OtpStorePorts,
  ProfilePorts,
  ScheduleExceptionPorts,
  SchedulingReadPorts,
  StreakDefinitionPorts,
  TenantPorts,
  UserLookupPorts,
  UserSearchPorts,
  WaitlistReadPorts,
} from '@core/ports';
import { PageStep, PagingSystem } from '@core/systems';
import {
  FIXTURE_OTP_CODE,
  FIXTURE_OTP_SALT,
  FIXTURE_TENANT_ID,
  fixtureCodeHash,
} from './identity.fixtures';
import {
  type LoyaltyClientFixture,
  loyaltyCatalogFixture,
} from './loyalty.fixtures';
import { type MemoryStore, memoryStore } from './test-support';

/**
 * The in-memory doubles of the named port bundles (flip-1 plan §3.1,
 * flip-2 plan §3.1.1, flip-3 plan §3.1) — one per `InjectionToken` of `ports.tokens.ts` and
 * one per identity bundle a pipeline names, each over plain arrays and maps,
 * each returning EXACTLY its bundle type. Store, component and pipeline
 * specs bind these; nobody re-implements a double. A spec that scripts a
 * member spreads the double and overrides it (`Partial<TheBundle>`).
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

// ── Accounts ─────────────────────────────────────────────────────────────

/**
 * `PROFILE_PORTS` — `users/{uid}` in `users`, written IN PLACE.
 * `observeProfile`/`loadProfile` answer the entry AS STORED — a
 * `PROVISIONED` stub included, as the adapter does (the consumer judges),
 * `null` only when absent; `writeOwnProfile` runs the given decide against
 * the entry (`null` when absent) and applies the five keys it answers, and
 * writes nothing on a `null` answer or a refusal (answered as is).
 */
export function memoryProfilePorts(users: Map<UserId, User>): ProfilePorts {
  return {
    observeProfile: (userId) => stream(() => users.get(userId) ?? null),
    loadProfile: async (userId) => Result.ok(users.get(userId) ?? null),
    writeOwnProfile: async (userId, decide) => {
      const stored = users.get(userId) ?? null;
      const decided = decide(stored);
      if (!decided.ok) return Result.err(decided.error);
      if (decided.value !== null && stored !== null) {
        users.set(userId, { ...stored, ...decided.value } as User);
      }
      return Result.ok(undefined);
    },
  };
}

/**
 * `USER_SEARCH_PORTS` — the staff client search over `users`: every user
 * whose `searchPrefixes` contains the (already normalised) prefix, by
 * `searchName` (ties by id), at most `limit` — index #8's query.
 */
export function memoryUserSearchPorts(users: readonly User[]): UserSearchPorts {
  return {
    searchUsers: async (prefix, limit) =>
      Result.ok(
        users
          .filter((entry) => entry.searchPrefixes.includes(prefix))
          .sort(
            (a, b) =>
              byString(a.searchName ?? '', b.searchName ?? '') ||
              byString(a.id, b.id),
          )
          .slice(0, limit),
      ),
  };
}

/** `IMPERSONATION_READ_PORTS` — the admin's `ACTIVE` session in `sessions` (the first one), or `null`. */
export function memoryImpersonationReadPorts(
  sessions: readonly ImpersonationSession[],
): ImpersonationReadPorts {
  return {
    observeActiveImpersonation: (adminUserId) =>
      stream(
        () =>
          sessions.find(
            (entry) =>
              entry.adminUserId === adminUserId &&
              entry.impersonationStatus === ImpersonationStatus.Active,
          ) ?? null,
      ),
  };
}

// ── Identity: the shared world and its doubles ───────────────────────────

/** A Firebase Auth user of the world — its uid and the one destination it holds. */
export type MemoryAuthUser = {
  readonly uid: UserId;
  readonly destination: ParsedIdentifier;
};

/** A custom token `mintCustomToken` answered, and the claims it carries. */
export type MintedToken = {
  readonly uid: UserId;
  readonly claims: AuthClaims;
  readonly token: string;
};

/**
 * The ONE state the identity doubles share, data only (never a port
 * member): the document table — `otps/{id}` and `users/{uid}` bodies, the
 * entity minus `id`, the SAME store a spec hands `memoryTxPorts`, so a stub
 * a transaction creates is found by the next `findUserByDestination` and an
 * `saveOtp`'d challenge is read by the next transaction — the Auth users
 * (a provision is visible to the next lookup), the minted tokens, the
 * claims set and the display names, all mutated IN PLACE.
 */
export type IdentityWorld = {
  readonly store: MemoryStore;
  readonly authUsers: MemoryAuthUser[];
  readonly minted: MintedToken[];
  readonly claims: Map<UserId, AuthClaims>;
  readonly displayNames: Map<UserId, string>;
};

/** What a world starts with — every part empty when omitted. */
export type IdentityWorldSeed = {
  readonly otps?: readonly Otp[];
  readonly users?: readonly User[];
  readonly authUsers?: readonly MemoryAuthUser[];
};

/** A world seeded with challenges, accounts and Auth users. */
export function memoryIdentityWorld(
  seed: IdentityWorldSeed = {},
): IdentityWorld {
  const store = memoryStore();
  for (const { id, ...body } of seed.otps ?? []) {
    store.set(`${Collections.Otps}/${id}`, body);
  }
  for (const { id, ...body } of seed.users ?? []) {
    store.set(`${Collections.Users}/${id}`, body);
  }
  return {
    store,
    authUsers: [...(seed.authUsers ?? [])],
    minted: [],
    claims: new Map(),
    displayNames: new Map(),
  };
}

/** Every entity of one collection in the world's store, by id. */
function entitiesOf<E>(store: MemoryStore, collection: string): readonly E[] {
  const prefix = `${collection}/`;
  const found: { readonly id: string; readonly entity: E }[] = [];
  for (const [key, body] of store) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (id.includes('/')) continue;
    found.push({ id, entity: { id, ...body } as E });
  }
  return found
    .sort((a, b) => byString(a.id, b.id))
    .map((entry) => entry.entity);
}

/**
 * The `otps` store over the world: `loadOpenOtps` — `destination ==`,
 * `consumedAtUtcMs == null`, `createdAtUtcMs >=` (index #10), oldest first;
 * `loadOtp` — the challenge or `null`; `saveOtp` — a `Set` of the body.
 */
export function memoryOtpStorePorts(world: IdentityWorld): OtpStorePorts {
  return {
    loadOpenOtps: async (destination, sinceUtcMs) =>
      Result.ok(
        entitiesOf<Otp>(world.store, Collections.Otps)
          .filter(
            (otp) =>
              otp.destination === destination &&
              otp.consumedAtUtcMs === null &&
              otp.createdAtUtcMs >= sinceUtcMs,
          )
          .sort((a, b) => a.createdAtUtcMs - b.createdAtUtcMs),
      ),
    loadOtp: async (id: OtpId) =>
      Result.ok(
        entitiesOf<Otp>(world.store, Collections.Otps).find(
          (otp) => otp.id === id,
        ) ?? null,
      ),
    saveOtp: async ({ id, ...body }) => {
      world.store.set(`${Collections.Otps}/${id}`, body);
      return Result.ok(undefined);
    },
  };
}

/** The same text — a stored `E164`/`Email` beside an `Identifier`. */
function sameText(held: string | null, identifier: string): boolean {
  return held === identifier;
}

/**
 * The account holding a destination, over the world's `users` — the field
 * by the parsed destination's `identifierChannel` (`phone` / `email`),
 * `limit 1` (the lowest id), as stored (a stub included), `null` when none.
 */
export function memoryUserLookupPorts(world: IdentityWorld): UserLookupPorts {
  return {
    findUserByDestination: async (destination) =>
      Result.ok(
        entitiesOf<User>(world.store, Collections.Users).find((user) =>
          sameText(
            destination.identifierChannel === IdentifierChannel.Phone
              ? user.phone
              : user.email,
            destination.identifier,
          ),
        ) ?? null,
      ),
  };
}

/** The Auth user holding a destination, over the world's Auth users — its uid or `null`. */
export function memoryAuthUserLookupPorts(
  world: IdentityWorld,
): AuthUserLookupPorts {
  return {
    findAuthUserByDestination: async (destination) =>
      Result.ok(
        world.authUsers.find((entry) =>
          ParsedIdentifier.equals(entry.destination, destination),
        )?.uid ?? null,
      ),
  };
}

/**
 * Firebase Auth's admin writes over the world: `provisionAuthUser` creates
 * an Auth user (uid `auth-uid-<n>`) — or answers `null` when one already
 * holds the destination (the race's loser, or an orphan Auth user);
 * `mintCustomToken` records the claims and answers `token:<uid>:<n>`;
 * `setClaims` and `setDisplayName` record theirs.
 */
export function memoryAuthAdminPorts(world: IdentityWorld): AuthAdminPorts {
  return {
    provisionAuthUser: async (destination) => {
      const held = world.authUsers.some((entry) =>
        ParsedIdentifier.equals(entry.destination, destination),
      );
      if (held) return Result.ok(null);
      const uid = UserId.of(`auth-uid-${world.authUsers.length + 1}`);
      world.authUsers.push({ uid, destination });
      return Result.ok(uid);
    },
    mintCustomToken: async (uid, claims) => {
      const token = `token:${uid}:${world.minted.length + 1}`;
      world.minted.push({ uid, claims, token });
      return Result.ok(token);
    },
    setClaims: async (uid, claims) => {
      world.claims.set(uid, claims);
      return Result.ok(undefined);
    },
    setDisplayName: async (uid, displayName) => {
      world.displayNames.set(uid, displayName);
      return Result.ok(undefined);
    },
  };
}

/** One delivery the recording sender was asked for. */
export type SentOtp = {
  readonly destination: ParsedIdentifier;
  readonly code: string;
};

/**
 * The login-OTP sender, recording every delivery it is asked for (failed
 * ones too) in `sent`; with `failing`, each answers
 * `PIPELINE_UNAVAILABLE` — a delivery the same call later may fix.
 */
export function recordingOtpDeliveryPorts(
  options: { readonly failing?: boolean } = {},
): { readonly ports: OtpDeliveryPorts; readonly sent: readonly SentOtp[] } {
  const sent: SentOtp[] = [];
  return {
    sent,
    ports: {
      sendOtp: async (destination, code) => {
        sent.push({ destination, code });
        return options.failing === true
          ? Result.err(PipelineError.bare(PipelineErrorCode.Unavailable))
          : Result.ok(undefined);
      },
    },
  };
}

/**
 * The OTP randomness, pinned: every code is `code`
 * (`FIXTURE_OTP_CODE`, the emulator's fixed code), every salt
 * `FIXTURE_OTP_SALT`, the hash the readable `fixtureCodeHash`, and
 * `codeMatches` that hash compared by equality — so `otpFixture()`
 * verifies with the fixed code.
 */
export function fixedOtpCryptoPorts(
  code: string = FIXTURE_OTP_CODE,
): OtpCryptoPorts {
  return {
    otpCrypto: {
      nextCode: () => code,
      nextSalt: () => FIXTURE_OTP_SALT,
      hashCode: fixtureCodeHash,
      codeMatches: (typed, salt, expectedHash) =>
        fixtureCodeHash(typed, salt) === expectedHash,
    },
  };
}

/** The deployment's tenant, pinned — `FIXTURE_TENANT_ID` unless given. */
export function fixedTenantPorts(
  tenantId: TenantId = FIXTURE_TENANT_ID,
): TenantPorts {
  return {
    loadTenant: async () => Result.ok(tenantId),
  };
}

// ── Loyalty (keyed by the client record, D29) ────────────────────────────

/** One read `memoryLoyaltyAccountReadPorts` served — what a store spec asserts was (or was not) asked. */
export type LoyaltyAccountReadCall = {
  readonly port: keyof LoyaltyAccountReadPorts;
  readonly customerId: CustomerId;
};

/**
 * What `memoryLoyaltyAccountReadPorts` reads, data only: each client
 * record's `loyaltyAccounts/{customerId}` body and its two subcollections,
 * read BY REFERENCE (a spec that sets a key is read at the next call), and
 * every call served, in order (`calls`, pushed in place).
 */
export type LoyaltyWorld = {
  readonly accounts: Map<CustomerId, LoyaltyAccount>;
  readonly badgeProgress: Map<CustomerId, readonly BadgeProgress[]>;
  readonly seasonProgress: Map<CustomerId, readonly SeasonProgress[]>;
  readonly calls: LoyaltyAccountReadCall[];
};

/** A world holding the given account holders' loyalty (`loyaltyAccountFixtures.georgi` …), none when omitted. */
export function memoryLoyaltyWorld(
  holders: readonly LoyaltyClientFixture[] = [],
): LoyaltyWorld {
  const world: LoyaltyWorld = {
    accounts: new Map(),
    badgeProgress: new Map(),
    seasonProgress: new Map(),
    calls: [],
  };
  for (const holder of holders) {
    world.accounts.set(holder.customerId, holder.account);
    world.badgeProgress.set(holder.customerId, holder.badgeProgress);
    world.seasonProgress.set(holder.customerId, holder.seasonProgress);
  }
  return world;
}

/**
 * `LOYALTY_ACCOUNT_READ_PORTS` over a {@link LoyaltyWorld}: a client
 * record's account (`null` when it has none) and its whole badge and season
 * progress (`[]` when none), every body as stored; each call recorded.
 */
export function memoryLoyaltyAccountReadPorts(
  world: LoyaltyWorld,
): LoyaltyAccountReadPorts {
  return {
    loadLoyaltyAccount: async (customerId) => {
      world.calls.push({ port: 'loadLoyaltyAccount', customerId });
      return Result.ok(world.accounts.get(customerId) ?? null);
    },
    listBadgeProgress: async (customerId) => {
      world.calls.push({ port: 'listBadgeProgress', customerId });
      return Result.ok(world.badgeProgress.get(customerId) ?? []);
    },
    listSeasonProgress: async (customerId) => {
      world.calls.push({ port: 'listSeasonProgress', customerId });
      return Result.ok(world.seasonProgress.get(customerId) ?? []);
    },
  };
}

/** How {@link memoryLoyaltyCatalogReadPorts} answers. */
export type LoyaltyCatalogDoubleOptions = {
  /** Every read fails with `RepositoryError.unavailable()` — the catalogue slice's failed state. */
  readonly failing: boolean;
};

/**
 * `LOYALTY_CATALOG_READ_PORTS` — the published catalogue under the system's
 * part names: `loyaltyCatalogFixture()` (the dev shop's, in Firestore's id
 * order) unless one is given; with `failing`, a `RepositoryError`.
 */
export function memoryLoyaltyCatalogReadPorts(
  catalog: LoyaltyCatalog = loyaltyCatalogFixture(),
  options: Partial<LoyaltyCatalogDoubleOptions> = {},
): LoyaltyCatalogReadPorts {
  return {
    loadLoyaltyCatalog: async () =>
      options.failing === true
        ? Result.err(RepositoryError.unavailable())
        : Result.ok(catalog),
  };
}

/**
 * `CLIENT_JOURNAL_PORTS` over `entries` (read BY REFERENCE): the adapter's
 * contract — `customerId ==`, `journalVisibility == CLIENT`, `journalEffect
 * in effects`, `seq <` the cursor when given, `seq` desc, `limit + 1` rows
 * read and trimmed by `PagingSystem` (`seq` is unique per record, so a page
 * never ends inside a tie); `nextBeforeSeq` the page's oldest `seq` while
 * anything older is left.
 */
export function memoryClientJournalPorts(
  entries: readonly JournalEntry[],
): ClientJournalPorts {
  return {
    pageClientJournal: async (customerId, effects, beforeSeq, limit) => {
      const size = PagingSystem.pageSize(limit);
      const read = entries
        .filter(
          (entry) =>
            entry.customerId === customerId &&
            entry.journalVisibility === JournalVisibility.Client &&
            effects.includes(entry.journalEffect) &&
            (beforeSeq === null || entry.seq < beforeSeq),
        )
        .sort((a, b) => b.seq - a.seq)
        .slice(0, size + 1);
      const step = PagingSystem.nextCursor(read, size, (entry) => entry.seq);
      const page =
        step.pageStep === PageStep.Page ? step.rows : read.slice(0, size);
      const oldest = page.at(-1);
      return Result.ok({
        entries: page,
        nextBeforeSeq:
          read.length > size && oldest !== undefined ? oldest.seq : null,
      });
    },
  };
}

// ── The rhythm's rule ────────────────────────────────────────────────────

/** A published version and the head it was published under. */
export type StreakVersionSeed = {
  readonly streakId: StreakDefinitionId;
  readonly version: StreakDefinitionVersion;
};

/** What a {@link StreakWorld} starts with — every part empty when omitted. */
export type StreakWorldSeed = {
  readonly heads?: readonly StreakDefinition[];
  readonly versions?: readonly StreakVersionSeed[];
  readonly audit?: readonly AuditEntry[];
};

/**
 * The ONE state the rhythm doubles share: the document table — the heads
 * (`streakDefinitions/{id}`), their versions
 * (`streakDefinitions/{id}/versions/{version:06}`) and the audit rows
 * (`auditLog/{id}`), each the entity minus `id` at its flat path — the SAME
 * store a spec hands `memoryTxPorts`, so the publish pipeline's commit lands
 * where the head stream reads. `changed()` tells every live head stream the
 * store moved (the publish-gateway double calls it after a commit);
 * `revisions` is that signal as a stream, starting at 0.
 */
export type StreakWorld = {
  readonly store: MemoryStore;
  readonly changed: () => void;
  readonly revisions: Observable<number>;
};

/** The path of a rhythm's head. */
function headPath(id: StreakDefinitionId): string {
  return `${Collections.StreakDefinitions}/${id}`;
}

/** A world seeded with heads, versions and audit rows. */
export function memoryStreakWorld(seed: StreakWorldSeed = {}): StreakWorld {
  const store = memoryStore();
  for (const { id, ...body } of seed.heads ?? []) {
    store.set(headPath(id), body);
  }
  for (const { streakId, version } of seed.versions ?? []) {
    const { id, ...body } = version;
    store.set(`${headPath(streakId)}/${Subcollections.Versions}/${id}`, body);
  }
  for (const { id, ...body } of seed.audit ?? []) {
    store.set(`${Collections.AuditLog}/${id}`, body);
  }
  const revision = new BehaviorSubject(0);
  return {
    store,
    changed: () => revision.next(revision.value + 1),
    revisions: revision.asObservable(),
  };
}

/**
 * `STREAK_DEFINITION_PORTS` over a {@link StreakWorld}: the head, live —
 * emitted at subscription and again on every `world.changed()` (`null`
 * while absent; the stream never completes, as `onSnapshot`); the newest
 * `limit` versions (at least one), `version` desc.
 */
export function memoryStreakDefinitionPorts(
  world: StreakWorld,
): StreakDefinitionPorts {
  const headOf = (id: StreakDefinitionId): StreakDefinition | null => {
    const body = world.store.get(headPath(id));
    return body === undefined ? null : ({ id, ...body } as StreakDefinition);
  };
  return {
    observeStreakDefinitionHead: (id) =>
      world.revisions.pipe(map(() => Result.ok(headOf(id)))),
    listStreakDefinitionVersions: async (id, limit) =>
      Result.ok(
        [
          ...entitiesOf<StreakDefinitionVersion>(
            world.store,
            `${headPath(id)}/${Subcollections.Versions}`,
          ),
        ]
          .sort((a, b) => b.version - a.version)
          .slice(0, Math.max(1, Math.floor(limit))),
      ),
  };
}
