import { Timestamp } from 'firebase-admin/firestore';
import type {
  DocumentData,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { ZonedTimeSystem } from '@core/systems';
import { type LocationDayHours, Service } from '@creativo/domain/catalog';
import {
  CalendarDay,
  Interval,
  type ShiftSegmentProps,
  StaffScheduleHistory,
  StaffScheduleVersion,
  WeeklyPattern,
  type WeeklyPatternProps,
} from '@creativo/domain/scheduling';
import {
  type AppointmentPlacement,
  type PersistedDocument,
  type PersistedSlot,
  SCHEDULE_EXCEPTIONS_COLLECTION,
  appointmentFromDocument,
  appointmentToDocument,
  busyDocumentId,
  busyIntervalsOf,
  exceptionFromDocument,
  mergeBusy,
  persistedChairTimesOf,
  placementFromDocument,
} from '@creativo/application/booking';
import {
  type BookingDecision,
  type BookingSnapshot,
  type CommitOutcome,
  type DecideBookingRequest,
  type LoadedSchedule,
  readStartIso,
} from '../use-cases/decide-booking';
import {
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingShopUnavailableError,
  CommitBookingStoreError,
} from '../use-cases/commit-booking.errors';
import { shopListed } from '../use-cases/party-admission';
import { TENANT_ZONE } from '../lib/booking/tenant-zone';

/**
 * What one transaction attempt read: the snapshot the decision sees, plus the
 * raw busy slots per document.
 *
 * The raw slots are kept because the WRITE must merge onto the exact base this
 * attempt READ. Merging onto anything else — a fresh read, or nothing at all —
 * would drop every other booking already in that document, which is a
 * projection that quietly frees other people's appointments.
 *
 * Local to the attempt, never instance state: a transaction can be retried,
 * and two invocations of a warm function instance overlap.
 */
interface LoadedAttempt {
  readonly snapshot: BookingSnapshot;
  readonly rawBusy: ReadonlyMap<string, readonly PersistedSlot[]>;
  /**
   * The shop the request names, as stored (`toShop`) — there, or the load
   * refused it. Whether it may TAKE the booking is asked only where a
   * booking arrives at it (`admitsArrival`): a new booking, or a visit moved
   * in from another shop — never a visit moved or edited where it is.
   */
  readonly shop: StoredShop;
}

/**
 * May `request` bring a booking to `shop` — one that is not there yet?
 *
 * THE LISTING RULE, asked wherever a booking ARRIVES at a shop: a new
 * booking (`commit`) and a visit moved in from another shop
 * (`reschedule`), which is a new booking there by another door. A shop
 * `/book` lists (`shopListed`, the rule the grid, the waitlist's door and
 * the matcher search by) takes any. One it does not list — hidden, or a
 * status nobody modelled — takes only the shop's own placement
 * (`placement: 'staff'`): listing is a rule about what the public surface
 * OFFERS, and the desk is not bound by those (the bookable-window /
 * valid-placement split, owner ruling 2026-07-29). A visit already AT the
 * shop is never asked, so nobody booked there before it was hidden is
 * stranded (team decision 2026-09-26). An absent `placement` is the
 * client's: fail-closed.
 */
function admitsArrival(
  shop: StoredShop,
  request: DecideBookingRequest,
): boolean {
  return request.placement === 'staff' || shopListed(shop);
}

/**
 * Runs the commit inside ONE Firestore transaction.
 *
 * Everything the decision depends on — the shop's hours, the catalog terms,
 * each barber's roster, and above all each barber's busy day — is READ inside
 * the transaction. That is what makes the race resolvable: two clients
 * confirming 14:00 with Ivan both read the same busy document, and Firestore
 * lets exactly one of them commit. The loser's transaction retries, re-reads a
 * busy set that now contains the winner, and its `decideBooking` returns
 * `slot_unavailable` — which the client turns into "that time just went".
 *
 * Reads strictly precede writes, as Firestore requires.
 */
export class FirestoreBookingStore {
  constructor(private readonly db: Firestore) {}

  async commit(
    request: DecideBookingRequest,
    decide: (
      snapshot: BookingSnapshot,
    ) => Result<BookingDecision, CommitBookingError>,
  ): Promise<Result<CommitOutcome, CommitBookingError>> {
    try {
      return await this.db.runTransaction(async (tx) => {
        // Idempotency FIRST, and inside the transaction: if this attempt
        // already committed (response lost, client retried), hand back the
        // original answer. Without this the retry reads its OWN busy write
        // and returns `slot_unavailable` — a phantom failure that walks the
        // user into booking a second real appointment. The read also enters
        // the conflict set, so a genuine double-fire serialises here too.
        if (request.attemptId) {
          const existing = await tx.get(
            this.db.collection('appointments').doc(request.attemptId),
          );
          if (existing.exists) {
            return ok<CommitOutcome, CommitBookingError>({
              kind: 'replayed',
              appointmentId: request.attemptId,
            });
          }
        }

        const loaded = await this.load(tx, request);
        if (loaded.isFailure()) return fail(loaded.error);

        // A NEW booking arrives at its shop (`admitsArrival`): a client's
        // only at a shop `/book` lists (team decision 2026-09-26), the
        // shop's own placement at any. Asked here and not in `load`, which
        // also serves `reschedule`, where only a visit ARRIVING from
        // another shop is asked. After the replay above: an attempt that
        // already committed keeps its answer whatever the shop became since.
        if (!admitsArrival(loaded.value.shop, request)) {
          return fail(
            new CommitBookingShopUnavailableError(
              request.locationId,
              'unlisted',
            ),
          );
        }

        const decision = decide(loaded.value.snapshot);
        if (decision.isFailure()) return fail(decision.error);

        this.write(
          tx,
          decision.value,
          loaded.value,
          {},
          request.placement ?? null,
        );
        return ok<CommitOutcome, CommitBookingError>({
          kind: 'committed',
          decision: decision.value,
        });
      });
    } catch (error) {
      // A transaction that exhausts its retries, a network fault, a rules
      // rejection — all opaque here, and all the same to the caller: the
      // booking did not happen and nothing partial was written.
      return fail(new CommitBookingStoreError(error));
    }
  }

  /**
   * Move an EXISTING appointment to a new time, atomically.
   *
   * The same decision the commit path runs, with one difference that is the
   * whole reason this cannot be "cancel, then book": an appointment must not
   * collide with ITSELF. Its own intervals are already in the busy
   * projection, so the placement check is run against a projection with this
   * appointment's contribution SUBTRACTED — which is exact rather than
   * approximate, because the merge that built those spans is reversible: a
   * merged run minus the intervals one appointment put there is the union of
   * what everyone else put there, and no two appointments overlap by
   * construction.
   *
   * The old day's projection is not touched here. The write lands on the
   * appointment, and `rebuildBusyOnAppointmentChange` recomputes BOTH sides
   * from live truth (it already reads keys from before and after the write,
   * for exactly this case). The new day's spans ARE merged inline, closing
   * the one window that matters: nobody else may take the slot this
   * appointment just moved into.
   *
   * ### Who may write is a PREDICATE, not an owner id
   * It used to be an owner id compared for equality, which encoded one
   * caller's rule into the store and made the store unusable by the other.
   * A client moving their own booking passes an owner check; staff moving the
   * shop's book pass unconditionally — and that difference is exactly what
   * unfreezes the walk-ins already in the collection, whose `ownerUserId` is
   * `null` and therefore equal to nobody's uid. They were unreschedulable by
   * ANYONE, which nothing ever decided and nobody ever wanted.
   *
   * ### A plan may conclude there is nothing to write
   * `plan` answering `null` means the stored appointment ALREADY is what the
   * caller asked for — a retried move whose first attempt committed and whose
   * response was lost. That is the commit path's `replayed`, and it is
   * answered the same way: the original outcome, nothing written, nothing
   * re-decided. Re-deciding it would re-run rules against the NEW placement
   * (a move into the cancellation window would refuse its own retry) and
   * stamp a second revision for a change that happened once.
   *
   * ### A visit moved to ANOTHER shop arrives there
   * Moving a visit where it already is — by its client or by staff — is
   * never asked whether the shop is listed: a visit booked before its shop
   * was hidden stays movable (team decision 2026-09-26). A request naming a
   * shop the stored visit is NOT at is a booking arriving there, and is
   * asked the commit's rule (`admitsArrival`): otherwise a client's move
   * would be a second door to a new booking at a hidden shop. Who is moving
   * it is the request's `placement` — `'staff'` for the shop's own desk,
   * absent (the client's) otherwise. It only answers this question: the
   * document keeps the placement it was first stamped with.
   */
  async reschedule<E = never, S = undefined>(
    appointmentId: string,
    canWrite: (current: PersistedDocument) => boolean,
    plan: (
      current: PersistedDocument,
    ) => Result<DecideBookingRequest | null, CommitBookingError | E>,
    decide: (
      snapshot: BookingSnapshot,
      current: PersistedDocument,
      request: DecideBookingRequest,
      side: S,
    ) => Result<BookingDecision, CommitBookingError | E>,
    extraFields: (
      current: PersistedDocument,
    ) => Record<string, unknown> = () => ({}),
    /**
     * WHAT ELSE the attempt reads and writes in the SAME transaction — the
     * gift vouchers a visit draws on (2026-09-10). `read` runs after the
     * booking loads and before the decision, so every read still precedes
     * every write; `write` runs after the appointment's own. Absent for a
     * caller that touches nothing but the book.
     */
    side?: {
      read: (
        tx: Transaction,
        current: PersistedDocument,
        request: DecideBookingRequest,
      ) => Promise<Result<S, CommitBookingError | E>>;
      write: (tx: Transaction, decision: BookingDecision, side: S) => void;
    },
  ): Promise<Result<CommitOutcome, CommitBookingError | E>> {
    type Failure = CommitBookingError | E;
    try {
      return await this.db.runTransaction(
        async (tx): Promise<Result<CommitOutcome, Failure>> => {
          const ref = this.db.collection('appointments').doc(appointmentId);
          const snap = await tx.get(ref);
          const current = snap.data();
          if (!current || !canWrite(current)) {
            // Indistinguishable from not-found on purpose: confirming that an
            // id EXISTS to someone who may not write it is a leak.
            return fail<CommitOutcome, Failure>(
              new CommitBookingInvalidInputError('appointmentId'),
            );
          }

          // The plan may need the STORED appointment — a staff edit's seats are
          // the ones already in the document, not a cart the caller sent — so it
          // runs after the read and before the loads that depend on it. Every
          // read still strictly precedes every write, which is all Firestore
          // asks.
          const planned = plan(current);
          if (planned.isFailure()) {
            return fail<CommitOutcome, Failure>(planned.error);
          }
          if (planned.value === null) {
            return ok<CommitOutcome, Failure>({
              kind: 'replayed',
              appointmentId,
            });
          }
          const request = planned.value;

          const loaded = await this.load(tx, request);
          if (loaded.isFailure()) {
            return fail<CommitOutcome, Failure>(loaded.error);
          }
          // Moved IN from another shop: it arrives there, and is asked what
          // a new booking is (see "A visit moved to ANOTHER shop" above).
          // Before the side reads — a refused move reads nothing more.
          if (
            request.locationId !== String(current['locationId'] ?? '') &&
            !admitsArrival(loaded.value.shop, request)
          ) {
            return fail<CommitOutcome, Failure>(
              new CommitBookingShopUnavailableError(
                request.locationId,
                'unlisted',
              ),
            );
          }

          const sideRead = side
            ? await side.read(tx, current, request)
            : ok<S, Failure>(undefined as S);
          if (sideRead.isFailure()) {
            return fail<CommitOutcome, Failure>(sideRead.error);
          }

          const freed = this.withoutOwnContribution(
            loaded.value,
            appointmentId,
            current,
          );
          const decision = decide(
            freed.snapshot,
            current,
            request,
            sideRead.value,
          );
          if (decision.isFailure()) {
            return fail<CommitOutcome, Failure>(decision.error);
          }

          // A move keeps the placement the commit stamped: who put the
          // booking in the book does not change when it moves.
          this.write(
            tx,
            decision.value,
            freed,
            extraFields(current),
            placementFromDocument(current),
          );
          side?.write(tx, decision.value, sideRead.value);
          return ok<CommitOutcome, Failure>({
            kind: 'committed',
            decision: decision.value,
          });
        },
      );
    } catch (error) {
      return fail<CommitOutcome, Failure>(new CommitBookingStoreError(error));
    }
  }

  /**
   * The same loaded attempt, with what THIS appointment already occupies
   * handed back to the decision.
   *
   * The chair time is the stored visit's own, read by the domain
   * (`Appointment.chairTimes`), the source the booking grid releases by too
   * (`BookingDraftMove.chairTimes`). The decision releases it by the same
   * rule the grid does (`BookingSnapshot.release`, `paddedBusy`): before the
   * turnaround pads what is left, so a neighbour's turnaround stays. One
   * source and one rule on both sides, so a move is refused here only where
   * the grid did not offer it.
   *
   * A stored visit the aggregate cannot read (a legacy document, a field the
   * mapper refuses) still hands back what the busy projection holds for it,
   * read straight off its stored seats (`persistedChairTimesOf`, the
   * geometry the rebuild trigger projects). A client's move refuses such a
   * visit in its plan anyway, but a staff edit rebuilds from the raw fields
   * and never asks the mapper: releasing nothing there would make the
   * visit's own chairs refuse its own edit (`slot_unavailable`).
   *
   * Only the decision's view changes — `rawBusy` (what the write merges
   * onto) is left exactly as read, because the write must not drop spans
   * that belong to other bookings.
   */
  private withoutOwnContribution(
    loaded: LoadedAttempt,
    appointmentId: string,
    current: PersistedDocument,
  ): LoadedAttempt {
    const stored = appointmentFromDocument(appointmentId, current);
    const release = stored.isSuccess()
      ? stored.value.chairTimes()
      : persistedChairTimesOf(current);
    return { ...loaded, snapshot: { ...loaded.snapshot, release } };
  }

  /**
   * Every read the decision needs, in TWO batched round trips, before any
   * write.
   *
   * Phase 1 fetches the location, the services and the rosters together —
   * none of those fetches depends on another's data. Phase 2 fetches the
   * busy docs, and genuinely cannot join phase 1: a busy KEY is
   * `${barberId}__${dayKey}` and the day key comes from parsing the seat's
   * start in the shop's zone, which phase 1 is what provides. The earlier
   * shape awaited one `tx.get` per document — seven serialized round trips
   * for a two-seat party — which billed the same reads but held the
   * transaction (and its conflict window on the hot busy docs) open several
   * times longer than necessary.
   */
  private async load(
    tx: Transaction,
    request: DecideBookingRequest,
  ): Promise<Result<LoadedAttempt, CommitBookingError>> {
    // Distinct ids only: a party of four with one barber must not read that
    // roster four times, and each extra read widens the contention window.
    const serviceIds = [
      ...new Set(request.seats.map((seat) => seat.serviceId)),
    ];
    const barberIds = [...new Set(request.seats.map((seat) => seat.barberId))];

    // An id that could not name a document names no shop, and is refused
    // UNREAD as one that is not there. Building its reference would throw
    // (the Admin SDK refuses an empty id, or one holding a `/`), and the
    // transaction would answer `store_failed` — "internal" — for a request
    // that simply names no usable shop, the answer the waitlist's door
    // gives the same spelling (`decideWaitlist`).
    if (!isDocumentId(request.locationId)) {
      return fail(
        new CommitBookingShopUnavailableError(request.locationId, 'not_found'),
      );
    }
    const locationRef = this.db.collection('locations').doc(request.locationId);
    const serviceRefs = serviceIds.map((id) =>
      this.db.collection('services').doc(id),
    );
    const scheduleRefs = barberIds.map((id) =>
      this.db.collection('barberSchedules').doc(id),
    );

    const phaseOne = await tx.getAll(
      locationRef,
      ...serviceRefs,
      ...scheduleRefs,
    );
    // The shop, through the one reading of a location document (`toShop`).
    // Refused here only when it is not there: this load also serves moves
    // and staff edits, and a stored visit at a shop hidden since must stay
    // movable. It is handed back, so a booking ARRIVING at it — a new one,
    // or a visit moved in from another shop — is asked `admitsArrival`.
    const shop = toShop(phaseOne[0]?.data());
    if (!shop) {
      return fail(
        new CommitBookingShopUnavailableError(request.locationId, 'not_found'),
      );
    }
    const { zone, hours: shopHours } = shop;

    const services: Service[] = [];
    for (const [index, serviceId] of serviceIds.entries()) {
      const data = phaseOne[1 + index]?.data();
      if (!data) continue;
      const service = toService(serviceId, data);
      // A malformed or inactive service is simply ABSENT from the snapshot;
      // `decideBooking` then refuses with `unknown_service` rather than
      // guessing at terms nobody authored.
      if (service) services.push(service);
    }

    const schedules = new Map<string, LoadedSchedule>();
    for (const [index, barberId] of barberIds.entries()) {
      const data = phaseOne[1 + serviceIds.length + index]?.data();
      if (!data) continue;
      const schedule = toSchedule(data, zone);
      if (schedule) schedules.set(barberId, schedule);
    }

    // Busy is keyed by barber AND day, and a seat's day comes from its own
    // start — a party that straddles midnight touches two documents.
    // Each start is read as the decision reads it (`readStartIso`, the
    // shop's zone); one that does not read touches no document — the
    // decision refuses it.
    const busyKeys = new Set<string>();
    const timeZone = ZonedTimeSystem.checkZone(zone);
    for (const seat of request.seats) {
      const start = readStartIso(seat.startIso, zone);
      if (!start.ok || !timeZone.ok) continue;
      busyKeys.add(
        busyDocumentId(
          seat.barberId,
          ZonedTimeSystem.toLocal(start.value, timeZone.value).localDate,
        ),
      );
    }

    const rawBusy = new Map<string, readonly PersistedSlot[]>();
    const busy = new Map<string, readonly Interval[]>();
    const exceptions = new Map<
      string,
      NonNullable<ReturnType<typeof exceptionFromDocument>>
    >();
    const orderedKeys = [...busyKeys];
    if (orderedKeys.length > 0) {
      // Busy AND published exceptions for the same (barber, day) keys, one
      // round trip. Read even when absent: an EMPTY read still enters the
      // transaction's conflict set, so two clients racing for a barber's
      // first booking of the day still serialise — and a commit racing a
      // just-declared day off loses honestly.
      const snaps = await tx.getAll(
        ...orderedKeys.map((key) => this.db.collection('barberBusy').doc(key)),
        ...orderedKeys.map((key) =>
          this.db.collection(SCHEDULE_EXCEPTIONS_COLLECTION).doc(key),
        ),
      );
      for (const [index, key] of orderedKeys.entries()) {
        const slots = (snaps[index]?.data()?.['busy'] ??
          []) as readonly PersistedSlot[];
        rawBusy.set(key, slots);
        busy.set(key, busyIntervalsOf(slots, zone));

        const exceptionData = snaps[orderedKeys.length + index]?.data();
        if (exceptionData) {
          const exception = exceptionFromDocument(exceptionData);
          if (exception) exceptions.set(key, exception);
        }
      }
    }

    return ok({
      snapshot: { zone, shopHours, services, schedules, busy, exceptions },
      rawBusy,
      shop,
    });
  }

  private write(
    tx: Transaction,
    decision: BookingDecision,
    loaded: LoadedAttempt,
    extraFields: Record<string, unknown> = {},
    placement: AppointmentPlacement | null = null,
  ): void {
    const zone = loaded.snapshot.zone;

    tx.set(
      this.db.collection('appointments').doc(decision.appointment.id.value),
      // `extraFields` FIRST, so the mapper always wins on any field it owns.
      // It carries the two things the mapper cannot know: the revision counter
      // this write is stamping, and whatever the stored document holds that
      // this mapper does not write — a `set()` replaces the document whole,
      // and a field the mapper has never heard of is a field a staff edit
      // would otherwise silently delete.
      {
        ...extraFields,
        ...appointmentToDocument(decision.appointment, { placement }),
      },
    );

    // Group by document FIRST: two seats for one barber on one day are one
    // write, and issuing two would have the second overwrite the first's
    // merge with a stale base.
    const byDocument = new Map<
      string,
      {
        readonly barberId: string;
        readonly dayKey: string;
        readonly intervals: Interval[];
      }
    >();
    for (const write of decision.busyWrites) {
      const key = busyDocumentId(write.barberId, write.dayKey);
      const entry = byDocument.get(key) ?? {
        barberId: write.barberId,
        dayKey: write.dayKey,
        intervals: [],
      };
      entry.intervals.push(write.interval);
      byDocument.set(key, entry);
    }

    for (const [key, entry] of byDocument) {
      tx.set(this.db.collection('barberBusy').doc(key), {
        barberId: entry.barberId,
        dayKey: entry.dayKey,
        zone,
        // Merged onto what THIS attempt read — see `LoadedAttempt`.
        busy: mergeBusy(loaded.rawBusy.get(key) ?? [], entry.intervals, zone),
        // TTL mirror: no read path wants a busy day 30 days gone (the client
        // range starts at today; commit reads current days), and expiring
        // them also caps what the world-readable projection exposes.
        purgeAt: busyPurgeAt(entry.dayKey),
      });
    }
  }
}

/** The busy projection's TTL horizon: 30 days after the day itself. */
export function busyPurgeAt(dayKey: string): Timestamp {
  return Timestamp.fromMillis(
    new Date(`${dayKey}T00:00:00Z`).getTime() + 30 * 24 * 3_600_000,
  );
}

/**
 * Could `id` name a Firestore document? The Admin SDK throws on an empty id
 * or one holding a `/` (a path, not a name) as the reference is built, and
 * the server refuses `.`, `..` and a reserved `__…__` name. An id that
 * could not is never read: it names nothing, and its reader answers "not
 * there" (`FirestoreBookingStore.load` refuses the shop as `not_found`).
 */
export function isDocumentId(id: string): boolean {
  return (
    id.length > 0 &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id)
  );
}

