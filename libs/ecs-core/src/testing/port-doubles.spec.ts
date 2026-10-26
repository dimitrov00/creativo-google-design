import { BehaviorSubject, firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  BarberStatus,
  BookingLifecycle,
  EnrollmentStatus,
  PositionStatus,
  TenantConfig,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  type ClientIssue,
  ClientIssueKind,
  ClientStats,
  CouponStatus,
  ExceptionEffectRule,
  LocationStatus,
  NotificationPayload,
  PhotoOrigin,
  PolicyPassStamp,
  ServiceStatus,
  VoucherCode,
  CustomerOrigin,
  Email,
  E164,
  AuthClaims,
  JournalEffect,
  JournalFeed,
  JournalVisibility,
  ParsedIdentifier,
  StreakRule,
  TierOp,
  WriteOp,
  FeatureFlags,
  type FlagName,
  OtpCode,
  type Principal,
  SessionKind,
} from '@core/components';
import {
  AppointmentId,
  AppointmentPhotoId,
  AuditEntryId,
  BarberId,
  BusyKey,
  CapacityMonthId,
  ClientMoneyStatsId,
  Currency,
  CouponGrantId,
  CouponId,
  CourseId,
  CustomerId,
  EventId,
  GiftVoucherId,
  GrantStatus,
  LocationId,
  NotificationId,
  PriceCents,
  OtpId,
  PositionId,
  type Result,
  ScheduleExceptionId,
  TenantId,
  ServiceCategoryId,
  ServiceId,
  StreakDefinitionId,
  StreakDefinitionVersionId,
  TierId,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
  InvitationId,
  MediaRefId,
  Result as R,
} from '@core/primitives';
import {
  RepositoryError,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import type {
  Appointment,
  AppointmentPhoto,
  AuditEntry,
  CapacityMonth,
  ClientMoneyRecord,
  ClientStatsRecord,
  Coupon,
  CouponGrant,
  Customer,
  GiftVoucher,
  InboxNotification,
  JournalEntry,
  ScheduleException,
  ServiceCategory,
  WaitlistRequest,
} from '@core/entities';
import { Collections, Subcollections } from '@core/entities';
import { appointmentFixture } from './appointment.fixtures';
import {
  barberBusyDayFixture,
  barberFixture,
  barberScheduleFixture,
  locationFixture,
  serviceFixture,
} from './booking-core.fixtures';
import { scheduleExceptionFixture } from './booking-flow.fixtures';
import {
  loyaltyAccountFixtures,
  loyaltyCatalogFixture,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
} from './loyalty.fixtures';
import {
  FIXTURE_IDS,
  FIXTURE_TODAY,
  customerOf,
  minute,
  textFixture,
  unwrapErr,
  unwrapOk,
  utcMs,
} from './test-support';
import {
  fixedOtpCryptoPorts,
  fixedTenantPorts,
  memoryAppointmentPhotoPorts,
  memoryAppointmentReadPorts,
  memoryAuthAdminPorts,
  memoryAuthUserLookupPorts,
  memoryCatalogReadPorts,
  memoryClientJournalPorts,
  memoryClientStatsReadPorts,
  memoryClockPorts,
  memoryCouponVoucherPorts,
  memoryCourseReadPorts,
  memoryCourseWritePorts,
  memoryCustomerPorts,
  memoryCustomerSearchPorts,
  memoryDefaultLocationPorts,
  memoryIdPorts,
  memoryIdentityWorld,
  memoryInboxPorts,
  memoryLocationLoadPorts,
  memoryLoyaltyAccountReadPorts,
  memoryLoyaltyCatalogReadPorts,
  memoryLoyaltyWorld,
  memoryOtpStorePorts,
  memoryPositionReadPorts,
  memoryPositionWritePorts,
  memoryProfilePorts,
  memoryProgramsPorts,
  memoryProgramsWorld,
  memoryScheduleExceptionPorts,
  memorySchedulingReadPorts,
  memoryShopEventReadPorts,
  memoryShopEventWritePorts,
  memoryStreakDefinitionPorts,
  memoryStreakWorld,
  memoryUserLookupPorts,
  memoryUserSearchPorts,
  memoryWaitlistReadPorts,
  recordingClientIssuePorts,
  recordingOtpDeliveryPorts,
  scriptedVisitEditWritePorts,
  type VisitEditWriteCall,
  type GatewayCall,
  type OtpChallengeCall,
  immediateTimerPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryFlagsPorts,
  memoryMediaResolvePorts,
  memoryOtpChallengePorts,
  scriptedGatewayPorts,
} from './port-doubles';
import {
  FIXTURE_OTP_CODE,
  FIXTURE_OTP_SALT,
  FIXTURE_TENANT_ID,
  otpFixture,
  principalFixture,
  provisionedUserFixture,
  registeredUserFixture,
} from './identity.fixtures';
import { Callables } from '@core/ports';
import { FIXTURE_NOW_UTC_MS, applyWrites } from './test-support';
import { courseOf, positionOf, shopEventOf } from './programs.fixtures';

/** The one value a stream double emits. */
async function first<T, E>(stream: Observable<Result<T, E>>): Promise<T> {
  return unwrapOk(await firstValueFrom(stream));
}

/**
 * An entity with only the fields a double reads — a TEST shortcut for the
 * archetypes whose other slices no query of these doubles touches.
 */
function partial<E>(fields: Partial<E>): E {
  return fields as E;
}

const ANA = UserId.of('ana');
const BOB = UserId.of('bob');
const ANA_RECORD = customerOf(ANA);
const BOB_RECORD = customerOf(BOB);
const KEY = BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY);
const OTHER_KEY = BusyKey.of(BarberId.of('b-petar'), FIXTURE_TODAY);

describe('memorySchedulingReadPorts — the booking store’s raw streams', () => {
  it('answers each stream by its key, null for a key with no document', async () => {
    const busy = barberBusyDayFixture();
    const exception = scheduleExceptionFixture();
    const schedule = barberScheduleFixture();
    const location = locationFixture();
    const month: CapacityMonth = {
      id: CapacityMonthId.of('2026-09'),
      month: CapacityMonthId.of('2026-09'),
      entries: [],
    };
    const ports = memorySchedulingReadPorts({
      busyDays: [busy],
      exceptions: [exception],
      schedules: [schedule],
      locations: [location],
      capacityMonths: [month],
    });
    expect(await first(ports.observeBusyDay(KEY))).toBe(busy);
    expect(await first(ports.observeBusyDay(OTHER_KEY))).toBeNull();
    expect(await first(ports.observeExceptions(KEY))).toBe(exception);
    expect(await first(ports.observeExceptions(OTHER_KEY))).toBeNull();
    expect(await first(ports.observeSchedule(FIXTURE_IDS.barber))).toBe(
      schedule,
    );
    expect(await first(ports.observeLocation(FIXTURE_IDS.location))).toBe(
      location,
    );
    expect(await first(ports.observeLocation(LocationId.of('gone')))).toBe(
      null,
    );
    expect(
      await first(ports.observeCapacityMonth(CapacityMonthId.of('2026-09'))),
    ).toBe(month);
    expect(
      await first(ports.observeCapacityMonth(CapacityMonthId.of('2026-10'))),
    ).toBeNull();
  });

  it('reads the default policy when none is given, the given one otherwise', async () => {
    expect(await first(memorySchedulingReadPorts().observePolicy())).toBe(
      BookingPolicy.DEFAULT,
    );
    const policy = { ...BookingPolicy.DEFAULT, autoConfirm: false };
    expect(
      await first(memorySchedulingReadPorts({ policy }).observePolicy()),
    ).toBe(policy);
  });

  it('reads its arrays by reference, at subscription time', async () => {
    const busyDays = [barberBusyDayFixture()];
    const ports = memorySchedulingReadPorts({ busyDays });
    const later = barberBusyDayFixture({ barberId: BarberId.of('b-petar') });
    busyDays.push(later);
    expect(await first(ports.observeBusyDay(OTHER_KEY))).toBe(later);
  });
});

