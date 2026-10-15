import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  BarberStatus,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
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
} from '@core/components';
import {
  AppointmentId,
  AppointmentPhotoId,
  BarberId,
  BusyKey,
  CapacityMonthId,
  ClientMoneyStatsId,
  Currency,
  CouponGrantId,
  CouponId,
  CustomerId,
  GiftVoucherId,
  GrantStatus,
  LocationId,
  NotificationId,
  PriceCents,
  type Result,
  ScheduleExceptionId,
  ServiceCategoryId,
  ServiceId,
  UserId,
  UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import type {
  Appointment,
  AppointmentPhoto,
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
  WaitlistRequest,
} from '@core/entities';
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
  FIXTURE_IDS,
  FIXTURE_TODAY,
  customerOf,
  minute,
  textFixture,
  unwrapOk,
  utcMs,
} from './test-support';
import {
  memoryAppointmentNotePorts,
  memoryAppointmentPhotoPorts,
  memoryAppointmentReadPorts,
  memoryCatalogReadPorts,
  memoryClientStatsReadPorts,
  memoryCouponVoucherPorts,
  memoryCustomerPorts,
  memoryInboxPorts,
  memoryScheduleExceptionPorts,
  memorySchedulingReadPorts,
  memoryWaitlistReadPorts,
} from './port-doubles';

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
    expect(await first(ports.observeBarberDay(KEY))).toEqual([base, cancelled]);
    expect(await first(ports.observeBarberDay(OTHER_KEY))).toEqual([elsewhere]);
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
  it('lists the active ones by sortOrder, narrowed by category or shop', async () => {
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
    expect((await first(ports.observeServices(null))).map((s) => s.id)).toEqual(
      ['svc-kid', 'svc-shave', 'svc-classic-cut'],
    );
    expect(
      (await first(ports.observeServices(FIXTURE_IDS.category))).map(
        (s) => s.id,
      ),
    ).toEqual(['svc-shave', 'svc-classic-cut']);
    expect((await first(ports.observeBarbers(null))).map((b) => b.id)).toEqual([
      'b-petar',
      'b-ivan',
    ]);
    expect(
      (await first(ports.observeBarbers(LocationId.of('loc-other')))).map(
        (b) => b.id,
      ),
    ).toEqual(['b-petar']);
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

  it('loads coupons by id WHATEVER their status — a held grant keeps its retired coupon', async () => {
    expect(
      unwrapOk(await ports.loadCoupons([closed.id, CouponId.of('gone')])),
    ).toEqual([closed]);
  });

  it('reads a grant by id, and a client record’s ACTIVE grants only', async () => {
    expect(unwrapOk(await ports.loadCouponGrant(held.id))).toBe(held);
    expect(
      unwrapOk(await ports.loadCouponGrant(CouponGrantId.of('none'))),
    ).toBeNull();
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

  it('stamps one read, then every unread one — a stamped one keeps its stamp', async () => {
    const inboxes = new Map([
      [ANA, [notification('a', 1), notification('b', 2)]],
    ]);
    const ports = memoryInboxPorts(inboxes);
    await ports.markNotificationRead(ANA, NotificationId.of('a'), READ_AT);
    expect(inboxes.get(ANA)?.map((entry) => entry.readAtUtcMs)).toEqual([
      READ_AT,
      null,
    ]);
    const LATER = UtcEpochMs.plusMs(READ_AT, 60_000);
    await ports.markAllNotificationsRead(ANA, LATER);
    expect(inboxes.get(ANA)?.map((entry) => entry.readAtUtcMs)).toEqual([
      READ_AT,
      LATER,
    ]);
    await ports.markAllNotificationsRead(BOB, LATER);
    expect(inboxes.get(BOB)).toEqual([]);
  });
});

describe('memoryAppointmentNotePorts — a visit’s note, in place', () => {
  it('saves a note and deletes it with null', async () => {
    const notes = new Map();
    const ports = memoryAppointmentNotePorts(notes);
    const note = {
      id: FIXTURE_IDS.appointment,
      text: 'Без машинка',
      authorUserId: ANA,
      writtenAtUtcMs: utcMs('2026-09-28T09:00:00+03:00'),
    };
    await ports.saveAppointmentNote(FIXTURE_IDS.appointment, note);
    expect(
      await first(ports.observeAppointmentNote(FIXTURE_IDS.appointment)),
    ).toBe(note);
    await ports.saveAppointmentNote(FIXTURE_IDS.appointment, null);
    expect(
      await first(ports.observeAppointmentNote(FIXTURE_IDS.appointment)),
    ).toBeNull();
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