/**
 * A `locations/{id}` document as the booking path reads it.
 *
 * Shared by every reader that must agree with the commit about a shop: the
 * commit itself (`FirestoreBookingStore.load`), the waitlist's door
 * (`loadNamedShop`), the matcher's day (`loadDayAvailability`) and the
 * capacity rebuild (`rebuildBarberCapacity`). A second reading would be a
 * second opinion about which shop a booking may name. Each caller then
 * applies its own rule to the result:
 * - a visit moved or edited where it already is
 *   (`FirestoreBookingStore.reschedule`) asks only that the shop is there
 *   (not `null`), so no visit is stranded;
 * - a booking ARRIVING at the shop — a new one, or a visit moved in from
 *   another shop — asks `admitsArrival`: listed, or placed by the shop;
 * - everything that offers a NEW booking — the waitlist's door, the
 *   matcher, the capacity rebuild — asks one rule, `shopListed`
 *   (party-admission): there AND listed.
 */
export interface StoredShop {
  /**
   * The SHOP's zone, from the shop's own document — never the client's and
   * never a constant (§7.1).
   */
  readonly zone: string;
  readonly hours: readonly LocationDayHours[];
  /**
   * On the public surface (`status: 'active'`), which is the fact
   * `shopListed` reads: `/book` lists it, the grid and the matcher search
   * it, and a waitlist may name it. A `hidden` shop — or a status nobody
   * authored — is not: fail-closed, as every public query
   * (`where('status', '==', 'active')`) already reads it.
   */
  readonly active: boolean;
}