describe('memoryScheduleExceptionPorts — the staff command, in place', () => {
  const exception = scheduleExceptionFixture();
  const other: ScheduleException = scheduleExceptionFixture({
    id: ScheduleExceptionId.of(OTHER_KEY),
    barberId: BarberId.of('b-petar'),
  });

  it('hands merge the stored bodies, positions kept, and writes its answer — null deletes', async () => {
    const exceptions = [exception];
    const ports = memoryScheduleExceptionPorts(exceptions);
    const seen: (ScheduleException | null)[][] = [];
    const written = await ports.writeScheduleException(
      [OTHER_KEY, KEY],
      (stored) => {
        seen.push([...stored]);
        return { ok: true, value: [other, null] } as const;
      },
    );
    expect(written.ok).toBe(true);
    expect(seen).toEqual([[null, exception]]);
    expect(exceptions).toEqual([other]);
  });

  it('replaces a stored day in place', async () => {
    const exceptions = [exception];
    const reopened: ScheduleException = {
      ...exception,
      ...ExceptionEffectRule.closed(),
    };
    await memoryScheduleExceptionPorts(exceptions).writeScheduleException(
      [KEY],
      () => ({ ok: true, value: [reopened] }) as const,
    );
    expect(exceptions).toEqual([reopened]);
  });

  it('writes nothing when merge refuses, and answers the refusal', async () => {
    const exceptions = [exception];
    const refused = await memoryScheduleExceptionPorts(
      exceptions,
    ).writeScheduleException([KEY], () => ({
      ok: false,
      error: { errorCode: 'REFUSED' } as const,
    }));
    expect(refused).toEqual({ ok: false, error: { errorCode: 'REFUSED' } });
    expect(exceptions).toEqual([exception]);
  });

  it('is visible through the read double that shares its array', async () => {
    const exceptions: ScheduleException[] = [];
    await memoryScheduleExceptionPorts(exceptions).writeScheduleException(
      [KEY],
      () => ({ ok: true, value: [exception] }) as const,
    );
    expect(
      await first(
        memorySchedulingReadPorts({ exceptions }).observeExceptions(KEY),
      ),
    ).toBe(exception);
  });
});

describe('memoryAppointmentReadPorts — the appointment readers', () => {
  const base = appointmentFixture();
  const at = (iso: string) => utcMs(iso);
  const visit = (id: string, iso: string, overrides = {}): Appointment =>
    appointmentFixture({
      id: AppointmentId.of(id),
      utcEpochMs: at(iso),
      ...overrides,
    });

  it('finds one visit by id, null when absent', async () => {
    const ports = memoryAppointmentReadPorts([base]);
    expect(await first(ports.observeAppointment(base.id))).toBe(base);
    expect(
      await first(ports.observeAppointment(AppointmentId.of('nope'))),
    ).toBeNull();
  });

  it('reads a barber’s day by its busy key, every status', async () => {
    const cancelled = appointmentFixture({
      id: AppointmentId.of('cancelled'),
      lifecycle: BookingLifecycle.cancel(
        base.utcEpochMs,
        CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
      ),
    });
    const elsewhere = visit('elsewhere', '2026-09-28T12:00:00+03:00', {
      busyKeys: [OTHER_KEY],
    });
    const ports = memoryAppointmentReadPorts([base, cancelled, elsewhere]);
    expect(await first(ports.observeBarberDay(KEY))).toEqual({
      appointments: [base, cancelled],
      unreadableCount: 0,
    });
    expect(await first(ports.observeBarberDay(OTHER_KEY))).toEqual({
      appointments: [elsewhere],
      unreadableCount: 0,
    });
  });

  it('answers a barber’s day with the unreadable count the script names for it — 0 for any other', async () => {
    const ports = memoryAppointmentReadPorts([base], {
      unreadable: new Map([[KEY, 2]]),
    });
    expect(await first(ports.observeBarberDay(KEY))).toEqual({
      appointments: [base],
      unreadableCount: 2,
    });
    expect(await first(ports.observeBarberDay(OTHER_KEY))).toEqual({
      appointments: [],
      unreadableCount: 0,
    });
  });

  it('lists an account’s live visits by start, and its newest `limit`', async () => {
    const early = visit('early', '2026-09-28T09:00:00+03:00');
    const late = visit('late', '2026-09-29T09:00:00+03:00');
    const done = visit('done', '2026-09-27T09:00:00+03:00', {
      lifecycle: BookingLifecycle.complete(at('2026-09-27T10:00:00+03:00')),
    });
    const bobs = visit('bobs', '2026-09-28T11:00:00+03:00', {
      ownerUserId: BOB,
    });
    const ports = memoryAppointmentReadPorts([late, done, bobs, early]);
    expect(
      (await first(ports.observeUpcoming(FIXTURE_IDS.client))).map(
        (entry) => entry.id,
      ),
    ).toEqual(['early', 'late']);
    expect(
      (await first(ports.observeHistory(FIXTURE_IDS.client, 2))).map(
        (entry) => entry.id,
      ),
    ).toEqual(['late', 'early']);
  });

  it('pages a client record’s history newest first, never ending inside one start instant', async () => {
    const mine = { subjectCustomerIds: [ANA_RECORD] };
    const a = visit('a', '2026-09-20T10:00:00+03:00', mine);
    const b1 = visit('b1', '2026-09-21T10:00:00+03:00', mine);
    const b2 = visit('b2', '2026-09-21T10:00:00+03:00', mine);
    const c = visit('c', '2026-09-22T10:00:00+03:00', mine);
    const notMine = visit('x', '2026-09-23T10:00:00+03:00', {
      subjectCustomerIds: [BOB_RECORD],
    });
    const ports = memoryAppointmentReadPorts([a, b1, b2, c, notMine]);
    const page1 = unwrapOk(await ports.pageClientHistory(ANA_RECORD, null, 2));
    // c, then the 21st taken WHOLE (b2 before b1: newest id first).
    expect(page1.appointments.map((entry) => entry.id)).toEqual([
      'c',
      'b2',
      'b1',
    ]);
    expect(page1.nextBeforeUtcMs).toBe(b1.utcEpochMs);
    const page2 = unwrapOk(
      await ports.pageClientHistory(ANA_RECORD, page1.nextBeforeUtcMs, 2),
    );
    expect(page2.appointments.map((entry) => entry.id)).toEqual(['a']);
    expect(page2.nextBeforeUtcMs).toBeNull();
    const cut = unwrapOk(await ports.pageClientHistory(ANA_RECORD, null, 1));
    expect(cut.appointments.map((entry) => entry.id)).toEqual(['c']);
    expect(cut.nextBeforeUtcMs).toBe(c.utcEpochMs);
  });

  it('searches the window nearest now on both sides, each half cut at `limitPerSide`, oldest first', async () => {
    const now = at('2026-09-28T12:00:00+03:00');
    const ports = memoryAppointmentReadPorts([
      visit('p3', '2026-09-25T10:00:00+03:00'),
      visit('p1', '2026-09-28T11:00:00+03:00'),
      visit('p2', '2026-09-27T10:00:00+03:00'),
      visit('n0', '2026-09-28T12:00:00+03:00'),
      visit('n1', '2026-09-29T10:00:00+03:00'),
      visit('n2', '2026-09-30T10:00:00+03:00'),
    ]);
    const window = unwrapOk(await ports.searchAppointmentWindow(now, 2));
    expect(window.map((entry) => entry.id)).toEqual(['p2', 'p1', 'n0', 'n1']);
  });
});

describe('memoryWaitlistReadPorts — an account’s own requests', () => {
  it('lists the account’s requests newest first', async () => {
    const request = (id: string, owner: UserId, ms: number) =>
      partial<WaitlistRequest>({
        id: WaitlistRequestId.of(id),
        ownerUserId: owner,
        createdAtUtcMs: unwrapOk(UtcEpochMs.of(ms)),
      });
    const ports = memoryWaitlistReadPorts([
      request('old', ANA, 1_000),
      request('bobs', BOB, 3_000),
      request('new', ANA, 2_000),
    ]);
    expect(
      (await first(ports.observeMyWaitlistRequests(ANA))).map(
        (entry) => entry.id,
      ),
    ).toEqual(['new', 'old']);
  });
});

describe('memoryClientStatsReadPorts — keyed by the client record (D29)', () => {
  const NOW = utcMs('2026-09-28T09:00:00+03:00');
  const record = (customerId: CustomerId): ClientStatsRecord => ({
    customerId,
    ...ClientStats.empty(),
    version: 1,
    updatedAtUtcMs: NOW,
    ...PolicyPassStamp.NONE,
    id: customerId,
  });
  const money: ClientMoneyRecord = {
    customerId: ANA_RECORD,
    lifetimeSpendCents: unwrapOk(PriceCents.of(2500)),
    currency: Currency.EUR,
    version: 1,
    updatedAtUtcMs: NOW,
    id: ClientMoneyStatsId.FIXED,
  };
  const records = [
    record(CustomerId.of('cus_c')),
    record(CustomerId.of('cus_a')),
    record(CustomerId.of('cus_b')),
  ];

  it('loads a record’s stats and its money by the record', async () => {
    const ports = memoryClientStatsReadPorts({
      stats: [record(ANA_RECORD)],
      money: [money],
    });
    expect(unwrapOk(await ports.loadClientStats(ANA_RECORD))?.id).toBe(
      ANA_RECORD,
    );
    expect(unwrapOk(await ports.loadClientStats(BOB_RECORD))).toBeNull();
    expect(unwrapOk(await ports.loadClientMoney(ANA_RECORD))).toBe(money);
    expect(unwrapOk(await ports.loadClientMoney(BOB_RECORD))).toBeNull();
  });

  it('pages by document id, the cursor the last id while somebody is left', async () => {
    const ports = memoryClientStatsReadPorts({ stats: records });
    const page1 = unwrapOk(await ports.pageClientStats(null, 2));
    expect(page1.records.map((entry) => entry.id)).toEqual(['cus_a', 'cus_b']);
    expect(page1.nextAfterCustomerId).toBe('cus_b');
    const page2 = unwrapOk(
      await ports.pageClientStats(page1.nextAfterCustomerId, 2),
    );
    expect(page2.records.map((entry) => entry.id)).toEqual(['cus_c']);
    expect(page2.nextAfterCustomerId).toBeNull();
  });
});

