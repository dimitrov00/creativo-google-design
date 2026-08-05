import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  Appointment,
  BookingContact,
  CalendarDay,
  Interval,
} from '@creativo/domain/scheduling';

/**
 * The persisted shape of an appointment, and of the public busy projection —
 * defined HERE, in the port layer, because two different SDKs write them.
 *
 * The browser reads appointments through `firebase/firestore`; the
 * `commitBooking` function writes them through `firebase-admin`. Neither may
 * import the other's adapter, so without a shared definition the shape would
 * exist twice and drift on the first field either side added. This module
 * imports no SDK at all — it is plain objects both can produce.
 */
export type PersistedDocument = Record<string, unknown>;

/** A slot as stored: wall-clock ISO plus the zone that makes it meaningful. */
export interface PersistedSlot {
  readonly startIso: string;
  readonly endIso: string;
  readonly zone: string;
}

/**
 * Appointment → document.
 *
 * `barberIds` and the top-level `timeSlot` are QUERY MIRRORS, not truth. The
 * seats are the truth and both are recomputed on read, so a corrupt mirror
 * cannot change what an appointment says — only which queries find it.
 */
export function appointmentToDocument(
  appointment: Appointment,
): PersistedDocument {
  return {
    locationId: appointment.locationId.value,
    ownerUserId: ownerUserIdOf(appointment),
    barberIds: appointment.barberIds().map((id) => id.value),
    // The (barber, day) projection docs this appointment occupies — the
    // rebuild trigger's reverse index. `array-contains` on this plus a
    // status filter is what lets one cancelled booking recompute exactly
    // the busy docs it touched, instead of scanning the collection.
    busyKeys: busyKeysOf(appointment),
    timeSlot: {
      startIso: appointment.timeSlot.start.toISO(),
      endIso: appointment.timeSlot.end.toISO(),
      zone: appointment.timeSlot.start.zoneName,
    },
    seats: appointment.seats.map((seat) => ({
      id: seat.id.value,
      serviceId: seat.serviceId.value,
      variantId: seat.variantId?.value ?? null,
      barberId: seat.barberId.value,
      terms: {
        priceMinorUnits: seat.terms.price.toMinorUnits(),
        currencyCode: seat.terms.price.currencyCode(),
        durationMinutes: seat.terms.durationMinutes,
        setupMinutes: seat.terms.setupMinutes,
        cleanupMinutes: seat.terms.cleanupMinutes,
      },
      slot: {
        startIso: seat.slot.start.toISO(),
        endIso: seat.slot.end.toISO(),
        zone: seat.slot.start.zoneName,
      },
      subject:
        seat.subject.kind === 'account'
          ? {
              kind: 'account' as const,
              userId: seat.subject.userId.value,
              relationship: seat.subject.relationship,
            }
          : { kind: 'anonymous' as const, label: seat.subject.label.value },
    })),
    status: appointment.status,
    // A SNAPSHOT, deliberately denormalized: the number given for THIS
    // booking is the number the shop dials for it, whatever the profile says
    // two months later. `null` for appointments booked before contacts
    // existed, and for a staff-entered walk-in with nobody to call.
    contact: appointment.contact?.toProps() ?? null,
  };
}

/**
 * Document → contact, for the readers that show it (the client's own
 * appointments, the staff day view).
 *
 * A contact that does not parse reads as ABSENT rather than failing the
 * appointment: the booking is still real, still cancellable, and still worth
 * showing — losing the phone number is not worth losing the row.
 */
export function contactFromDocument(
  data: PersistedDocument,
): BookingContact | null {
  const raw = data['contact'];
  if (raw === null || typeof raw !== 'object') return null;
  const contact = raw as Record<string, unknown>;

  const result = BookingContact.create({
    name: String(contact['name'] ?? ''),
    phone: String(contact['phone'] ?? ''),
    email: contact['email'] == null ? null : String(contact['email']),
    note: contact['note'] == null ? null : String(contact['note']),
  });
  return result.isSuccess() ? result.value : null;
}

/**
 * The booker, denormalized so "my appointments" is one indexed query rather
 * than a scan. Taken from the `self` seat — the one seat whose subject is the
 * account that owns the booking; a party's guests are anonymous subjects and
 * never own anything.
 */
export function ownerUserIdOf(appointment: Appointment): string | null {
  for (const seat of appointment.seats) {
    if (
      seat.subject.kind === 'account' &&
      seat.subject.relationship === 'self'
    ) {
      return seat.subject.userId.value;
    }
  }
  return null;
}

/**
 * The PUBLIC busy projection for one (barber, day).
 *
 * Geometry and nothing else — no client, no service, no price, and above all
 * no reason. `/book` is browsable anonymously and Firestore rules cannot
 * redact fields, so a visitor must be able to read this document whole
 * without learning anything about who is in the chair. (A `sick` day is GDPR
 * Art. 9 special-category data; it must never be derivable from here.)
 *
 * Intervals are stored UNPADDED — the barber's turnaround is applied by
 * whoever reads them, from the roster document, so changing a barber's reset
 * time takes effect immediately instead of only for bookings written
 * afterwards.
 */
