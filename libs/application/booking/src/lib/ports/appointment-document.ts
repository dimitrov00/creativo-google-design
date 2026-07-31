import { ZonedDateTime } from '@creativo/domain/kernel';
import { Appointment, Interval } from '@creativo/domain/scheduling';

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
  };
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
