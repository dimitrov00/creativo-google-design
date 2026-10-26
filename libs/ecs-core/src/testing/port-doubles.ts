import { BehaviorSubject, defer, map, of, type Observable } from 'rxjs';
import {
  type AuthClaims,
  BarberStatus,
  type BookingCall,
  BookingLifecycle,
  BookingPolicy,
  type ClientIssue,
  CouponStatus,
  type FlagName,
  JournalVisibility,
  LocationStatus,
  type OtpCode,
  PageStep,
  ParsedIdentifier,
  PhotoOrigin,
  Principal,
  type RegistrationFields,
  ServiceStatus,
  SessionKind,
  TenantConfig,
  type VoucherCode,
} from '@core/components';
import {
  BusyKey,
  GrantStatus,
  IdentifierChannel,
  OtpId,
  Result,
  type AppointmentId,
  type CourseId,
  type CustomerId,
  type EventId,
  type LocationId,
  type PositionId,
  type StreakDefinitionId,
  type TenantId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  MediaError,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/errors';
import {
  Collections,
  Subcollections,
  type Appointment,
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
  type Course,
  type CouponGrant,
  type Customer,
  type GiftVoucher,
  type InboxNotification,
  type JournalEntry,
  type LoyaltyAccount,
  type LoyaltyCatalog,
  type Otp,
  type Position,
  type ScheduleException,
  type SeasonProgress,
  type ServiceCategory,
  type Service,
  type ShopEvent,
  type ShopLocation,
  type StreakDefinition,
  type StreakDefinitionVersion,
  type User,
  type WaitlistRequest,
} from '@core/entities';
import type {
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  AuthAdminPorts,
  AuthSessionPorts,
  AuthUserLookupPorts,
  AvatarPorts,
  CallableClient,
  CallableName,
  CallableWire,
  CatalogReadPorts,
  ClientIssuePorts,
  ClientJournalPorts,
  ClientStatsReadPorts,
  ClockPorts,
  CouponVoucherPorts,
  CourseReadPorts,
  CourseWritePorts,
  CustomerPorts,
  CustomerSearchPorts,
  DefaultLocationPorts,
  FlagsPorts,
  GatewayPorts,
  IdPorts,
  InboxPorts,
  LocationLoadPorts,
  LoyaltyAccountReadPorts,
  LoyaltyCatalogReadPorts,
  MediaResolvePorts,
  OtpChallengePorts,
  OtpCryptoPorts,
  OtpDeliveryPorts,
  OtpStorePorts,
  PositionReadPorts,
  PositionWritePorts,
  ProfilePorts,
  ProgramsPorts,
  ScheduleExceptionPorts,
  SchedulingReadPorts,
  ShopEventReadPorts,
  ShopEventWritePorts,
  StoredFile,
  StreakDefinitionPorts,
  TenantPorts,
  TimerPorts,
  UserLookupPorts,
  UserSearchPorts,
  VisitEditWritePorts,
  WaitlistReadPorts,
} from '@core/ports';
import { DiscountSystem, PagingSystem } from '@core/systems';
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
import {
  FIXTURE_NOW_UTC_MS,
  type MemoryStore,
  memoryStore,
  pinnedNowUtcMs,
  sequentialIds,
} from './test-support';

/**
 * The in-memory doubles of the named port bundles (flip-1 plan §3.1,
 * flip-2 plan §3.1.1, flip-3 plan §3.1, flip-4 plan §3.5) — one per `InjectionToken` of `ports.tokens.ts` and
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
  return UtcEpochMs.compare(a.utcEpochMs, b.utcEpochMs) || byString(a.id, b.id);
}

/** What `memoryAppointmentReadPorts` adds to the visits it reads — nothing unreadable unless given. */
export type AppointmentReadScript = {
  /**
   * Per barber day, how many stored visits the read-time guard dropped —
   * the day's `unreadableCount` (OR-2); `0` for a key it does not name.
   */
  readonly unreadable: ReadonlyMap<BusyKey, number>;
};

/**
 * `APPOINTMENT_READ_PORTS` — the appointment readers over `appointments`:
 * one visit; a barber's day (`busyKeys` contains, every status, with the
 * script's `unreadableCount` for it — `0` unless given); an account's live
 * visits by start and its newest `limit` (`ownerUserId`); a client record's
 * history pages (`subjectCustomerIds` contains, newest first, the
 * same-instant boundary kept by `PagingSystem`); and the staff search
 * window — the `limitPerSide` nearest each side of `nowUtcMs`, merged
 * oldest first.
 */
export function memoryAppointmentReadPorts(
  appointments: readonly Appointment[],
  script: Partial<AppointmentReadScript> = {},
): AppointmentReadPorts {
  return {
    observeAppointment: (id) =>
      stream(() => appointments.find((entry) => entry.id === id) ?? null),
    observeBarberDay: (key) =>
      stream(() => ({
        appointments: appointments.filter((entry) =>
          entry.busyKeys.includes(key),
        ),
        unreadableCount: script.unreadable?.get(key) ?? 0,
      })),
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
              UtcEpochMs.compare(b.createdAtUtcMs, a.createdAtUtcMs) ||
              byString(b.id, a.id),
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
 * `CATALOG_PORTS` — the four live streams: ACTIVE services, ACTIVE barbers,
 * every category, ACTIVE shops — each by `sortOrder`.
 */
export function memoryCatalogReadPorts(
  state: Partial<CatalogReadState> = {},
): CatalogReadPorts {
  return {
    observeServices: () =>
      stream(() =>
        (state.services ?? [])
          .filter((entry) => entry.serviceStatus === ServiceStatus.Active)
          .sort(bySortOrder),
      ),
    observeBarbers: () =>
      stream(() =>
        (state.barbers ?? [])
          .filter((entry) => entry.barberStatus === BarberStatus.Active)
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
 * enabled coupon that carries a code (a grant-only one is not on offer, as
 * the adapter answers), the grants of a set of ids WHATEVER their status
 * (`loadCouponGrants`, a burned one included), a client record's ACTIVE
 * grants, a voucher by code, a record's vouchers (`issuedToCustomerId`), and
 * the coupons of a set of ids WHATEVER their status (`loadCoupons`, no
 * status filter).
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
    // The offer rule, said once (`DiscountSystem.isOffered`): enabled and
    // carrying a code — a grant-only (code-less) coupon is not on offer.
    listOpenCoupons: async () =>
      Result.ok((state.coupons ?? []).filter(DiscountSystem.isOffered)),
    loadCouponGrants: async (ids) =>
      Result.ok((state.grants ?? []).filter((entry) => ids.includes(entry.id))),
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
 * `inboxes`, written IN PLACE: the newest 50 by `sentAtUtcMs`; the read
 * receipt — one stamp on each named notification still unread, a stamped
 * one keeping its own (the stamp is one-shot), an unknown id skipped.
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
          .sort(
            (a, b) =>
              UtcEpochMs.compare(b.sentAtUtcMs, a.sentAtUtcMs) ||
              byString(b.id, a.id),
          )
          .slice(0, INBOX_LIMIT),
      ),
    markNotificationsRead: async (userId, ids, readAtUtcMs) => {
      const inbox = inboxOf(userId);
      inbox.forEach((entry, at) => {
        if (entry.readAtUtcMs === null && ids.includes(entry.id)) {
          inbox.splice(at, 1, { ...entry, readAtUtcMs });
        }
      });
      return Result.ok(undefined);
    },
  };
}

// ── Photos ───────────────────────────────────────────────────────────────

/**
 * `APPOINTMENT_PHOTO_PORTS` — `appointmentPhotos` in `photos`, written IN
 * PLACE: a visit's photos (every origin, ascending by `takenAtUtcMs`, stably
 * — the adapter's order), a save (by id), a delete, a
 * client record's newest `limit` SHOTS (`photoOrigin == SHOT`,
 * `takenAtUtcMs desc`, ties by id desc as Firestore breaks them; nothing
 * for a `limit` under one — index #22's query), the shots per visit — and
 * the upload, which stores nothing and answers today's object path
 * `appointmentPhotos/{appointmentId}/{id}` and a `memory://` URL of it.
 * Library pictures adopted onto a visit are stored like any photo and
 * answered exactly where the adapter answers them
 * (`PhotoOrigin.countsForClient`), so a fixture never sets them aside by
 * hand.
 */
export function memoryAppointmentPhotoPorts(
  photos: AppointmentPhoto[],
): AppointmentPhotoPorts {
  const isShot = (entry: AppointmentPhoto): boolean =>
    PhotoOrigin.countsForClient(entry.photoOrigin);
  return {
    // Ascending by the instant taken, stably — the adapter's `byTaken` order.
    observeAppointmentPhotos: (appointmentId) =>
      stream(() =>
        photos
          .filter((entry) => entry.appointmentId === appointmentId)
          .sort((a, b) => UtcEpochMs.compare(a.takenAtUtcMs, b.takenAtUtcMs)),
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
        limit >= 1
          ? photos
              .filter(
                (entry) =>
                  entry.clientCustomerId === clientCustomerId && isShot(entry),
              )
              .sort(
                (a, b) =>
                  UtcEpochMs.compare(b.takenAtUtcMs, a.takenAtUtcMs) ||
                  byString(b.id, a.id),
              )
              .slice(0, PagingSystem.pageSize(limit))
          : [],
      ),
    countPhotosByAppointment: async (appointmentIds) =>
      Result.ok(
        appointmentIds.map(
          (appointmentId) =>
            photos.filter(
              (entry) => entry.appointmentId === appointmentId && isShot(entry),
            ).length,
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
 * `PROFILE_PORTS` — `users/{uid}` in `users`. `observeProfile`/`loadProfile`
 * answer the entry AS STORED — a `PROVISIONED` stub included, as the
 * adapter does (the consumer judges), `null` only when absent. Profile
 * writes are the `updateProfile` callable's (Phase 4a 4A-3 (2)).
 */
export function memoryProfilePorts(users: Map<UserId, User>): ProfilePorts {
  return {
    observeProfile: (userId) => stream(() => users.get(userId) ?? null),
    loadProfile: async (userId) => Result.ok(users.get(userId) ?? null),
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

/**
 * The staff client search over the client records (OR-26): every customer
 * whose `searchPrefixes` contains the (already normalised) prefix, by
 * `searchName` (ties by id), at most `limit` — the adapter's query.
 */
export function memoryCustomerSearchPorts(
  customers: readonly Customer[],
): CustomerSearchPorts {
  return {
    searchCustomers: async (prefix, limit) =>
      Result.ok(
        customers
          .filter((entry) => entry.searchPrefixes.includes(prefix))
          .sort(
            (a, b) =>
              byString(a.searchName, b.searchName) || byString(a.id, b.id),
          )
          .slice(0, limit),
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
 * (a provision is visible to the next lookup), the minted tokens and the
 * display names, all mutated IN PLACE.
 */
export type IdentityWorld = {
  readonly store: MemoryStore;
  readonly authUsers: MemoryAuthUser[];
  readonly minted: MintedToken[];
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
 * `saveOtp` — a `Set` of the body.
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
          .sort((a, b) =>
            UtcEpochMs.compare(a.createdAtUtcMs, b.createdAtUtcMs),
          ),
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
 * `setDisplayName` records its name.
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

// ── The clock and the id source (`tx.port.ts`) ───────────────────────────

/** `CLOCK_PORTS` — the pinned instant, `FIXTURE_NOW_UTC_MS` unless given. */
export function memoryClockPorts(
  nowUtcMs: UtcEpochMs = FIXTURE_NOW_UTC_MS,
): ClockPorts {
  return { nowUtcMs: pinnedNowUtcMs(nowUtcMs) };
}

/** `ID_PORTS` — `prefix-1`, `prefix-2`, … in call order (`sequentialIds`). */
export function memoryIdPorts(prefix?: string): IdPorts {
  return { nextId: sequentialIds(prefix) };
}

// ── Programs (positions, courses, shop events) ───────────────────────────

/**
 * The ONE state the programs doubles share: each collection's entities by
 * id, read BY REFERENCE (a spec that sets a key is read at the next call),
 * plus the shops an event save reads its zone from. A save replaces the
 * whole entry (a full-document set, never a merge).
 */
export type ProgramsWorld = {
  readonly positions: Map<PositionId, Position>;
  readonly courses: Map<CourseId, Course>;
  readonly events: Map<EventId, ShopEvent>;
  readonly locations: Map<LocationId, ShopLocation>;
};

/** What a {@link ProgramsWorld} starts with — every collection empty when omitted. */
export type ProgramsWorldSeed = {
  readonly positions?: readonly Position[];
  readonly courses?: readonly Course[];
  readonly events?: readonly ShopEvent[];
  readonly locations?: readonly ShopLocation[];
};

/** A world seeded with programs content and shops. */
export function memoryProgramsWorld(
  seed: ProgramsWorldSeed = {},
): ProgramsWorld {
  const world: ProgramsWorld = {
    positions: new Map(),
    courses: new Map(),
    events: new Map(),
    locations: new Map(),
  };
  for (const position of seed.positions ?? []) {
    world.positions.set(position.id, position);
  }
  for (const course of seed.courses ?? []) world.courses.set(course.id, course);
  for (const event of seed.events ?? []) world.events.set(event.id, event);
  for (const location of seed.locations ?? []) {
    world.locations.set(location.id, location);
  }
  return world;
}

/** How many past events one read answers — the adapter's `limit(24)`. */
const PAST_EVENTS_PAGE = 24;

/**
 * Firestore's order on `orderBy(field)`: the field, then — on a tie — the
 * document id in the direction of the LAST `orderBy` (`__name__`).
 */
function byFieldThenId<E extends { readonly id: string }>(
  field: (entry: E) => number,
  direction: 1 | -1,
): (a: E, b: E) => number {
  return (a, b) => direction * (field(a) - field(b) || byString(a.id, b.id));
}

/**
 * `POSITION_READ_PORTS` over a {@link ProgramsWorld}: `positionStatus ==`
 * the given status (every role when `null`), `sortOrder` ascending, ties by
 * id ascending.
 */
export function memoryPositionReadPorts(
  world: ProgramsWorld,
): PositionReadPorts {
  return {
    observePositions: (positionStatus) =>
      stream(() =>
        [...world.positions.values()]
          .filter(
            (entry) =>
              positionStatus === null ||
              entry.positionStatus === positionStatus,
          )
          .sort(byFieldThenId((entry) => entry.sortOrder, 1)),
      ),
  };
}

/** A role by id (`null` when absent) and its full-document save. */
export function memoryPositionWritePorts(
  world: ProgramsWorld,
): PositionWritePorts {
  return {
    loadPosition: async (id) => Result.ok(world.positions.get(id) ?? null),
    savePosition: async (position) => {
      world.positions.set(position.id, position);
      return Result.ok(undefined);
    },
  };
}

/**
 * `COURSE_READ_PORTS` over a {@link ProgramsWorld}: `enrollmentStatus in`
 * the given statuses (every course when `null`), `sortOrder` ascending,
 * ties by id ascending.
 */
export function memoryCourseReadPorts(world: ProgramsWorld): CourseReadPorts {
  return {
    observeCourses: (statuses) =>
      stream(() =>
        [...world.courses.values()]
          .filter(
            (entry) =>
              statuses === null || statuses.includes(entry.enrollmentStatus),
          )
          .sort(byFieldThenId((entry) => entry.sortOrder, 1)),
      ),
  };
}

/** A course by id (`null` when absent) and its full-document save. */
export function memoryCourseWritePorts(world: ProgramsWorld): CourseWritePorts {
  return {
    loadCourse: async (id) => Result.ok(world.courses.get(id) ?? null),
    saveCourse: async (course) => {
      world.courses.set(course.id, course);
      return Result.ok(undefined);
    },
  };
}

/**
 * `SHOP_EVENT_READ_PORTS` over a {@link ProgramsWorld}: upcoming =
 * `utcEpochMs >= nowUtcMs`, `utcEpochMs` ascending then id ascending, every
 * one; past = `utcEpochMs < nowUtcMs`, `utcEpochMs` DESCENDING then id
 * DESCENDING, the first 24 — so on a tie at the cap the double keeps the
 * document Firestore keeps.
 */
export function memoryShopEventReadPorts(
  world: ProgramsWorld,
): ShopEventReadPorts {
  return {
    observeEvents: ({ nowUtcMs, upcoming }) =>
      stream(() => {
        const events = [...world.events.values()];
        return upcoming
          ? events
              .filter((entry) => entry.utcEpochMs >= nowUtcMs)
              .sort(byFieldThenId((entry) => entry.utcEpochMs, 1))
          : events
              .filter((entry) => entry.utcEpochMs < nowUtcMs)
              .sort(byFieldThenId((entry) => entry.utcEpochMs, -1))
              .slice(0, PAST_EVENTS_PAGE);
      }),
  };
}

/** An event by id (`null` when absent) and its full-document save. */
export function memoryShopEventWritePorts(
  world: ProgramsWorld,
): ShopEventWritePorts {
  return {
    loadEvent: async (id) => Result.ok(world.events.get(id) ?? null),
    saveEvent: async (event) => {
      world.events.set(event.id, event);
      return Result.ok(undefined);
    },
  };
}

/** `PROGRAMS_PORTS` — the admin page's suite: the six bundles over one world. */
export function memoryProgramsPorts(world: ProgramsWorld): ProgramsPorts {
  return {
    ...memoryPositionReadPorts(world),
    ...memoryPositionWritePorts(world),
    ...memoryCourseReadPorts(world),
    ...memoryCourseWritePorts(world),
    ...memoryShopEventReadPorts(world),
    ...memoryShopEventWritePorts(world),
  };
}

/** `LOCATION_LOAD_PORTS` — a shop of the world by id, `null` when absent. */
export function memoryLocationLoadPorts(
  world: ProgramsWorld,
): LocationLoadPorts {
  return {
    loadLocation: async (id) => Result.ok(world.locations.get(id) ?? null),
  };
}

/** `DEFAULT_LOCATION_PORTS` — the deployment's main shop, `TenantConfig.DEFAULT`'s unless given. */
export function memoryDefaultLocationPorts(
  defaultLocationId: LocationId = TenantConfig.DEFAULT.defaultLocationId,
): DefaultLocationPorts {
  return { defaultLocationId };
}

// ── The web's wiring (Phase 4a §3.7) ──────────────────────────────────────

/** How `memoryAuthSessionPorts` answers — every part optional. */
export type AuthSessionScript = {
  /** The live principal — shared with the spec, which `next`s it; anonymous unless given. */
  readonly principals$?: BehaviorSubject<Principal>;
  /** Each refresh's answer (`ok` unless given) — may `next` the principal it unlocks. */
  readonly refresh?: () => Result<void, PipelineError>;
  /** Each sign-out's answer; an `ok` sign-out emits the anonymous principal. */
  readonly signOut?: () => Result<void, PipelineError>;
  readonly identifier?: ParsedIdentifier | null;
  readonly displayName?: string | null;
};

/**
 * `AUTH_SESSION_PORTS` — the session over a `BehaviorSubject` of the ecs
 * `Principal` the spec scripts: `observePrincipal` replays the current one
 * and every later `next`; `refreshToken` and `signOut` answer the script
 * (an `ok` sign-out drops to `Principal.anonymous()`).
 */
export function memoryAuthSessionPorts(
  script: AuthSessionScript = {},
): AuthSessionPorts {
  const principals$ =
    script.principals$ ?? new BehaviorSubject<Principal>(Principal.anonymous());
  return {
    observePrincipal: () => principals$.asObservable(),
    refreshToken: async () => script.refresh?.() ?? Result.ok(undefined),
    signOut: async () => {
      const answer = script.signOut?.() ?? Result.ok(undefined);
      if (answer.ok) principals$.next(Principal.anonymous());
      return answer;
    },
    currentIdentifier: () => script.identifier ?? null,
    currentDisplayName: () => script.displayName ?? null,
  };
}

/** One call `memoryOtpChallengePorts` was asked, in order. */
export type OtpChallengeCall =
  | { readonly otpCall: 'REQUEST'; readonly identifier: ParsedIdentifier }
  | {
      readonly otpCall: 'VERIFY';
      readonly challengeId: OtpId;
      readonly code: OtpCode;
    }
  | {
      readonly otpCall: 'COMPLETE';
      readonly identifier: ParsedIdentifier;
      readonly fields: RegistrationFields;
    };

/** How `memoryOtpChallengePorts` answers — every part optional. */
export type OtpChallengeScript = {
  /** Every call, recorded in order — the spec's own array. */
  readonly calls?: OtpChallengeCall[];
  /** The challenge a request answers (`otp-1` unless given), or its failure. */
  readonly request?: Result<OtpId, PipelineError>;
  /** The session a verify opens (`RETURNING` unless given), or its failure. */
  readonly verify?: Result<SessionKind, PipelineError>;
  /** A registration's answer (`ok` unless given). */
  readonly complete?: Result<void, PipelineError>;
};

/** `OTP_CHALLENGE_PORTS` — the three OTP callables, scripted and recorded. */
export function memoryOtpChallengePorts(
  script: OtpChallengeScript = {},
): OtpChallengePorts {
  const calls = script.calls ?? [];
  return {
    requestOtpChallenge: async (identifier) => {
      calls.push({ otpCall: 'REQUEST', identifier });
      return script.request ?? Result.ok(OtpId.of('otp-1'));
    },
    verifyOtpChallenge: async (challengeId, code) => {
      calls.push({ otpCall: 'VERIFY', challengeId, code });
      return script.verify ?? Result.ok(SessionKind.Returning);
    },
    completeRegistration: async (identifier, fields) => {
      calls.push({ otpCall: 'COMPLETE', identifier, fields });
      return script.complete ?? Result.ok(undefined);
    },
  };
}

/** One callable `scriptedGatewayPorts` was dialled with, in order. */
export type GatewayCall = {
  readonly callable: CallableName;
  readonly input: unknown;
};

/** Per callable, its answer to an input — a callable the script names nothing for is `PIPELINE_UNKNOWN`. */
export type GatewayScript = {
  readonly [N in CallableName]?: (
    input: CallableWire[N]['input'],
  ) =>
    | Result<CallableWire[N]['answer'], PipelineError>
    | Promise<Result<CallableWire[N]['answer'], PipelineError>>;
};

/**
 * `GATEWAY_PORTS` — the typed `callableClient` over a script, recording
 * every call (name and input) in the spec's `calls` array. A callable the
 * script does not answer fails `PIPELINE_UNKNOWN` (recorded too).
 */
export function scriptedGatewayPorts(
  script: GatewayScript = {},
  calls: GatewayCall[] = [],
): GatewayPorts {
  const answerOf = (
    callable: CallableName,
    input: unknown,
  ): Promise<Result<unknown, PipelineError>> => {
    calls.push({ callable, input });
    const handler = script[callable] as
      | ((
          input: unknown,
        ) =>
          | Result<unknown, PipelineError>
          | Promise<Result<unknown, PipelineError>>)
      | undefined;
    return handler === undefined
      ? Promise.resolve(
          Result.err(PipelineError.bare(PipelineErrorCode.Unknown)),
        )
      : Promise.resolve(handler(input));
  };
  const callableClient = (<N extends CallableName>(name: N) =>
    (input: CallableWire[N]['input']) =>
      answerOf(name, input) as Promise<
        Result<CallableWire[N]['answer'], PipelineError>
      >) as CallableClient;
  return { callableClient };
}

/** One write `scriptedVisitEditWritePorts` was asked for, in order — named by its bundle member. */
export type VisitEditWriteCall =
  | {
      readonly port: 'sendStaffEdit';
      readonly intent: BookingCall.StaffEditIntent;
    }
  | {
      readonly port: 'saveTeamNoteText';
      readonly appointmentId: AppointmentId;
      readonly text: string | null;
    }
  | { readonly port: 'sendSeatTip'; readonly request: BookingCall.TipIntent };

/** How `scriptedVisitEditWritePorts` answers — every part optional. */
export type VisitEditWriteScript = {
  /** Every write, recorded in order — the spec's own array. */
  readonly calls?: VisitEditWriteCall[];
  /** Whether the staff-edit batch lands (`true` unless given). */
  readonly staffEdit?: boolean;
  /** Whether the team note is written (`true` unless given). */
  readonly teamNote?: boolean;
  /** Whether the tip is recorded (`true` unless given). */
  readonly seatTip?: boolean;
};

/**
 * The visit sheet's three writes (OR-4), scripted and recorded: each call
 * pushed to `calls` in the order it was made — what a `saveVisitEdit` spec
 * asserts the sequence by — and answered `true` (landed) unless the script
 * says otherwise. Nothing is stored: the store's writers own the state.
 */
export function scriptedVisitEditWritePorts(
  script: VisitEditWriteScript = {},
): VisitEditWritePorts {
  const calls = script.calls ?? [];
  return {
    sendStaffEdit: async (intent) => {
      calls.push({ port: 'sendStaffEdit', intent });
      return script.staffEdit ?? true;
    },
    saveTeamNoteText: async (appointmentId, text) => {
      calls.push({ port: 'saveTeamNoteText', appointmentId, text });
      return script.teamNote ?? true;
    },
    sendSeatTip: async (request) => {
      calls.push({ port: 'sendSeatTip', request });
      return script.seatTip ?? true;
    },
  };
}

/**
 * The client issue sink (OR-34), recording: every issue handed over is
 * pushed to `reported`, in order, one batch after another — nothing is
 * deduplicated, capped or sent (that is the web reporter's adapter).
 */
export function recordingClientIssuePorts(): {
  readonly ports: ClientIssuePorts;
  readonly reported: readonly ClientIssue[];
} {
  const reported: ClientIssue[] = [];
  return {
    reported,
    ports: {
      reportClientIssues: (issues) => {
        reported.push(...issues);
      },
    },
  };
}

/**
 * `AVATAR_PORTS` — one avatar per account in the spec's map
 * (`avatars/{uid}/original`, a `https://avatars.test/…` URL), replaced on
 * upload, `null` when none, removed in place.
 */
export function memoryAvatarPorts(
  avatars: Map<UserId, StoredFile> = new Map(),
): AvatarPorts {
  return {
    uploadAvatar: async (userId) => {
      const path = `avatars/${userId}/original`;
      const file = { path, url: `https://avatars.test/${path}` };
      avatars.set(userId, file);
      return Result.ok(file);
    },
    findAvatar: async (userId) => Result.ok(avatars.get(userId) ?? null),
    removeAvatar: async (userId) => {
      avatars.delete(userId);
      return Result.ok(undefined);
    },
  };
}

/** Which Storage paths `memoryMediaResolvePorts` refuses, and how. */
export type MediaResolveScript = {
  readonly forbidden?: readonly string[];
  readonly notFound?: readonly string[];
  readonly transient?: readonly string[];
};

/**
 * `MEDIA_RESOLVE_PORTS` — one rendition per ref, `ref.mediaWidth` wide at
 * `https://media.test/<path>`, unless the script names its path forbidden,
 * not found or transient (the permanent and the retryable failures).
 */
export function memoryMediaResolvePorts(
  script: MediaResolveScript = {},
): MediaResolvePorts {
  return {
    resolveMedia: async (ref) => {
      const path = ref.mediaPath;
      if (script.forbidden?.includes(path)) {
        return Result.err(MediaError.forbidden(path));
      }
      if (script.notFound?.includes(path)) {
        return Result.err(MediaError.notFound(path));
      }
      if (script.transient?.includes(path)) {
        return Result.err(MediaError.transient(path));
      }
      return Result.ok([
        { width: ref.mediaWidth, url: `https://media.test/${path}` },
      ]);
    },
  };
}

/** `FLAGS_PORTS` — the named flags on, every other off (all off unless given). */
export function memoryFlagsPorts(on: readonly FlagName[] = []): FlagsPorts {
  return { flagOn: (key) => on.includes(key) };
}

/** `TIMER_PORTS` — no waiting: each delay resolves at once, recorded in the spec's array. */
export function immediateTimerPorts(delays: number[] = []): TimerPorts {
  return {
    delay: async (ms) => {
      delays.push(ms);
    },
  };
}