describe('memoryCatalogReadPorts — the four live streams', () => {
  it('lists the active ones by sortOrder, every category and every shop', async () => {
    const cut = serviceFixture({ sortOrder: 2 });
    const shave = serviceFixture({
      id: ServiceId.of('svc-shave'),
      sortOrder: 1,
    });
    const archived = serviceFixture({
      id: ServiceId.of('svc-old'),
      serviceStatus: ServiceStatus.Archived,
    });
    const otherCategory = serviceFixture({
      id: ServiceId.of('svc-kid'),
      categoryId: ServiceCategoryId.of('cat-kids'),
      sortOrder: 0,
    });
    const ivan = barberFixture({ sortOrder: 2 });
    const petar = barberFixture({
      id: BarberId.of('b-petar'),
      sortOrder: 1,
      locationIds: [LocationId.of('loc-other')],
    });
    const away = barberFixture({
      id: BarberId.of('b-away'),
      barberStatus: BarberStatus.Inactive,
    });
    const hidden = locationFixture({
      id: LocationId.of('loc-hidden'),
      locationStatus: LocationStatus.Hidden,
    });
    const categories: ServiceCategory[] = [
      { id: ServiceCategoryId.of('b'), name: textFixture('B'), sortOrder: 2 },
      { id: ServiceCategoryId.of('a'), name: textFixture('A'), sortOrder: 1 },
    ];
    const ports = memoryCatalogReadPorts({
      services: [cut, shave, archived, otherCategory],
      barbers: [ivan, petar, away],
      categories,
      locations: [locationFixture(), hidden],
    });
    expect((await first(ports.observeServices())).map((s) => s.id)).toEqual([
      'svc-kid',
      'svc-shave',
      'svc-classic-cut',
    ]);
    expect((await first(ports.observeBarbers())).map((b) => b.id)).toEqual([
      'b-petar',
      'b-ivan',
    ]);
    expect((await first(ports.observeCategories())).map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
    expect((await first(ports.observeLocations())).map((l) => l.id)).toEqual([
      FIXTURE_IDS.location,
    ]);
  });
});

describe('memoryCouponVoucherPorts — coupons, grants and vouchers', () => {
  const coupon = (
    id: string,
    code: string | null,
    couponStatus: CouponStatus,
  ) =>
    partial<Coupon>({
      id: CouponId.of(id),
      code: code === null ? null : VoucherCode.of(code),
      couponStatus,
    });
  const open = coupon('c-open', 'FIRST10', CouponStatus.Enabled);
  const closed = coupon('c-closed', 'OLD5', CouponStatus.Disabled);
  const grant = (
    id: string,
    customerId: CustomerId,
    grantStatus: GrantStatus,
  ) =>
    partial<CouponGrant>({
      id: CouponGrantId.of(id),
      customerId,
      holderUserId: null,
      couponId: closed.id,
      grantStatus,
    } as Partial<CouponGrant>);
  const held = grant('g-held', ANA_RECORD, GrantStatus.Active);
  const spent = grant('g-spent', ANA_RECORD, GrantStatus.Used);
  const bobs = grant('g-bob', BOB_RECORD, GrantStatus.Active);
  const voucher = partial<GiftVoucher>({
    id: GiftVoucherId.of('v1'),
    code: VoucherCode.of('GIFT50'),
    issuedToCustomerId: ANA_RECORD,
    holderUserId: ANA,
  });
  const paper = partial<GiftVoucher>({
    id: GiftVoucherId.of('v-paper'),
    code: VoucherCode.of('PAPER'),
    issuedToCustomerId: null,
    holderUserId: null,
  });
  const ports = memoryCouponVoucherPorts({
    coupons: [open, closed],
    grants: [held, spent, bobs],
    vouchers: [voucher, paper],
  });

  it('opens only an ENABLED coupon by its code, and lists the enabled ones', async () => {
    expect(
      unwrapOk(await ports.findCouponByCode(VoucherCode.of('FIRST10'))),
    ).toBe(open);
    expect(
      unwrapOk(await ports.findCouponByCode(VoucherCode.of('OLD5'))),
    ).toBeNull();
    expect(unwrapOk(await ports.listOpenCoupons())).toEqual([open]);
  });

  // Pass C (plausible defect 5): the double answers the adapter's contract.
  it('lists no code-less coupon — a grant-only coupon is not on offer, even ENABLED', async () => {
    const grantOnly = coupon('c-grant-only', null, CouponStatus.Enabled);
    const withGrantOnly = memoryCouponVoucherPorts({
      coupons: [grantOnly, open, closed],
    });
    expect(unwrapOk(await withGrantOnly.listOpenCoupons())).toEqual([open]);
    // Still loaded by id, whatever it carries.
    expect(unwrapOk(await withGrantOnly.loadCoupons([grantOnly.id]))).toEqual([
      grantOnly,
    ]);
  });

  it('loads coupons by id WHATEVER their status — a held grant keeps its retired coupon', async () => {
    expect(
      unwrapOk(await ports.loadCoupons([closed.id, CouponId.of('gone')])),
    ).toEqual([closed]);
  });

  it('reads grants by id WHATEVER their status — a used one included, a missing id absent — and a client record’s ACTIVE grants only', async () => {
    expect(
      unwrapOk(
        await ports.loadCouponGrants([
          held.id,
          spent.id,
          CouponGrantId.of('none'),
        ]),
      ),
    ).toEqual([held, spent]);
    expect(unwrapOk(await ports.loadCouponGrants([]))).toEqual([]);
    expect(unwrapOk(await ports.listUsableCouponGrants(ANA_RECORD))).toEqual([
      held,
    ]);
  });

  it('reads a voucher by code, and a client record’s vouchers', async () => {
    expect(
      unwrapOk(await ports.findGiftVoucherByCode(VoucherCode.of('PAPER'))),
    ).toBe(paper);
    expect(unwrapOk(await ports.listGiftVouchersForHolder(ANA_RECORD))).toEqual(
      [voucher],
    );
    expect(unwrapOk(await ports.listGiftVouchersForHolder(BOB_RECORD))).toEqual(
      [],
    );
  });
});

describe('memoryInboxPorts — an account’s inbox, in place', () => {
  const notification = (id: string, sentMs: number): InboxNotification => ({
    id: NotificationId.of(id),
    sentAtUtcMs: unwrapOk(UtcEpochMs.of(sentMs)),
    readAtUtcMs: null,
    ...NotificationPayload.appointmentReminder(
      FIXTURE_IDS.appointment,
      FIXTURE_TODAY,
      minute(600),
    ),
  });
  const READ_AT = utcMs('2026-09-28T09:00:00+03:00');

  it('streams the newest 50, newest first', async () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      notification(`n${String(i).padStart(2, '0')}`, 1_000 + i),
    );
    const inbox = await first(
      memoryInboxPorts(new Map([[ANA, many]])).observeInbox(ANA),
    );
    expect(inbox).toHaveLength(50);
    expect(inbox[0]?.id).toBe('n54');
    expect(inbox[49]?.id).toBe('n05');
    expect(await first(memoryInboxPorts(new Map()).observeInbox(BOB))).toEqual(
      [],
    );
  });

  it('stamps the receipt on each named unread notification — the others, and a stamped one, keep theirs', async () => {
    const EARLIER = utcMs('2026-09-28T08:00:00+03:00');
    const inboxes = new Map([
      [
        ANA,
        [
          notification('a', 1),
          notification('b', 2),
          { ...notification('c', 3), readAtUtcMs: EARLIER },
          notification('d', 4),
        ],
      ],
    ]);
    const ports = memoryInboxPorts(inboxes);
    expect(
      unwrapOk(
        await ports.markNotificationsRead(
          ANA,
          [
            NotificationId.of('a'),
            NotificationId.of('c'),
            NotificationId.of('d'),
            NotificationId.of('gone'),
          ],
          READ_AT,
        ),
      ),
    ).toBeUndefined();
    expect(inboxes.get(ANA)?.map((entry) => entry.readAtUtcMs)).toEqual([
      READ_AT,
      null,
      EARLIER,
      READ_AT,
    ]);
  });
});

