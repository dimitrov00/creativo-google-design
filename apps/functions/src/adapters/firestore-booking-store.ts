import { Timestamp } from 'firebase-admin/firestore';
import type {
  DocumentData,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
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
  type PersistedDocument,
  type PersistedSlot,
  SCHEDULE_EXCEPTIONS_COLLECTION,
  appointmentToDocument,
  busyContributionsOf,
  busyDocumentId,
  busyIntervalsOf,
  exceptionFromDocument,
  mergeBusy,
} from '@creativo/application/booking';
import type {
  BookingDecision,
  BookingSnapshot,
  CommitOutcome,
  DecideBookingRequest,
  LoadedSchedule,
} from '../use-cases/decide-booking';
import {
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingStoreError,
} from '../use-cases/commit-booking.errors';

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

        const decision = decide(loaded.value.snapshot);
        if (decision.isFailure()) return fail(decision.error);

        this.write(tx, decision.value, loaded.value);
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
   */
  async reschedule<E = never>(
    appointmentId: string,
    canWrite: (current: PersistedDocument) => boolean,
    plan: (
      current: PersistedDocument,
    ) => Result<DecideBookingRequest, CommitBookingError | E>,
    decide: (
      snapshot: BookingSnapshot,
      current: PersistedDocument,
      request: DecideBookingRequest,
    ) => Result<BookingDecision, CommitBookingError | E>,
    extraFields: (
      current: PersistedDocument,
    ) => Record<string, unknown> = () => ({}),
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
          const request = planned.value;

          const loaded = await this.load(tx, request);
          if (loaded.isFailure()) {
            return fail<CommitOutcome, Failure>(loaded.error);
          }

          const freed = this.withoutOwnContribution(loaded.value, current);
          const decision = decide(freed.snapshot, current, request);
          if (decision.isFailure()) {
            return fail<CommitOutcome, Failure>(decision.error);
          }

          this.write(tx, decision.value, freed, extraFields(current));
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
   * The same loaded attempt, minus what THIS appointment already occupies.
   *
   * Only the decision's view is narrowed — `rawBusy` (what the write merges
   * onto) is left exactly as read, because the write must not drop spans
   * that belong to other bookings.
   */
  private withoutOwnContribution(
    loaded: LoadedAttempt,
    current: PersistedDocument,
  ): LoadedAttempt {
    const own = busyContributionsOf(current);
    if (own.size === 0) return loaded;

    const busy = new Map(loaded.snapshot.busy);
    for (const [key, contribution] of own) {
      const existing = busy.get(key);
      if (!existing) continue;
      busy.set(key, Interval.subtract(existing, contribution.intervals));
    }
    return { ...loaded, snapshot: { ...loaded.snapshot, busy } };
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
    const locationData = phaseOne[0]?.data();
    if (!locationData) {
      return fail(new CommitBookingInvalidInputError('locationId'));
    }
    // The SHOP's zone, from the shop's own document — never the client's and
    // never a constant (§7.1).
    const zone = String(locationData['timezone'] ?? 'Europe/Sofia');
    const shopHours = (locationData['hours'] ??
      []) as readonly LocationDayHours[];

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
    const busyKeys = new Set<string>();
    for (const seat of request.seats) {
      const start = ZonedDateTime.fromISO(seat.startIso, zone);
      if (start.isFailure()) continue;
      busyKeys.add(
        busyDocumentId(
          seat.barberId,
          CalendarDay.fromZonedDateTime(start.value).key(),
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
    });
  }

  private write(
    tx: Transaction,
    decision: BookingDecision,
    loaded: LoadedAttempt,
    extraFields: Record<string, unknown> = {},
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
      { ...extraFields, ...appointmentToDocument(decision.appointment) },
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