/** Firestore doc → `StoredShop`, or `null` when there is no such shop. */
export function toShop(data: DocumentData | undefined): StoredShop | null {
  if (!data) return null;
  return {
    // A shop that names no zone is in the tenant's (`TENANT_ZONE`, the one
    // place the functions say it).
    zone: String(data['timezone'] ?? TENANT_ZONE),
    hours: (data['hours'] ?? []) as readonly LocationDayHours[],
    active: data['status'] === 'active',
  };
}

/** Firestore doc → `Service`, or `null` when it is unbookable. */
export function toService(id: string, data: DocumentData): Service | null {
  if (data['status'] !== 'active') return null;
  const result = Service.reconstitute({
    id,
    name: data['name'],
    description: data['description'],
    categoryId: data['categoryId'],
    priceMinorUnits: data['priceMinorUnits'],
    currencyCode: data['currencyCode'],
    durationMinutes: data['durationMinutes'],
    setupMinutes: data['setupMinutes'],
    cleanupMinutes: data['cleanupMinutes'],
    locationIds: data['locationIds'] ?? [],
    conflictsWith: data['conflictsWith'] ?? [],
    variants: data['variants'] ?? [],
    offerings: data['offerings'] ?? [],
    composition: data['composition'],
    upsellOnly: data['upsellOnly'],
    popular: data['popular'],
    status: data['status'],
    sortOrder: data['sortOrder'],
  });
  return result.isSuccess() ? result.value : null;
}

