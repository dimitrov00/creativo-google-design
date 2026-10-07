import { UserId } from '@creativo/application/accounts';
import {
  type Appointment,
  type Seat,
  type WaitlistRequest,
  ZonedDateTime,
  subjectVisitOf,
} from '@creativo/application/booking';
import { firstNameOf } from '../first-name';
import { visitRowOf, waitlistRowOf } from '../visit-row.presenter';
import type { VisitLookup, VisitRowVm } from '../visit-row.vm';
import type {
  VisitCardOptions,
  VisitCardVm,
  VisitLinePart,
  WaitlistCardOptions,
} from './visit-card.vm';

/*
 * THE CARD BUILDERS (client-card revision 3 §3.10, R2-I) — an appointment,
 * or a waiting request, into the one card `/account` and the staff glance
 * draw.
 *
 * Pure, as the row's builders are: the words arrive translated, the
 * catalogue arrives as a lookup, the clock arrives as a number. A card
 * builds the same in a spec, on the client's page and on the staff sheet.
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
 * Every date is formatted on the visit's own calendar — the shop's zone
 * travels with the instant — never on the device's.
 */

/** «·» between two facts of a line, as the row's fact line sets it. */
const JOINT = ' · ';

/** One appointment as a card: the last worked visit, or the next one to come. */
export function visitCardOf(
  appointment: Appointment,
  options: VisitCardOptions,
  lookup: VisitLookup,
): VisitCardVm {
  const words = options.words;
  const staff = options.perspective === 'staff';
  const last = options.kind === 'last';
  const start = appointment.timeSlot.start;
  const at = new CardClock(start, options.nowMs, options.locale);

  // The visit as both lists tell it. The grain is the list's, and a card
  // reads neither the tile nor the section it picks.
  const row = visitRowOf(
    appointment,
    {
      perspective: options.perspective,
      grain: 'month',
      subjectUserId: options.subjectUserId,
      currentAppointmentId: null,
      nowMs: options.nowMs,
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
  const barberIds = distinct(
    seatsOf(appointment, options).map((seat) => seat.barberId.value),
  );
  const nameOf = (barberId: string) =>
    lookup.barberName(barberId) ?? words.barberRole;
  const showBarber = options.barber !== false && barberIds.length > 0;
  const several = barberIds.length > 1;
  const whoShort = !showBarber
    ? null
    : !staff
      ? several
        ? words.severalBarbers(barberIds.length)
        : nameOf(barberIds[0] ?? '')
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
  const single = several ? null : (barberIds[0] ?? null);

  // WHERE — a worked visit's shop, by its short name, and only where the
  // tenant has more than one: the row's rule.
  const where =
    staff && last && row.outcome === 'worked' && lookup.locationCount > 1
      ? lookup.locationName(appointment.locationId.value)
      : null;

  // The figure is the staff's, of a worked visit: what the row prints on
  // its trailing edge, read from whichever of its two slots carries it
  // (`trailingFact` since revision 3, `trailing` before).
  const figure =
    staff && last && row.outcome === 'worked' ? amountOf(row) : null;

  // A status is news on a visit still to come, and only there.
  const status = appointment.status.kind;
  const statusWord =
    last || row.outcome !== 'open'
      ? null
      : status === 'pending'
        ? words.statusPending
        : status === 'confirmed'
          ? (words.statusConfirmed ?? null)
          : null;

  const tail = [whoShort, where]
    .filter((part): part is string => part !== null && part !== '')
    .map((part) => `${JOINT}${part}`)
    .join('');
  const today = at.isToday();
  const facts: readonly VisitLinePart[] = last
    ? [
        { text: today ? words.today : at.day(), fact: true },
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
  const note = row.quote === null ? null : (appointment.contact?.note ?? null);

  // Every fact the eye reads, in reading order, through the row's own
  // sentence: the facts after the day follow one another, the first of
  // them in the barber's slot.
  const said = [whoLong, where, figure, statusWord].filter(
    (part): part is string => part !== null && part !== '',
  );
  const when = last ? at.dayLong() : at.whenLong(words.today);
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
    id: appointment.id.value,
    kind: options.kind,
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
      alt: words.photoName(at.dayLong(photo.takenAtIso)),
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
): VisitCardVm {
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
    kind: 'waitlist',
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

// ── The story's seats ──────────────────────────────────────────────────

/**
 * The seats the card is about: the subject's own on the staff card (the
 * domain's reading, `subjectVisitOf`, the one the row and the statistics
 * count by); the whole party's on the client's page, and for a subject
 * with no seat on the visit.
 */
function seatsOf(
  appointment: Appointment,
  options: Pick<VisitCardOptions, 'perspective' | 'subjectUserId'>,
): readonly Seat[] {
  if (options.perspective !== 'staff' || options.subjectUserId === null) {
    return appointment.seats;
  }
  const subject = UserId.create(options.subjectUserId);
  const visit = subject.isSuccess()
    ? subjectVisitOf(subject.value, appointment)
    : null;
  return visit === null ? appointment.seats : visit.seats;
}

/** The row's money, charged: «27,50 €». A struck amount is a visit that did not happen. */
function amountOf(row: VisitRowVm): string | null {
  for (const slot of [row.trailingFact ?? null, row.trailing]) {
    if (slot !== null && slot.kind === 'amount' && !slot.struck) {
      return slot.text;
    }
  }
  return null;
}

/** Each once, in first-seen order. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ── The clock ──────────────────────────────────────────────────────────

/**
 * A visit's instant as a card prints it, on its own calendar against
 * "now". The two date faces are the card's own («5.09», «пт, 23.10»: a
 * row never prints its date); the day in words, the time and the list
 * are the row's forms.
 */
class CardClock {
  private readonly now: ZonedDateTime | null;

  constructor(
    private readonly start: ZonedDateTime,
    nowMs: number,
    private readonly locale: string,
  ) {
    const now = ZonedDateTime.fromMillis(nowMs, start.zoneName);
    this.now = now.isSuccess() ? now.value : null;
  }

  /** «10:00». */
  time(): string {
    return this.format(this.start, { hour: '2-digit', minute: '2-digit' });
  }

  /** «5.09» — a last visit's day (R59); the year only outside the current one. */
  day(): string {
    return this.format(this.start, {
      day: 'numeric',
      month: 'short',
      ...this.yearIfElsewhere(this.start),
    });
  }

  /** «пт, 23.10» — the day of a visit to come, as `/account` has always printed it. */
  weekdayAndDay(): string {
    return this.format(this.start, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...this.yearIfElsewhere(this.start),
    });
  }

  /**
   * «5 септември» — the day as a reader hears it; a photo's own day for
   * its name, the visit's when the photo's is unreadable.
   */
  dayLong(iso?: string): string {
    const taken =
      iso === undefined
        ? null
        : ZonedDateTime.fromISO(iso, this.start.zoneName);
    const day = taken !== null && taken.isSuccess() ? taken.value : this.start;
    return this.format(day, {
      day: 'numeric',
      month: 'long',
      ...this.yearIfElsewhere(day),
    });
  }

  /** «петък, 23 октомври в 10:00» · «днес, 10:00» — a visit to come, heard. */
  whenLong(today: string): string {
    return this.isToday()
      ? `${today}, ${this.time()}`
      : this.format(this.start, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          ...this.yearIfElsewhere(this.start),
          hour: '2-digit',
          minute: '2-digit',
        });
  }

  /** «Иван» · «Иван и Петър» — the people, as the locale lists them. */
  list(names: readonly string[]): string {
    return new Intl.ListFormat(this.locale, { type: 'conjunction' }).format(
      names,
    );
  }

  isToday(): boolean {
    return this.now !== null && this.now.toISODate() === this.start.toISODate();
  }

  /** The year only outside the current one (R59). */
  private yearIfElsewhere(
    instant: ZonedDateTime,
  ): Pick<Intl.DateTimeFormatOptions, 'year'> {
    return this.now === null || this.now.year === instant.year
      ? {}
      : { year: 'numeric' };
  }

  private format(
    instant: ZonedDateTime,
    options: Intl.DateTimeFormatOptions,
  ): string {
    return instant.toLocaleString(this.locale, options);
  }
}