describe('memoryAppointmentPhotoPorts — a visit’s photos, in place', () => {
  /** A photo's own facts — every field but the two Storage answers. */
  const factsOf = (
    id: string,
    takenIso: string,
    appointmentId = FIXTURE_IDS.appointment,
  ): Omit<AppointmentPhoto, 'path' | 'url'> => ({
    id: AppointmentPhotoId.of(id),
    appointmentId,
    barberId: FIXTURE_IDS.barber,
    clientCustomerId: ANA_RECORD,
    clientLabel: 'Ана',
    takenByUserId: UserId.of('dev-staff-ivan'),
    takenAtUtcMs: utcMs(takenIso),
    width: null,
    height: null,
    photoOrigin: PhotoOrigin.Shot,
    label: null,
  });
  const photo = (
    id: string,
    takenIso: string,
    appointmentId = FIXTURE_IDS.appointment,
  ): AppointmentPhoto => ({
    ...factsOf(id, takenIso, appointmentId),
    path: `appointmentPhotos/${appointmentId}/${id}`,
    url: `memory://appointmentPhotos/${appointmentId}/${id}`,
  });

  it('saves, lists, counts and deletes', async () => {
    const photos: AppointmentPhoto[] = [];
    const ports = memoryAppointmentPhotoPorts(photos);
    const one = photo('p1', '2026-09-20T10:00:00+03:00');
    const two = photo('p2', '2026-09-28T10:00:00+03:00');
    const elsewhere = photo(
      'p3',
      '2026-09-25T10:00:00+03:00',
      AppointmentId.of('appt-2'),
    );
    await ports.saveAppointmentPhoto(one);
    await ports.saveAppointmentPhoto(two);
    await ports.saveAppointmentPhoto(elsewhere);
    await ports.saveAppointmentPhoto({ ...one, label: 'Отпред' });
    expect(photos).toHaveLength(3);
    expect(
      (
        await first(ports.observeAppointmentPhotos(FIXTURE_IDS.appointment))
      ).map((entry) => entry.label),
    ).toEqual(['Отпред', null]);
    expect(
      unwrapOk(await ports.listClientPhotos(ANA_RECORD, 2)).map((p) => p.id),
    ).toEqual(['p2', 'p3']);
    expect(unwrapOk(await ports.listClientPhotos(BOB_RECORD, 2))).toEqual([]);
    expect(
      unwrapOk(
        await ports.countPhotosByAppointment([
          FIXTURE_IDS.appointment,
          AppointmentId.of('appt-2'),
          AppointmentId.of('none'),
        ]),
      ),
    ).toEqual([2, 1, 0]);
    await ports.deleteAppointmentPhoto(two);
    expect(photos.map((entry) => entry.id)).toEqual(['p1', 'p3']);
  });

  it('answers the record’s strip and the counts with shots only, as the adapter’s query does — a library picture adopted onto a visit takes no place', async () => {
    const adopted = (id: string, takenIso: string): AppointmentPhoto => ({
      ...photo(id, takenIso),
      photoOrigin: PhotoOrigin.Library,
      label: 'Фейд · витрина',
      path: '/work/fade.jpg',
      url: '/work/fade.jpg',
    });
    const ports = memoryAppointmentPhotoPorts([
      adopted('cover-new', '2026-09-30T10:00:00+03:00'),
      photo('shot-3', '2026-09-29T10:00:00+03:00'),
      adopted('cover-old', '2026-09-28T12:00:00+03:00'),
      photo('shot-2', '2026-09-28T10:00:00+03:00'),
      photo('shot-1', '2026-09-20T10:00:00+03:00', AppointmentId.of('appt-2')),
    ]);

    expect(
      unwrapOk(await ports.listClientPhotos(ANA_RECORD, 2)).map((p) => p.id),
    ).toEqual(['shot-3', 'shot-2']);
    expect(
      unwrapOk(await ports.listClientPhotos(ANA_RECORD, 12)).map((p) => p.id),
    ).toEqual(['shot-3', 'shot-2', 'shot-1']);
    // No room, nothing — the adapter reads nothing for it.
    expect(unwrapOk(await ports.listClientPhotos(ANA_RECORD, 0))).toEqual([]);
    expect(
      unwrapOk(
        await ports.countPhotosByAppointment([
          FIXTURE_IDS.appointment,
          AppointmentId.of('appt-2'),
        ]),
      ),
    ).toEqual([2, 1]);
    // The visit's own strip shows every picture on it, whatever its origin.
    expect(
      await first(ports.observeAppointmentPhotos(FIXTURE_IDS.appointment)),
    ).toHaveLength(4);
  });

  // Pass C (Y-9): the double answers the adapter's `byTaken` order, stably.
  it('answers a visit’s photos ascending by the instant taken, ties in stored order', async () => {
    const ports = memoryAppointmentPhotoPorts([
      photo('late', '2026-09-28T12:00:00+03:00'),
      photo('early', '2026-09-28T09:00:00+03:00'),
      photo('tie-a', '2026-09-28T10:00:00+03:00'),
      photo('tie-b', '2026-09-28T10:00:00+03:00'),
      photo('other', '2026-09-28T08:00:00+03:00', AppointmentId.of('appt-2')),
    ]);
    expect(
      (
        await first(ports.observeAppointmentPhotos(FIXTURE_IDS.appointment))
      ).map((entry) => entry.id),
    ).toEqual(['early', 'tie-a', 'tie-b', 'late']);
  });

  it('uploads to today’s object path, derived from the photo’s own facts', async () => {
    expect(
      unwrapOk(
        await memoryAppointmentPhotoPorts([]).uploadPhotoBytes(
          factsOf('p9', '2026-09-28T10:00:00+03:00'),
          new Blob(['x']),
        ),
      ),
    ).toEqual({
      path: 'appointmentPhotos/appt-1/p9',
      url: 'memory://appointmentPhotos/appt-1/p9',
    });
  });
});

describe('memoryCustomerPorts — the signed-in account’s client record', () => {
  it('finds the record whose userId is the account, null when none', async () => {
    const record: Customer = {
      id: ANA_RECORD,
      userId: ANA,
      displayName: 'Ана Петрова',
      phone: E164.of('+359888000001'),
      email: Email.of('ana@example.com'),
      searchName: 'ана петрова',
      searchPrefixes: ['ан', 'ана'],
      createdAtUtcMs: utcMs('2026-09-01T09:00:00+03:00'),
      customerOrigin: CustomerOrigin.FirstBooking,
    };
    const ports = memoryCustomerPorts([record]);
    expect(unwrapOk(await ports.loadCustomerForUser(ANA))).toBe(record);
    expect(unwrapOk(await ports.loadCustomerForUser(BOB))).toBeNull();
  });
});

/** An owner edit that keeps every field — override the ones a case changes. */
describe('memoryProfilePorts — an account’s own profile', () => {
  it('observes and loads the entry AS STORED — a provisioned stub included, null only when absent', async () => {
    const stub = provisionedUserFixture();
    const ports = memoryProfilePorts(new Map([[stub.id, stub]]));
    expect(await first(ports.observeProfile(stub.id))).toBe(stub);
    expect(unwrapOk(await ports.loadProfile(stub.id))).toBe(stub);
    expect(unwrapOk(await ports.loadProfile(BOB))).toBeNull();
    expect(await first(ports.observeProfile(BOB))).toBeNull();
  });

  // dead: «writes the five keys the decide answers, IN PLACE» — Phase 4a
  // 4A-3 (2): `ProfilePorts.writeOwnProfile` is gone; every users write is
  // the `updateProfile` callable's (`update-profile.pipeline.spec.ts`).
});

describe('memoryUserSearchPorts — the staff client search', () => {
  it('answers the users whose prefixes contain the query, by searchName, cut at the limit', async () => {
    const zara = registeredUserFixture({
      id: UserId.of('u-zara'),
      searchName: 'zara petrova',
      searchPrefixes: ['z', 'p', 'pe'],
    });
    const anna = registeredUserFixture({
      id: UserId.of('u-anna'),
      searchName: 'anna petrova',
      searchPrefixes: ['a', 'p', 'pe'],
    });
    const stub = provisionedUserFixture({ id: UserId.of('u-stub') });
    const ports = memoryUserSearchPorts([zara, stub, anna]);
    expect(unwrapOk(await ports.searchUsers('pe', 20))).toEqual([anna, zara]);
    expect(unwrapOk(await ports.searchUsers('pe', 1))).toEqual([anna]);
    expect(unwrapOk(await ports.searchUsers('x', 20))).toEqual([]);
  });
});

