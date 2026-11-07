import type {
  BookingStatus,
  BarberId,
  LocalDate,
  ServiceId,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import { ServiceVariantPick } from '@core/components';
import { TextMatchSystem } from './text-match.system';

/**
 * The words a visit is searched by that the visit itself does not hold: the
 * names behind its ids and its people. They arrive as functions of the
 * features layer's catalogue and profile reads, so the index is built from
 * plain strings and the system reads no catalogue.
 */
export type SearchLabels = {
  /** Every name the visit is findable by as a client: the contact, each guest, each read companion. */
  readonly clientNames: (visit: Appointment) => readonly string[];
  /** A service's name, or `null` the catalogue no longer knows. */
  readonly serviceName: (serviceId: ServiceId) => string | null;
  /** A barber's name, or `null` when unknown. */
  readonly barberName: (barberId: BarberId) => string | null;
};

/**
 * The folded window as flat parallel columns — one array per field, the same
 * length, index `i` describing the window's visit `i`. A keystroke scans the
 * columns and folds nothing: the folding happened once, when the window was
 * replaced.
 */
export type SearchIndex = {
  readonly visitCount: number;
  /** Folded names, a visit's own joined by `\n`; `''` for none. */
  readonly clientText: readonly string[];
  readonly serviceText: readonly string[];
  readonly barberText: readonly string[];
  readonly emailText: readonly string[];
  readonly noteText: readonly string[];
  /** The contact number's digits alone; `''` for none. */
  readonly phoneDigits: readonly string[];
  readonly barberIds: readonly (readonly BarberId[])[];
  readonly serviceIds: readonly (readonly ServiceId[])[];
  /** The variants its seats were booked at, with their services (a seat with none adds nothing), distinct. */
  readonly variants: readonly (readonly ServiceVariantPick[])[];
  /** The same picks as keys (`ServiceVariantPick.keyOf`), to match by. */
  readonly variantKeys: readonly (readonly string[])[];
  readonly bookingStatus: readonly BookingStatus[];
  readonly localDate: readonly LocalDate[];
  readonly hasNote: readonly boolean[];
};

const NON_DIGITS = /\D/g;

function joined(parts: readonly (string | null)[]): string {
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string | null;
    if (part === null || part.length === 0) continue;
    const folded = TextMatchSystem.fold(part);
    out += out.length === 0 ? folded : `\n${folded}`;
  }
  return out;
}

/**
 * SearchIndexSystem — folds the staff search window once. Rebuilt whenever
 * the window is replaced (never patched per visit, never per keystroke).
 */
export const SearchIndexSystem = {
  build(visits: readonly Appointment[], labels: SearchLabels): SearchIndex {
    const clientText: string[] = [];
    const serviceText: string[] = [];
    const barberText: string[] = [];
    const emailText: string[] = [];
    const noteText: string[] = [];
    const phoneDigits: string[] = [];
    const barberIds: (readonly BarberId[])[] = [];
    const serviceIds: (readonly ServiceId[])[] = [];
    const variants: (readonly ServiceVariantPick[])[] = [];
    const variantKeys: (readonly string[])[] = [];
    const bookingStatus: BookingStatus[] = [];
    const localDate: LocalDate[] = [];
    const hasNote: boolean[] = [];
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i] as Appointment;
      clientText.push(joined(labels.clientNames(visit)));
      const services: ServiceId[] = [];
      const picks: ServiceVariantPick[] = [];
      const keys: string[] = [];
      const serviceNames: (string | null)[] = [];
      for (let s = 0; s < visit.seats.length; s++) {
        const seat = visit.seats[s] as Appointment['seats'][number];
        const serviceId = seat.serviceId;
        if (seat.variantId !== null) {
          const pick = ServiceVariantPick.of(serviceId, seat.variantId);
          const key = ServiceVariantPick.keyOf(pick);
          if (!keys.includes(key)) {
            picks.push(pick);
            keys.push(key);
          }
        }
        if (services.includes(serviceId)) continue;
        services.push(serviceId);
        serviceNames.push(labels.serviceName(serviceId));
      }
      serviceText.push(joined(serviceNames));
      serviceIds.push(services);
      variants.push(picks);
      variantKeys.push(keys);
      const barberNames: (string | null)[] = [];
      for (let b = 0; b < visit.barberIds.length; b++) {
        barberNames.push(labels.barberName(visit.barberIds[b] as BarberId));
      }
      barberText.push(joined(barberNames));
      barberIds.push(visit.barberIds);
      emailText.push(joined([visit.contactEmail]));
      noteText.push(joined([visit.contactNote]));
      phoneDigits.push(
        visit.contactPhone === null
          ? ''
          : visit.contactPhone.replace(NON_DIGITS, ''),
      );
      bookingStatus.push(visit.bookingStatus);
      localDate.push(visit.localDate);
      hasNote.push(visit.contactNote !== null && visit.contactNote.length > 0);
    }
    return {
      visitCount: visits.length,
      clientText,
      serviceText,
      barberText,
      emailText,
      noteText,
      phoneDigits,
      barberIds,
      serviceIds,
      variants,
      variantKeys,
      bookingStatus,
      localDate,
      hasNote,
    };
  },
} as const;