export interface PersistedBusyDocument {
  readonly barberId: string;
  readonly dayKey: string;
  readonly zone: string;
  readonly busy: readonly PersistedSlot[];
}

/** Composite key — the barber AND the day, so the grid reads exactly what it renders. */
export function busyDocumentId(barberId: string, dayKey: string): string {
  return `${barberId}__${dayKey}`;
}

/**
 * Every busy-doc key this appointment's seats occupy.
 *
 * Keyed by the SOLD slot's start day — the same day `decideBooking` keys its
 * busy writes by — so the mirror and the projection always name the same
 * documents. Deduplicated because two seats with one barber on one day are
 * one projection doc.
 */
export function busyKeysOf(appointment: Appointment): readonly string[] {
  const keys = new Set<string>();
  for (const seat of appointment.seats) {
    keys.add(
      busyDocumentId(
        seat.barberId.value,
        CalendarDay.fromZonedDateTime(seat.slot.start).key(),
      ),
    );
  }
  return [...keys].sort();
}

/** One (barber, day) projection doc's share of a stored appointment. */
export interface BusyContribution {
  readonly zone: string;
  readonly intervals: readonly Interval[];
}

/**
 * What a PERSISTED appointment occupies, per busy-doc key.
 *
 * The same envelope `decideBooking` writes — setup + service + cleanup
 * around each seat's sold slot — re-derived from the stored seats, so the
 * rebuild trigger reproduces the commit path's geometry byte-for-byte
 * instead of keeping a second copy of the rule. A seat that does not parse
 * contributes nothing: fail-closed FREES time rather than inventing a block
 * nobody can explain, and the appointment itself remains the truth.
 */
export function busyContributionsOf(
  data: PersistedDocument,
): ReadonlyMap<string, BusyContribution> {
  const byKey = new Map<string, { zone: string; intervals: Interval[] }>();
  const seats = Array.isArray(data['seats'])
    ? (data['seats'] as readonly Record<string, unknown>[])
    : [];

  for (const seat of seats) {
    const slot = (seat['slot'] ?? {}) as Record<string, unknown>;
    const terms = (seat['terms'] ?? {}) as Record<string, unknown>;
    const zone = String(slot['zone'] ?? '');
    const barberId = String(seat['barberId'] ?? '');
    if (zone.length === 0 || barberId.length === 0) continue;

    const start = ZonedDateTime.fromISO(String(slot['startIso'] ?? ''), zone);
    const end = ZonedDateTime.fromISO(String(slot['endIso'] ?? ''), zone);
    if (start.isFailure() || end.isFailure()) continue;

    const setup = Number(terms['setupMinutes'] ?? 0);
    const cleanup = Number(terms['cleanupMinutes'] ?? 0);

    const key = busyDocumentId(
      barberId,
      CalendarDay.fromZonedDateTime(start.value).key(),
    );
    const entry = byKey.get(key) ?? { zone, intervals: [] };
    entry.intervals.push(
      Interval.of(
        start.value.toMillis() - (Number.isFinite(setup) ? setup : 0) * 60_000,
        end.value.toMillis() +
          (Number.isFinite(cleanup) ? cleanup : 0) * 60_000,
      ),
    );
    byKey.set(key, entry);
  }
  return byKey;
}

/** Stored slots → intervals. An unparseable entry is skipped, never guessed at. */
export function busyIntervalsOf(
  slots: readonly PersistedSlot[],
  zone: string,
): readonly Interval[] {
  const intervals: Interval[] = [];
  for (const slot of slots) {
    const start = ZonedDateTime.fromISO(slot.startIso, zone);
    const end = ZonedDateTime.fromISO(slot.endIso, zone);
    if (start.isFailure() || end.isFailure()) continue;
    intervals.push(Interval.of(start.value.toMillis(), end.value.toMillis()));
  }
  return intervals;
}

/**
 * Merge new spans into a busy document's slots.
 *
 * `Interval.normalize` merges touching runs, which is deliberate: two
 * back-to-back seats become one span, so the projection leaks booking
 * DENSITY (what anyone learns by looking through the window) but never how
 * many clients were served.
 */
export function mergeBusy(
  existing: readonly PersistedSlot[],
  added: readonly Interval[],
  zone: string,
): readonly PersistedSlot[] {
  const merged = Interval.normalize([
    ...busyIntervalsOf(existing, zone),
    ...added,
  ]);

  const slots: PersistedSlot[] = [];
  for (const interval of merged) {
    const start = ZonedDateTime.fromMillis(interval.startMs, zone);
    const end = ZonedDateTime.fromMillis(interval.endMs, zone);
    // Unreachable for a valid zone; dropping beats writing a broken span.
    if (start.isFailure() || end.isFailure()) continue;
    slots.push({
      startIso: start.value.toISO(),
      endIso: end.value.toISO(),
      zone,
    });
  }
  return slots;
}