describe('memoryCustomerSearchPorts — the staff client search over the records', () => {
  const record = (
    id: string,
    searchName: string,
    searchPrefixes: readonly string[],
  ): Customer => ({
    id: CustomerId.of(id),
    userId: null,
    displayName: searchName,
    phone: null,
    email: null,
    searchName,
    searchPrefixes,
    createdAtUtcMs: utcMs('2026-09-01T09:00:00+03:00'),
    customerOrigin: CustomerOrigin.StaffWalkIn,
  });

  it('answers the records whose prefixes contain the query, by searchName then id, cut at the limit', async () => {
    const zara = record('cus_zara', 'zara petrova', ['z', 'p', 'pe']);
    const anna = record('cus_anna', 'anna petrova', ['a', 'p', 'pe']);
    const twin = record('cus_anna_2', 'anna petrova', ['a', 'p', 'pe']);
    const other = record('cus_ivan', 'ivan ivanov', ['i', 'iv']);
    const ports = memoryCustomerSearchPorts([zara, twin, other, anna]);
    expect(unwrapOk(await ports.searchCustomers('pe', 20))).toEqual([
      anna,
      twin,
      zara,
    ]);
    expect(unwrapOk(await ports.searchCustomers('pe', 1))).toEqual([anna]);
    expect(unwrapOk(await ports.searchCustomers('x', 20))).toEqual([]);
  });
});

describe('memoryIdentityWorld — the one state the identity doubles share', () => {
  const PHONE = ParsedIdentifier.phone(E164.of('+359888123456'));
  const EMAIL = ParsedIdentifier.email(Email.of('maria@example.com'));

  it('loads open challenges by destination, unconsumed and recent, oldest first; saves a Set', async () => {
    const recent = otpFixture({ id: OtpId.of('otp-2') });
    const older = otpFixture({
      id: OtpId.of('otp-1'),
      createdAtUtcMs: utcMs('2026-09-28T05:59:30Z'),
    });
    const consumed = otpFixture({
      id: OtpId.of('otp-3'),
      consumedAtUtcMs: recent.createdAtUtcMs,
    });
    const stale = otpFixture({
      id: OtpId.of('otp-4'),
      createdAtUtcMs: utcMs('2026-09-28T05:00:00Z'),
    });
    const world = memoryIdentityWorld({
      otps: [recent, older, consumed, stale],
    });
    const ports = memoryOtpStorePorts(world);
    expect(
      unwrapOk(
        await ports.loadOpenOtps(
          recent.destination,
          utcMs('2026-09-28T05:59:00Z'),
        ),
      ),
    ).toEqual([older, recent]);
    // dead: the `loadOtp` reads — Phase 4a 4A-14 (no caller; the member is gone).
    expect(world.store.get(`otps/${consumed.id}`)).toMatchObject({
      consumedAtUtcMs: recent.createdAtUtcMs,
    });

    const saved = otpFixture({ id: OtpId.of('otp-9'), attemptCount: 1 });
    expect(await ports.saveOtp(saved)).toEqual({ ok: true, value: undefined });
    // The SAME table a transaction reads — the body, no id.
    expect(world.store.get(`otps/${saved.id}`)).toMatchObject({
      attemptCount: 1,
      destination: saved.destination,
    });
    expect(world.store.get(`otps/${saved.id}`)).not.toHaveProperty('id');
  });

  it('finds the account by the destination’s own field, a stub included — and sees a stub a transaction created', async () => {
    const maria = registeredUserFixture({
      email: Email.of('maria@example.com'),
    });
    const world = memoryIdentityWorld({ users: [maria] });
    const lookup = memoryUserLookupPorts(world);
    expect(unwrapOk(await lookup.findUserByDestination(PHONE))).toEqual(maria);
    expect(unwrapOk(await lookup.findUserByDestination(EMAIL))).toEqual(maria);
    expect(
      unwrapOk(
        await lookup.findUserByDestination(
          ParsedIdentifier.phone(E164.of('+359888000000')),
        ),
      ),
    ).toBeNull();

    const other = ParsedIdentifier.phone(E164.of('+359888999999'));
    const stub = provisionedUserFixture({
      id: UserId.of('u-new'),
      phone: E164.of('+359888999999'),
    });
    const { id, ...stubBody } = stub;
    expect(
      applyWrites(world.store, [
        WriteOp.create([Collections.Users, id], stubBody),
      ]).ok,
    ).toBe(true);
    expect(unwrapOk(await lookup.findUserByDestination(other))).toEqual(stub);
  });

  it('provisions an Auth user once per destination — the second answers null and the lookup finds the first', async () => {
    const world = memoryIdentityWorld();
    const admin = memoryAuthAdminPorts(world);
    const authLookup = memoryAuthUserLookupPorts(world);
    expect(
      unwrapOk(await authLookup.findAuthUserByDestination(PHONE)),
    ).toBeNull();
    const uid = unwrapOk(await admin.provisionAuthUser(PHONE));
    expect(uid).toBe('auth-uid-1');
    expect(unwrapOk(await admin.provisionAuthUser(PHONE))).toBeNull();
    expect(unwrapOk(await authLookup.findAuthUserByDestination(PHONE))).toBe(
      uid,
    );
    expect(unwrapOk(await admin.provisionAuthUser(EMAIL))).toBe('auth-uid-2');
  });

  it('an orphan Auth user seeded without a users document blocks the provision', async () => {
    const orphan = UserId.of('u-orphan');
    const world = memoryIdentityWorld({
      authUsers: [{ uid: orphan, destination: PHONE }],
    });
    expect(
      unwrapOk(await memoryAuthAdminPorts(world).provisionAuthUser(PHONE)),
    ).toBeNull();
    expect(
      unwrapOk(
        await memoryAuthUserLookupPorts(world).findAuthUserByDestination(PHONE),
      ),
    ).toBe(orphan);
  });

  it('records minted claims and display names', async () => {
    const world = memoryIdentityWorld();
    const admin = memoryAuthAdminPorts(world);
    const claims = AuthClaims.onboarding(FIXTURE_TENANT_ID);
    expect(unwrapOk(await admin.mintCustomToken(ANA, claims))).toBe(
      'token:ana:1',
    );
    await admin.setDisplayName(ANA, 'Ана Петрова');
    expect(world.minted).toEqual([{ uid: ANA, claims, token: 'token:ana:1' }]);
    expect(world.displayNames.get(ANA)).toBe('Ана Петрова');
  });
});

describe('the pinned OTP side channels', () => {
  it('records every delivery; a failing sender answers PIPELINE_UNAVAILABLE', async () => {
    const PHONE = ParsedIdentifier.phone(E164.of('+359888123456'));
    const ok = recordingOtpDeliveryPorts();
    expect(await ok.ports.sendOtp(PHONE, '123456')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(ok.sent).toEqual([{ destination: PHONE, code: '123456' }]);
    const failing = recordingOtpDeliveryPorts({ failing: true });
    const answer = await failing.ports.sendOtp(PHONE, '654321');
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.errorCode).toBe('PIPELINE_UNAVAILABLE');
    expect(failing.sent).toHaveLength(1);
  });

  it('draws the fixed code and salt, and matches otpFixture’s hash with the fixed code only', () => {
    const { otpCrypto } = fixedOtpCryptoPorts();
    expect(otpCrypto.nextCode()).toBe(FIXTURE_OTP_CODE);
    expect(otpCrypto.nextSalt()).toBe(FIXTURE_OTP_SALT);
    const otp = otpFixture();
    expect(otpCrypto.hashCode(FIXTURE_OTP_CODE, otp.salt)).toBe(otp.codeHash);
    expect(
      otpCrypto.codeMatches(FIXTURE_OTP_CODE, otp.salt, otp.codeHash),
    ).toBe(true);
    expect(otpCrypto.codeMatches('000000', otp.salt, otp.codeHash)).toBe(false);
    expect(fixedOtpCryptoPorts('999999').otpCrypto.nextCode()).toBe('999999');
  });

  it('answers the fixture tenant, or the one given', async () => {
    expect(unwrapOk(await fixedTenantPorts().loadTenant())).toBe(
      FIXTURE_TENANT_ID,
    );
    const other = TenantId.of('other-shop');
    expect(unwrapOk(await fixedTenantPorts(other).loadTenant())).toBe(other);
  });
});

