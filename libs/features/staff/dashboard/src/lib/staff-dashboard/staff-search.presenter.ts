import {
  SearchFieldsSystem,
  PhoneSystem,
  TextMatchSystem,
  VisitStorySystem,
} from '@core/systems';
import { SeatSubject, type ShopNow } from '@core/components';
import type { Appointment } from '@core/entities';
import type { LocationId } from '@core/primitives';
import { formatWallClock } from '@creativo/ui/wall-clock';
import { guestLabelOf } from './staff-day-guest.words';
import type { StaffCatalogNames } from './staff-day-chrome.presenter';
import {
  SearchField,
  type SearchHitVm,
  type SearchMatch,
  type SearchableField,
} from './staff-search.vm';

/*
 * THE SEARCH SHEET, WORDED (Law 10). The outward order and what counts as
 * past are `VisitStorySystem.outwardFromNow`'s, the digit rule
 * `SearchFieldsSystem`'s; this reads each visit's text fields and marks the
 * runs that matched (pass C PC-D-3: the collation match and its highlight are
 * no decision, and they could never live in a system).
 */

/** What the hits are worded from. */
export interface SearchInput {
  /** The term as typed; trimmed and folded on the Bulgarian collation here. */
  readonly term: string;
  /** The loaded window of visits. */
  readonly pool: readonly Appointment[];
  /** Each shop's own `ShopNow`, read at the store's edge at this tick. */
  readonly shopNowAt: (locationId: LocationId) => ShopNow | null;
  readonly names: StaffCatalogNames;
  /** A wall-clock reading prints nothing before the zone is known (D-6.2). */
  readonly zoneKnown: boolean;
  readonly locale: string;
  /** A companion's own name, by account, once his profile is read. */
  readonly companionNames: Readonly<Record<string, string>>;
  /** «Клиент без име» — `staff.day.unnamedClient`. */
  readonly unnamedClient: string;
}

/**
 * Does this field hold the term — by text (the Bulgarian collation, this
 * page's), or by the term's bare digits for a phone (`digits`, `null` when
 * the term is no phone number — `SearchFieldsSystem.digitQuery`)?
 */
export function matches(
  field: SearchableField,
  term: string,
  digits: string | null,
): boolean {
  if (field.value.toLocaleLowerCase('bg').includes(term)) return true;
  return (
    digits !== null &&
    field.label === SearchField.Phone &&
    SearchFieldsSystem.digitsMatch(field.value, digits)
  );
}

/**
 * The hits for a term, or none for a term too short to search.
 *
 * Matched in memory against a window the store loaded once — Firestore
 * cannot substring-match, and the fields a shop actually searches by
 * (name, phone, email, note, service) are four different shapes, one of
 * them nested inside the `seats` array.
 */
export function searchHits(input: SearchInput): readonly SearchHitVm[] {
  const term = input.term.trim().toLocaleLowerCase('bg');
  if (!SearchFieldsSystem.termSearchable(term)) return [];

  // Digits-only alias, so "887778899" finds "+359 88 777 8899". A person
  // searching by phone types the number off a screen or a card, never with
  // the formatter's spaces in it (`digitQuery`: `null` when it is none).
  const digits = SearchFieldsSystem.digitQuery(term);

  const found = new Map<Appointment, SearchMatch>();
  const visits: Appointment[] = [];
  for (const appointment of input.pool) {
    const fields = searchableFields(appointment, input.names);
    const matched = fields.filter((field) => matches(field, term, digits));
    if (matched.length === 0) continue;
    found.set(appointment, { fields, matched });
    visits.push(appointment);
  }

  // Soonest first among the future; most recent first among the past —
  // the two things a person searching a book is actually looking for.
  // A visit is past once it has ENDED, on its own shop's clock
  // (`VisitStorySystem.outwardFromNow`, the grid's definition too).
  return VisitStorySystem.outwardFromNow(visits, (visit) =>
    input.shopNowAt(visit.locationId),
  ).map(({ visit: appointment, past }) => {
    const { fields, matched } = found.get(appointment) as SearchMatch;
    // The client is the title, highlighted when it is what matched. Every
    // OTHER matched field lists beneath — so a phone search shows the
    // number it hit, and a name search does not print the name twice.
    const titleField = titleFieldOf(appointment, fields, input);
    return {
      id: appointment.id,
      dayKey: appointment.localDate,
      whenLabel: input.zoneKnown
        ? formatWallClock(
            appointment.localDate,
            appointment.startMinutes,
            input.locale,
            {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            },
          )
        : '',
      past,
      bookingStatus: appointment.bookingStatus,
      titleParts: titleField
        ? TextMatchSystem.segments(titleField.value, term)
        : [{ text: '', hit: false }],
      matches: matched
        .filter((field) => field !== titleField)
        .map((field) => ({
          label: field.label,
          // Highlight the run that actually matched: the digits form
          // when that is what hit, the typed term otherwise.
          parts:
            digits !== null && field.label === SearchField.Phone
              ? TextMatchSystem.phoneSegments(field.value, digits)
              : TextMatchSystem.segments(field.value, term),
        })),
    };
  });
}

/**
 * A hit's title: the contact, else the first seat whose person has a name (a
 * guest's label, a read companion's profile), else, for an account seat with
 * no name anywhere, the unnamed word. Any other field only with no person at
 * all.
 */
function titleFieldOf(
  appointment: Appointment,
  fields: readonly SearchableField[],
  input: SearchInput,
): SearchableField | undefined {
  if (appointment.contactName) return fields[0];
  for (const seat of appointment.seats) {
    const name =
      guestLabelOf(seat) ??
      (seat.seatSubject === SeatSubject.Account
        ? input.companionNames[seat.subjectUserId]
        : undefined);
    if (name === undefined) continue;
    return (
      fields.find(
        (field) => field.label === SearchField.Client && field.value === name,
      ) ?? { label: SearchField.Client, value: name }
    );
  }
  return appointment.seats.length > 0
    ? { label: SearchField.Client, value: input.unnamedClient }
    : fields[0];
}

/** Every field a search is allowed to look at, in display priority. */
export function searchableFields(
  appointment: Appointment,
  names: StaffCatalogNames,
): readonly SearchableField[] {
  const out: SearchableField[] = [];
  if (appointment.contactName) {
    out.push({ label: SearchField.Client, value: appointment.contactName });
  }
  for (const seat of appointment.seats) {
    const guestLabel = guestLabelOf(seat);
    if (guestLabel !== null) {
      out.push({ label: SearchField.Client, value: guestLabel });
    }
    const service = names.findService(seat.serviceId);
    if (service) {
      out.push({
        label: SearchField.Service,
        value: names.text(service.name),
      });
    }
  }
  if (appointment.contactPhone !== null) {
    out.push({
      label: SearchField.Phone,
      value: PhoneSystem.formatInternational(appointment.contactPhone),
    });
  }
  if (appointment.contactEmail !== null) {
    out.push({ label: SearchField.Email, value: appointment.contactEmail });
  }
  if (appointment.contactNote) {
    out.push({ label: SearchField.Note, value: appointment.contactNote });
  }
  return out;
}
