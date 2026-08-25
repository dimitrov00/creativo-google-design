import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideRouter } from '@angular/router';
import {
  APPOINTMENT_REPOSITORY,
  AVAILABILITY_READER,
  Appointment,
  BOOKING_GATEWAY,
  BookingContact,
  Interval,
  Money,
  Seat,
  SeatId,
  SCHEDULE_EXCEPTION_WRITER,
  Result,
  ScheduleException,
  SeatSubject,
  ZonedDateTime,
  ok,
} from '@creativo/application/booking';
import {
  Barber,
  BarberId,
  CATALOG_READER,
  LocationId,
  MEDIA_READER,
  ServiceId,
  ServiceTerms,
} from '@creativo/application/catalog';
import { UserId } from '@creativo/application/accounts';
import { CLOCK } from '@creativo/application/shared';
import { StaffDashboard } from './staff-dashboard';

const ZONE = 'Europe/Sofia';

function value<T, E>(result: Result<T, E>): T {
  if (!result.isSuccess()) throw new Error('bad fixture');
  return result.value;
}

function at(iso: string): ZonedDateTime {
  return value(ZonedDateTime.fromISO(iso, ZONE));
}

function barber(id: string, name: string): Barber {
  return value(
    Barber.create({
      id,
      name: { en: name, bg: name },
      handle: id,
      title: { en: 'Barber', bg: 'Бръснар' },
      bio: { en: 'Bio', bg: 'Био' },
      // A real location: blocking time writes against the chair's own shop,
      // and a barber with none would make the write silently no-op.
      locationIds: ['loc-center'],
      status: 'active',
      sortOrder: 0,
    }),
  );
}

/** One booked visit in `ivan`'s chair, starting at `startIso`. */
function appointment(
  id: string,
  startIso: string,
  contact?: { name: string; phone: string },
  barberId = 'ivan',
): Appointment {
  const price = value(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  const seat = Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(UserId.generate(), 'self'),
    serviceId: ServiceId.generate(),
    variantId: null,
    barberId: value(BarberId.create(barberId)),
    terms: value(ServiceTerms.create(price, 30)),
    startsAt: at(startIso),
  });
  return value(
    Appointment.create({
      id,
      locationId: LocationId.generate().toString(),
      seats: [seat],
      now: at('2026-08-05T08:00:00'),
      contact: contact
        ? value(
            BookingContact.create({
              name: contact.name,
              phone: contact.phone,
              email: null,
              // A real note, so the glyph row has something in it: the specs
              // that read that row passed vacuously against a card with
              // nothing to show.
              note: 'Скъсява отстрани',
            }),
          )
        : null,
    }),
  );
}