describe('memoryLoyaltyAccountReadPorts — keyed by the client record (D29)', () => {
  const { georgi, martin } = loyaltyAccountFixtures;

  it('reads a record’s account and its whole progress, as stored', async () => {
    const ports = memoryLoyaltyAccountReadPorts(
      memoryLoyaltyWorld([georgi, martin]),
    );
    expect(unwrapOk(await ports.loadLoyaltyAccount(georgi.customerId))).toBe(
      georgi.account,
    );
    expect(unwrapOk(await ports.listBadgeProgress(martin.customerId))).toBe(
      martin.badgeProgress,
    );
    expect(unwrapOk(await ports.listSeasonProgress(georgi.customerId))).toBe(
      georgi.seasonProgress,
    );
  });

  it('answers no account and no progress for a record without loyalty', async () => {
    const ports = memoryLoyaltyAccountReadPorts(memoryLoyaltyWorld([georgi]));
    expect(unwrapOk(await ports.loadLoyaltyAccount(ANA_RECORD))).toBeNull();
    expect(unwrapOk(await ports.listBadgeProgress(ANA_RECORD))).toEqual([]);
    expect(unwrapOk(await ports.listSeasonProgress(ANA_RECORD))).toEqual([]);
  });

  it('records each call, in order, by the record it asked for', async () => {
    const world = memoryLoyaltyWorld([georgi]);
    const ports = memoryLoyaltyAccountReadPorts(world);
    await ports.loadLoyaltyAccount(georgi.customerId);
    await ports.listSeasonProgress(BOB_RECORD);
    expect(world.calls).toEqual([
      { port: 'loadLoyaltyAccount', customerId: georgi.customerId },
      { port: 'listSeasonProgress', customerId: BOB_RECORD },
    ]);
  });

  it('reads the world by reference: an account set later is read at the next call', async () => {
    const world = memoryLoyaltyWorld();
    const ports = memoryLoyaltyAccountReadPorts(world);
    expect(unwrapOk(await ports.loadLoyaltyAccount(martin.customerId))).toBe(
      null,
    );
    world.accounts.set(martin.customerId, martin.account);
    expect(unwrapOk(await ports.loadLoyaltyAccount(martin.customerId))).toBe(
      martin.account,
    );
  });
});

describe('memoryLoyaltyCatalogReadPorts — the published catalogue', () => {
  it('answers the dev shop’s catalogue under the system’s part names', async () => {
    const catalog = unwrapOk(
      await memoryLoyaltyCatalogReadPorts().loadLoyaltyCatalog(),
    );
    expect(catalog).toBe(loyaltyCatalogFixture());
    expect(Object.keys(catalog)).toEqual([
      'categories',
      'series',
      'seasons',
      'tiers',
      'rewards',
      'streaks',
    ]);
  });

  it('answers the catalogue it is given, or fails as unavailable', async () => {
    const empty = {
      categories: [],
      series: [],
      seasons: [],
      tiers: [],
      rewards: [],
      streaks: [],
    };
    expect(
      unwrapOk(await memoryLoyaltyCatalogReadPorts(empty).loadLoyaltyCatalog()),
    ).toBe(empty);
    expect(
      await memoryLoyaltyCatalogReadPorts(undefined, {
        failing: true,
      }).loadLoyaltyCatalog(),
    ).toEqual({ ok: false, error: RepositoryError.unavailable() });
  });
});

describe('memoryClientJournalPorts — the feed and ledger query', () => {
  const { georgi, martin } = loyaltyAccountFixtures;
  const POINTS = JournalFeed.effectsOf(JournalFeed.Points);
  const ALL = JournalFeed.effectsOf(JournalFeed.All);
  const newest = georgi.clientJournal.at(-1) as JournalEntry;
  /** A staff-only row and a tier row on Георги's journal, past his last seq. */
  const staffOnly: JournalEntry = {
    ...newest,
    seq: newest.seq + 1,
    journalVisibility: JournalVisibility.Staff,
  };
  const tierRow: JournalEntry = {
    ...newest,
    seq: newest.seq + 2,
    journalEffect: JournalEffect.Tier,
    tierOp: TierOp.Changed,
    tierFrom: TierId.of('silver'),
    tierTo: TierId.of('gold'),
    tierUntil: null,
  };
  const rows = [
    ...martin.clientJournal,
    ...georgi.clientJournal,
    staffOnly,
    tierRow,
  ];

  it('reads one record’s client-visible rows of the pill’s effects, newest first', async () => {
    const page = unwrapOk(
      await memoryClientJournalPorts(rows).pageClientJournal(
        georgi.customerId,
        POINTS,
        null,
        100,
      ),
    );
    expect(page.entries.map((entry) => entry.seq)).toEqual(
      georgi.clientJournal.map((entry) => entry.seq).reverse(),
    );
    expect(page.nextBeforeSeq).toBeNull();
    const all = unwrapOk(
      await memoryClientJournalPorts(rows).pageClientJournal(
        georgi.customerId,
        ALL,
        null,
        1,
      ),
    );
    // The tier row is «Всички»'s; the staff row is nobody's feed.
    expect(all.entries).toEqual([tierRow]);
  });

  it('pages by seq: the page’s oldest seq is the cursor while anything older is left', async () => {
    const ports = memoryClientJournalPorts(rows);
    const first = unwrapOk(
      await ports.pageClientJournal(georgi.customerId, POINTS, null, 30),
    );
    expect(first.entries).toHaveLength(30);
    expect(first.entries[0]?.seq).toBe(35);
    expect(first.nextBeforeSeq).toBe(6);
    const second = unwrapOk(
      await ports.pageClientJournal(
        georgi.customerId,
        POINTS,
        first.nextBeforeSeq,
        30,
      ),
    );
    expect(second.entries.map((entry) => entry.seq)).toEqual([5, 4, 3, 2, 1]);
    expect(second.nextBeforeSeq).toBeNull();
  });

  it('reads a page of at least one row, and nothing for a pill with no rows', async () => {
    const ports = memoryClientJournalPorts(rows);
    const one = unwrapOk(
      await ports.pageClientJournal(martin.customerId, POINTS, null, 0),
    );
    expect(one.entries.map((entry) => entry.seq)).toEqual([18]);
    expect(one.nextBeforeSeq).toBe(18);
    const status = unwrapOk(
      await ports.pageClientJournal(
        martin.customerId,
        JournalFeed.effectsOf(JournalFeed.Status),
        null,
        12,
      ),
    );
    expect(status).toEqual({ entries: [], nextBeforeSeq: null });
  });
});

describe('memoryStreakWorld — the one state the rhythm doubles share', () => {
  const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
  const row = partial<AuditEntry>({ id: AuditEntryId.of('row-1') });

  it('seeds the head, its versions and the audit rows at their flat paths, minus their ids', () => {
    const world = memoryStreakWorld({
      heads: [streakDefinitionFixture()],
      versions: [
        { streakId: CADENCE, version: streakDefinitionVersionFixture() },
      ],
      audit: [row],
    });
    expect([...world.store.keys()]).toEqual([
      `${Collections.StreakDefinitions}/cadence`,
      `${Collections.StreakDefinitions}/cadence/${Subcollections.Versions}/000001`,
      `${Collections.AuditLog}/row-1`,
    ]);
    const head = world.store.get('streakDefinitions/cadence');
    const version = world.store.get(
      'streakDefinitions/cadence/versions/000001',
    );
    // The body is the entity minus `id` (`toEqual` reads `id: undefined` as absent).
    expect(head).toEqual({ ...streakDefinitionFixture(), id: undefined });
    expect(version).toEqual({
      ...streakDefinitionVersionFixture(),
      id: undefined,
    });
    expect(head !== undefined && 'id' in head).toBe(false);
    expect(version !== undefined && 'id' in version).toBe(false);
    expect(memoryStreakWorld().store.size).toBe(0);
  });

  it('streams the head live: at subscription, and again on every changed()', () => {
    const world = memoryStreakWorld({ heads: [streakDefinitionFixture()] });
    const seen: unknown[] = [];
    const subscription = memoryStreakDefinitionPorts(world)
      .observeStreakDefinitionHead(CADENCE)
      .subscribe((result) => seen.push(result.ok ? result.value : result));
    expect(seen).toEqual([streakDefinitionFixture()]);
    world.store.delete('streakDefinitions/cadence');
    expect(seen).toHaveLength(1);
    world.changed();
    expect(seen).toEqual([streakDefinitionFixture(), null]);
    subscription.unsubscribe();
  });

  it('lists the newest versions first, at least one', async () => {
    const second = streakDefinitionVersionFixture({
      id: StreakDefinitionVersionId.forVersion(2),
      version: 2,
    });
    const world = memoryStreakWorld({
      versions: [
        { streakId: CADENCE, version: streakDefinitionVersionFixture() },
        { streakId: CADENCE, version: second },
        {
          streakId: StreakDefinitionId.of('other'),
          version: streakDefinitionVersionFixture(),
        },
      ],
    });
    const ports = memoryStreakDefinitionPorts(world);
    const both = unwrapOk(await ports.listStreakDefinitionVersions(CADENCE, 5));
    expect(both.map((version) => version.id)).toEqual(['000002', '000001']);
    const one = unwrapOk(await ports.listStreakDefinitionVersions(CADENCE, 0));
    expect(one).toEqual([second]);
  });
});