/**
 * Firestore doc → roster.
 *
 * Firestore forbids nested arrays, so a weekday's ranges are stored as
 * `[{start, end}]` maps — the same shape the browser's reader and the seed
 * script use. A document that does not parse yields `null`, which
 * `decideBooking` reads as "not rostered": fail-closed, because treating an
 * unreadable roster as unrestricted would write a booking nobody works.
 */
export function toSchedule(
  data: DocumentData,
  zone: string,
): LoadedSchedule | null {
  const versions: StaffScheduleVersion[] = [];
  for (const raw of (data['versions'] ?? []) as DocumentData[]) {
    const from = CalendarDay.create(String(raw['effectiveFrom'] ?? ''), zone);
    if (from.isFailure()) return null;
    const to =
      raw['effectiveTo'] == null
        ? null
        : CalendarDay.create(String(raw['effectiveTo']), zone);
    if (to !== null && to.isFailure()) return null;

    const byWeekday: Record<string, readonly ShiftSegmentProps[]> = {};
    for (const [weekday, segments] of Object.entries(
      (raw['weeklyPattern'] ?? {}) as Record<string, unknown>,
    )) {
      if (!Array.isArray(segments)) continue;
      byWeekday[weekday] = (segments as DocumentData[]).map((segment) => ({
        start: String(segment['start']),
        end: String(segment['end']),
        locationId: String(segment['locationId'] ?? ''),
      }));
    }

    const pattern = WeeklyPattern.create({
      byWeekday: byWeekday as WeeklyPatternProps['byWeekday'],
    });
    if (pattern.isFailure()) return null;

    versions.push(
      StaffScheduleVersion.of({
        seq: Number(raw['seq'] ?? 0),
        effectiveFrom: from.value,
        effectiveTo: to === null ? null : to.value,
        pattern: pattern.value,
      }),
    );
  }

  const history = StaffScheduleHistory.create(versions);
  if (history.isFailure()) return null;

  const turnaround = Number(data['turnaroundMinutes'] ?? 0);
  return {
    history: history.value,
    turnaroundMinutes:
      Number.isFinite(turnaround) && turnaround > 0 ? turnaround : 0,
  };
}