function interval(startIso: string, endIso: string): Interval {
  return Interval.of(at(startIso).toMillis(), at(endIso).toMillis());
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

describe('StaffDashboard', () => {
  let fixture: ComponentFixture<StaffDashboard>;

  /** Ivan holds one 10:00 visit; Niko's chair is empty. */
  const observeBarberDay = vi.fn((barberId: { value: string }) =>
    of(
      ok(
        barberId.value === 'ivan'
          ? [
              // WITH a contact: the phone path is half this surface's point,
              // and without one "does not print the phone in the run" passed
              // vacuously against a row that had no phone to print.
              appointment('appointment-1', '2026-08-05T10:00:00', {
                name: 'Мартин Илиев',
                phone: '+359881234567',
              }),
            ]
          : [],
      ),
    ),
  );

  /**
   * Ivan is rostered 09:00–18:00 with 10:00–10:30 taken; Niko is NOT rostered
   * at all, which is what separates "off today" from "free day".
   */
  const observeDay = vi.fn(() =>
    of(
      ok([
        {
          barberId: value(BarberId.create('ivan')),
          windows: [
            {
              interval: interval('2026-08-05T09:00:00', '2026-08-05T18:00:00'),
              locationId: LocationId.generate(),
            },
          ],
          busy: [interval('2026-08-05T10:00:00', '2026-08-05T10:30:00')],
        },
      ]),
    ),
  );

  const put = vi.fn((_exception: ScheduleException) =>
    Promise.resolve(ok(undefined)),
  );
  const clear = vi.fn((_barberId: string, _dayKey: string) =>
    Promise.resolve(ok(undefined)),
  );
  // Hoisted so the guards below can assert that a destructive write did NOT
  // happen on the tap that asked for it.
  const transition = vi.fn((_input: unknown) => Promise.resolve(ok(undefined)));

  /**
   * The whole fixture, with the CLOCK as the one dial worth turning.
   *
   * 09:00 — the first rostered minute — is the right default: it puts the
   * entire day ahead of the reader and keeps every other test's arithmetic
   * simple. It is also the one moment at which "nothing has elapsed yet" is
   * true, so any rule about elapsed time has to move it, or pass vacuously.
   */
  async function build(
    nowIso = '2026-08-05T09:00:00.000+03:00',
  ): Promise<void> {
    // `AgendaFields` persists to localStorage, which jsdom shares across
    // every test in the file — one `toggle` leaked into all of them and
    // "ships with free time off" quietly stopped being testable.
    localStorage.clear();
    observeBarberDay.mockClear();
    observeDay.mockClear();
    put.mockClear();
    clear.mockClear();
    transition.mockClear();
    await TestBed.configureTestingModule({
      imports: [StaffDashboard],
      providers: [
        ...provideTestI18n(),
        // The store publishes the shown day into `?day=` so it can be pasted
        // into a staff chat; without a router that write throws on first read.
        provideRouter([]),
        {
          provide: CLOCK,
          useValue: {
            now: (zone: string) => ZonedDateTime.fromISO(nowIso, zone),
          },
        },
        {
          provide: APPOINTMENT_REPOSITORY,
          useValue: {
            observeBarberDay,
            searchWindow: () =>
              Promise.resolve(
                ok([
                  appointment('appointment-1', '2026-08-05T10:00:00', {
                    name: 'Георги Петров',
                    phone: '+359 88 123 4567',
                  }),
                ]),
              ),
            findById: () => Promise.resolve(ok(null)),
            observeUpcomingFor: () => of(ok([])),
            observeHistoryFor: () => of(ok([])),
            save: () => Promise.resolve(ok(undefined)),
          },
        },
        {
          provide: BOOKING_GATEWAY,
          useValue: {
            transition,
            commit: () => Promise.reject(new Error('not under test')),
            cancel: () => Promise.reject(new Error('not under test')),
            reschedule: () => Promise.reject(new Error('not under test')),
          },
        },
        {
          // A REAL roster. The stub used to return no barbers, which meant
          // not one lane, row, gap or verb on this surface was under test.
          provide: CATALOG_READER,
          useValue: {
            listActiveServices: () => of(ok([])),
            listActiveBarbers: () =>
              of(ok([barber('ivan', 'Иван'), barber('niko', 'Нико')])),
            listServiceCategories: () => of(ok([])),
            listActiveLocations: () => of(ok([])),
            findServiceById: () => Promise.resolve(ok(null)),
            findBarberById: () => Promise.resolve(ok(null)),
            findLocationById: () => Promise.resolve(ok(null)),
          },
        },
        {
          provide: AVAILABILITY_READER,
          useValue: {
            observeDay,
            observeRangeCapacity: () => of(ok(new Map())),
          },
        },
        { provide: SCHEDULE_EXCEPTION_WRITER, useValue: { put, clear } },
        {
          provide: MEDIA_READER,
          useValue: { resolve: () => Promise.resolve(ok([])) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StaffDashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => build());

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Free time is a switch, and it ships OFF — see `agenda-fields`. */
  function showFreeTime(): void {
    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    if (!component.fields.isOn('freeTime')) component.fields.toggle('freeTime');
    fixture.detectChanges();
  }

  it('opens on TODAY, named in the header', () => {
    const label = host().querySelector('[data-testid="staff-day-label"]');
    // 2026-08-05 is a Wednesday; bg locale spells it out.
    expect(label?.textContent).toContain('5');
    expect(host().querySelector('[data-testid="staff-day-today"]')).toBeNull();
  });

  it('title-cases the month in the period label', () => {
    // Bulgarian writes months lowercase in prose ("7 август") and `Intl`
    // follows the language — but this is a heading, not a sentence.
    const label = host()
      .querySelector('[data-testid="staff-day-label"]')
      ?.textContent?.trim();
    expect(label).toContain('Август');
    expect(label).not.toContain('август');
  });

  it('reaches another day through the date pull-down', async () => {
    // The ± chevrons are gone (owner ruling 2026-08-07, matching the
    // reference): the period label IS the control, and it opens a month.
    expect(host().querySelector('[data-testid="staff-day-prev"]')).toBeNull();

    (
      host().querySelector(
        '[data-testid="staff-day-label"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    (
      host().querySelector(
        '[data-testid="staff-date-2026-08-06"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host().querySelector('[data-testid="staff-day-label"]')?.textContent,
    ).toContain('6');
    // Off today, the anchor back appears.
    expect(
      host().querySelector('[data-testid="staff-day-today"]'),
    ).not.toBeNull();
  });

  it('draws ONE clock-ordered run, not a column per chair', () => {
    // The list used to be a list per barber, stacked — three schedules on
    // one page, the same hour written three times. The agenda groups by
    // start time instead, and a barber who is off contributes nothing.
    expect(host().querySelectorAll('[data-testid="staff-lane"]').length).toBe(
      0,
    );
    const groups = host().querySelectorAll(
      '[data-testid="staff-agenda-group"]',
    );
    expect(groups.length).toBeGreaterThan(0);
  });

  it('banners the barber who is off as an ALL-DAY event, above the run', () => {
    // The old surface rendered "free day" under a barber on holiday, which is
    // the same invented fact as a fabricated number. Then it was a line of
    // grey footnote type UNDER the whole agenda — read last, when it is the
    // first thing a shop needs. Then a small inline capsule, which still read
    // as chrome. It is an all-day EVENT, so it is built from the event's own
    // parts and banners above the timed run the way Apple Calendar does.
    const off = host().querySelector('[data-testid="staff-off-today"]');
    expect(off).not.toBeNull();

    // THE SAME GROUND as the cards below it — `.agenda-card` is what supplies
    // the 14% chair tint and the padding. If this ever stops being an agenda
    // card it stops being recognisable as an event.
    expect(off?.classList.contains('agenda-card')).toBe(true);
    expect(off?.getAttribute('data-barber-tone')).not.toBeNull();

    // NO RAIL. The rail is a straight bar down a leading edge and this row is
    // a capsule; the chair's colour moved into a disc instead — the same
    // shape and slot the client's avatar occupies on every card below.
    expect(off?.querySelector('.agenda-card__rail')).toBeNull();
    expect(off?.querySelector('.agenda-allday__disc')).not.toBeNull();

    // PRESSABLE, and a real button rather than a div with a handler — it
    // opens the block sheet, which is where days off are actually edited.
    expect(off?.tagName.toLowerCase()).toBe('button');
    expect(off?.hasAttribute('data-interactive')).toBe(true);

    // The barber's name is plain foreground, exactly as every client's name
    // on the cards is. It was tinted for a while, which made the same kind of
    // thing read as two different kinds.
    const name = off?.querySelector('.agenda-allday__name');
    expect(name?.getAttribute('data-foreground-style')).toBeNull();
    expect(name?.getAttribute('data-font')).toBe('callout');

    // ABOVE the run. `compareDocumentPosition` rather than reading the
    // markup, so a refactor that moves either one is caught.
    const agenda = host().querySelector('.agenda');
    expect(agenda).not.toBeNull();
    const isBefore = !!(
      off!.compareDocumentPosition(agenda!) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(isBefore).toBe(true);

    // No "all day" caption: a full-width tinted row above the run carrying no
    // clock time, when every card below carries one, says it by construction.
    expect(host().querySelector('.staff-allday__label')).toBeNull();

    const component = fixture.componentInstance as unknown as {
      resting: () => { id: string; name: string; tone: number }[];
    };
    expect(component.resting().map((b) => b.name)).toEqual(['Нико']);
  });

  it('opens the rest day for editing, already knowing it is all day', () => {
    // A card-shaped thing at a full touch target that does nothing when
    // pressed is a worse lie than the footnote it replaced. It reuses the
    // block sheet rather than growing a second editor — with the all-day
    // switch already true, because the barber IS off all day and the sheet
    // should open showing that rather than asking from scratch.
    const component = fixture.componentInstance as unknown as {
      openRestDay: (id: string) => void;
      blockLaneId: () => string | null;
      blockAllDay: () => boolean;
    };
    component.openRestDay('nikо-test-id');
    expect(component.blockLaneId()).toBe('nikо-test-id');
    expect(component.blockAllDay()).toBe(true);
  });

  it('never says "off today" and "nobody in the catalog" at once', () => {
    // Both branches used to fire on an empty day, so the screen named three
    // resting barbers and then announced there were none — one of the two
    // sentences necessarily false.
    const offToday = host().querySelector('[data-testid="staff-off-today"]');
    expect(offToday).not.toBeNull();
    // The fixture has one rostered chair AND one resting one; the no-roster
    // line must stay away while either of those is true.
    expect(
      host().querySelectorAll('[data-testid="staff-agenda-group"]').length,
    ).toBeGreaterThan(0);
    expect(host().textContent).not.toContain('staff.day.noRoster');
  });

  it('gives every time group a real heading that names its own run', () => {
    // Headings are what make the rotor usable; they moved from the barber
    // (three of them) to the hour (as many as the day has starts).
    const heading = host().querySelector('h2.agenda-group__time');
    expect(heading).not.toBeNull();
    const run = host().querySelector('ul[aria-labelledby]');
    expect(run?.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('identifies the barber with a face and a rail, never a word', () => {
    // Three answers to one question was two too many. The card carries the
    // barber's own photograph in the trailing cluster and their chair's
    // colour down the rail; spelling the name out underneath repeated it a
    // third time, in the one column whose premise is that each line is a
    // fact you do not already have. The `barber` field is retired.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.getAttribute('data-barber-tone')).not.toBeNull();
    expect(card?.querySelector('.agenda-card__rail')).not.toBeNull();
    expect(card?.querySelector('.agenda-card__barber-face')).not.toBeNull();
    // No name row, and no switch that could bring one back.
    expect(host().querySelector('.agenda-card__fact--chair')).toBeNull();
    const component = fixture.componentInstance as unknown as {
      agendaFieldIds: readonly string[];
    };
    expect(component.agendaFieldIds).not.toContain('barber');
    // The face still ANNOUNCES the name, for anyone not reading colour.
    expect(
      card
        ?.querySelector('.agenda-card__barber-face')
        ?.getAttribute('aria-label'),
    ).toBeTruthy();
  });

  it('names the act after the client it acts on, in the sheet', async () => {
    // Twelve buttons a day all called "Дойде" is unusable in a rotor. The
    // acts moved to the sheet; their names moved with them.
    const card = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    card.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid^="staff-visit-act-"]'),
    ).not.toBeNull();
    // And the card can still take focus when its state changes underneath.
    expect(card.getAttribute('tabindex')).toBe('-1');
  });

  it('carries a note as a MARK in the trailing cluster, not as a row', () => {
    // Its text was a clamped line in the fact column — the one fact there
    // that could not be read in full, sitting in a column whose whole
    // premise is that everything gets its place. A mark says "there is one"
    // honestly; the sheet says what it is.
    expect(host().querySelector('[data-testid="staff-visit-note"]')).toBeNull();
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    const foot = card?.querySelector('.agenda-card__foot');
    expect(foot?.querySelector('.agenda-card__mark')).not.toBeNull();

    // And it is the NOTE field that governs the mark, now that the row is
    // gone — otherwise the switch would control nothing at all.
    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
      rowIcons: (e: {
        rebooked: boolean;
        hasNote: boolean;
      }) => readonly string[];
    };
    expect(component.rowIcons({ rebooked: false, hasNote: true })).toContain(
      'visit.note',
    );
    if (component.fields.isOn('note')) component.fields.toggle('note');
    expect(
      component.rowIcons({ rebooked: false, hasNote: true }),
    ).not.toContain('visit.note');
  });

  it('accounts for every rostered minute — the run carries gaps, not just visits', () => {
    showFreeTime();
    const gaps = host().querySelectorAll('[data-testid="staff-gap-row"]');
    // 09:00–18:00 minus a 10:00–10:30 visit = two sellable holes.
    expect(gaps.length).toBe(2);
    // The START is the group's heading now, not something each card repeats
    // — that redundancy is exactly what the agenda exists to remove.
    const starts = [...host().querySelectorAll('.agenda-group__time')].map(
      (heading) => heading.textContent?.trim(),
    );
    expect(starts).toContain('09:00');
    expect(starts).toContain('10:30');
    // A gap says WHOSE chair is free — unattributed free time is meaningless
    // in a run that mixes every barber. It says it in the rail's tone now
    // rather than in a name, which is what took the widest chip off the card.
    expect(gaps[0]?.getAttribute('data-barber-tone')).not.toBeNull();
  });

  it('orders the run by the clock, interleaving gaps with visits', () => {
    showFreeTime();
    const rows = [
      ...host().querySelectorAll(
        '[data-testid="staff-gap-row"], [data-testid="staff-visit-row"]',
      ),
    ];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'staff-gap-row',
      'staff-visit-row',
      'staff-gap-row',
    ]);
  });

  it('carries NO act on the card — the card opens the act instead', () => {
    // HIG's own reading of a list like this (owner ruling): the row is the
    // interactive thing and the verbs live in what it opens. An inline button
    // restates on every card a small set of acts the reader learns once, and
    // it competes with the one thing the card must land: who.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.querySelector('[data-testid^="staff-act-"]')).toBeNull();
    expect(card?.querySelector('[data-testid="staff-row-menu"]')).toBeNull();
    expect(card?.querySelector('ui-menu')).toBeNull();
  });

  it('prints status only when it is an EXCEPTION', () => {
    // The badge printed on every card — "Потвърден" nine times in ten, the
    // widest pill on the row, saying what a booking is by default. Ordinary
    // states are carried by the rail's form; the word fires only when
    // something went other than to plan.
    const component = fixture.componentInstance as unknown as {
      statusWord: (status: string) => string | null;
    };
    expect(component.statusWord('confirmed')).toBeNull();
    expect(component.statusWord('completed')).toBeNull();
    expect(component.statusWord('no_show')).not.toBeNull();
    expect(component.statusWord('cancelled')).not.toBeNull();
  });

  it('puts the client at the head of the body row and the barber at its end', () => {
    // The barber was an 18px badge on the client's corner. Measured across
    // the roster, a photo at that size had a mean pairwise RGB distance of
    // 23 between chairs against the rail's 102 — it identified nobody. It is
    // a full disc at the far end of the row now, filled with the chair's
    // tone and carrying the barber's initials.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    const body = card?.querySelector('.agenda-card__body');
    const foot = card?.querySelector('.agenda-card__foot');
    expect(body).not.toBeNull();
    expect(foot).not.toBeNull();
    const face = body?.querySelector('.agenda-card__face');
    expect(face).not.toBeNull();
    // The barber is no longer INSIDE the client's face...
    expect(face?.querySelector('.agenda-card__barber-face')).toBeNull();
    // ...it shares the FOOT row with the marks, after them...
    const barber = foot?.querySelector('.agenda-card__barber-face');
    expect(barber).not.toBeNull();
    const mark = foot?.querySelector('.agenda-card__mark');
    if (mark && barber) {
      expect(
        mark.compareDocumentPosition(barber) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // ...and that row is its own band across the card, after the body — not
    // crammed into the narrow column the times need.
    expect(
      body &&
        foot &&
        body.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('reserves the face column on the RUN, so names start at one x', () => {
    // Per card, a client with no disc would shift their own name left and
    // the run would stop being scannable down its leading edge.
    const component = fixture.componentInstance as unknown as {
      faceWidth: () => string;
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    expect(component.faceWidth()).not.toBe('0px');
    if (component.fields.isOn('avatar')) component.fields.toggle('avatar');
    if (component.fields.isOn('barberAvatar')) {
      component.fields.toggle('barberAvatar');
    }
    expect(component.faceWidth()).toBe('0px');
  });

  it('says a STATE with a dot and a COUNT with a numeral, both labelled', () => {
    // Status is a dot — the reference's rule taken literally, and what every
    // messaging app means by a dot on an avatar: this person is here. A count
    // is a numeral, because the glyph beside it said "people" and only the
    // number was information. Neither is ever a word or a capsule in the run.
    expect(
      host().querySelector('[data-testid="staff-visit-note-glyph"]'),
    ).toBeNull();
    expect(host().querySelector('.agenda-card__glyphs')).toBeNull();

    // Whatever marks DO render, each is announced — an unlabelled mark on a
    // card whose whole body opens a sheet cannot say what it means.
    for (const dot of host().querySelectorAll('.agenda-card__dot')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(dot.nextElementSibling?.hasAttribute('data-visually-hidden')).toBe(
        true,
      );
    }
    for (const party of host().querySelectorAll('.agenda-card__party')) {
      expect(party.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('reserves NO trailing column — the meta cluster collapses instead', () => {
    // `trailWidth()` held a column open from FIELD STATE, so a switch being
    // on cost width whether or not a single card on screen had anything to
    // put there: 68px of a 298px phone card, taken from the one line that
    // must never truncate, to align a column of nothing with a column of
    // nothing. There is no reserved column now — the cluster is a flex item
    // that is simply absent when empty.
    const component = fixture.componentInstance as unknown as {
      trailWidth?: unknown;
      hasMeta: (entry: {
        partySize: number;
        priceLabel: string | null;
      }) => boolean;
    };
    expect(component.trailWidth).toBeUndefined();
    expect(host().querySelector('.agenda-card__trail')).toBeNull();
    // The run no longer publishes the custom property either.
    const run = host().querySelector('.agenda') as HTMLElement | null;
    expect(run?.style.getPropertyValue('--agenda-trail')).toBeFalsy();
  });

  it('ships free time OFF, and states the quiet in words instead', () => {
    // Every unsold minute is a card, and on the quiet Tuesday that is most
    // of a shop's week the run becomes mostly holes. The screen's job is the
    // bookings; the holes are a second question, asked by whoever is trying
    // to fill one. Turning the inventory off must never hide the FACT of it.
    expect(
      host().querySelectorAll('[data-testid="staff-gap-row"]').length,
    ).toBe(0);
    // The day still SAYS it was quiet, in the summary — but only at one
    // chair, where unsold minutes are clock hours rather than chair-hours.
    // The suite runs at whole-shop scope, so the line is absent here.
    expect(
      host().querySelector('[data-testid="staff-day-summary"]'),
    ).toBeNull();
    showFreeTime();
    expect(
      host().querySelectorAll('[data-testid="staff-gap-row"]').length,
    ).toBeGreaterThan(0);
  });

  it('strikes a CANCELLED booking through, and a no-show never', () => {
    // The platform's own mark for something that is on the calendar and is
    // not happening. A no-show HAPPENED — the chair was held and nobody came
    // — and a line through it would say the booking was withdrawn, which is
    // a different fact and the one thing that row exists to record.
    // jsdom does not resolve component styles, so the rendered line cannot
    // be asserted here — it is verified in the browser. What this locks is
    // the HOOK the rule hangs on: every card publishes its exact status, and
    // the two statuses stay distinguishable to a selector.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.getAttribute('data-status')).toBe('pending');
    const component = fixture.componentInstance as unknown as {
      statusWord: (status: string) => string | null;
    };
    expect(component.statusWord('cancelled')).not.toBe(
      component.statusWord('no_show'),
    );
  });

  it('says the state to a screen reader even though the card only shows it', () => {
    // The state is carried by the card's FORM now — hollow for a cancelled
    // booking or a no-show, dashed for pending, plus a strike through the
    // name. A screen reader perceives NONE of that: `text-decoration` is not
    // announced and a missing background certainly is not. Without this the
    // change would have made a cancelled row indistinguishable from a live
    // one for anyone not looking at it.
    const component = fixture.componentInstance as unknown as {
      rowLabel: (e: {
        clientLabel: string;
        startLabel: string;
        status: string;
        arrived: boolean;
        terminal: boolean;
      }) => string;
    };
    const label = (status: string) =>
      component.rowLabel({
        clientLabel: 'Николай',
        startLabel: '10:00',
        status,
        arrived: false,
        terminal: false,
      });

    // The states the FORM speaks are all appended to the name.
    for (const status of ['cancelled', 'no_show', 'pending']) {
      expect(label(status)).toContain('staff.day.exception.' + status);
    }
    // ...and the two ordinary outcomes stay silent, exactly as they are
    // silent visually. A row that says "confirmed" on nine cards in ten is
    // the texture problem this card has now removed three times.
    for (const status of ['confirmed', 'completed']) {
      expect(label(status)).not.toContain('staff.day.exception');
    }

    // The state is NOT a line in the fact column any more.
    const facts = host().querySelector('.agenda-card__facts');
    expect(facts?.querySelector('.agenda-card__fact--state')).toBeNull();
  });

  it('releases the now-anchor when TODAY is tapped, so it can re-anchor', () => {
    // `anchorToNow` claims each day once, which is right for a day CHANGE —
    // a barber who has scrolled somewhere on purpose should be left there.
    // But it made the second tap on today inert, and the second tap is
    // exactly the one a barber makes because they have scrolled off and want
    // to come back. Tapping today has to mean "take me to now" every time.
    const component = fixture.componentInstance as unknown as {
      pickDay: (key: string) => void;
      anchoredDay: { set: (v: string | null) => void; (): string | null };
      store: { todayKey: () => string };
    };
    const today = component.store.todayKey();

    component.anchoredDay.set(today);
    component.pickDay(today);
    expect(component.anchoredDay()).toBeNull();

    // Any OTHER day keeps its claim — there is no "now" on screen to scroll
    // to, and re-anchoring would yank a barber off the row they went to read.
    component.anchoredDay.set(today);
    component.pickDay('2099-01-01');
    expect(component.anchoredDay()).toBe(today);
  });

  it('renders no foot row at all when there is nothing to put in it', () => {
    // With price, marks and the barber's face all switched off, the foot
    // still rendered: an empty flex box of zero height, which sounds free and
    // is not. The card's `row-gap` sat on BOTH sides of it, so every row on
    // the screen carried 8px of dead height for a row with nothing in it.
    //
    // Note this could never have been fixed by hiding the element — the gap
    // belongs to the grid TRACK, which exists whether or not anything
    // occupies it. `display: none` on the foot moved the card's height by
    // exactly zero. The card spaces its rows with margins now instead.
    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    for (const id of ['price', 'barberAvatar', 'note']) {
      if (component.fields.isOn(id)) component.fields.toggle(id);
    }
    fixture.detectChanges();

    // Any foot still standing has to be one with real content in it (a
    // cancelled or no-show row keeps its state mark).
    for (const foot of host().querySelectorAll('.agenda-card__foot')) {
      expect(foot.children.length).toBeGreaterThan(0);
    }

    // Turning ONE of them back on brings the row back, so the assertion above
    // is not passing merely because no card renders.
    component.fields.toggle('barberAvatar');
    fixture.detectChanges();
    expect(
      host().querySelectorAll('.agenda-card__foot').length,
    ).toBeGreaterThan(0);
  });

  it('keeps hasFoot in step with what the foot actually renders', () => {
    // `hasFoot` duplicates the template's three conditions, and duplicated
    // conditions drift. This ties them together: for every card on screen,
    // the predicate and the DOM must agree.
    const component = fixture.componentInstance as unknown as {
      hasFoot: (e: unknown) => boolean;
      agenda: () => { items: unknown[] }[];
    };
    const cards = [...host().querySelectorAll('.agenda-card--visit')];
    expect(cards.length).toBeGreaterThan(0);
    const entries = component
      .agenda()
      .flatMap((group) => group.items)
      .filter((item) => (item as { kind?: string }).kind === 'visit');

    let checked = 0;
    for (const entry of entries) {
      const id = (entry as { id?: string }).id;
      if (id === undefined) continue;
      const card = host().querySelector(`[data-appointment-id="${id}"]`);
      if (card === null) continue;
      checked++;
      expect(card.querySelector('.agenda-card__foot') !== null).toBe(
        component.hasFoot(entry),
      );
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('gives every fact its own LINE, and none of them is clamped', () => {
    // A fact that has to win an argument with another fact in order to be
    // shown is a fact the card is not really carrying. Each one is a row
    // that is either rendered in full or not rendered at all — which is why
    // the note, the only one that could not be, left the column entirely.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    const facts = card?.querySelector('.agenda-card__facts');
    expect(facts).not.toBeNull();
    expect((facts?.children.length ?? 0) > 1).toBe(true);
    for (const fact of facts?.children ?? []) {
      expect(fact.tagName).toBe('P');
      // Nothing in this column truncates.
      expect(fact.className).not.toContain('--note');
    }
  });

  it("gives a failed write its OWN row, not the context line's cell", () => {
    // The error <p> wore `class="agenda-card__ctx"` and therefore
    // `grid-area: ctx` — the same cell the booking's own detail occupies — so
    // the two paragraphs stacked and the message drew on top of the detail.
    // Invisible until a transition actually failed, which is the worst
    // possible moment to find out.
    const ctxCells = host().querySelectorAll('.agenda-card__ctx');
    for (const cell of ctxCells) {
      expect(cell.getAttribute('data-testid')).not.toBe('staff-row-error');
    }
    // And the error, when it renders, is its own class.
    const component = fixture.componentInstance as unknown as {
      rowError: (id: string) => string | null;
    };
    expect(typeof component.rowError).toBe('function');
  });

  it('leads the card with a LEDE row, never a capsule or a third row', () => {
    // It was a capsule on a row that existed only when the clock said so, so
    // the run's stride broke at precisely the card the eye is hunting for.
    // Then it was an eyebrow inside the joined line. Now it is the card's
    // own first row, and the joined line is gone.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card).not.toBeNull();
    expect(host().querySelector('.agenda-card__state')).toBeNull();
    expect(host().querySelector('.agenda-chip')).toBeNull();
    expect(host().querySelector('.agenda-card__eyebrow')).toBeNull();

    // Where a lede renders it is a child of the CARD, ahead of the name.
    for (const lede of host().querySelectorAll('.agenda-card__lede')) {
      expect(lede.parentElement?.classList.contains('agenda-card')).toBe(true);
      expect(['exception', 'clock']).toContain(lede.getAttribute('data-kind'));
      const title = lede.parentElement?.querySelector('.agenda-card__title');
      expect(
        title &&
          lede.compareDocumentPosition(title) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('says WHEN on every card, counting a running cut down to its end', () => {
    // Relative time was a field, then a lede that only two rows ever got.
    // The header has a slot of its own now, so every card can say where it
    // sits relative to the clock without costing another fact its place. A
    // live cut counts down to its END — the barber is standing in it and
    // wants the time left, not the time since.
    const component = fixture.componentInstance as unknown as {
      whenLabel: (entry: {
        live: boolean;
        startMs: number;
        endMs: number;
      }) => string;
    };
    const now = at('2026-08-05T09:00:00').toMillis();
    // A running cut reaches for the REMAINING-time phrase. (The suite's
    // loader returns no translations, so this asserts the key it reaches
    // for, not the rendered words.)
    expect(
      component.whenLabel({
        live: true,
        startMs: now - 10 * 60_000,
        endMs: now + 12 * 60_000,
      }),
    ).toBe('staff.day.agendaRemaining');
    // Anything else counts to its START, through `Intl` rather than
    // transloco — so that one IS real text, in the active language.
    expect(
      component.whenLabel({ live: false, startMs: now + 3_600_000, endMs: 0 }),
    ).toMatch(/\d/);
    for (const row of host().querySelectorAll(
      '[data-testid="staff-visit-row"]',
    )) {
      expect(
        row.querySelector('.agenda-card__when')?.textContent?.trim(),
      ).toBeTruthy();
    }
  });

  it('joins nothing to anything — no middot survives in the run', () => {
    // The owner's central complaint: the card foreach-ed its fields into one
    // line and punctuated them with middots. The pattern is gone at the root
    // — no variant, no other separator, no smarter ordering.
    expect(host().querySelector('.agenda-card__ctx')).toBeNull();
    for (const row of host().querySelectorAll(
      '[data-testid="staff-visit-row"], [data-testid="staff-gap-row"], [data-testid="staff-idle-row"]',
    )) {
      expect(row.textContent).not.toContain('·');
    }
  });

  it('states only what the list cannot be counted for', () => {
    // The summary used to lead with a visit count, and the count DISAGREED
    // with the list beside it: it counts appointments while the run renders
    // one row per appointment PER LANE, so a party across two chairs is one
    // visit and two cards — "4 визити" printed above six rows. A number that
    // contradicts the list is worse than no number.
    //
    // What is left is the one fact nobody can derive by looking: the unsold
    // minutes. And only at ONE chair — summed across five, free time is
    // chair-hours, which read as clock hours.
    const component = fixture.componentInstance as unknown as {
      daySummary: () => string | null;
      store: { setScope: (id: string | null) => void };
    };
    expect(component.store).toBeTruthy();
    // Whole-shop scope: nothing.
    expect(component.daySummary()).toBeNull();
    // One chair: the free-time figure, and no count in it.
    component.store.setScope('ivan');
    fixture.detectChanges();
    const line = component.daySummary();
    if (line !== null) {
      expect(line).not.toMatch(/визит|visit/i);
    }
  });

  it('gives an elapsed hole a LINE and a sellable one a CARD', () => {
    // Same word, different objects. One is time to fill and competes with
    // the bookings beside it; the other already happened and, on a quiet
    // morning, outnumbers them. Form carries it — never a second word.
    showFreeTime();
    const idle = host().querySelector('[data-testid="staff-idle-row"]');
    const sellable = host().querySelector('[data-testid="staff-gap-row"]');
    expect(sellable?.classList.contains('agenda-card--idle')).toBe(false);
    if (idle) expect(idle.classList.contains('agenda-card--idle')).toBe(true);
    // And ONE word for both — "Незаето" is gone.
    for (const gap of host().querySelectorAll(
      '[data-testid="staff-gap-row"], [data-testid="staff-idle-row"]',
    )) {
      expect(gap.textContent).toContain('Free');
    }
  });

  it('drops elapsed holes entirely when every chair is in scope', async () => {
    // Five lanes times every twenty-minute hole is a screenful of things
    // that already happened and that nobody can act on, filed between the
    // bookings the screen is open for. The STORE still computes them —
    // lane-gaps.spec.ts rules that it must — and the summary reads its
    // total off them. What is settled here is only whether each earns a row.
    //
    // The suite's clock stands at 09:00, the first rostered minute, so
    // NOTHING has elapsed and asserting zero rows there would pass against
    // an empty day. The clock is moved to mid-afternoon first, which is when
    // this rule has anything to decide at all.
    TestBed.resetTestingModule();
    await build('2026-08-05T14:20:00.000+03:00');
    showFreeTime();

    const component = fixture.componentInstance as unknown as {
      store: { scope: (() => string | null) & { set?: unknown } };
      setScope?: unknown;
    };
    expect(component.store.scope()).toBeNull();

    // The day HAS elapsed holes — otherwise this proves nothing.
    const store = component.store as unknown as {
      workingLanes: () => readonly { gaps: readonly { sellable: boolean }[] }[];
      setScope: (id: string | null) => void;
    };
    const elapsed = store
      .workingLanes()
      .flatMap((lane) => lane.gaps)
      .filter((gap) => !gap.sellable);
    expect(elapsed.length).toBeGreaterThan(0);

    // ...and none of them is a row while the whole shop is in scope.
    expect(
      host().querySelectorAll('[data-testid="staff-idle-row"]').length,
    ).toBe(0);

    // Narrowed to one chair, they come back — as lines, not cards.
    store.setScope('ivan');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = host().querySelectorAll('[data-testid="staff-idle-row"]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.classList.contains('agenda-card--idle')).toBe(true);
    }
  });

  it('puts WHEN beside the body, and says STATUS only when there is some', () => {
    // The header row is gone — two facts that need no width of their own
    // were costing a whole block of height across the top of every card,
    // before the client's name appeared. They live in the body's trailing
    // column now: the interval at the top, what became of the booking at
    // the bottom, and the card's own height between them.
    expect(host().querySelector('.agenda-card__header')).toBeNull();

    const aside = host().querySelector('.agenda-card__aside');
    expect(aside).not.toBeNull();
    // The aside is ONE thing now: the interval. The foot cluster used to sit
    // underneath it, five marks deep in a gutter sized for four characters.
    const times = aside?.querySelector('.agenda-card__times');
    expect(times).not.toBeNull();
    expect(aside?.querySelector('.agenda-card__foot')).toBeNull();

    const foot = host().querySelector('.agenda-card__foot');
    expect(foot).not.toBeNull();
    expect(
      aside &&
        foot &&
        aside.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The interval reads DOWNWARD — start, then end, then the gloss. The
    // relative time follows the value it qualifies rather than leading it.
    const order = [...(times?.children ?? [])].map((el) => el.className);
    expect(order[0]).toContain('__start');
    expect(order[1]).toContain('__end');
    expect(order[2]).toContain('__when');

    // STATE IS THE CARD'S FORM, NOT A LINE OF TEXT. It was a glyph on every
    // card (texture, not signal), then a word in the fact column — where it
    // read as one more field between the phone and the service. It is now
    // carried by the fill: hollow for a cancellation or a no-show, dashed
    // for pending. What survives in the DOM is announcement only, because
    // neither a shape nor a strikethrough reaches a screen reader.
    expect(
      foot?.querySelector('[data-testid="staff-visit-status"]'),
    ).toBeNull();
    const state = host().querySelector('[data-testid="staff-visit-status"]');
    if (state) {
      expect(state.hasAttribute('data-visually-hidden')).toBe(true);
      expect(state.classList.contains('agenda-card__fact')).toBe(false);
    }

    // It reuses the app's EXISTING status vocabulary rather than a second
    // parallel map of the same five words. (The suite's loader returns no
    // translations, so this asserts the key it reaches for, not the word.)
    const component = fixture.componentInstance as unknown as {
      statusNote: (e: {
        status: string;
        arrived: boolean;
        terminal: boolean;
      }) => string | null;
    };
    const of = (status: string, arrived = false) =>
      component.statusNote({ status, arrived, terminal: false });

    // Arrival is NOT announced here — it is visible text in the trailing
    // gloss now (`whenLabel`), and saying it twice is a screen-reader bug.
    expect(of('confirmed', true)).toBeNull();
    // Silent on the two ordinary outcomes — that is the whole point.
    expect(of('confirmed')).toBeNull();
    expect(of('completed')).toBeNull();
    // ...and distinct for each state worth interrupting a glance for.
    const kinds = ['pending', 'cancelled', 'no_show'];
    expect(kinds.every((k) => of(k))).toBe(true);
    expect(new Set(kinds.map((k) => of(k))).size).toBe(3);

    // ARRIVAL IS A WORD, not a dot — and only displaces `confirmed`, because
    // a pending visit that has arrived is still waiting on someone.
    expect(of('pending', true)).toBe('staff.day.exception.pending');
  });

  it('opens the visit itself, which the row could never do before', async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const sheet = host().querySelector('[data-testid="staff-visit-sheet"]');
    expect(sheet).not.toBeNull();
    // The number was already on the row model and thrown away; this is the
    // first surface in the product that shows it to staff.
    const call = sheet?.querySelector('[data-testid="staff-visit-call"]');
    expect(call?.getAttribute('href')).toMatch(/^tel:/);
  });

  it('keeps every legal transition reachable — in the sheet, not a popover', async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    // The graph is never narrowed, only relocated: cancelling is still
    // reachable, at full size and named in words.
    expect(
      host().querySelector('[data-testid="staff-visit-act-cancelled"]'),
    ).not.toBeNull();
  });

  it('slides the week strip a WHOLE week, in CSS, with nothing to press', () => {
    // The gesture is the browser's: `ui-scroll-row` supplies
    // `scroll-snap-type: x mandatory` and `scroll-snap-align: start` on each
    // child, and every child is exactly one scrollport wide — which is the
    // only reason a flick advances by a week rather than a day. No scroll
    // listener, no drag maths, no chevrons.
    const strip = host().querySelector('[data-testid="staff-week-strip"]');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('data-snap')).toBe('start');

    const weeks = [...(strip?.querySelectorAll('.staff-weeks__week') ?? [])];
    // A bounded window anchored to TODAY, not to the selection: anchoring to
    // the selection would re-key every week on every tap and rebuild the
    // strip under the user's thumb.
    expect(weeks.length).toBe(13);
    // Seven days each, and every one is a real button.
    for (const week of weeks) {
      expect(week.querySelectorAll('.staff-weeks__day').length).toBe(7);
    }
    for (const day of strip?.querySelectorAll('.staff-weeks__day') ?? []) {
      expect(day.tagName).toBe('BUTTON');
      expect(day.getAttribute('aria-label')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Exactly one day is current, and it says so to a screen reader.
    const current = strip?.querySelectorAll('[aria-current="date"]') ?? [];
    expect(current.length).toBe(1);

    // ONE marker per week, and it is the only thing that draws the disc —
    // the numeral paints no background of its own. A background on whichever
    // day was selected TELEPORTED, and the jump is what made a day change
    // read as slow: measured, the disc updates in 8-23ms and the agenda in
    // 49-63ms warm, so the lag was never in the work.
    for (const week of weeks) {
      expect(week.querySelectorAll('.staff-weeks__marker').length).toBe(1);
    }
    // The selected week publishes the column the marker parks in; the others
    // publish -1 and hide it.
    const withSelection = weeks.filter((w) =>
      w.hasAttribute('data-has-selection'),
    );
    expect(withSelection.length).toBe(1);
    expect(
      Number(
        (withSelection[0] as HTMLElement).style.getPropertyValue(
          '--staff-week-col',
        ),
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  it("does not rebuild the strip's labels when the shown day changes", () => {
    // The cells' text is a function of the DATE and the LOCALE. It used to be
    // computed inside the same memo that reads `dayKey()`, so every tap
    // rebuilt ninety-one cells and constructed a hundred and eighty-two
    // `Intl.DateTimeFormat`s to re-derive labels that had not moved —
    // measured at 14ms of work per tap, for nothing.
    //
    // Node identity would NOT catch a regression here: `@for` tracks by
    // `day.key`, so Angular reuses the same elements whether or not the
    // objects behind them were rebuilt. What actually distinguishes the two
    // is the FORMATTER CONSTRUCTION, so that is what this counts. The
    // weekday initial is the strip's alone — nothing else in the dashboard
    // asks for `weekday: 'narrow'` — which makes it an exact probe.
    const real = Intl.DateTimeFormat;
    let narrow = 0;
    const spy = function (
      locale?: unknown,
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (options?.weekday === 'narrow') narrow++;
      return new (
        real as unknown as new (
          l?: unknown,
          o?: Intl.DateTimeFormatOptions,
        ) => Intl.DateTimeFormat
      )(locale, options);
    };
    Object.setPrototypeOf(spy, real);

    const days = Array.from(
      host().querySelectorAll<HTMLButtonElement>('.staff-weeks__day'),
    );
    const shown = days.findIndex((d) => d.hasAttribute('data-selected'));
    expect(shown).toBeGreaterThanOrEqual(0);
    const next = days[shown + 1] ?? days[shown - 1];

    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = spy;
    try {
      next.click();
      fixture.detectChanges();
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = real;
    }

    // Not one. Changing the day may not touch the strip's labels at all.
    expect(narrow).toBe(0);

    // And the selection DID move, so the count above is not vacuous.
    expect(next.hasAttribute('data-selected')).toBe(true);
    expect(
      host().querySelectorAll('.staff-weeks__day[data-selected]').length,
    ).toBe(1);
  });

  it('presses through the DS grammar, not a local hover treatment', () => {
    // The card had its own hover/press/focus rules and they were wrong twice:
    // they replaced `background-color`, which threw away the chair's tint, and
    // the fix for THAT was an inset shadow with a 100vmax spread — a repaint
    // the size of the viewport on every frame of the transition.
    //
    // `uiInteractive` is the sanctioned grammar and its own docs say surfaces
    // must not invent their own. It layers a `::after` over the tint instead
    // of replacing it, and brings the press scale, the disabled guards, the
    // focus ring and the reduced-motion opt-out with it.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.hasAttribute('data-interactive')).toBe(true);
    // No JS hover anywhere on the row — the state is entirely CSS.
    for (const attr of ['mouseenter', 'mouseover', 'mouseleave']) {
      expect(host().innerHTML).not.toContain(attr);
    }
  });

  it('carries no interactive control inside the card at all', () => {
    // The card IS the target. It briefly grew a phone link, which put an
    // unlabelled receiver on a surface whose whole body opens a sheet — and
    // printed a client's number on a screen that faces the room.
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    expect(card?.querySelector('a, button')).toBeNull();
  });

  it('arms the day-wide lift before it deletes anything', async () => {
    // `clearBlock` removes the chair's WHOLE exception document for the date
    // — every block plus the all-day absence — so it must not happen on the
    // tap that asked for it.
    const component = fixture.componentInstance as unknown as {
      liftBlock: (barberId: string) => Promise<void>;
      blockLiftArmed: () => boolean;
    };

    await component.liftBlock('ivan');
    expect(component.blockLiftArmed()).toBe(true);
    expect(clear).not.toHaveBeenCalled();

    await component.liftBlock('ivan');
    expect(clear).toHaveBeenCalledTimes(1);
    expect(component.blockLiftArmed()).toBe(false);
  });

  it('lets the block sheet be re-aimed at another chair', () => {
    // The shop-wide action pre-aims at the first lane; without a picker that
    // meant one barber could stand a colleague's chair down in two taps.
    const component = fixture.componentInstance as unknown as {
      openBlockSheet: (barberId: string) => void;
      pickBlockLane: (barberId: string) => void;
      blockLaneId: () => string | null;
      blockLaneOptions: () => readonly { id: string }[];
    };
    component.openBlockSheet('ivan');
    expect(component.blockLaneId()).toBe('ivan');
    // Every rostered chair is reachable from inside the sheet.
    expect(component.blockLaneOptions().map((o) => o.id)).toContain('ivan');
    component.pickBlockLane('ivan');
    expect(component.blockLaneId()).toBe('ivan');
  });

  it('names the visits a block would strand rather than sitting on them', () => {
    const component = fixture.componentInstance as unknown as {
      openBlockSheet: (barberId: string) => void;
      blockAllDay: { set: (on: boolean) => void };
      blockCollisions: () => readonly { clientLabel: string }[];
    };
    component.openBlockSheet('ivan');
    component.blockAllDay.set(true);
    fixture.detectChanges();
    // The fixture books one live visit in Ivan's chair; a whole-day block
    // lands squarely on top of it.
    expect(component.blockCollisions().length).toBe(1);
  });

  it('keeps only ONE transient surface open at a time', () => {
    const component = fixture.componentInstance as unknown as {
      togglePicker: (which: 'view' | 'scope') => void;
      toggleDatePicker: () => void;
      openPicker: () => string | null;
      datePickerOpen: () => boolean;
    };
    component.togglePicker('scope');
    expect(component.openPicker()).toBe('scope');
    // Each opener used to own its own flag and know nothing about the others,
    // so surfaces stacked — the date popover over a still-open picker, over a
    // scrim that was swallowing outside taps for all of them.
    component.toggleDatePicker();
    expect(component.datePickerOpen()).toBe(true);
    expect(component.openPicker()).toBeNull();
  });

  it('blocks a range through the exception writer, sanitized', async () => {
    (
      host().querySelector(
        '[data-testid="staff-lane-block"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    (
      host().querySelector(
        '[data-testid="staff-block-confirm"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    expect(put).toHaveBeenCalledTimes(1);
    const [written] = put.mock.calls[0] ?? [];
    if (!written) throw new Error('the writer was never called');
    expect(written.barberId?.value).toBe('ivan');
    expect(written.day.key()).toBe('2026-08-05');
    // The default is a RANGE, not the whole day — standing a chair down for
    // a full day is the rarer act and must be chosen deliberately.
    expect(written.detail.kind).toBe('admin');
  });

  it('stands the whole day down when the switch is on', async () => {
    (
      host().querySelector(
        '[data-testid="staff-lane-block"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-block-all-day"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-block-confirm"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    const [written] = put.mock.calls[0] ?? [];
    if (!written) throw new Error('the writer was never called');
    // `time_off`, which the sanitizer collapses to a reason-free `closed`.
    expect(written.detail.kind).toBe('time_off');
  });

  /** The view options live in a pull-down now, so the trigger opens first. */
  function chooseView(view: string): void {
    (
      host().querySelector(
        '[data-testid="staff-view-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        `[data-testid="staff-view-${view}"]`,
      ) as HTMLButtonElement
    ).click();
  }

  it('switches to the day view and columns by CHAIR — including the chair that is off', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // BOTH barbers get a column: Ivan rostered, Niko off. A dropped column is
    // not a quiet answer, it is no answer — "off today", "out of scope" and
    // "the roster failed to load" all render as the same nothing, and the
    // column count would change with the data so the same chair moved around
    // the screen day to day (owner ruling 2026-08-10).
    expect(
      host().querySelectorAll('[data-testid="staff-grid-column-head"]').length,
    ).toBe(2);

    // Niko's column is shut for the WHOLE day: one closed run, top to bottom.
    const columns = host().querySelectorAll(
      '[data-testid="staff-grid-column"]',
    );
    const niko = [...columns].find(
      (column) => column.getAttribute('data-column') === 'niko',
    );
    const shut = niko?.querySelectorAll('[data-testid="staff-grid-closed"]');
    expect(shut?.length).toBe(1);
    expect((shut?.[0] as HTMLElement).style.gridRow).toBe('1 / 97');

    // …and SAYS so. Shading alone is one channel, and the one a screen reader
    // cannot read; the all-day row is the band built for a fact with no hour.
    expect(host().textContent).toContain('staff.day.offBadge');

    // The zone is the head's other job and survives either way.
    expect(
      host().querySelector('[data-testid="staff-grid-zone"]')?.textContent,
    ).toContain('EE');
  });

  it('drops the column head only when ONE chair is in scope', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (
      host().querySelector(
        '[data-testid="staff-scope-ivan"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Scoped to one barber the head is suppressed: the toolbar already names
    // whose day this is, and repeating it under the bar is a row of chrome
    // for nothing.
    expect(
      host().querySelectorAll('[data-testid="staff-grid-column-head"]').length,
    ).toBe(0);
    expect(host().querySelector('.staff-grid__head--bare')).not.toBeNull();
  });

  it("carries a block's state in words, not only in its fill", async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const block = host().querySelector('[data-testid="staff-grid-event"]');
    // HIG *Color*: never rely on colour alone. The fill is one channel; this
    // is the one a screen reader — and a greyscale print — actually has.
    const name = block?.getAttribute('aria-label') ?? '';
    expect(name).toContain('appointments.status.');
    // The block's own text is abbreviated as it shrinks, so the accessible
    // name must state the span itself rather than inherit it.
    expect(name).toMatch(/\d{1,2}:\d{2}/);
  });

  it('draws the now-line only when TODAY is one of the columns', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The clock stub sits on the anchor day, so the line belongs here.
    expect(
      host().querySelectorAll('[data-testid="staff-grid-now"]').length,
    ).toBeGreaterThan(0);

    // Browse away. A rule saying "now" across a day three weeks out marks an
    // hour that has not happened — it would be pointing at nothing.
    (
      host().querySelector(
        '[data-testid="staff-day-label"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-date-2026-08-26"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host().querySelectorAll('[data-testid="staff-grid-now"]').length,
    ).toBe(0);
    expect(
      host().querySelector('[data-testid="staff-grid-now-label"]'),
    ).toBeNull();
  });

  it('hatches every PAST block, whatever became of it', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The clock stub is 09:00; the fixture's visit is 10:00–10:30, so it is
    // still ahead and must NOT be hatched.
    const block = host().querySelector('[data-testid="staff-grid-event"]');
    expect(block?.hasAttribute('data-past')).toBe(false);

    // The flag is temporal, not a status: it is set off the END INSTANT, so
    // a completed cut, a no-show and a cancellation at the same hour all
    // carry it together — and so does a booking still sitting `confirmed`,
    // which is the row a shop most needs to notice.
    expect(block?.getAttribute('data-status')).toBe('pending');
  });

  it('draws no "free" blocks on the calendar — empty space IS the gap', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The list view carries gap ROWS because a list has no empty space to
    // read. A proportional grid is nothing but empty space, so the same
    // information drawn as a block is chrome over a fact the eye already has.
    expect(
      host().querySelectorAll('[data-testid="staff-grid-gap"]').length,
    ).toBe(0);
  });

  it('columns the week by DATE, Monday first, and scopes to one chair', async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const heads = [
      ...host().querySelectorAll('[data-testid="staff-grid-column-head"]'),
    ];
    expect(heads.length).toBe(7);
    // 2026-08-05 is a Wednesday, so its week opens on Monday the 3rd, and the
    // day number rides its own capsule beside the weekday.
    expect(
      heads[0]?.querySelector('.staff-grid__column-day')?.textContent?.trim(),
    ).toBe('3');
    // The chair picker only exists where a column is a date.
    expect(
      host().querySelector('[data-testid="staff-scope-trigger"]'),
    ).not.toBeNull();
  });

  it('marks TODAY in the column head, by capsule not by colour alone', async () => {
    chooseView('three-day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const heads = [
      ...host().querySelectorAll('[data-testid="staff-grid-column-head"]'),
    ];
    // The clock stub says 2026-08-05, the anchor day — so the first column.
    expect(heads[0]?.hasAttribute('data-today')).toBe(true);
    expect(heads[1]?.hasAttribute('data-today')).toBe(false);
  });

  it('lays overlapping seats side by side rather than stacking them', async () => {
    chooseView('three-day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const events = [
      ...host().querySelectorAll('[data-testid="staff-grid-event"]'),
    ] as HTMLElement[];
    // Every block states which lane of how many it occupies, and a lane
    // offset that a later `margin-inline` shorthand once silently reset.
    for (const event of events) {
      const lanes = Number(event.style.getPropertyValue('--staff-event-lanes'));
      const lane = Number(event.style.getPropertyValue('--staff-event-lane'));
      expect(lanes).toBeGreaterThanOrEqual(1);
      expect(lane).toBeLessThan(lanes);
    }
    // The MULTI-lane case needs two chairs busy at one hour, which this
    // fixture's single rostered barber cannot produce; it is verified in the
    // browser against the seeded mixed party (two seats at 16:00 laying out
    // at half width, side by side). What this pins is the invariant that
    // held even while the layout was broken: the lane index is always
    // in range, so a regression shows up as a bad offset, not bad data.
    expect(events.length).toBeGreaterThan(0);
  });

  it('names the view by GLYPH, and keeps the label where it teaches', () => {
    const trigger = host().querySelector(
      '[data-testid="staff-view-trigger"]',
    ) as HTMLButtonElement;
    // The trigger is a glyph, so its accessible name carries what the eye
    // reads off the icon — otherwise the control is unnameable.
    // The stub loader returns raw keys, so assert the SHAPE: the label names
    // the current view rather than being a bare "View".
    expect(trigger.getAttribute('aria-label')).toContain(
      'staff.day.view.agenda',
    );
    expect(trigger.querySelector('ui-icon')).not.toBeNull();

    trigger.click();
    fixture.detectChanges();
    // Inside the menu the label stays: a list of four bare glyphs would be
    // the only place that teaches which glyph means what.
    const item = host().querySelector('[data-testid="staff-view-week"]');
    expect(item?.textContent).toContain('staff.day.view.week');
    expect(item?.querySelector('ui-icon')).not.toBeNull();
  });

  it("picks the barber by PORTRAIT, with the booking flow's any-glyph", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const trigger = host().querySelector(
      '[data-testid="staff-scope-trigger"]',
    ) as HTMLButtonElement;
    // The trigger is the SAME DS button as its neighbours, and "everyone"
    // rides the SAME control a barber does — `ui-avatar` with a glyph in
    // place of the monogram, which is the booking flow's "Anyone" exactly.
    expect(trigger.classList.contains('ui-button')).toBe(true);
    expect(trigger.querySelector('ui-avatar')).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toContain('staff.day.scopeAll');

    trigger.click();
    fixture.detectChanges();
    expect(
      host().querySelector(
        '[data-testid="staff-scope-all"] [uiLeading] ui-avatar',
      ),
    ).not.toBeNull();

    (
      host().querySelector(
        '[data-testid="staff-scope-ivan"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Scoped to one barber, the trigger becomes their portrait.
    expect(trigger.querySelector('ui-avatar')).not.toBeNull();
  });

  it('searches name, phone digits and service across past and upcoming', async () => {
    (
      host().querySelector(
        '[data-testid="staff-search-open"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = host().querySelector(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    input.value = 'георги';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const hits = host().querySelectorAll('[data-testid="staff-search-hit"]');
    expect(hits.length).toBe(1);
    // The matching run is MARKED, and the original casing survives it.
    const mark = hits[0]?.querySelector('.staff-search__mark');
    expect(mark?.textContent).toBe('Георги');
  });

  it("finds a phone by bare digits, across the formatter's spaces", async () => {
    (
      host().querySelector(
        '[data-testid="staff-search-open"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = host().querySelector(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    // Nobody types a number with the formatter's spaces in it.
    input.value = '359881234567';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(
      host().querySelectorAll('[data-testid="staff-search-hit"]').length,
    ).toBe(1);
  });

  it('advertises no write it cannot actually perform', () => {
    // The FAB shipped with three arms and two opened a sheet saying the
    // feature was not built. A receptionist who taps the primary action
    // twice and is told "not yet" both times has learned the app does not
    // do what its buttons say — a lesson the third, working arm does not
    // undo. It returns with the walk-in write (plan item C4).
    expect(host().querySelector('[data-testid="staff-fab"]')).toBeNull();
    expect(
      host().querySelector('[data-testid="staff-fab-trigger"]'),
    ).toBeNull();
    // The bar itself stays — "back to today" still lives in it.
    expect(host().querySelector('ui-page-action-bar')).not.toBeNull();
  });

  it('keeps blocking time on the lane it belongs to, and only there', () => {
    // The FAB's block arm was a SECOND door to a control that already lives
    // on each lane header, aimed by default at whichever chair sorted first.
    expect(
      host().querySelector('[data-testid="staff-lane-block"]'),
    ).not.toBeNull();
  });
  it('prints the contact details the owner asked for, behind their fields', () => {
    // REVERSED, deliberately. An earlier ruling kept digits out of the run
    // because this screen lies face-up on a counter and gets turned toward
    // whoever is standing at it. The owner has since asked for the email and
    // the number on the card, and that is their call about their own shop.
    //
    // They stay FIELDS rather than becoming fixtures, so a shop that shares
    // its counter with clients can put them back behind the sheet with one
    // tap — which is what this asserts.
    const row = host().querySelector('[data-testid="staff-visit-row"]');
    expect(
      row?.querySelector('[data-testid="staff-visit-phone"]'),
    ).not.toBeNull();
    expect(row?.textContent ?? '').toMatch(/\+\d/);

    const component = fixture.componentInstance as unknown as {
      fields: { toggle: (id: string) => void; isOn: (id: string) => boolean };
    };
    if (component.fields.isOn('phone')) component.fields.toggle('phone');
    if (component.fields.isOn('email')) component.fields.toggle('email');
    fixture.detectChanges();

    const after = host().querySelector('[data-testid="staff-visit-row"]');
    expect(
      after?.querySelector('[data-testid="staff-visit-phone"]'),
    ).toBeNull();
    expect(
      after?.querySelector('[data-testid="staff-visit-email"]'),
    ).toBeNull();
    expect(after?.textContent ?? '').not.toMatch(/\+\d/);
  });
});