describe('memoryClockPorts / memoryIdPorts — the pinned clock and id source', () => {
  it('answers the fixture instant, or the one given, on every read', () => {
    const clock = memoryClockPorts();
    expect(clock.nowUtcMs()).toBe(FIXTURE_NOW_UTC_MS);
    expect(clock.nowUtcMs()).toBe(FIXTURE_NOW_UTC_MS);
    const later = utcMs('2026-12-01T10:00:00.000+02:00');
    expect(memoryClockPorts(later).nowUtcMs()).toBe(later);
  });

  it('issues prefix-1, prefix-2, … in call order', () => {
    const ids = memoryIdPorts('evt');
    expect([ids.nextId(), ids.nextId()]).toEqual(['evt-1', 'evt-2']);
    expect(memoryIdPorts().nextId()).toBe('id-1');
  });
});

describe('memoryProgramsWorld — the one state the programs doubles share', () => {
  it('orders roles by sortOrder, ties by id ascending; filters on positionStatus or answers all', async () => {
    const world = memoryProgramsWorld({
      positions: [
        positionOf('pos-b', { sortOrder: 1 }),
        positionOf('pos-c', {
          sortOrder: 0,
          positionStatus: PositionStatus.Closed,
        }),
        positionOf('pos-a', { sortOrder: 1 }),
      ],
    });
    const ports = memoryPositionReadPorts(world);
    const ids = (rows: readonly { readonly id: string }[]) =>
      rows.map((row) => row.id);

    expect(ids(await first(ports.observePositions(null)))).toEqual([
      'pos-c',
      'pos-a',
      'pos-b',
    ]);
    expect(
      ids(await first(ports.observePositions(PositionStatus.Open))),
    ).toEqual(['pos-a', 'pos-b']);
  });

  it('orders courses by sortOrder; filters on enrollmentStatus membership or answers all', async () => {
    const world = memoryProgramsWorld({
      courses: [
        courseOf('c-closed', { enrollmentStatus: EnrollmentStatus.Closed }),
        courseOf('c-up', {
          enrollmentStatus: EnrollmentStatus.Upcoming,
          sortOrder: 2,
        }),
        courseOf('c-open', { sortOrder: 1 }),
      ],
    });
    const ports = memoryCourseReadPorts(world);

    expect(
      (
        await first(
          ports.observeCourses([
            EnrollmentStatus.Open,
            EnrollmentStatus.Upcoming,
          ]),
        )
      ).map((row) => row.id),
    ).toEqual(['c-open', 'c-up']);
    expect(
      (await first(ports.observeCourses(null))).map((row) => row.id),
    ).toEqual(['c-closed', 'c-open', 'c-up']);
  });

  it('splits events on the instant: upcoming >= now ascending, past < now descending', async () => {
    const now = FIXTURE_NOW_UTC_MS;
    const world = memoryProgramsWorld({
      events: [
        shopEventOf('e-later', {
          utcEpochMs: UtcEpochMs.plusMs(now, 7_200_000),
        }),
        shopEventOf('e-now', { utcEpochMs: now }),
        shopEventOf('e-old', {
          utcEpochMs: UtcEpochMs.plusMs(now, -7_200_000),
        }),
        shopEventOf('e-older', {
          utcEpochMs: UtcEpochMs.plusMs(now, -14_400_000),
        }),
      ],
    });
    const ports = memoryShopEventReadPorts(world);

    expect(
      (await first(ports.observeEvents({ nowUtcMs: now, upcoming: true }))).map(
        (row) => row.id,
      ),
    ).toEqual(['e-now', 'e-later']);
    expect(
      (
        await first(ports.observeEvents({ nowUtcMs: now, upcoming: false }))
      ).map((row) => row.id),
    ).toEqual(['e-old', 'e-older']);
  });

  it('breaks a tie on the instant by id — ascending upcoming, DESCENDING past (Firestore’s __name__ rule)', async () => {
    const now = FIXTURE_NOW_UTC_MS;
    const past = UtcEpochMs.plusMs(now, -60_000);
    const soon = UtcEpochMs.plusMs(now, 60_000);
    const world = memoryProgramsWorld({
      events: [
        shopEventOf('e-a', { utcEpochMs: past }),
        shopEventOf('e-b', { utcEpochMs: past }),
        shopEventOf('u-b', { utcEpochMs: soon }),
        shopEventOf('u-a', { utcEpochMs: soon }),
      ],
    });
    const ports = memoryShopEventReadPorts(world);

    expect(
      (
        await first(ports.observeEvents({ nowUtcMs: now, upcoming: false }))
      ).map((row) => row.id),
    ).toEqual(['e-b', 'e-a']);
    expect(
      (await first(ports.observeEvents({ nowUtcMs: now, upcoming: true }))).map(
        (row) => row.id,
      ),
    ).toEqual(['u-a', 'u-b']);
  });

  it('caps the past at the latest 24 — on a tie at the cap, keeping the document Firestore keeps', async () => {
    const now = FIXTURE_NOW_UTC_MS;
    const tied = UtcEpochMs.plusMs(now, -24 * 3_600_000);
    const events: ReturnType<typeof shopEventOf>[] = [];
    for (let hour = 1; hour <= 23; hour++) {
      events.push(
        shopEventOf(`p-${String(hour).padStart(2, '0')}`, {
          utcEpochMs: UtcEpochMs.plusMs(now, -hour * 3_600_000),
        }),
      );
    }
    events.push(shopEventOf('p-tie-a', { utcEpochMs: tied }));
    events.push(shopEventOf('p-tie-b', { utcEpochMs: tied }));
    const ports = memoryShopEventReadPorts(memoryProgramsWorld({ events }));

    const rows = await first(
      ports.observeEvents({ nowUtcMs: now, upcoming: false }),
    );

    expect(rows).toHaveLength(24);
    expect(rows[0]?.id).toBe('p-01');
    expect(rows[22]?.id).toBe('p-23');
    expect(rows[23]?.id).toBe('p-tie-b');
    expect(rows.some((row) => row.id === 'p-tie-a')).toBe(false);
  });

  it('loads by id (null when absent) and saves a full replace, seen by the next read', async () => {
    const world = memoryProgramsWorld();
    const positions = memoryPositionWritePorts(world);
    const courses = memoryCourseWritePorts(world);
    const events = memoryShopEventWritePorts(world);

    expect(
      unwrapOk(await positions.loadPosition(PositionId.of('p'))),
    ).toBeNull();
    expect(unwrapOk(await courses.loadCourse(CourseId.of('c')))).toBeNull();
    expect(unwrapOk(await events.loadEvent(EventId.of('e')))).toBeNull();

    unwrapOk(await positions.savePosition(positionOf('p', { sortOrder: 3 })));
    unwrapOk(await positions.savePosition(positionOf('p')));
    unwrapOk(await courses.saveCourse(courseOf('c')));
    unwrapOk(await events.saveEvent(shopEventOf('e')));

    expect(unwrapOk(await positions.loadPosition(PositionId.of('p')))).toEqual(
      positionOf('p'),
    );
    expect(unwrapOk(await courses.loadCourse(CourseId.of('c')))).toEqual(
      courseOf('c'),
    );
    expect(unwrapOk(await events.loadEvent(EventId.of('e')))).toEqual(
      shopEventOf('e'),
    );
    expect(
      await first(memoryPositionReadPorts(world).observePositions(null)),
    ).toEqual([positionOf('p')]);
  });

  it('binds the admin suite over the one world — every member of the six bundles', () => {
    expect(
      Object.keys(memoryProgramsPorts(memoryProgramsWorld())).sort(),
    ).toEqual([
      'loadCourse',
      'loadEvent',
      'loadPosition',
      'observeCourses',
      'observeEvents',
      'observePositions',
      'saveCourse',
      'saveEvent',
      'savePosition',
    ]);
  });

  it('loads a shop of the world by id, null when absent; the default shop is TenantConfig’s unless given', async () => {
    const ports = memoryLocationLoadPorts(
      memoryProgramsWorld({ locations: [locationFixture()] }),
    );
    expect(unwrapOk(await ports.loadLocation(FIXTURE_IDS.location))).toEqual(
      locationFixture(),
    );
    expect(
      unwrapOk(await ports.loadLocation(LocationId.of('loc-nowhere'))),
    ).toBeNull();

    expect(memoryDefaultLocationPorts().defaultLocationId).toBe(
      TenantConfig.DEFAULT.defaultLocationId,
    );
    expect(
      memoryDefaultLocationPorts(LocationId.of('loc-north')).defaultLocationId,
    ).toBe('loc-north');
  });
});

