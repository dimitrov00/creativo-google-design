import type { Appointment, WaitlistRequest } from '@core/entities';
import {
  VisitGrain,
  VisitPerspective,
  VisitStatusMark,
} from '@core/components';
import type { BarberId } from '@core/primitives';
import { VisitStorySystem } from '@core/systems';
import { firstNameOf } from '../first-name';
import {
  subjectStoryOf,
  visitClockOf,
  visitRowOf,
  visitZoneOf,
  waitlistRowOf,
} from '../visit-row.presenter';
import type { VisitLookup } from '../visit-lookup.contracts';
import { TrailingFactFace, type VisitRowVm } from '../visit-row.vm';
import {
  type AppointmentCardVm,
  type VisitCardOptions,
  VisitCardSlot,
  type VisitLinePart,
  type WaitlistCardOptions,
  type WaitlistCardVm,
} from './visit-card.vm';

/*
 * THE CARD BUILDERS (client-card revision 3 §3.10, R2-I) — an appointment,
 * or a waiting request, into the one card `/account` and the staff glance
 * draw.
 *
 * Pure, as the row's builders are: the words arrive translated, the
 * catalogue arrives as a lookup, "now" arrives as the shop's `ShopNow`. A
 * card builds the same in a spec, on the client's page and on the staff
 * sheet, and reads the row's own clock (`visitClockOf`).
 *
 * A card is a ROW TOLD AT LENGTH, so it asks the row's own builders for
 * everything the two share and words nothing a second time: whose seats
 * the story is about, how the visit went, what it cost, whose words the
 * quote is (`visitRowOf`); the services, the watched days and the
 * sentence of a waiting request (`waitlistRowOf`). What is the card's
 * own is what a row never prints: the DATE as a fact of its line (a row's
 * date is its tile and its section), the barber as a face in the corner,
 * a status as a capsule, the label over it all.
 *
 * The visit's day and hour are its shop wall clock (`localDate` +
 * `startMinutes`), printed as stored; "now" and a photo's instant are read
 * in the location's zone, never the device's.
 */

/** «·» between two facts of a line, as the row's fact line sets it. */
const JOINT = ' · ';

