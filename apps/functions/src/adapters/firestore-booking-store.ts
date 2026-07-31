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
  type PersistedSlot,
  appointmentToDocument,
  busyDocumentId,
  busyIntervalsOf,
  mergeBusy,
} from '@creativo/application/booking';
import type {
  BookingDecision,
  BookingSnapshot,
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
  ): Promise<Result<BookingDecision, CommitBookingError>> {
    try {
      return await this.db.runTransaction(async (tx) => {
        const loaded = await this.load(tx, request);
        if (loaded.isFailure()) return fail(loaded.error);

        const decision = decide(loaded.value.snapshot);
        if (decision.isFailure()) return fail(decision.error);

        this.write(tx, decision.value, loaded.value);
        return ok(decision.value);
      });
    } catch (error) {
      // A transaction that exhausts its retries, a network fault, a rules
      // rejection — all opaque here, and all the same to the caller: the
      // booking did not happen and nothing partial was written.
      return fail(new CommitBookingStoreError(error));
    }
  }

  /** Every read the decision needs, in one pass, before any write. */
  private async load(
    tx: Transaction,
    request: DecideBookingRequest,
  ): Promise<Result<LoadedAttempt, CommitBookingError>> {
    const locationSnap = await tx.get(
      this.db.collection('locations').doc(request.locationId),
    );
    const locationData = locationSnap.data();
    if (!locationData) {
      return fail(new CommitBookingInvalidInputError('locationId'));
    }
    // The SHOP's zone, from the shop's own document — never the client's and
    // never a constant (§7.1).
    const zone = String(locationData['timezone'] ?? 'Europe/Sofia');
    const shopHours = (locationData['hours'] ??
      []) as readonly LocationDayHours[];

    // Distinct ids only: a party of four with one barber must not read that
    // roster four times, and each extra read widens the contention window.
    const serviceIds = [
      ...new Set(request.seats.map((seat) => seat.serviceId)),
    ];
    const barberIds = [...new Set(request.seats.map((seat) => seat.barberId))];

    const services: Service[] = [];
    for (const serviceId of serviceIds) {
      const snap = await tx.get(this.db.collection('services').doc(serviceId));
      const data = snap.data();
      if (!data) continue;
      const service = toService(serviceId, data);
      // A malformed or inactive service is simply ABSENT from the snapshot;
      // `decideBooking` then refuses with `unknown_service` rather than
      // guessing at terms nobody authored.
      if (service) services.push(service);
    }

    const schedules = new Map<string, LoadedSchedule>();
    for (const barberId of barberIds) {
      const snap = await tx.get(
        this.db.collection('barberSchedules').doc(barberId),
      );
      const data = snap.data();
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
    for (const key of busyKeys) {
      // Read even when absent: an EMPTY read still enters the transaction's
      // conflict set, so two clients racing for a barber's first booking of
      // the day still serialise.
      const snap = await tx.get(this.db.collection('barberBusy').doc(key));
      const slots = (snap.data()?.['busy'] ?? []) as readonly PersistedSlot[];
      rawBusy.set(key, slots);
      busy.set(key, busyIntervalsOf(slots, zone));
    }

    return ok({
      snapshot: { zone, shopHours, services, schedules, busy },
      rawBusy,
    });
  }

  private write(
    tx: Transaction,
    decision: BookingDecision,
    loaded: LoadedAttempt,
  ): void {
    const zone = loaded.snapshot.zone;

    tx.set(
      this.db.collection('appointments').doc(decision.appointment.id.value),
      appointmentToDocument(decision.appointment),
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
      });
    }
  }
}

/** Firestore doc → `Service`, or `null` when it is unbookable. */
function toService(id: string, data: DocumentData): Service | null {
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
function toSchedule(data: DocumentData, zone: string): LoadedSchedule | null {
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
