import { describe, expect, it } from 'vitest';
import { Firestore } from 'firebase-admin/firestore';
import {
  type DomainError,
  type Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { TENANT_ZONE } from '../lib/booking/tenant-zone';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { FixedClock } from '../test-support/fixed-clock';
import {
  type BookingSnapshot,
  type DecideBookingRequest,
  decideBooking,
} from '../use-cases/decide-booking';
import {
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingShopUnavailableError,
} from '../use-cases/commit-booking.errors';
import { CommitBookingUseCase } from '../use-cases/commit-booking.use-case';
import { shopListed } from '../use-cases/party-admission';
import { RescheduleBookingUseCase } from '../use-cases/reschedule-booking.use-case';
import { StaffEditAppointmentUseCase } from '../use-cases/staff-edit-appointment.use-case';
import {
  FirestoreBookingStore,
  isDocumentId,
  toShop,
} from './firestore-booking-store';

/**
 * `FirestoreBookingStore.reschedule` hands the stored visit's own chairs
 * back to the decision (`BookingSnapshot.release`), so its own seats never
 * block where it goes next.
 *
 * The chairs come from the aggregate when it reads the document
 * (`Appointment.chairTimes`), and from the stored seats when it cannot
 * (`persistedChairTimesOf`): a staff edit rebuilds from raw fields and never
 * asks the mapper, so a legacy document the aggregate refuses would
 * otherwise collide with its own chairs.
 */

const ZONE = 'Europe/Sofia';
/** The shop the father's visit is booked at. */
const CENTER_ID = 'loc-center';
const OWNER = 'user-father';
const APPOINTMENT = 'appt-father';
/** 2030-01-15 is a Tuesday. */
const DAY = '2030-01-15';
/** Two days before the father's visit: inside the lead time and the horizon. */
const NOW_ISO = '2030-01-13T08:00:00.000+02:00';

function iso(hour: number, minute = 0): string {
  return `${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+02:00`;
}

/**
 * Ivan works Center 09:00–18:00 with a 15-minute reset. The father's fade
 * (45 minutes + 10 of cleanup) holds his chair 10:00–10:55; somebody else
 * sits 11:10–11:40. `visit` overrides fields of the stored visit.
 */
function seeded(visit: Record<string, unknown> = {}) {
  const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
  return createProjectionFirestore({
    'locations/loc-center': {
      timezone: ZONE,
      status: 'active',
      hours: [
        ...Array.from({ length: 6 }, () => ({
          kind: 'open',
          opens: '09:00',
          closes: '20:00',
        })),
        { kind: 'closed' },
      ],
    },
    'services/svc-fade': {
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 4000,
      currencyCode: 'EUR',
      durationMinutes: 45,
      setupMinutes: 0,
      cleanupMinutes: 10,
      locationIds: ['loc-center'],
      conflictsWith: [],
      variants: [],
      offerings: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    },
    'barberSchedules/ivan': {
      barberId: 'ivan',
      turnaroundMinutes: 15,
      versions: [
        {
          seq: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          weeklyPattern: { monday: day, tuesday: day, wednesday: day },
        },
      ],
    },
    [`barberBusy/ivan__${DAY}`]: {
      barberId: 'ivan',
      dayKey: DAY,
      zone: ZONE,
      busy: [
        { startIso: iso(10), endIso: iso(10, 55), zone: ZONE },
        { startIso: iso(11, 10), endIso: iso(11, 40), zone: ZONE },
      ],
    },
    [`appointments/${APPOINTMENT}`]: {
      locationId: 'loc-center',
      ownerUserId: OWNER,
      subjectUserIds: [OWNER],
      barberIds: ['ivan'],
      busyKeys: [`ivan__${DAY}`],
      timeSlot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
      seats: [
        {
          id: 'seat-father',
          serviceId: 'svc-fade',
          variantId: null,
          barberId: 'ivan',
          barberPref: 'specific',
          terms: {
            priceMinorUnits: 4000,
            currencyCode: 'EUR',
            durationMinutes: 45,
            setupMinutes: 0,
            cleanupMinutes: 10,
          },
          slot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
          subject: { kind: 'account', userId: OWNER, relationship: 'self' },
          outcome: { kind: 'scheduled' },
        },
      ],
      status: { kind: 'confirmed' },
      bookedAt: { iso: '2030-01-01T09:00:00.000+02:00', zone: ZONE },
      bookedFromAppointmentId: null,
      arrivedAt: null,
      contact: null,
      revision: 1,
      ...visit,
    },
  });
}

/** The father's fade, with Ivan, at `hour:minute`. */
function fadeAt(hour: number, minute = 0): DecideBookingRequest {
  return {
    locationId: 'loc-center',
    seats: [
      {
        lineId: 'line-1',
        serviceId: 'svc-fade',
        variantId: null,
        barberId: 'ivan',
        barberPref: 'specific',
        startIso: iso(hour, minute),
        subject: { kind: 'self' },
      },
    ],
  };
}

/** The chair time the decision was handed back, as wall-clock spans. */
async function releaseSeen(
  visit: Record<string, unknown> = {},
): Promise<readonly string[]> {
  const store = new FirestoreBookingStore(
    seeded(visit).db as unknown as Firestore,
  );
  let seen: BookingSnapshot | null = null;
  await store.reschedule(
    APPOINTMENT,
    () => true,
    () => ok(fadeAt(9, 45)),
    (snapshot) => {
      seen = snapshot;
      // Nothing is written: only what the decision was handed matters here.
      return fail(new CommitBookingInvalidInputError('seats'));
    },
  );
  const release = (seen as BookingSnapshot | null)?.release ?? [];
  return release.map((chair) => {
    const from = ZonedDateTime.fromMillis(chair.occupied.startMs, ZONE);
    const to = ZonedDateTime.fromMillis(chair.occupied.endMs, ZONE);
    if (from.isFailure() || to.isFailure()) throw new Error('bad span');
    return `${chair.barberId.value} ${from.value.toISO()}–${to.value.toISO()}`;
  });
}

/** A staff-style rebuild of the visit to `hour:minute`, decided for real. */
async function rebuild(
  visit: Record<string, unknown>,
  hour: number,
  minute = 0,
): Promise<string> {
  const store = new FirestoreBookingStore(
    seeded(visit).db as unknown as Firestore,
  );
  const now = ZonedDateTime.fromISO(NOW_ISO, ZONE);
  if (now.isFailure()) throw new Error('bad fixture');
  let next = 0;
  const outcome = await store.reschedule(
    APPOINTMENT,
    () => true,
    () => ok(fadeAt(hour, minute)),
    (snapshot, _current, request) =>
      decideBooking(request, snapshot, {
        now: now.value,
        policy: BookingPolicy.default(),
        nextId: () => `seat-${next++}`,
        ownerUserId: OWNER,
      }),
  );
  return outcome.isSuccess() ? outcome.value.kind : outcome.error.code;
}

/** A document the aggregate cannot read: no status, as legacy rows have. */
const LEGACY = { status: null };

describe('FirestoreBookingStore.reschedule — the visit’s own chairs, handed back', () => {
  it('hands back the chairs the aggregate reads off a stored visit', async () => {
    expect(await releaseSeen()).toEqual([`ivan ${iso(10)}–${iso(10, 55)}`]);
  });

  it('hands back the same chairs for a visit the aggregate cannot read', async () => {
    expect(await releaseSeen(LEGACY)).toEqual([
      `ivan ${iso(10)}–${iso(10, 55)}`,
    ]);
  });

  it('lets a legacy visit move a quarter of an hour earlier, over its own old chair', async () => {
    // 09:45–10:40 with Ivan: only the visit's own 10:00–10:55 was in the way.
    expect(await rebuild(LEGACY, 9, 45)).toBe('committed');
  });

  it('still keeps the neighbour’s reset for a legacy visit', async () => {
    // 10:30–11:25 runs into the 11:10 neighbour's chair.
    expect(await rebuild(LEGACY, 10, 30)).toBe(
      'booking.commit.slot_unavailable',
    );
  });
});

// ── The shop a booking names ──────────────────────────────────────────────

type Fake = ReturnType<typeof seeded>;

/** Center's document as stored, with `status` set — or taken away. */
async function setShopStatus(
  fake: Fake,
  status: string | undefined,
): Promise<void> {
  const ref = fake.db.collection('locations').doc('loc-center');
  const data: Record<string, unknown> = { ...(await ref.get()).data() };
  delete data['status'];
  await ref.set(status === undefined ? data : { ...data, status });
}

/**
 * The Admin SDK's OWN path check, offline: building a reference validates
 * the id and throws on one that cannot name a document (an empty id, a
 * `/`-separated path), before any network is touched. The in-memory fake
 * does not check paths, so this stand-in asks the real SDK first and then
 * reads and writes through the fake — what production does to such an id,
 * without an emulator.
 */
const sdk = new Firestore({ projectId: 'demo-store-paths' });

function withSdkPaths(fake: Fake): Firestore {
  const collection = (name: string) => ({
    ...fake.db.collection(name),
    doc: (id: string) => {
      sdk.collection(name).doc(id);
      return fake.db.collection(name).doc(id);
    },
  });
  return { ...fake.db, collection } as unknown as Firestore;
}

/**
 * A NEW booking of a fade with Ivan at `hour`, through the production
 * commit: a client's own, or the shop placing its own book.
 */
function book(
  fake: Fake,
  hour: number,
  options: {
    readonly locationId?: string;
    readonly staffPlacement?: boolean;
    readonly attemptId?: string;
  } = {},
): Promise<Result<{ appointmentId: string }, CommitBookingError>> {
  let next = 0;
  return new CommitBookingUseCase(
    new FirestoreBookingStore(withSdkPaths(fake)),
    new FixedClock(NOW_ISO),
    { next: () => `id-${next++}` },
    BookingPolicy.default(),
  ).execute({
    ...fadeAt(hour),
    ...(options.locationId === undefined
      ? {}
      : { locationId: options.locationId }),
    ...(options.attemptId === undefined
      ? {}
      : { attemptId: options.attemptId }),
    ownerUserId: 'user-new',
    staffPlacement: options.staffPlacement,
  });
}

/** An answer as the wire carries it: `'committed'`, or the refusal. */
function wire(result: Result<unknown, DomainError>): unknown {
  return result.isSuccess()
    ? 'committed'
    : { code: result.error.code, params: result.error.params };
}

/** The one wire answer for a booking that names no usable shop. */
const NO_USABLE_SHOP = {
  code: 'booking.commit.invalid_input',
  params: { field: 'locationId' },
};

/** Did anything land in the book or the busy projection? */
const bookWritten = (fake: Fake): boolean =>
  fake.writes.some(
    (path) =>
      path.startsWith('appointments/') || path.startsWith('barberBusy/'),
  );

/** The father moving his own visit to `request`, through the production move. */
function clientMove(
  fake: Fake,
  request: DecideBookingRequest,
): ReturnType<RescheduleBookingUseCase['execute']> {
  let minted = 0;
  return new RescheduleBookingUseCase(
    new FirestoreBookingStore(withSdkPaths(fake)),
    new FixedClock(NOW_ISO),
    { next: () => `seat-new-${++minted}` },
    BookingPolicy.default(),
  ).execute({
    ...request,
    appointmentId: APPOINTMENT,
    ownerUserId: OWNER,
  });
}

/** The stored visit's `field`, as the book holds it now. */
async function stored(
  fake: Fake,
  field: 'locationId' | 'placement',
): Promise<unknown> {
  const snap = await fake.db.collection('appointments').doc(APPOINTMENT).get();
  return new Map(Object.entries(snap.data() ?? {})).get(field);
}

/*
 * A HIDDEN SHOP TAKES NO NEW CLIENT BOOKINGS (team decision, 2026-09-26).
 * The commit reads the shop through the one reading of a location document
 * (`toShop`) and asks a NEW client booking the rule the grid, the
 * waitlist's door and the matcher already search by (`shopListed`): the
 * shop is there AND `active`. A shop it cannot find, or one `/book` no
 * longer lists, is the one "no usable shop" answer on the wire
 * (`invalid_input: locationId`), told apart only by the typed error's
 * `reason`. Moved here from the matcher's spec (the commit lives here).
 */
describe('FirestoreBookingStore.commit — a new booking names a shop `/book` lists', () => {
  it('takes a new client booking at a listed shop', async () => {
    const fake = seeded();

    expect(wire(await book(fake, 14))).toBe('committed');
    expect(bookWritten(fake)).toBe(true);
  });

  it('refuses a shop it cannot find, as `invalid_input: locationId`', async () => {
    const fake = seeded();
    const refused = await book(fake, 14, { locationId: 'loc-nowhere' });

    expect(wire(refused)).toEqual(NO_USABLE_SHOP);
    expect(refused.isFailure() && refused.error).toBeInstanceOf(
      CommitBookingShopUnavailableError,
    );
    expect(
      refused.isFailure() &&
        (refused.error as CommitBookingShopUnavailableError).reason,
    ).toBe('not_found');
    expect(bookWritten(fake)).toBe(false);
  });

  it.each([
    ['hidden', 'hidden'],
    ['a status nobody modelled', 'archived'],
    ['no status at all', undefined],
  ])(
    'refuses a new client booking at a shop that is not listed (%s) — the same answer, nothing written',
    async (_label, status) => {
      const fake = seeded();
      await setShopStatus(fake, status);
      const refused = await book(fake, 14);

      expect(wire(refused)).toEqual(NO_USABLE_SHOP);
      expect(
        refused.isFailure() &&
          (refused.error as CommitBookingShopUnavailableError).reason,
      ).toBe('unlisted');
      expect(bookWritten(fake)).toBe(false);
    },
  );

  it('takes the shop’s own placement at a hidden shop — its desk is not the public surface', async () => {
    const fake = seeded();
    await setShopStatus(fake, 'hidden');

    expect(wire(await book(fake, 14, { staffPlacement: true }))).toBe(
      'committed',
    );
  });

  /*
   * An id that could not name a document is a shop nobody can name: refused
   * UNREAD as the same answer, not `store_failed`. Building its reference
   * is what throws (`withSdkPaths`, the Admin SDK's own check), inside the
   * transaction, where it used to surface as "internal".
   */
  it.each([
    ['an empty id', ''],
    ['a path rather than a name', 'loc-center/annex'],
  ])(
    'refuses %s as the one answer — `not_found`, never `store_failed`',
    async (_label, locationId) => {
      const fake = seeded();
      const refused = await book(fake, 14, { locationId });

      expect(wire(refused)).toEqual(NO_USABLE_SHOP);
      expect(
        refused.isFailure() &&
          (refused.error as CommitBookingShopUnavailableError).reason,
      ).toBe('not_found');
      expect(bookWritten(fake)).toBe(false);
    },
  );

  it('answers a retry of an attempt that committed before the shop was hidden with its own booking', async () => {
    const fake = seeded();
    const attemptId = 'appt-attempt-1';
    expect(wire(await book(fake, 14, { attemptId }))).toBe('committed');
    await setShopStatus(fake, 'hidden');
    const writes = fake.writes.length;

    const retried = await book(fake, 14, { attemptId });

    expect(retried.isSuccess() && retried.value).toEqual({
      appointmentId: attemptId,
    });
    expect(fake.writes.length).toBe(writes);
  });
});

/*
 * …AND NOBODY BOOKED THERE IS STRANDED. A visit booked while the shop was
 * listed can still be moved by its client and edited by staff after the
 * shop is hidden: the move and the staff edit share the commit's load, but
 * only a new client booking is asked the listing rule. Each case first
 * shows the same time refused to a NEW booking, so the move going through
 * is the visit's doing and not a shop that is still listed.
 */
describe('FirestoreBookingStore.reschedule — a visit at a shop hidden since is never stranded', () => {
  const clock = new FixedClock(NOW_ISO);

  async function hiddenCenter(): Promise<Fake> {
    const fake = seeded();
    await setShopStatus(fake, 'hidden');
    expect(wire(await book(fake, 14))).toEqual(NO_USABLE_SHOP);
    return fake;
  }

  const storedStart = async (fake: Fake): Promise<unknown> =>
    (
      (
        await fake.db.collection('appointments').doc(APPOINTMENT).get()
      ).data()?.['timeSlot'] as { startIso?: string } | undefined
    )?.startIso;

  it('lets the client move their own visit', async () => {
    const fake = await hiddenCenter();

    const moved = await clientMove(fake, fadeAt(14));

    expect(moved.isSuccess()).toBe(true);
    expect(await storedStart(fake)).toBe(iso(14));
  });

  it('lets staff edit it', async () => {
    const fake = await hiddenCenter();

    const edited = await new StaffEditAppointmentUseCase(
      new FirestoreBookingStore(withSdkPaths(fake)),
      clock,
      BookingPolicy.default(),
    ).execute({
      appointmentId: APPOINTMENT,
      actorUserId: 'staff-ivan',
      actorRoles: ['barber'],
      command: { kind: 'move', startIso: iso(14) },
    });

    expect(edited.isSuccess()).toBe(true);
    expect(await storedStart(fake)).toBe(iso(14));
  });
});

/*
 * …BUT A VISIT MOVED TO ANOTHER SHOP ARRIVES THERE. The client's move takes
 * its shop from the payload, so without this a move would be a second door
 * to a new client booking at a hidden shop. A request naming a shop the
 * visit is not at is asked the commit's rule (`admitsArrival`): listed, or
 * placed by the shop's own desk. Mladost is a second shop Niko works on
 * Tuesdays, offering the fade — each refusal is first shown to be the
 * listing's by the same move going through while Mladost is listed.
 */
describe('FirestoreBookingStore.reschedule — a visit moved to another shop arrives there', () => {
  const MLADOST = 'loc-mladost';

  /** `seeded()`, plus Mladost with `status`, Niko's Tuesdays and the fade. */
  async function withMladost(status: string): Promise<Fake> {
    const fake = seeded({ placement: 'self' });
    const center = await fake.db.collection('locations').doc(CENTER_ID).get();
    await fake.db
      .collection('locations')
      .doc(MLADOST)
      .set({ ...center.data(), status });
    const fade = fake.db.collection('services').doc('svc-fade');
    await fade.set({
      ...(await fade.get()).data(),
      locationIds: [CENTER_ID, MLADOST],
    });
    await fake.db
      .collection('barberSchedules')
      .doc('niko')
      .set({
        barberId: 'niko',
        turnaroundMinutes: 0,
        versions: [
          {
            seq: 1,
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            weeklyPattern: {
              tuesday: [{ start: '09:00', end: '18:00', locationId: MLADOST }],
            },
          },
        ],
      });
    return fake;
  }

  /** The father's fade with Niko at Mladost, at `hour`. */
  function atMladost(hour: number): DecideBookingRequest {
    const [seat] = fadeAt(hour).seats;
    if (!seat) throw new Error('bad fixture');
    return {
      locationId: MLADOST,
      seats: [{ ...seat, barberId: 'niko' }],
    };
  }

  it('moves the client’s visit to another shop `/book` lists', async () => {
    const fake = await withMladost('active');

    expect(wire(await clientMove(fake, atMladost(14)))).toBe('committed');
    expect(await stored(fake, 'locationId')).toBe(MLADOST);
  });

  it.each([
    ['hidden', 'hidden'],
    ['a status nobody modelled', 'archived'],
  ])(
    'refuses a client moving their visit INTO a shop `/book` does not list (%s) — the commit’s answer, nothing written',
    async (_label, status) => {
      const fake = await withMladost(status);

      const refused = await clientMove(fake, atMladost(14));

      expect(wire(refused)).toEqual(NO_USABLE_SHOP);
      expect(refused.isFailure() && refused.error).toBeInstanceOf(
        CommitBookingShopUnavailableError,
      );
      expect(
        refused.isFailure() &&
          (refused.error as CommitBookingShopUnavailableError).reason,
      ).toBe('unlisted');
      expect(bookWritten(fake)).toBe(false);
      expect(await stored(fake, 'locationId')).toBe(CENTER_ID);
    },
  );

  it('lets the client move their visit OUT of a hidden shop, to one `/book` lists', async () => {
    const fake = await withMladost('active');
    await setShopStatus(fake, 'hidden');

    expect(wire(await clientMove(fake, atMladost(14)))).toBe('committed');
    expect(await stored(fake, 'locationId')).toBe(MLADOST);
  });

  /*
   * The shop's own desk may bring a visit to a hidden shop, as it may place
   * a new one there: the request says who is moving it (`placement`). The
   * document keeps the placement it was first stamped with.
   */
  it.each([
    ['the shop’s own desk', 'staff' as const, 'committed'],
    ['nobody said who — the client’s, fail-closed', undefined, NO_USABLE_SHOP],
  ])(
    'asks who brings a visit to a hidden shop: %s',
    async (_label, placement, expected) => {
      const fake = await withMladost('hidden');
      const now = ZonedDateTime.fromISO(NOW_ISO, ZONE);
      if (now.isFailure()) throw new Error('bad fixture');
      let next = 0;

      const moved = await new FirestoreBookingStore(
        withSdkPaths(fake),
      ).reschedule(
        APPOINTMENT,
        () => true,
        () => ok({ ...atMladost(14), ...(placement ? { placement } : {}) }),
        (snapshot, _current, request) =>
          decideBooking(request, snapshot, {
            now: now.value,
            policy: BookingPolicy.default(),
            nextId: () => `seat-${next++}`,
            ownerUserId: OWNER,
          }),
      );

      expect(wire(moved)).toEqual(expected);
      expect(await stored(fake, 'placement')).toBe('self');
    },
  );
});

/*
 * THE ONE READING OF A SHOP (`toShop`) AND THE ONE RULE A NEW BOOKING ASKS
 * OF IT (`shopListed`), directly. Every reader that must agree with the
 * commit about a shop reads it through `toShop` — the commit and a move,
 * the waitlist's door, the matcher's day and the capacity rebuild — and
 * every surface that offers or takes a new booking asks `shopListed`.
 */
describe('toShop — a location document as the booking path reads it', () => {
  const hours = Array.from({ length: 7 }, () => ({
    kind: 'open',
    opens: '08:00',
    closes: '20:00',
  }));

  it('reads the shop’s own zone, hours and status', () => {
    expect(
      toShop({ timezone: 'Europe/Athens', status: 'active', hours }),
    ).toEqual({ zone: 'Europe/Athens', hours, active: true });
  });

  it('reads a shop that names no zone in the tenant’s, and one that publishes no hours as bound by none', () => {
    expect(toShop({ status: 'active' })).toEqual({
      zone: TENANT_ZONE,
      hours: [],
      active: true,
    });
  });

  it.each([
    ['hidden', { status: 'hidden' }],
    ['a status nobody modelled', { status: 'archived' }],
    ['no status at all', {}],
  ])('reads %s as not active — fail-closed', (_label, document) => {
    expect(toShop({ timezone: ZONE, ...document })?.active).toBe(false);
  });

  it('is `null` when there is no document', () => {
    expect(toShop(undefined)).toBeNull();
  });
});

describe('shopListed — there, and listed', () => {
  it.each([
    ['not there', null, false],
    ['there, not listed', { active: false }, false],
    ['there and listed', { active: true }, true],
  ] as const)('%s → %s', (_label, shop, listed) => {
    expect(shopListed(shop)).toBe(listed);
  });
});

describe('isDocumentId — could an id name a document at all', () => {
  it.each([
    ['a plain id', 'loc-center', true],
    ['a blank id — a name, if not a shop', '   ', true],
    ['an empty id', '', false],
    ['a path rather than a name', 'loc-center/annex', false],
    ['the current segment', '.', false],
    ['the parent segment', '..', false],
    ['a reserved name', '__center__', false],
  ] as const)('%s → %s', (_label, id, named) => {
    expect(isDocumentId(id)).toBe(named);
  });

  it('refuses at least every id the Admin SDK will not build a reference for', () => {
    for (const id of ['', 'loc-center/annex']) {
      expect(() => sdk.collection('locations').doc(id)).toThrow();
      expect(isDocumentId(id)).toBe(false);
    }
  });
});