/** One appointment as a card: the last worked visit, or the next one to come. */
export function visitCardOf(
  appointment: Appointment,
  options: VisitCardOptions,
  lookup: VisitLookup,
): AppointmentCardVm {
  const words = options.words;
  const staff = options.perspective === VisitPerspective.Staff;
  const last = options.visitCardSlot === VisitCardSlot.Last;
  const at = visitClockOf(
    appointment.localDate,
    appointment.startMinutes,
    options.now,
    options.locale,
    visitZoneOf(appointment.locationId, lookup) ?? options.timeZone,
  );

  // The visit as both lists tell it. The grain is the list's, and a card
  // reads neither the tile nor the section it picks.
  const row = visitRowOf(
    appointment,
    {
      perspective: options.perspective,
      grain: VisitGrain.Month,
      subjectUserId: options.subjectUserId,
      subjectCustomerId: options.subjectCustomerId,
      currentAppointmentId: null,
      now: options.now,
      timeZone: options.timeZone,
      locale: options.locale,
      words,
      clientWords: options.clientWords,
    },
    lookup,
  );

  const label =
    options.label ?? (last ? options.cardWords.last : options.cardWords.next);

  // WHO — the barbers of the seats the story is about. The line names a
  // barber the way the row's does: a first name on the staff card, the
  // name as the client knows it on their own; a party cut by several is
  // «Иван и Петър» to a barber and «2 бръснари» to the client.
  // The story is the row's own (the same subject, the same perspective).
  const story = subjectStoryOf(appointment, options);
  const barberIds = VisitStorySystem.subjectBarberIds(appointment, story);
  const nameOf = (barberId: BarberId) =>
    lookup.barberName(barberId) ?? words.barberRole;
  const showBarber = options.barber !== false && barberIds.length > 0;
  const several = barberIds.length > 1;
  const single = several ? null : (barberIds[0] ?? null);
  // `showBarber` holds a barber, so a lone one is `single`; the guarded
  // read words the role where (never) none is named, as an unknown barber.
  const whoShort = !showBarber
    ? null
    : !staff
      ? several
        ? words.severalBarbers(barberIds.length)
        : single === null
          ? words.barberRole
          : nameOf(single)
      : at.list(
          barberIds.map((barberId) => {
            const name = lookup.barberName(barberId);
            return name === null ? words.barberRole : firstNameOf(name);
          }),
        );
  const whoLong = !showBarber
    ? null
    : !staff && several
      ? words.severalBarbers(barberIds.length)
      : at.list(barberIds.map(nameOf));

  // WHERE — a worked visit's shop, by its short name, and only where the
  // tenant has more than one: the row's rule (`VisitStorySystem.namesShop`),
  // on the staff's last visit.
  const where =
    staff &&
    last &&
    VisitStorySystem.namesShop(story.outcome, lookup.locationCount)
      ? lookup.locationName(appointment.locationId)
      : null;

  // The figure is the staff's, of a worked visit: what the row prints at
  // the end of its second line (`trailingFact`) — charged, never struck,
  // which the row's figure is on a worked visit alone.
  const figure = staff && last ? amountOf(row) : null;

  // A status is news on a visit still to come, and only there: the next
  // visit's card words the hour the shop has or has not confirmed
  // (`VisitStorySystem.statusMark`, open hours only).
  const statusMark = last
    ? null
    : VisitStorySystem.statusMark(story.outcome, appointment.bookingStatus);
  const statusWord =
    statusMark === VisitStatusMark.Pending
      ? words.statusPending
      : statusMark === VisitStatusMark.Confirmed
        ? (words.statusConfirmed ?? null)
        : null;

  const tail = [whoShort, where]
    .filter((part): part is string => part !== null && part !== '')
    .map((part) => `${JOINT}${part}`)
    .join('');
  const today = at.isToday();
  const facts: readonly VisitLinePart[] = last
    ? [
        { text: today ? words.today : at.dayShort(), fact: true },
        ...(tail === '' ? [] : [{ text: tail, fact: false }]),
      ]
    : [
        {
          text: `${today ? words.today : at.weekdayAndDay()}${JOINT}`,
          fact: false,
        },
        { text: at.time(), fact: true },
        ...(tail === '' ? [] : [{ text: tail, fact: false }]),
      ];

  // The client's own words, as the row rules whose they are. The sentence
  // says them whole, in its own form («от клиента: „…“»).
  const note = row.quote === null ? null : appointment.contactNote;

  // Every fact the eye reads, in reading order, through the row's own
  // sentence: the facts after the day follow one another, the first of
  // them in the barber's slot.
  const said = [whoLong, where, figure, statusWord].filter(
    (part): part is string => part !== null && part !== '',
  );
  const when = last ? at.dayLong() : at.whenHeard(words.today);
  const worded = words.rowName({
    title: row.title,
    when,
    barber: said[0] ?? '',
    outcome: said
      .slice(1)
      .map((part) => `, ${part}`)
      .join(''),
    price: '',
    marks: '',
    quote: note === null ? '' : words.quoteName(note),
  });
  // With nothing to say after the day (`/account`, no status word) the
  // barber's slot stands empty, and its joint goes with it: «…, 10:00»,
  // never «…, 10:00, ».
  const sentence = said.length > 0 ? worded : worded.replace(`${when}, `, when);

  return {
    id: appointment.id,
    visitCardSlot: options.visitCardSlot,
    label,
    services: row.title,
    facts,
    figure,
    quote: row.quote,
    capsule: statusWord === null ? null : { text: statusWord, tone: 'accent' },
    barber:
      !showBarber || single === null
        ? null
        : { name: nameOf(single), avatarSrc: lookup.barberAvatarSrc(single) },
    photos: (options.photos ?? []).slice(0, 3).map((photo) => ({
      id: photo.id,
      url: photo.url,
      alt: words.photoName(at.dayLong(photo.takenAtUtcMs)),
    })),
    accessibleName: options.cardWords.name(label, sentence),
    testId: options.testId,
  };
}

/**
 * A request waiting for a free slot, as a card: the state is its label,
 * «Чака свободен час», the services lead as on every card, and the quiet
 * line holds the days it still watches and the person's other requests —
 * «8.10 – 9.10, следобед · още 1». No fact is set apart in it: nothing is
 * booked yet, so no date is THE date.
 */
export function waitlistCardOf(
  request: WaitlistRequest,
  options: WaitlistCardOptions,
  lookup: VisitLookup,
): WaitlistCardVm {
  const words = options.words;
  const row = waitlistRowOf(
    request,
    {
      words,
      today: options.today,
      locale: options.locale,
      otherRequests: options.otherRequests,
    },
    lookup,
  );
  // The row words the state on a line of its own and the watched days
  // under it; a request with no day left to name has the state's line
  // alone.
  const days = row.lines.length > 1 ? (row.lines.at(-1)?.text ?? '') : '';
  const others = options.otherRequests ?? 0;
  const more = others > 0 ? words.moreRequests(others) : '';
  const line = [days, more].filter((part) => part !== '').join(' ');

  return {
    id: row.id,
    visitCardSlot: VisitCardSlot.Waitlist,
    label: words.waiting,
    services: row.title,
    facts: line === '' ? [] : [{ text: line, fact: false }],
    figure: null,
    quote: null,
    capsule: null,
    barber: null,
    photos: [],
    // The request's own sentence names its state: «…, чака свободен час: …».
    accessibleName: row.accessibleName,
    testId: options.testId,
  };
}

// ── The row's figure ───────────────────────────────────────────────

/** The row's money, charged: «27,50 €». A struck amount is a visit that did not happen. */
function amountOf(row: VisitRowVm): string | null {
  const fact = row.trailingFact;
  return fact !== null &&
    fact.trailingFactFace === TrailingFactFace.Amount &&
    !fact.struck
    ? fact.text
    : null;
}