// ── The web's wiring (Phase 4a §3.7) ─────────────────────────────────────

describe('memoryAuthSessionPorts — the session over a scripted principal', () => {
  it('replays the current principal and every later one; an ok sign-out drops to anonymous', async () => {
    const principals$ = new BehaviorSubject<Principal>(
      principalFixture.client(),
    );
    const ports = memoryAuthSessionPorts({ principals$ });
    const seen: Principal[] = [];
    const subscription = ports.observePrincipal().subscribe((principal) => {
      seen.push(principal);
    });
    principals$.next(principalFixture.staff(UserId.of('u-staff')));
    expect(await ports.signOut()).toEqual({ ok: true, value: undefined });
    subscription.unsubscribe();
    expect(seen.map((principal) => principal.principalKind)).toEqual([
      'CLIENT',
      'STAFF',
      'ANONYMOUS',
    ]);
    expect(await ports.refreshToken()).toEqual({ ok: true, value: undefined });
    expect(ports.currentIdentifier()).toBeNull();
    expect(ports.currentDisplayName()).toBeNull();
  });

  it('answers the scripted refresh and sign-out failures', async () => {
    const failed = PipelineError.bare(PipelineErrorCode.Unavailable);
    const ports = memoryAuthSessionPorts({
      refresh: () => R.err(failed),
      signOut: () => R.err(failed),
    });
    expect(await ports.refreshToken()).toEqual(R.err(failed));
    expect(await ports.signOut()).toEqual(R.err(failed));
    expect(await firstValueFrom(ports.observePrincipal())).toEqual(
      principalFixture.anonymous(),
    );
  });
});

describe('memoryOtpChallengePorts — the three OTP callables, scripted', () => {
  it('records every call and answers the script (otp-1, RETURNING, ok by default)', async () => {
    const calls: OtpChallengeCall[] = [];
    const ports = memoryOtpChallengePorts({ calls });
    const phone = ParsedIdentifier.phone(E164.of('+359888123456'));
    expect(await ports.requestOtpChallenge(phone)).toEqual(
      R.ok(OtpId.of('otp-1')),
    );
    expect(
      await ports.verifyOtpChallenge(OtpId.of('otp-1'), OtpCode.of('123456')),
    ).toEqual(R.ok(SessionKind.Returning));
    expect(calls.map((call) => call.otpCall)).toEqual(['REQUEST', 'VERIFY']);
  });
});

describe('scriptedGatewayPorts — the typed callable client', () => {
  it('answers the script by name and records every call; an unscripted one is PIPELINE_UNKNOWN', async () => {
    const calls: GatewayCall[] = [];
    const ports = scriptedGatewayPorts(
      {
        [Callables.CancelWaitlist]: (input) =>
          R.ok({ requestId: input.requestId }),
      },
      calls,
    );
    const requestId = WaitlistRequestId.of('wl_1');
    expect(
      await ports.callableClient(Callables.CancelWaitlist)({ requestId }),
    ).toEqual(R.ok({ requestId }));
    expect(
      await ports.callableClient(Callables.RedeemInvitation)({
        invitationId: InvitationId.of('inv-1'),
      }),
    ).toEqual(R.err(PipelineError.bare(PipelineErrorCode.Unknown)));
    expect(calls.map((call) => call.callable)).toEqual([
      'cancelWaitlist',
      'redeemInvitation',
    ]);
  });
});

describe('memoryAvatarPorts and memoryMediaResolvePorts — Storage', () => {
  it('replaces, finds and removes the one avatar of an account', async () => {
    const ports = memoryAvatarPorts();
    const uid = UserId.of('u-1');
    const blob = { type: 'image/jpeg', size: 1 } as unknown as Blob;
    const stored = unwrapOk(await ports.uploadAvatar(uid, blob));
    expect(stored.path).toBe('avatars/u-1/original');
    expect(unwrapOk(await ports.findAvatar(uid))).toEqual(stored);
    await ports.removeAvatar(uid);
    expect(unwrapOk(await ports.findAvatar(uid))).toBeNull();
  });

  it('answers one rendition per ref, or the scripted failure of its path', async () => {
    const ports = memoryMediaResolvePorts({
      forbidden: ['f.jpg'],
      notFound: ['n.jpg'],
      transient: ['t.jpg'],
    });
    const ref = (mediaPath: string) => ({
      mediaId: MediaRefId.of('m-1'),
      mediaPath,
      mediaWidth: 640,
      mediaHeight: 480,
      mediaBlurhash: null,
      mediaFocalX: null,
      mediaFocalY: null,
    });
    expect(unwrapOk(await ports.resolveMedia(ref('ok.jpg')))).toEqual([
      { width: 640, url: 'https://media.test/ok.jpg' },
    ]);
    expect(unwrapErr(await ports.resolveMedia(ref('f.jpg'))).errorCode).toBe(
      'MEDIA_FORBIDDEN',
    );
    expect(unwrapErr(await ports.resolveMedia(ref('n.jpg'))).errorCode).toBe(
      'MEDIA_NOT_FOUND',
    );
    expect(unwrapErr(await ports.resolveMedia(ref('t.jpg'))).errorCode).toBe(
      'MEDIA_TRANSIENT',
    );
  });
});

describe('memoryFlagsPorts and immediateTimerPorts', () => {
  it('turns on exactly the named flags', () => {
    const ports = memoryFlagsPorts([FeatureFlags.NAMES[0] as FlagName]);
    expect(ports.flagOn(FeatureFlags.NAMES[0] as FlagName)).toBe(true);
    for (const flag of FeatureFlags.NAMES.slice(1)) {
      expect(ports.flagOn(flag)).toBe(false);
    }
    expect(memoryFlagsPorts().flagOn(FeatureFlags.NAMES[0] as FlagName)).toBe(
      false,
    );
  });

  it('waits for nothing and records each delay', async () => {
    const delays: number[] = [];
    const ports = immediateTimerPorts(delays);
    await ports.delay(250);
    await ports.delay(0);
    expect(delays).toEqual([250, 0]);
  });
});

describe('scriptedVisitEditWritePorts — the visit sheet’s three writes', () => {
  const intent = {
    appointmentId: FIXTURE_IDS.appointment,
    commands: [],
    acknowledgedOverlap: false,
    expectedVersion: 3,
  };
  const tip = {
    appointmentId: FIXTURE_IDS.appointment,
    seatId: FIXTURE_IDS.seat,
    amountCents: null,
  };

  it('records every write in the order it was made, each landing unless the script says otherwise', async () => {
    const calls: VisitEditWriteCall[] = [];
    const ports = scriptedVisitEditWritePorts({ calls });
    expect(await ports.sendStaffEdit(intent)).toBe(true);
    expect(
      await ports.saveTeamNoteText(FIXTURE_IDS.appointment, 'Бележка'),
    ).toBe(true);
    expect(await ports.sendSeatTip(tip)).toBe(true);
    expect(calls).toEqual([
      { port: 'sendStaffEdit', intent },
      {
        port: 'saveTeamNoteText',
        appointmentId: FIXTURE_IDS.appointment,
        text: 'Бележка',
      },
      { port: 'sendSeatTip', request: tip },
    ]);
  });

  it('answers each write as scripted', async () => {
    const ports = scriptedVisitEditWritePorts({
      staffEdit: false,
      teamNote: false,
      seatTip: false,
    });
    expect(await ports.sendStaffEdit(intent)).toBe(false);
    expect(await ports.saveTeamNoteText(FIXTURE_IDS.appointment, null)).toBe(
      false,
    );
    expect(await ports.sendSeatTip(tip)).toBe(false);
  });
});

describe('recordingClientIssuePorts — the client issue sink', () => {
  const issue = (clientIssueKind: ClientIssueKind): ClientIssue => ({
    clientIssueKind,
    errorName: null,
    documentPath: null,
    fieldName: null,
    routePattern: '/staff/schedule',
    topFrame: null,
    scrubbedMessage: null,
    release: null,
    occurrences: 1,
  });

  it('records every issue handed over, batch after batch, in order', () => {
    const { ports, reported } = recordingClientIssuePorts();
    const dropped = issue(ClientIssueKind.DataDocumentDropped);
    const csp = issue(ClientIssueKind.CspViolation);
    const uncaught = issue(ClientIssueKind.UncaughtError);
    ports.reportClientIssues([dropped, csp]);
    ports.reportClientIssues([]);
    ports.reportClientIssues([uncaught]);
    expect(reported).toEqual([dropped, csp, uncaught]);
  });
});
