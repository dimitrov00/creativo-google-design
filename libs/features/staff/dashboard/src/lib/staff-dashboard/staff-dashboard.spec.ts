import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AUTH_GATEWAY,
  type Principal,
  type PrincipalId,
  roleFromPrimitive,
} from '@creativo/application/identity';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { USER_SEARCH_PORT } from '@creativo/application/governance';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router, provideRouter } from '@angular/router';
import {
  APPOINTMENT_NOTES,
  APPOINTMENT_PHOTOS,
  APPOINTMENT_REPOSITORY,
  AVAILABILITY_READER,
  Appointment,
  BOOKING_GATEWAY,
  CommitBookingRequest,
  BookingContact,
  Interval,
  Money,
  Seat,
  SeatId,
  SCHEDULE_EXCEPTION_WRITER,
  Result,
  ScheduleException,
  SeatSubject,
  type SeatRelationship,
  ZonedDateTime,
  fail,
  ok,
  BookingGatewayError,
} from '@creativo/application/booking';
import {
  COUPON_GRANT_REPOSITORY,
  COUPON_READER,
  GIFT_VOUCHER_READER,
} from '@creativo/application/engagement';
import {
  Barber,
  BarberId,
  CATALOG_READER,
  LocationId,
  MEDIA_READER,
  Service,
  ServiceId,
  ServiceTerms,
} from '@creativo/application/catalog';
import { AVATAR_UPLOADER, UserId } from '@creativo/application/accounts';
import { CLOCK } from '@creativo/application/shared';
import { StaffDashboard, reversibleSave } from './staff-dashboard';
import {
  StaffVisitEditor,
  snapshotCommitOf,
  type VisitEditorCommit,
  type VisitEditorLeg,
  type VisitEditorVm,
} from '../visit-editor/staff-visit-editor';

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

/** One catalogue service, timed for `ivan` — the length the tag measures against. */
function service(id: string, minutes: number): Service {
  return value(
    Service.create({
      id,
      name: { en: id, bg: id },
      description: { en: 'x', bg: 'x' },
      categoryId: 'cat-hair',
      priceMinorUnits: 2800,
      currencyCode: 'EUR',
      durationMinutes: minutes,
      offerings: [
        {
          barberId: 'ivan',
          base: {
            priceMinorUnits: 2800,
            currencyCode: 'EUR',
            durationMinutes: minutes,
          },
        },
      ],
      locationIds: [],
      conflictsWith: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 0,
    }),
  );
}

/**
 * One booked visit in `ivan`'s chair, starting at `startIso`.
 *
 * `withParty` adds a SECOND seat in another chair — the split party, which
 * is the case the party mark exists for: `seatsHere` is 1 on both rows, so
 * the avatar's `+N` shows nothing and only `1 / 2` says the two cards are
 * one booking. The extra seat is in a chair whose lane returns nothing, so
 * this adds a MARK to the existing card rather than a second card.
 */
function appointment(
  id: string,
  startIso: string,
  contact?: { name: string; phone: string },
  barberId = 'ivan',
  withParty = false,
  /** A catalogue service by id — the default is one the catalogue never knew. */
  serviceId?: string,
): Appointment {
  const price = value(Money.fromMinorUnitsAndCode(2800, 'EUR'));
  // Only ONE seat may be `self` — `AppointmentMultipleSelfSeatsError` — and
  // that is the real shape anyway: a father books himself and his son.
  const makeSeat = (chair: string, relationship: SeatRelationship) =>
    Seat.of({
      id: SeatId.generate(),
      subject: SeatSubject.account(UserId.generate(), relationship),
      serviceId:
        serviceId === undefined
          ? ServiceId.generate()
          : value(ServiceId.create(serviceId)),
      variantId: null,
      barberId: value(BarberId.create(chair)),
      terms: value(ServiceTerms.create(price, 30)),
      startsAt: at(startIso),
    });
  const seat = makeSeat(barberId, 'self');
  return value(
    Appointment.create({
      id,
      locationId: LocationId.generate().toString(),
      seats: withParty ? [seat, makeSeat('niko', 'companion')] : [seat],
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
              appointment(
                'appointment-1',
                '2026-08-05T10:00:00',
                { name: 'Мартин Илиев', phone: '+359881234567' },
                'ivan',
                // A SPLIT PARTY, so the `1 / 2` mark is under test rather
                // than asserted vacuously against a card with no party.
                true,
              ),
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

  /** Who is at the book. `next()` a plain barber to shut the money gate. */
  const principal$ = new BehaviorSubject<Principal>({
    kind: 'active',
    uid: 'dev-staff-ivan' as unknown as PrincipalId,
    roles: ['barber', 'admin'].map(roleFromPrimitive),
  });

  const put = vi.fn((_exception: ScheduleException) =>
    Promise.resolve(ok(undefined)),
  );
  const clear = vi.fn((_barberId: string, _dayKey: string) =>
    Promise.resolve(ok(undefined)),
  );
  const putRange = vi.fn(() => Promise.resolve(ok(undefined)));
  const clearRange = vi.fn(() => Promise.resolve(ok(undefined)));
  // Hoisted so the guards below can assert that a destructive write did NOT
  // happen on the tap that asked for it.
  const transition = vi.fn(
    (_input: unknown): Promise<Result<undefined, BookingGatewayError>> =>
      Promise.resolve(ok(undefined)),
  );

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
            // One timed service, so the tag has a catalogue to measure
            // against; the fixture's own seats use ids it never knew.
            listActiveServices: () => of(ok([service('fade', 45)])),
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
        {
          provide: SCHEDULE_EXCEPTION_WRITER,
          useValue: { put, clear, putRange, clearRange },
        },
        {
          // The signed-in principal — a barber who also holds the keys, so
          // the money gate opens; a plain barber's case is asserted below.
          provide: AUTH_GATEWAY,
          useValue: {
            observePrincipal: () => principal$,
            refreshToken: () => Promise.resolve(ok(undefined)),
            signOut: () => Promise.resolve(ok(undefined)),
          },
        },
        {
          provide: USER_SEARCH_PORT,
          useValue: { search: async () => ok([]) },
        },
        {
          provide: APPOINTMENT_NOTES,
          useValue: {
            observe: () => of(ok(null)),
            save: async () => ok(undefined),
          },
        },
        {
          // Nobody has a portrait here; the lookup answers "none" at once.
          provide: AVATAR_UPLOADER,
          useValue: {
            find: async () => ok(null),
            upload: async () => ok({ url: '', path: '' }),
            remove: async () => ok(undefined),
          },
        },
        {
          provide: APPOINTMENT_PHOTOS,
          // The shop's photos of a visit: none, and every shutter lands.
          useValue: {
            observe: () => of(ok([])),
            attach: async (attachment: { appointmentId: string }) =>
              ok({
                photoId: 'p',
                ...attachment,
                url: '',
                path: '',
                takenAtIso: '',
                takenByUid: null,
                width: null,
                height: null,
              }),
            adopt: async (reference: { appointmentId: string }) =>
              ok({
                photoId: 'p',
                ...reference,
                url: '',
                path: '',
                takenAtIso: '',
                takenByUid: null,
                width: null,
                height: null,
                origin: 'library',
                label: null,
              }),
            remove: async () => ok(undefined),
          },
        },
        // The discount row's two reads (2026-09-10): nobody holds a coupon
        // and no code opens one, so the menu offers «Без» and the typed arms.
        {
          provide: COUPON_GRANT_REPOSITORY,
          useValue: { findUsableForUser: async () => ok([]) },
        },
        {
          provide: COUPON_READER,
          useValue: {
            findByCode: async () => ok(null),
            listOpen: async () => ok([]),
          },
        },
        {
          provide: GIFT_VOUCHER_READER,
          useValue: { findByCode: async () => ok(null) },
        },
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

  it("names the day the way the visit sheet does — the locale's compact date", () => {
    // REVERSED (owner, 2026-09-09): the toolbar's label and the frame's pill
    // are ONE component now, and one grammar — the compact date exactly as
    // `Intl` renders it, `ср, 5.08`. The title-cased heading is gone with
    // the headline segment it lived in.
    const label = host()
      .querySelector('[data-testid="staff-day-label"]')
      ?.textContent?.trim();
    expect(label).toContain('5.08');
    expect(label).not.toMatch(/август/i);
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
        '[data-testid="ui-month-day-2026-08-06"]',
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
      blockEdit: () => { allDay: boolean; blockId: string | null } | null;
    };
    component.openRestDay('nikо-test-id');
    expect(component.blockLaneId()).toBe('nikо-test-id');
    expect(component.blockEdit()?.allDay).toBe(true);
    // Editing something that exists — so the sheet offers the lift.
    expect(component.blockEdit()?.blockId).not.toBeNull();
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
    // The sheet's acts are its EXITS, at the foot (owner, 2026-09-09).
    expect(
      host().querySelector('[data-testid="staff-visit-cancel"]'),
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
    // tone and carrying the barber's initials. The client's face LEADS the
    // row: tried between the facts and the times (2026-09-16) and put back
    // the same day — "it doesn't work".
    const card = host().querySelector('[data-testid="staff-visit-row"]');
    const body = card?.querySelector('.agenda-card__body');
    const foot = card?.querySelector('.agenda-card__foot');
    expect(body).not.toBeNull();
    expect(foot).not.toBeNull();
    const face = body?.querySelector('.agenda-card__face');
    expect(face).not.toBeNull();
    // The face, then the shared head (the name, the lines, the clock).
    const kids = [...(body?.children ?? [])];
    expect(kids.length).toBe(2);
    expect(kids[0]?.classList.contains('agenda-card__face')).toBe(true);
    expect(kids[1]?.classList.contains('staff-event-head')).toBe(true);
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
    const facts = host().querySelector('.staff-event-head__lines');
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

  it('marks the party in the foot, not as a line of its own', () => {
    // `1 / 2` is a MARK about the row — a glyph and a count — not a detail
    // of the client like an email or a phone, and as a fact line it cost a
    // whole line of card height to say four characters. The foot adds no
    // height: the barber's disc already needs that row.
    const share = host().querySelector(
      '[data-testid="staff-visit-party-share"]',
    );
    expect(share).not.toBeNull();
    expect(share?.closest('.agenda-card__foot')).not.toBeNull();
    expect(share?.closest('.staff-event-head')).toBeNull();

    // Figures adjacent, plain glyphs after them, the barber's disc last.
    const foot = share?.closest('.agenda-card__foot');
    const kids = [...(foot?.children ?? [])];
    const shareAt = kids.indexOf(share as Element);
    const markAt = kids.findIndex((el) =>
      el.classList.contains('agenda-card__mark'),
    );
    const faceAt = kids.findIndex((el) =>
      el.classList.contains('agenda-card__barber-face'),
    );
    if (markAt !== -1) expect(shareAt).toBeLessThan(markAt);
    if (faceAt !== -1) expect(shareAt).toBeLessThan(faceAt);
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
      const card = host().querySelector(`[data-row-id="${id}"]`);
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
    // The shared head's column: the title, then one line per fact.
    const facts = card?.querySelector('.staff-event-head__lines');
    expect(facts).not.toBeNull();
    expect((facts?.children.length ?? 0) > 1).toBe(true);
    for (const fact of facts?.children ?? []) {
      expect(fact.tagName).toBe('SPAN');
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
        row.querySelector('.staff-event-head__gloss')?.textContent?.trim(),
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

    // The clock is ONE thing: the interval, in the shared head's own
    // column. The foot cluster used to sit underneath it, five marks deep
    // in a gutter sized for four characters.
    const times = host().querySelector('.staff-event-head__times');
    expect(times).not.toBeNull();
    expect(times?.querySelector('.agenda-card__foot')).toBeNull();

    const foot = host().querySelector('.agenda-card__foot');
    expect(foot).not.toBeNull();
    expect(
      times &&
        foot &&
        times.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The interval reads DOWNWARD — start, then end, then the gloss. The
    // relative time follows the value it qualifies rather than leading it.
    const order = [...(times?.children ?? [])].map((el) => el.className);
    expect(order[0]).toContain('__start');
    expect(order[1]).toContain('__end');
    expect(order[2]).toContain('__gloss');

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
      expect(state.classList.contains('staff-event-head__line')).toBe(false);
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
    //
    // ONE, in the DOCK, and NAMED (owner, 2026-09-09: "the most common
    // action you do when you open the appointment"; reverses the row
    // placement of 2026-09-08). The client row keeps the number to read.
    const call = sheet?.querySelector('[data-testid="staff-visit-call"]');
    expect(call?.closest('ui-sheet-action-bar')).not.toBeNull();
    expect(call?.getAttribute('href')).toMatch(/^tel:/);
    expect(call?.getAttribute('aria-label')).toContain('staff.day.visitCall');
    expect(
      sheet?.querySelector('[data-testid^="staff-visit-call-"]'),
    ).toBeNull();
  });

  it('names the sheet from the bar, which never collapses away', async () => {
    /*
     * The editor used to carry an `h2 uiSheetLargeTitle` that collapsed into
     * the bar on scroll. On a ladder eight groups long that block bought
     * nothing — the name is the same on every visit — so the bar shows it
     * from the first frame and the id `aria-labelledby` resolves through
     * moved with it. `aria-labelledby` still works although the bar title is
     * `aria-hidden`: a referenced element contributes its text either way.
     */
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const sheet = host().querySelector('[data-testid="staff-visit-sheet"]');
    expect(sheet?.querySelector('[uiSheetLargeTitle]')).toBeNull();

    const label = sheet?.querySelector('#staff-visit-title');
    expect(label).not.toBeNull();
    expect(label?.hasAttribute('sheet-title')).toBe(true);
  });

  it('keeps the drafted day live, and releases it on close', async () => {
    /*
     * The frame in the sheet draws the chair's day around the block, and the
     * pill can step that block onto a date the agenda underneath is not
     * showing. Only `visibleDays()` was subscribed — one day, in day view —
     * so the frame kept drawing the ORIGINAL day's neighbours under a pill
     * that said a different date. The store now keeps the drafted day live
     * as a PROBE; this is what proves the subscription actually moves.
     */
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const daysFor = () =>
      observeBarberDay.mock.calls.map((call) => call[1] as string);
    expect(daysFor()).toContain('2026-08-05');
    observeBarberDay.mockClear();

    const next = host().querySelector(
      '[data-testid="staff-visit-day-next"]',
    ) as HTMLElement;
    next.click();
    await fixture.whenStable();
    fixture.detectChanges();

    // The next day is now subscribed — the frame can only draw what is live.
    expect(daysFor()).toContain('2026-08-06');
    observeBarberDay.mockClear();

    // …and a closed sheet must not keep a listener open on a day nothing is
    // looking at.
    // The REAL close path — the shell's own ✕. A `dismissed` CustomEvent on
    // the host does not reach an Angular `output()`, so dispatching one
    // proved nothing about what closing actually does.
    const close = host().querySelector<HTMLElement>(
      '[data-testid="staff-visit-sheet"] .ui-sheet-header button[uitrailing]',
    );
    expect(close).not.toBeNull();
    close?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The day was stepped, so the draft is dirty and the ✕ asks first
    // (2026-09-18, the discard guard); «Отхвърли» is the close.
    expect(
      host().querySelector('[data-testid="staff-visit-sheet"]'),
    ).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-discard-confirm"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-visit-sheet"]'),
    ).toBeNull();

    /*
     * ⚠ RELEASE IS PROVED BY THE NEXT SUBSCRIPTION, not by the absence of
     * one. Closing shrinks the subscribed set, and nothing re-queries until
     * something else moves it — so `not.toContain` straight after the close
     * passed against an EMPTY list, which is true for the wrong reason.
     * Moving the agenda forces a fresh subscription, and the probe's day is
     * absent from it only if the probe was actually let go.
     */
    const component = fixture.componentInstance as unknown as {
      store: { goToDay: (day: string) => void };
    };
    component.store.goToDay('2026-08-04');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(daysFor()).toContain('2026-08-04');
    expect(daysFor()).not.toContain('2026-08-06');
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
      host().querySelector('[data-testid="staff-visit-cancel"]'),
    ).not.toBeNull();
  });

  /*
   * ── A CHAIR RESOLVED INSIDE A LIVE PARTY (found live, 2026-09-11) ────
   * A guest cancelled out of a two-chair party kept reading as a live visit
   * on his chair, because the row took the ROOT's status — still confirmed
   * while the other seat is scheduled. The sheet then offered «Откажи часа»
   * again and the server refused it as already resolved.
   */
  it("reads a chair by its own seats' outcomes once all of them are resolved", async () => {
    const visits = observeBarberDay.getMockImplementation();
    const price = value(Money.fromMinorUnitsAndCode(2800, 'EUR'));
    const seat = (
      chair: string,
      relationship: SeatRelationship,
      cancelled: boolean,
    ) =>
      Seat.of({
        id: SeatId.generate(),
        subject: SeatSubject.account(UserId.generate(), relationship),
        serviceId: ServiceId.generate(),
        variantId: null,
        barberId: value(BarberId.create(chair)),
        terms: value(ServiceTerms.create(price, 30)),
        startsAt: at('2026-08-05T10:00:00'),
        ...(cancelled
          ? {
              outcome: {
                kind: 'cancelled' as const,
                atMs: Date.UTC(2026, 7, 5, 7, 0, 0),
                by: 'staff' as const,
                reason: { kind: 'client_unwell' as const },
              },
            }
          : {}),
      });
    const party = value(
      Appointment.create({
        id: 'appointment-party',
        locationId: LocationId.generate().toString(),
        seats: [seat('ivan', 'self', false), seat('niko', 'companion', true)],
        now: at('2026-08-05T08:00:00'),
      }),
    );
    observeBarberDay.mockImplementation((barberId: { value: string }) =>
      of(
        ok(
          barberId.value === 'ivan' || barberId.value === 'niko' ? [party] : [],
        ),
      ),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const ivan = host().querySelector(
        '[data-row-id="appointment-party#ivan"]',
      );
      const niko = host().querySelector(
        '[data-row-id="appointment-party#niko"]',
      );
      // The root is still live, so Ivan's chair reads as it did…
      expect(ivan?.getAttribute('data-status')).toBe('pending');
      // …and Niko's reads by its own outcome.
      expect(niko?.getAttribute('data-status')).toBe('cancelled');

      // SAID IN A WORD where the countdown stood (owner, 2026-09-24: "so
      // it's instantly recognised"), and a live chair keeps its countdown.
      expect(
        niko?.querySelector('[data-testid="staff-event-state"]')?.textContent,
      ).toContain('appointments.status.cancelled');
      expect(
        niko
          ?.querySelector('.staff-event-head')
          ?.hasAttribute('data-gloss-state'),
      ).toBe(true);
      expect(
        ivan?.querySelector('[data-testid="staff-event-state"]'),
      ).toBeNull();

      // …its glyph on the client's FACE, where a glance starts — moved, not
      // copied: the foot no longer carries it (owner, 2026-09-24).
      expect(
        niko
          ?.querySelector(
            '.agenda-card__face [data-testid="staff-visit-state-badge"] ui-icon',
          )
          ?.getAttribute('data-name'),
      ).toBe('visit.cancelled');
      expect(
        niko?.querySelector(
          '.agenda-card__foot ui-icon[data-name="visit.cancelled"]',
        ),
      ).toBeNull();
      expect(
        ivan?.querySelector('[data-testid="staff-visit-state-badge"]'),
      ).toBeNull();

      // With faces switched off, the foot carries the glyph again.
      const cards = fixture.componentInstance as unknown as {
        fields: { isOn: (id: string) => boolean };
        rowIcons: (entry: unknown) => readonly string[];
      };
      const isOn = cards.fields.isOn.bind(cards.fields);
      cards.fields.isOn = (id: string) => (id === 'avatar' ? false : isOn(id));
      expect(
        cards.rowIcons({
          status: 'cancelled',
          rebooked: false,
          hasNote: false,
        }),
      ).toContain('visit.cancelled');
      cards.fields.isOn = isOn;
      expect(
        cards.rowIcons({
          status: 'cancelled',
          rebooked: false,
          hasNote: false,
        }),
      ).not.toContain('visit.cancelled');

      // The grid's block says the same on the line under the name.
      const component = fixture.componentInstance as unknown as {
        store: { setView: (view: string) => void };
        gridColumns: () => readonly {
          events: readonly { id: string; detail: string | null }[];
        }[];
      };
      component.store.setView('day');
      fixture.detectChanges();
      const blocks = component.gridColumns().flatMap((column) => column.events);
      expect(
        blocks.find((block) => block.id === 'appointment-party#niko')?.detail,
      ).toBe('appointments.status.cancelled');
      expect(
        (
          blocks.find((block) => block.id === 'appointment-party#niko') as
            { statusIcon?: string | null } | undefined
        )?.statusIcon,
      ).toBe('visit.cancelled');
      expect(
        blocks.find((block) => block.id === 'appointment-party#ivan')?.detail,
      ).not.toBe('appointments.status.cancelled');
      component.store.setView('agenda');
      fixture.detectChanges();

      // Opened, the cancelled chair offers no cancel and no no-show — only
      // the next visit. (The agenda was drawn again: read the row anew.)
      (
        host().querySelector(
          '[data-row-id="appointment-party#niko"]',
        ) as HTMLElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        host().querySelector('[data-testid="staff-visit-cancel"]'),
      ).toBeNull();
      expect(
        host().querySelector('[data-testid="staff-visit-no-show"]'),
      ).toBeNull();
      expect(
        host().querySelector('[data-testid="staff-visit-rebook"]'),
      ).not.toBeNull();

      // …and it opens on what settled it: whose act, when, and why (owner,
      // 2026-09-11). The stamp landed at 10:00 shop time on the visit's own
      // day, so the clock stands alone; the reason is the catalogue's line.
      const head = host().querySelector(
        '[data-testid="staff-visit-resolution"]',
      );
      expect(head?.getAttribute('data-tone')).toBe('destructive');
      const line =
        head?.querySelector('[data-testid="staff-visit-resolution-line"]')
          ?.textContent ?? '';
      expect(line).toContain('staff.visit.resolution.cancelledByStaff');
      expect(line).toContain('10:00');
      expect(
        head
          ?.querySelector('[data-testid="staff-visit-resolution-detail"]')
          ?.textContent?.trim(),
      ).toBe('staff.day.cancelReasonCode.client_unwell');
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it("says why a cancellation was refused, in the shop's words rather than the gateway's", async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-cancel"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-cancel-reason-client_changed_plans"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    // The server's refusal rides in the gateway error's params; the sheet
    // must reach for ITS line, not the gateway's "something went wrong".
    transition.mockResolvedValueOnce(
      fail(
        new BookingGatewayError(
          'invalid_request',
          'That seat is already resolved',
          {
            serverCode: 'booking.transition.not_allowed',
            from: 'resolved',
            to: 'cancelled',
          },
        ),
      ),
    );
    (
      host().querySelector(
        '[data-testid="staff-cancel-confirm"]',
      ) as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    const alert = host().querySelector(
      '[data-testid="staff-cancel-sheet"] [role="alert"]',
    );
    // The loader returns no translations, so the KEY reached for is the assertion.
    expect(alert?.textContent?.trim()).toBe(
      'errors.booking.transition.seat_resolved',
    );
    expect(alert?.textContent).not.toContain('booking.gateway.failed');
  });

  /*
   * ── THE REASON IS OPTIONAL (owner, 2026-09-11) ──────────────────────
   * "Barbers may not have time to enter such issue." One tap cancels; a
   * reason is a second tap for the barber who has one, and a chip tapped
   * again lets go of it. «Друго…» opens the note, and the note carries an
   * example rather than a second label.
   */
  it('cancels on one tap — a reason is offered, never demanded', async () => {
    const row = host().querySelector(
      '[data-testid="staff-visit-row"]',
    ) as HTMLElement;
    row.click();
    await fixture.whenStable();
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-cancel"]') as HTMLElement
    ).click();
    fixture.detectChanges();

    // The red button is live with nothing picked.
    const confirm = host().querySelector(
      '[data-testid="staff-cancel-confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);

    // A reason picked and picked again is no reason.
    const chip = host().querySelector(
      '[data-testid="staff-cancel-reason-client_unwell"]',
    ) as HTMLElement;
    chip.click();
    fixture.detectChanges();
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    chip.click();
    fixture.detectChanges();
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    // «Друго…» opens a note with an EXAMPLE in it, and left empty it is a
    // door opened and not walked through — the cancel still goes, unfiled.
    (
      host().querySelector(
        '[data-testid="staff-cancel-reason-other"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    const note = host().querySelector(
      '[data-testid="staff-cancel-note"]',
    ) as HTMLTextAreaElement;
    expect(note.placeholder).toBe('staff.day.cancelNotePlaceholder');
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(transition).toHaveBeenCalledTimes(1);
    const request = transition.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request['to']).toBe('cancelled');
    expect(request).not.toHaveProperty('reasonCode');
    expect(request).not.toHaveProperty('note');
    // The sheet closed on success.
    expect(
      host().querySelector('[data-testid="staff-cancel-sheet"]'),
    ).toBeNull();
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
    expect(next).toBeDefined();
    if (!next) return;

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
      openRestDay: (barberId: string) => void;
      liftFromEditor: () => Promise<void>;
      blockLiftArmed: () => boolean;
    };
    component.openRestDay('ivan');

    await component.liftFromEditor();
    expect(component.blockLiftArmed()).toBe(true);
    expect(clear).not.toHaveBeenCalled();

    await component.liftFromEditor();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(component.blockLiftArmed()).toBe(false);
  });

  it('lets the block sheet be re-aimed at another chair', () => {
    // The shop-wide action pre-aims at the first lane; without a picker that
    // meant one barber could stand a colleague's chair down in two taps.
    const component = fixture.componentInstance as unknown as {
      openBlockSheet: (barberId: string) => void;
      blockLaneId: () => string | null;
      barberOptions: () => readonly { id: string }[];
    };
    component.openBlockSheet('ivan');
    fixture.detectChanges();
    expect(component.blockLaneId()).toBe('ivan');
    // The chair it opened on is a row; the others wait behind «Добави
    // бръснар» (owner, 2026-09-09: several barbers, discretely).
    expect(component.barberOptions().map((o) => o.id)).toContain('ivan');
    expect(
      host().querySelector('[data-testid="staff-block-barber-ivan"]'),
    ).not.toBeNull();
    expect(
      host().querySelector('[data-testid="staff-block-add-barber"]'),
    ).not.toBeNull();
  });

  it('names the visits a block would strand rather than sitting on them', () => {
    const component = fixture.componentInstance as unknown as {
      openRestDay: (barberId: string) => void;
    };
    component.openRestDay('ivan');
    fixture.detectChanges();
    // The fixture books one live visit in Ivan's chair; a whole-day block
    // lands squarely on top of it, and the frame names it in red — under
    // the picture, the way the visit sheet names a collision. (The suite's
    // loader carries no copy, so the sentence is its key.)
    const note = host().querySelector('[data-testid="staff-block-frame-note"]');
    expect(note?.getAttribute('data-verdict')).toBe('conflict');
    expect(note?.textContent).toContain('staff.visit.conflict');
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

  /** Blocking time is an act, so its door is the ＋ menu's «Блок». */
  function openBlockDoor(): void {
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-add-block"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
  }

  it('blocks a range through the exception writer, sanitized', async () => {
    openBlockDoor();

    (
      host().querySelector(
        '[data-testid="staff-block-save"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    // The default is a RANGE, not the whole day — standing a chair down for
    // a full day is the rarer act and must be chosen deliberately. And a
    // range ACCUMULATES: it goes through `putRange`, which merges into the
    // day, never through `put`, which would replace it.
    expect(put).not.toHaveBeenCalled();
    expect(putRange).toHaveBeenCalledTimes(1);
    const args = putRange.mock.calls[0] as unknown as [
      string,
      string,
      string,
      string,
      { start: { toString: () => string }; end: { toString: () => string } },
    ];
    expect(args[0]).toBe('ivan');
    expect(args[2]).toBe('2026-08-05');
    expect(args[4].start.toString()).toBe('12:00');
    expect(args[4].end.toString()).toBe('13:00');
  });

  it('stands the whole day down when the switch is on', async () => {
    openBlockDoor();
    (
      host().querySelector(
        '[data-testid="staff-block-all-day"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-block-save"]',
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
        '[data-testid="ui-month-day-2026-08-26"]',
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
    // The bar itself stays — "back to today" still lives in it, and so does
    // the ONE create door the page can honour today: the block editor.
    expect(host().querySelector('ui-page-action-bar')).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    // The ＋ is the kind picker: what you are making, as a menu.
    (
      host().querySelector(
        '[data-testid="staff-add-block"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-block-sheet"]'),
    ).not.toBeNull();
  });

  // The owner, 2026-09-24: "do the same for no-show visits" — one
  // treatment for both hours that did not happen.
  it('treats a no-show like a cancellation: the word, the face badge, no tag, and a glyph on the block', async () => {
    const visits = observeBarberDay.getMockImplementation();
    const base = appointment(
      'appointment-missed',
      '2026-08-05T09:00:00',
      undefined,
      'ivan',
      false,
      'fade',
    );
    const seat = base.seats[0];
    if (seat === undefined) throw new Error('the fixture has no seat');
    const missed = value(
      Appointment.create({
        id: 'appointment-missed',
        locationId: base.locationId.toString(),
        seats: [
          Seat.of({
            id: seat.id,
            subject: seat.subject,
            serviceId: seat.serviceId,
            variantId: null,
            barberId: seat.barberId,
            terms: seat.terms,
            startsAt: seat.slot.start,
            outcome: {
              kind: 'no_show' as const,
              atMs: Date.UTC(2026, 7, 5, 7, 0, 0),
            },
          }),
        ],
        now: at('2026-08-05T08:00:00'),
      }),
    );
    observeBarberDay.mockImplementation((barberId: { value: string }) =>
      of(ok(barberId.value === 'ivan' ? [missed] : [])),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const card = host().querySelector(
        '[data-row-id="appointment-missed#ivan"]',
      );
      expect(card?.getAttribute('data-status')).toBe('no_show');
      expect(
        card?.querySelector('[data-testid="staff-event-state"]')?.textContent,
      ).toContain('staff.visit.resolution.noShow');
      expect(
        card
          ?.querySelector('[data-testid="staff-visit-state-badge"] ui-icon')
          ?.getAttribute('data-name'),
      ).toBe('visit.noShow');
      expect(
        card?.querySelector(
          '.agenda-card__foot ui-icon[data-name="visit.noShow"]',
        ),
      ).toBeNull();
      expect(card?.querySelector('[data-testid="staff-visit-tag"]')).toBeNull();
      expect(
        card?.querySelector('.staff-event-head')?.hasAttribute('data-struck'),
      ).toBe(true);

      const component = fixture.componentInstance as unknown as {
        store: { setView: (view: string) => void };
        gridColumns: () => readonly {
          events: readonly {
            id: string;
            detail: string | null;
            statusIcon: string | null;
          }[];
        }[];
      };
      component.store.setView('day');
      fixture.detectChanges();
      const block = component
        .gridColumns()
        .flatMap((column) => column.events)
        .find((event) => event.id === 'appointment-missed#ivan');
      expect(block?.detail).toBe('staff.visit.resolution.noShow');
      expect(block?.statusIcon).toBe('visit.noShow');
      component.store.setView('agenda');
      fixture.detectChanges();
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  // An hour that did not happen drops the marks that only matter to a
  // live visit (owner, 2026-09-24): the catalogue tag first.
  it('draws no duration tag on a cancelled visit', async () => {
    const visits = observeBarberDay.getMockImplementation();
    const cancelled = appointment(
      'appointment-fade-off',
      '2026-08-05T14:00:00',
      undefined,
      'ivan',
      false,
      'fade',
    );
    const seat = cancelled.seats[0];
    if (seat === undefined) throw new Error('the fixture has no seat');
    const resolved = value(
      Appointment.create({
        id: 'appointment-fade-off',
        locationId: cancelled.locationId.toString(),
        seats: [
          Seat.of({
            id: seat.id,
            subject: seat.subject,
            serviceId: seat.serviceId,
            variantId: null,
            barberId: seat.barberId,
            terms: seat.terms,
            startsAt: seat.slot.start,
            outcome: {
              kind: 'cancelled' as const,
              atMs: Date.UTC(2026, 7, 5, 7, 0, 0),
              by: 'client' as const,
              reason: { kind: 'client_unwell' as const },
            },
          }),
        ],
        now: at('2026-08-05T08:00:00'),
      }),
    );
    observeBarberDay.mockImplementation((barberId: { value: string }) =>
      of(ok(barberId.value === 'ivan' ? [resolved] : [])),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const card = host().querySelector(
        '[data-row-id="appointment-fade-off#ivan"]',
      );
      expect(card?.getAttribute('data-status')).toBe('cancelled');
      expect(card?.querySelector('[data-testid="staff-visit-tag"]')).toBeNull();
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it("tags a visit that runs off the catalogue's length, the way the frame does", async () => {
    // Owner, 2026-09-10: "the events here should look a lot like the ones
    // in the frame … the ±x min if extended or subtracted". The seat was
    // sold for 30 minutes; the chair's catalogue says 45 for the fade, so
    // the card says «−15 мин» in its foot, beside the marks — the frame's
    // own tag, one recipe.
    const visits = observeBarberDay.getMockImplementation();
    observeBarberDay.mockImplementation((barberId: { value: string }) =>
      of(
        ok(
          barberId.value === 'ivan'
            ? [
                appointment(
                  'appointment-fade',
                  '2026-08-05T14:00:00',
                  undefined,
                  'ivan',
                  false,
                  'fade',
                ),
              ]
            : [],
        ),
      ),
    );
    try {
      TestBed.resetTestingModule();
      await build();
      const tag = host().querySelector('[data-testid="staff-visit-tag"]');
      // The loader returns no translations, so this asserts the true minus
      // and the key the figure reaches for; the words are the helper's own
      // spec's business (`shared/catalog-delta.spec.ts`).
      expect(tag?.textContent?.trim()).toBe('−staff.visit.minutes');
      expect(tag?.closest('.agenda-card__foot')).not.toBeNull();
      expect(tag?.classList.contains('staff-event-tag')).toBe(true);
    } finally {
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it('opens the block sheet on a day nobody works — the ＋ never resolves to nobody', async () => {
    // Owner, 2026-09-09: "adding a blocker when all are blocked for the
    // selected date is not working — it should always open". A day everyone
    // is off has no working lane, and the create chair used to be read off
    // the lanes alone.
    // No roster AND no bookings: a chair with a visit still works the day.
    const roster = observeDay.getMockImplementation();
    const visits = observeBarberDay.getMockImplementation();
    observeDay.mockImplementation(() => of(ok([])));
    observeBarberDay.mockImplementation(() => of(ok([])));
    try {
      TestBed.resetTestingModule();
      await build();
      const component = fixture.componentInstance as unknown as {
        openCreate: (kind: 'booking' | 'block') => void;
        lanes: () => readonly unknown[];
        blockLaneId: () => string | null;
      };
      expect(component.lanes()).toHaveLength(0);
      component.openCreate('block');
      fixture.detectChanges();
      expect(
        host().querySelector('[data-testid="staff-block-sheet"]'),
      ).not.toBeNull();
      expect(component.blockLaneId()).toBe('ivan');
      // And the picture tells the truth: a chair with no roster is shut all
      // day — one closed run over the whole column, not a free day.
      expect(
        host().querySelectorAll('[data-testid="staff-grid-closed"]'),
      ).toHaveLength(1);
    } finally {
      if (roster) observeDay.mockImplementation(roster);
      if (visits) observeBarberDay.mockImplementation(visits);
    }
  });

  it("raises a refused save as the page's toast, in the shop's words, and keeps the sheet", async () => {
    // Owner, 2026-09-17: "save doesn't work all the time … if there is an
    // error message it should appear as a toast". The row's own error line
    // lives on the agenda behind the sheet; the toast is what the eye gets.
    const gateway = TestBed.inject(BOOKING_GATEWAY) as {
      staffEdit: (request: unknown) => Promise<unknown>;
    };
    gateway.staffEdit = async () =>
      fail(
        new BookingGatewayError(
          'invalid_request',
          'Services svc-classic-cut and svc-fade cannot be combined',
          { serverCode: 'booking.commit.conflicting_services' },
        ),
      );
    const component = fixture.componentInstance as unknown as {
      commitFromEditor: (id: string, commit: unknown) => Promise<void>;
      visitSheetRow: () => { appointmentId: string } | null;
      undo: () => unknown;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    if (row === null) throw new Error('the sheet did not open');
    const toast = () => host().querySelector('[data-testid="staff-toast"]');
    expect(toast()?.hasAttribute('data-presented')).toBe(false);

    // Every seat dropped: a batch with something in it, refused.
    await component.commitFromEditor(row.appointmentId, {
      kind: 'save',
      dayKey: '2026-08-05',
      startMinute: 600,
      endMinute: 630,
      note: null,
      discounts: [],
      vouchers: [],
      tipMinorUnits: null,
      clients: [],
      legs: [],
    });
    fixture.detectChanges();
    expect(toast()?.hasAttribute('data-presented')).toBe(true);
    // The toast carries the refusal as `describeError` words it. The loader
    // returns no translations here, so the server code's own line cannot
    // be told from its key and the description falls back to the gateway's
    // — the shop's sentence («Тези услуги не се комбинират.») is what the
    // running app shows, verified live. No undo on offer, only the dismiss.
    expect(toast()?.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'booking.gateway.failed',
    );
    expect(toast()?.querySelectorAll('button').length).toBe(1);
    expect(component.undo()).toBeNull();
    expect(component.visitSheetRow()?.appointmentId).toBe(row.appointmentId);
  });

  it("sends the editor's shutter up with the visit's facts, and a refusal as the page's toast", async () => {
    // Owner, 2026-09-17: photos on a visit carry who — the chair the sheet
    // is on, the client it is for, the visit.
    const requests: {
      appointmentId: string;
      barberId: string;
      clientLabel: string;
      file: Blob;
    }[] = [];
    let answer = true;
    const component = fixture.componentInstance as unknown as {
      store: {
        attachPhoto: (request: (typeof requests)[number]) => Promise<boolean>;
      };
      visitEditorVm: () => {
        appointmentId: string;
        chairId: string;
        clientLabel: string;
      } | null;
      attachPhotoFromEditor: (vm: unknown, file: File) => Promise<void>;
      notice: () => string | null;
    };
    component.store.attachPhoto = async (request) => {
      requests.push(request);
      return answer;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const vm = component.visitEditorVm();
    if (vm === null) throw new Error('the sheet did not open');
    const file = new File(['bytes'], 'cut.jpg', { type: 'image/jpeg' });

    await component.attachPhotoFromEditor(vm, file);
    expect(requests.length).toBe(1);
    expect(requests[0]?.appointmentId).toBe(vm.appointmentId);
    expect(requests[0]?.barberId).toBe(vm.chairId);
    expect(requests[0]?.clientLabel).toBe(vm.clientLabel);
    expect(requests[0]?.file).toBe(file);
    expect(component.notice()).toBeNull();

    answer = false;
    await component.attachPhotoFromEditor(vm, file);
    fixture.detectChanges();
    // The loader returns no translations: the key reached for is the assertion.
    expect(component.notice()).toBe('staff.visit.photoFailed');
    expect(
      host()
        .querySelector('[data-testid="staff-toast"]')
        ?.hasAttribute('data-presented'),
    ).toBe(true);
  });

  it('asks the index by every form of a typed number, once per pause, and never lets a late answer win', async () => {
    const component = fixture.componentInstance as unknown as {
      searchClients: (query: string) => void;
      visitClientOptions: () => readonly {
        id: string;
        label: string;
        phone: string | null;
        email?: string | null;
      }[];
      visitClientSearching: () => boolean;
      userSearch: { search: (key: string) => Promise<unknown> };
    };
    const asked: string[] = [];
    const userId = (id: string) => {
      const created = UserId.create(id);
      if (created.isFailure()) throw new Error('fixture: bad user id');
      return created.value;
    };
    const hit = (id: string, name: string, phone: string) => ({
      userId: userId(id),
      displayName: name,
      email: null,
      phone,
    });
    component.userSearch.search = async (key: string) => {
      asked.push(key);
      // Only the national form finds him; the other two forms find nobody.
      return ok(
        key === '0887654321'
          ? [hit('u-martin', 'Мартин Илиев', '+359887654321')]
          : [],
      );
    };
    vi.useFakeTimers();
    try {
      component.searchClients('88');
      component.searchClients('887654');
      component.searchClients('887654321');
      expect(component.visitClientSearching()).toBe(true);
      expect(asked).toEqual([]);
      await vi.advanceTimersByTimeAsync(250);
    } finally {
      vi.useRealTimers();
    }
    // One pause, one question — asked in all three forms the index holds.
    expect(asked).toEqual(['887654321', '0887654321', '359887654321']);
    expect(component.visitClientSearching()).toBe(false);
    expect(component.visitClientOptions()).toEqual([
      expect.objectContaining({
        id: 'u-martin',
        label: 'Мартин Илиев',
        phone: '+359 88 765 4321',
      }),
    ]);
    // Cleared: nothing to ask, nothing listed, no ring.
    component.searchClients('');
    expect(component.visitClientOptions()).toEqual([]);
    expect(component.visitClientSearching()).toBe(false);
  });

  it("builds the add-client page's one section — recent visitors from the window, never today's book", async () => {
    const component = fixture.componentInstance as unknown as {
      browseClients: () => Promise<void>;
      visitClientSections: () => readonly {
        id: string;
        clients: readonly { label: string }[];
      }[];
    };
    await component.browseClients();
    const sections = component.visitClientSections();
    // «Днес» is gone (owner, 2026-09-22): a person already in today's book
    // is not one a barbershop adds to another visit.
    expect(sections.map((section) => section.id)).toEqual(['recent']);
    // The window's visit — dated 2026-08-05, behind any real clock — is
    // the one recent visitor.
    expect(sections[0]?.clients.map((client) => client.label)).toEqual([
      'Георги Петров',
    ]);
    expect(sections[0]?.clients[0]?.meta).toMatch(
      /^посл\. |^staff\.visit\.lastVisit/,
    );
  });

  it('lands the compact title in the bar while the add-client search is engaged', () => {
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-visit-add-client"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    const header = () =>
      host().querySelector(
        '[data-testid="staff-visit-sheet"] .ui-sheet-header',
      );
    expect(header()?.hasAttribute('data-collapsed')).toBe(false);
    const query = host().querySelector(
      '[data-testid="staff-visit-client-query"]',
    ) as HTMLInputElement;
    query.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    // The editor's word reaches the sheet's own header: the folded title
    // never scrolls under the bar, so nothing else could have said so.
    expect(header()?.hasAttribute('data-collapsed')).toBe(true);
    query.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(header()?.hasAttribute('data-collapsed')).toBe(false);
  });

  // The «Нов час» sheet never forwarded the fold (found 2026-09-24): its
  // client search folded the large title and the bar never landed the
  // compact one, so the page lost its name.
  it('lands the compact title on the new-visit sheet too, while its searches are engaged', () => {
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-add-booking"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const header = () =>
      host().querySelector(
        '[data-testid="staff-create-sheet"] .ui-sheet-header',
      );
    for (const door of ['staff-visit-add-client', 'staff-visit-add-service']) {
      (
        host().querySelector(
          `[data-testid="staff-create-sheet"] [data-testid="${door}"]`,
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      const field = host().querySelector(
        '[data-testid="staff-create-sheet"] ui-search-field input',
      ) as HTMLInputElement;
      expect(header()?.hasAttribute('data-collapsed')).toBe(false);
      field.dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      expect(header()?.hasAttribute('data-collapsed')).toBe(true);
      field.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(header()?.hasAttribute('data-collapsed')).toBe(false);
      (
        host().querySelector(
          '[data-testid="staff-create-sheet"] [data-testid="staff-visit-back"]',
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
    }
  });

  it("gives the day search the sheets' one search grammar: the head folds, the DS field is pinned, ↓ reaches the hits", async () => {
    (
      host().querySelector(
        '[data-testid="staff-search-open"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const head = () =>
      host().querySelector('[data-testid="staff-search-headline"]');
    const header = () =>
      host().querySelector(
        '[data-testid="staff-search-sheet"] .ui-sheet-header',
      );
    const input = host().querySelector(
      '[data-testid="staff-search-input"]',
    ) as HTMLInputElement;
    expect(input.closest('ui-search-field[data-pinned]')).not.toBeNull();
    expect(head()?.hasAttribute('data-folded')).toBe(false);

    input.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(head()?.hasAttribute('data-folded')).toBe(true);
    expect(header()?.hasAttribute('data-collapsed')).toBe(true);

    input.value = 'георги';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    // A query standing keeps it folded, keyboard or not.
    expect(head()?.hasAttribute('data-folded')).toBe(true);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'staff-search-hit',
    );
  });

  it('hands the omnibox the book — everyone in the loaded days, as their last booking wrote them', async () => {
    const component = fixture.componentInstance as unknown as {
      browseClients: () => Promise<void>;
      visitClientBook: () => readonly {
        id: string;
        label: string;
        phone: string | null;
        meta: string | null;
      }[];
    };
    expect(component.visitClientBook()).toEqual([]);
    await component.browseClients();
    // The window's one visitor, by the contact the booking was made with —
    // searched on the keystroke, so no «last visit» line: it is never listed.
    expect(component.visitClientBook()).toEqual([
      expect.objectContaining({
        label: 'Георги Петров',
        phone: '+359 88 123 4567',
        meta: null,
      }),
    ]);
  });

  it('keeps a drag in the frame in the draft — nothing written, no toast — and «Запази» carries it', async () => {
    // The owner, 2026-09-23: the gesture's immediate write (the order
    // review's one exception) and its toast's undo moved the server while
    // the sheet's draft stayed put — the frame kept showing the dragged
    // time after «Отмени». A drag is a draft edit now, like «Начало».
    const component = fixture.componentInstance as unknown as {
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => { appointmentId: string } | null;
      undo: () => { message: string } | null;
      notice: () => string | null;
    };
    const edits: {
      command: readonly { kind: string; startIso?: string }[];
    }[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(
        request as {
          command: readonly { kind: string; startIso?: string }[];
        },
      );
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    if (component.visitSheetRow() === null) {
      throw new Error('the sheet did not open');
    }
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      onFrameCommit: (commit: {
        id: string;
        kind: 'move';
        startMinute: number;
        endMinute: number;
      }) => void;
      dirty: () => boolean;
    };
    editor.onFrameCommit({
      id: 'appt-1',
      kind: 'move',
      startMinute: 660,
      endMinute: 705,
    });
    fixture.detectChanges();
    expect(edits).toHaveLength(0);
    // The toast's host is always mounted; what it shows is these two.
    expect(component.undo()).toBeNull();
    expect(component.notice()).toBeNull();
    expect(editor.dirty()).toBe(true);

    (
      host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(edits).toHaveLength(1);
    const move = edits[0]?.command.find((entry) => entry.kind === 'move');
    expect(Date.parse(move?.startIso ?? '')).toBe(
      Date.parse('2026-08-05T11:00:00+03:00'),
    );
    // The save's own receipt is the one toast a save raises.
    expect(component.undo()?.message).toBe('staff.day.undo.saved');
  });

  // The owner, 2026-09-23: "build the save receipt with whole-save undo".
  it('offers the receipt after a save, and its undo maps the visit back in one batch, then re-seeds the sheet', async () => {
    const component = fixture.componentInstance as unknown as {
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => { appointmentId: string } | null;
      undo: () => { message: string } | null;
      runUndo: () => Promise<void>;
      visitReseedMark: () => { appointmentId: string; n: number };
      rowWaitMs: number;
    };
    // The store under test never delivers a write, so the waits on the
    // listener run to their ceiling — lowered to a tick here.
    component.rowWaitMs = 0;
    type Sent = {
      command: readonly {
        kind: string;
        startIso?: string;
        atIso?: string;
        edge?: string;
      }[];
    };
    const edits: Sent[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(request as Sent);
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    if (component.visitSheetRow() === null) {
      throw new Error('the sheet did not open');
    }
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      onFrameCommit: (commit: {
        id: string;
        kind: 'move';
        startMinute: number;
        endMinute: number;
      }) => void;
      dirty: () => boolean;
    };
    editor.onFrameCommit({
      id: 'appointment-1',
      kind: 'move',
      startMinute: 660,
      endMinute: 690,
    });
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(edits).toHaveLength(1);
    expect(component.undo()?.message).toBe('staff.day.undo.saved');

    await component.runUndo();
    expect(edits).toHaveLength(2);
    const back = edits[1]?.command ?? [];
    const move = back.find((entry) => entry.kind === 'move');
    expect(Date.parse(move?.startIso ?? '')).toBe(
      Date.parse('2026-08-05T10:00:00+03:00'),
    );
    const resize = back.find((entry) => entry.kind === 'resize');
    expect(resize?.edge).toBe('end');
    expect(Date.parse(resize?.atIso ?? '')).toBe(
      Date.parse('2026-08-05T10:30:00+03:00'),
    );
    expect(
      back.some(
        (entry) => entry.kind === 'addSeat' || entry.kind === 'removeSeat',
      ),
    ).toBe(false);
    expect(component.undo()).toBeNull();

    // The store under test never moved the row, so it already agrees with
    // the snapshot: the sheet on THIS visit is asked to re-seed, and the
    // drag the save carried is gone from the draft.
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 5));
    fixture.detectChanges();
    expect(component.visitReseedMark()).toEqual({
      appointmentId: 'appointment-1',
      n: 1,
    });
    expect(editor.dirty()).toBe(false);
  });

  it('says a refused undo left the save standing, and offers nothing to try again', async () => {
    const component = fixture.componentInstance as unknown as {
      store: {
        staffEdit: (request: unknown) => Promise<boolean>;
        errorFor: (id: string) => unknown;
      };
      undo: () => { message: string } | null;
      notice: () => string | null;
      runUndo: () => Promise<void>;
      rowWaitMs: number;
    };
    component.rowWaitMs = 0;
    let sent = 0;
    component.store.staffEdit = async () => {
      sent += 1;
      return sent < 2;
    };
    component.store.errorFor = () => null;
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      onFrameCommit: (commit: unknown) => void;
    };
    editor.onFrameCommit({
      id: 'appointment-1',
      kind: 'move',
      startMinute: 660,
      endMinute: 690,
    });
    fixture.detectChanges();
    (
      host().querySelector('[data-testid="staff-visit-save"]') as HTMLElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.undo()?.message).toBe('staff.day.undo.saved');

    await component.runUndo();
    expect(sent).toBe(2);
    expect(component.undo()).toBeNull();
    expect(component.notice()).toBe('staff.day.undo.refused');
  });

  it('pins every surviving leg to its ladder slot before the chair-wide move, and restaffs a moved chair back', () => {
    const component = fixture.componentInstance as unknown as {
      visitSheetRow: () =>
        | (Record<string, unknown> & {
            id: string;
            startMs: number;
            endMs: number;
            legs: readonly VisitEditorLeg[];
          })
        | null;
      visitEditorVm: () => VisitEditorVm | null;
      commandsFor: (
        target: VisitEditorCommit,
        row: unknown,
      ) => readonly {
        kind: string;
        seatIds?: readonly string[];
        seatId?: string;
        barberId?: string;
        startIso?: string;
      }[];
      rowFor: (
        rowId: string,
        seatIds?: readonly string[],
      ) => { id: string } | null;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    const vm = component.visitEditorVm();
    if (row === null || vm === null) throw new Error('the sheet did not open');
    const before = snapshotCommitOf(vm);
    const cut = before.legs[0];
    if (cut === undefined) throw new Error('the fixture row has no leg');

    // The snapshot held two legs; the save dropped the second and dragged
    // the block an hour on. The way back re-adds the beard at its slot and
    // PINS the cut to the ladder's start before the chair-wide move, so one
    // delta cannot swap them.
    const twoLegs: VisitEditorCommit = {
      ...before,
      endMinute: before.startMinute + cut.minutes + 20,
      legs: [
        ...before.legs,
        {
          seatId: 'seat-beard',
          serviceId: 'beard',
          variantId: null,
          minutes: 20,
          priceLabel: '10,00 €',
          barberId: cut.barberId,
          clientId: cut.clientId,
        },
      ],
    };
    const hour = 60 * 60_000;
    const later = {
      ...row,
      startMs: row.startMs + hour,
      endMs: row.endMs + hour,
    };
    const back = component.commandsFor(twoLegs, later);
    const moves = back.filter((entry) => entry.kind === 'move');
    const pin = moves.find((entry) => entry.seatIds?.length === 1);
    expect(pin).toEqual({
      kind: 'move',
      seatIds: [cut.seatId],
      startIso: expect.any(String),
    });
    expect(Date.parse(pin?.startIso ?? '')).toBe(
      Date.parse('2026-08-05T10:00:00+03:00'),
    );
    const wide = moves.find((entry) => entry !== pin);
    expect(back.indexOf(pin as (typeof back)[number])).toBeLessThan(
      back.indexOf(wide as (typeof back)[number]),
    );
    const readd = back.find((entry) => entry.kind === 'addSeat');
    expect(Date.parse(readd?.startIso ?? '')).toBe(
      Date.parse('2026-08-05T10:30:00+03:00'),
    );
    // A chair's share names the seats the batch LEAVES — never a removed one.
    expect(wide?.seatIds).toEqual([cut.seatId, 'seat-beard']);

    // The save restaffed the chair: the row now lives on another lane under
    // another name, and is found by its seat. The way back restaffs it.
    const onStefan: VisitEditorCommit = {
      ...before,
      legs: before.legs.map((leg) => ({ ...leg, barberId: 'stefan' })),
    };
    expect(component.rowFor('appointment-1#stefan')).toBeNull();
    expect(component.rowFor('appointment-1#stefan', [cut.seatId])?.id).toBe(
      'appointment-1#ivan',
    );
    expect(component.commandsFor(onStefan, row)).toContainEqual({
      kind: 'restaff',
      seatId: cut.seatId,
      barberId: 'stefan',
    });
  });

  it('withholds the way back only from a save that added a seat to a finished visit', () => {
    const added = [{ kind: 'addSeat' }] as unknown as Parameters<
      typeof reversibleSave
    >[1];
    const moved = [{ kind: 'move' }] as unknown as Parameters<
      typeof reversibleSave
    >[1];
    expect(reversibleSave({ status: 'completed' }, added)).toBe(false);
    expect(reversibleSave({ status: 'completed' }, moved)).toBe(true);
    expect(reversibleSave({ status: 'confirmed' }, added)).toBe(true);
    expect(reversibleSave(null, added)).toBe(true);
  });

  it("undoes a save by the save's own arithmetic: the added seat goes, the removed one returns with its terms, the block and the bill go back", () => {
    const component = fixture.componentInstance as unknown as {
      visitSheetRow: () => (DayRowShape & Record<string, unknown>) | null;
      visitEditorVm: () => VisitEditorVm | null;
      commandsFor: (
        target: VisitEditorCommit,
        row: unknown,
      ) => readonly Record<string, unknown>[];
    };
    type DayRowShape = {
      startMs: number;
      endMs: number;
      legs: readonly VisitEditorLeg[];
      discounts: readonly unknown[];
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    const vm = component.visitEditorVm();
    if (row === null || vm === null) throw new Error('the sheet did not open');
    const before = snapshotCommitOf(vm);
    const cut = row.legs[0];
    if (cut === undefined) throw new Error('the fixture row has no leg');

    // The visit as a save left it: an hour later, the cut gone, a beard in
    // its place, a code on the bill.
    const hour = 60 * 60_000;
    const after = {
      ...row,
      startMs: row.startMs + hour,
      endMs: row.endMs + hour,
      legs: [
        {
          seatId: 'seat-beard',
          serviceId: 'beard',
          variantId: null,
          serviceLabel: 'Брада',
          minutes: 20,
          priceLabel: '10,00 €',
          barberId: cut.barberId,
          barberName: cut.barberName,
          barberTone: cut.barberTone,
          overridden: false,
        },
      ],
      discounts: [
        {
          source: 'code',
          label: 'FIRST10',
          value: { kind: 'percent_off', percent: 10 },
          grantId: null,
          code: 'FIRST10',
          exclusive: false,
        },
      ],
    };

    const back = component.commandsFor(before, after);
    const kinds = back.map((entry) => entry['kind']);
    expect(kinds).toContain('removeSeat');
    expect(back.find((entry) => entry['kind'] === 'removeSeat')).toEqual({
      kind: 'removeSeat',
      seatId: 'seat-beard',
    });
    const readd = back.find((entry) => entry['kind'] === 'addSeat');
    expect(readd).toEqual(
      expect.objectContaining({
        seatId: cut.seatId,
        serviceId: cut.serviceId,
        barberId: cut.barberId,
        minutes: cut.minutes,
        subject: { kind: 'self' },
      }),
    );
    expect(Date.parse(String(readd?.['startIso']))).toBe(
      Date.parse('2026-08-05T10:00:00+03:00'),
    );
    // Its stored price rides along, for a server that honours it.
    expect(back).toContainEqual({
      kind: 'reprice',
      seatId: cut.seatId,
      priceMinorUnits: 2800,
    });
    const move = back.find((entry) => entry['kind'] === 'move');
    expect(Date.parse(String(move?.['startIso']))).toBe(
      Date.parse('2026-08-05T10:00:00+03:00'),
    );
    // The bill's arm is sent EXPLICITLY, empty: omitting it would keep the
    // code the save applied.
    expect(back).toContainEqual({ kind: 'discounts', discounts: [] });
    // In the server's order: seats before the move, the bill last.
    expect(kinds.indexOf('removeSeat')).toBeLessThan(kinds.indexOf('move'));
    expect(kinds.indexOf('addSeat')).toBeLessThan(kinds.indexOf('move'));
    expect(kinds.at(-1)).toBe('discounts');
  });

  it('asks before a ✕ drops unsaved edits, and closes at once when the draft is clean', () => {
    const component = fixture.componentInstance as unknown as {
      dismissVisitSheet: () => void;
      confirmDiscard: () => void;
      discardPending: () => string | null;
      visitSheetRow: () => unknown;
    };
    const openRow = () => {
      (
        host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
      ).click();
      fixture.detectChanges();
    };
    openRow();
    expect(component.visitSheetRow()).not.toBeNull();
    component.dismissVisitSheet();
    fixture.detectChanges();
    expect(component.visitSheetRow()).toBeNull();
    expect(component.discardPending()).toBeNull();

    openRow();
    const editor = fixture.debugElement.query(By.directive(StaffVisitEditor))
      .componentInstance as unknown as {
      stepDay: (offset: number) => void;
      dirty: () => boolean;
    };
    editor.stepDay(1);
    fixture.detectChanges();
    expect(editor.dirty()).toBe(true);
    component.dismissVisitSheet();
    fixture.detectChanges();
    expect(component.discardPending()).toBe('visit');
    expect(component.visitSheetRow()).not.toBeNull();
    const sheet = host().querySelector('[data-testid="staff-discard-sheet"]');
    expect(sheet).not.toBeNull();
    (
      sheet?.querySelector('[data-testid="staff-discard-keep"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(component.discardPending()).toBeNull();
    expect(component.visitSheetRow()).not.toBeNull();
    component.dismissVisitSheet();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-discard-confirm"]',
      ) as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(component.discardPending()).toBeNull();
    expect(component.visitSheetRow()).toBeNull();
  });

  it("«Запиши пак» keeps the finished visit's own hour and span", () => {
    const component = fixture.componentInstance as unknown as {
      rebookFromEditor: (vm: unknown) => void;
      visitEditorVm: () => Record<string, unknown> | null;
      createVisit: () => { startMinute: number; minutes?: number } | null;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const vm = component.visitEditorVm();
    if (vm === null) throw new Error('the sheet did not open');
    component.rebookFromEditor({ ...vm, startMinute: 615, endMinute: 660 });
    fixture.detectChanges();
    expect(component.createVisit()?.startMinute).toBe(615);
    expect(component.createVisit()?.minutes).toBe(45);
  });

  it('sends the other shop as a relocate that LEADS the batch, and nothing when the shop is the same', async () => {
    const component = fixture.componentInstance as unknown as {
      commitFromEditor: (id: string, commit: unknown) => Promise<void>;
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => {
        appointmentId: string;
        locationId: string;
        legs: readonly {
          seatId: string;
          minutes: number;
          barberId: string;
          priceLabel: string | null;
        }[];
      } | null;
    };
    const edits: { command: readonly { kind: string }[] }[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(request as { command: readonly { kind: string }[] });
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    if (row === null) throw new Error('the sheet did not open');
    const [leg] = row.legs;
    if (leg === undefined) throw new Error('no seat on the row');
    // The row knows its shop — the appointment's own.
    expect(row.locationId.length).toBeGreaterThan(0);
    const save = (locationId: string) => ({
      kind: 'save',
      dayKey: '2026-08-05',
      startMinute: 600,
      endMinute: 630,
      locationId,
      note: null,
      discounts: [],
      vouchers: [],
      tipMinorUnits: null,
      clients: [],
      legs: [
        {
          seatId: leg.seatId,
          serviceId: 'cut',
          variantId: null,
          minutes: leg.minutes,
          priceLabel: leg.priceLabel,
          barberId: leg.barberId,
          clientId: 'user-martin',
        },
      ],
    });
    await component.commitFromEditor(row.appointmentId, save('loc-mladost'));
    expect(edits).toHaveLength(1);
    expect(edits[0]?.command[0]).toEqual({
      kind: 'relocate',
      locationId: 'loc-mladost',
    });
    // The same shop: no relocate at all.
    await component.commitFromEditor(row.appointmentId, save(row.locationId));
    expect(edits).toHaveLength(2);
    expect(
      edits[1]?.command.some((command) => command.kind === 'relocate'),
    ).toBe(false);
  });

  it('lets the front desk and the owners reprice a seat, and sends it as a reprice on save', async () => {
    // Owner, 2026-09-10: the price is edited on the ladder for whoever may;
    // the save carries it as the seat's new terms. A plain barber gets no
    // pill: he may stretch his own time, not discount the shop's money.
    const component = fixture.componentInstance as unknown as {
      mayReprice: () => boolean;
      commitFromEditor: (id: string, commit: unknown) => Promise<void>;
      store: { staffEdit: (request: unknown) => Promise<boolean> };
      visitSheetRow: () => {
        appointmentId: string;
        legs: readonly {
          seatId: string;
          minutes: number;
          barberId: string;
          priceLabel: string | null;
        }[];
      } | null;
    };
    expect(component.mayReprice()).toBe(true);

    const edits: { command: readonly { kind: string }[] }[] = [];
    component.store.staffEdit = async (request) => {
      edits.push(request as { command: readonly { kind: string }[] });
      return true;
    };
    (
      host().querySelector('[data-testid="staff-visit-row"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    const row = component.visitSheetRow();
    if (row === null) throw new Error('the sheet did not open');
    const [leg] = row.legs;
    if (leg === undefined) throw new Error('no seat on the row');
    await component.commitFromEditor(row.appointmentId, {
      kind: 'save',
      dayKey: '2026-08-05',
      startMinute: 600,
      endMinute: 630,
      note: null,
      discounts: [],
      vouchers: [],
      tipMinorUnits: null,
      clients: [],
      legs: [
        {
          seatId: leg.seatId,
          serviceId: 'cut',
          variantId: null,
          minutes: leg.minutes,
          priceLabel: '18,00 €',
          priceMinorUnits: 1800,
          barberId: leg.barberId,
          clientId: 'user-martin',
        },
        // A seat minted in the draft, priced by hand: its reprice follows
        // its addSeat in the same batch (owner, 2026-09-10).
        {
          seatId: 'draft-wash-1',
          serviceId: 'wash',
          variantId: null,
          minutes: 10,
          priceLabel: '9,00 €',
          priceMinorUnits: 900,
          barberId: leg.barberId,
          clientId: 'user-martin',
        },
      ],
    });
    const commands = edits.flatMap((edit) => edit.command);
    expect(commands).toContainEqual({
      kind: 'reprice',
      seatId: leg.seatId,
      priceMinorUnits: 1800,
    });
    const seatOf = (command: { kind: string }) =>
      (command as { seatId?: string }).seatId;
    const added = commands.findIndex(
      (command) =>
        command.kind === 'addSeat' && seatOf(command) === 'draft-wash-1',
    );
    const repriced = commands.findIndex(
      (command) =>
        command.kind === 'reprice' && seatOf(command) === 'draft-wash-1',
    );
    expect(added).toBeGreaterThanOrEqual(0);
    expect(repriced).toBeGreaterThan(added);
    expect(commands[repriced]).toMatchObject({ priceMinorUnits: 900 });

    // A plain barber: the gate shuts.
    principal$.next({
      kind: 'active',
      uid: 'dev-staff-ivan' as unknown as PrincipalId,
      roles: ['barber'].map(roleFromPrimitive),
    });
    expect(component.mayReprice()).toBe(false);
    principal$.next({
      kind: 'active',
      uid: 'dev-staff-ivan' as unknown as PrincipalId,
      roles: ['barber', 'admin'].map(roleFromPrimitive),
    });
  });

  it('opens ONE kind of new visit from the ＋, starting at the next tick', () => {
    // «Бърз час» is gone (owner, 2026-09-09): a walk-in is a kind of client,
    // chosen in the sheet, and someone at the counter may want tomorrow.
    const component = fixture.componentInstance as unknown as {
      openCreate: (kind: 'booking' | 'block') => void;
      createVm: () => { clientLabel: string; startMinute: number } | null;
    };
    expect(
      host().querySelector('[data-testid="staff-add-walk-in"]'),
    ).toBeNull();
    component.openCreate('booking');
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-create-sheet"]'),
    ).not.toBeNull();
    expect(component.createVm()?.clientLabel).toBe('');
    expect((component.createVm()?.startMinute ?? 0) % 5).toBe(0);
  });

  it('places a party as one booking: the account holder owns it, the rest ride as guests', async () => {
    // THE PARTY GRAMMAR. Every leg names its person. The first client WITH
    // an account is the appointment's owner (`self` seats, `onBehalfOfUserId`);
    // a walk-in placeholder or a minted guest rides as a `guest` seat under
    // their own name — the domain's one-owner shape, not a shortcut here.
    const requests: CommitBookingRequest[] = [];
    const gateway = TestBed.inject(BOOKING_GATEWAY) as {
      commit: (request: CommitBookingRequest) => Promise<unknown>;
    };
    gateway.commit = async (request) => {
      requests.push(request);
      return ok({ appointmentId: 'apt-party', status: 'confirmed' });
    };
    const component = fixture.componentInstance as unknown as {
      openCreate: (kind: 'booking' | 'block') => void;
      createFromEditor: (commit: unknown) => Promise<void>;
      createVisit: () => unknown;
    };
    component.openCreate('booking');
    fixture.detectChanges();
    await component.createFromEditor({
      kind: 'save',
      dayKey: '2026-09-03',
      startMinute: 600,
      endMinute: 645,
      note: null,
      clients: [
        { id: 'primary', label: 'Без запазен час', phone: null },
        { id: 'user-martin', label: 'Мартин Илиев', phone: '+359881234567' },
      ],
      legs: [
        {
          seatId: 'draft-cut',
          serviceId: 'cut',
          variantId: null,
          minutes: 30,
          priceLabel: null,
          barberId: 'ivan',
          clientId: 'primary',
        },
        {
          seatId: 'draft-beard',
          serviceId: 'beard',
          variantId: null,
          minutes: 15,
          priceLabel: null,
          barberId: 'ivan',
          clientId: 'user-martin',
        },
      ],
    });
    const request = requests[0];
    expect(request?.onBehalfOfUserId).toBe('user-martin');
    expect(request?.seats.map((seat) => seat.subject)).toEqual([
      { kind: 'guest', label: 'Без запазен час' },
      { kind: 'self' },
    ]);
    // The contact is the owner's, not the walk-in's.
    expect(request?.contact?.name).toBe('Мартин Илиев');
    // Serial from the chosen minute, in ladder order.
    const at = request?.seats.map((seat) => Date.parse(seat.startIso)) ?? [];
    expect(at[1] - at[0]).toBe(30 * 60_000);
    expect(component.createVisit()).toBeNull();
  });

  it('keeps the view menu to views, and blocking time under ＋', () => {
    // «Блокирай време» used to ride under the four readings (owner,
    // 2026-09-23): a picker that chooses how the day is DRAWN must not also
    // DO something to it. The act has one door, with the other acts.
    (
      host().querySelector(
        '[data-testid="staff-view-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="staff-lane-block"]')).toBeNull();
    expect(
      host().querySelector('[data-testid="staff-view-week"]'),
    ).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-add-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      host().querySelector('[data-testid="staff-add-block"]'),
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

  // ── The grid views' design record (2026-09-23) ─────────────────────────

  it("names a period in the pill's own numeric grammar", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // 2026-08-05 is a Wednesday; its week runs Monday the 3rd to Sunday the
    // 9th, and the shared month is said once, the way the day pill says a
    // day («ср, 5.08») — never the long month that pushed the cluster off a
    // phone's bar.
    const label = host()
      .querySelector('[data-testid="staff-day-label"]')
      ?.textContent?.replace(/\s/g, ' ')
      .trim();
    expect(label).toContain('3 – 9.08');
    expect(label).not.toMatch(/август/i);
  });

  it('mounts the calendar in its own canvas, and the agenda in its stack', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The calendar is the screen: no padded stack around it, no 52rem cap.
    expect(
      host().querySelector(
        '[data-testid="staff-canvas"] [data-testid="staff-grid"]',
      ),
    ).not.toBeNull();
    expect(host().querySelector('.staff-lanes')).toBeNull();
    expect(
      host().querySelector('.staff-day')?.getAttribute('data-view-kind'),
    ).toBe('grid');

    chooseView('agenda');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host().querySelector('.staff-lanes')).not.toBeNull();
    expect(host().querySelector('[data-testid="staff-canvas"]')).toBeNull();
    expect(
      host().querySelector('.staff-day')?.getAttribute('data-view-kind'),
    ).toBe('agenda');
  });

  it("carries the view switch twice — the cluster's menu and the bar's segments", () => {
    // Both are in the DOM; the bar's own width shows one (a container query
    // the test runner cannot evaluate). The menu's items keep their ids, so
    // every `staff-view-{id}` query still resolves to the menu.
    expect(
      host().querySelector(
        '[data-testid="staff-view-segments"] [data-testid="staff-view-segment-week"]',
      ),
    ).not.toBeNull();
    (
      host().querySelector(
        '[data-testid="staff-view-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      host()
        .querySelector('[data-testid="staff-view-week"]')
        ?.closest('.staff-view-menu'),
    ).not.toBeNull();
  });

  it("opens a date column's day in the day view from its head", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const heads = host().querySelectorAll<HTMLButtonElement>(
      '[data-testid="staff-grid-head-day"]',
    );
    expect(heads.length).toBe(7);
    // Thursday the 6th — Apple's own week-head tap.
    heads[3]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      store: { view(): string; dayKey(): string };
    };
    expect(component.store.view()).toBe('day');
    expect(component.store.dayKey()).toBe('2026-08-06');
    expect(
      host().querySelector('[data-testid="staff-day-label"]')?.textContent,
    ).toContain('6.08');
  });

  it('offers the way back to now on today once the present has left the frame', async () => {
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // On today, with the present in the box, there is nothing to come back to.
    expect(host().querySelector('[data-testid="staff-day-today"]')).toBeNull();
    // Driven through the grid's own report, as the template wires it.
    const component = fixture.componentInstance as unknown as {
      grid(): { nowInView: { emit(inView: boolean): void } } | undefined;
    };
    component.grid()?.nowInView.emit(false);
    fixture.detectChanges();
    const button = host().querySelector('[data-testid="staff-day-today"]');
    expect(button).not.toBeNull();
    // A button that scrolls must not say it jumps.
    expect(button?.getAttribute('aria-label')).toBe('staff.day.backToNow');
    component.grid()?.nowInView.emit(true);
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="staff-day-today"]')).toBeNull();
  });

  it('reads the view and the chair from the route, and remembers the view', async () => {
    fixture.componentRef.setInput('view', 'week');
    fixture.componentRef.setInput('barber', 'ivan');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      store: { view(): string; scope(): string | null };
    };
    expect(component.store.view()).toBe('week');
    expect(component.store.scope()).toBe('ivan');
    // The view is kept on the device; the chair never is.
    expect(localStorage.getItem('staff.schedule.view')).toBe('week');
    // A name nobody has resolves to the list, not to a view that does not exist.
    fixture.componentRef.setInput('view', 'month');
    fixture.detectChanges();
    expect(component.store.view()).toBe('agenda');
  });

  it('writes the view and the chair to the address bar, after the tick', async () => {
    chooseView('week');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    expect(router.url).toContain('view=week');
    (
      host().querySelector(
        '[data-testid="staff-scope-trigger"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      host().querySelector(
        '[data-testid="staff-scope-ivan"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(router.url).toContain('barber=ivan');
    expect(router.url).toContain('view=week');
  });

  it("opens the block sheet all day from a date's all-day band, and from a chair's", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const cells = host().querySelectorAll<HTMLButtonElement>(
      '[data-testid="staff-grid-allday-add"]',
    );
    expect(cells.length).toBe(7);
    // Thursday the 6th's band: the sheet opens ON that date, all day on,
    // for the create chair.
    cells[3]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      blockEditorVm(): {
        allDay: boolean;
        dayKey: string;
        barberIds: readonly string[];
      } | null;
      closeBlockSheet(): void;
    };
    expect(
      host().querySelector('[data-testid="staff-block-sheet"]'),
    ).not.toBeNull();
    expect(component.blockEditorVm()?.allDay).toBe(true);
    expect(component.blockEditorVm()?.dayKey).toBe('2026-08-06');
    component.closeBlockSheet();
    fixture.detectChanges();

    // The day view's band names a CHAIR: the sheet opens for it on the shown day.
    chooseView('day');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const chairs = host().querySelectorAll<HTMLButtonElement>(
      '[data-testid="staff-grid-allday-add"]',
    );
    chairs[1]?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.blockEditorVm()?.allDay).toBe(true);
    expect(component.blockEditorVm()?.dayKey).toBe('2026-08-05');
    expect(component.blockEditorVm()?.barberIds).toEqual(['niko']);
  });

  it("opens a chair's day off from its chip in the band, on that date", async () => {
    chooseView('week');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // Niko is off every day of the fixture's week; the chip in WEDNESDAY's
    // cell (the 5th, the third column) opens his rest day on that date,
    // ready to lift — not the shown day, not the first cell's.
    const cells = host().querySelectorAll<HTMLElement>(
      '[data-testid="staff-grid-allday-cell"]',
    );
    const chip = cells[2]?.querySelector<HTMLButtonElement>(
      '[data-testid="staff-grid-allday-chip"]',
    );
    expect(chip?.tagName).toBe('BUTTON');
    chip?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      blockEditorVm(): {
        blockId: string | null;
        allDay: boolean;
        dayKey: string;
        barberIds: readonly string[];
        dayIsOff: boolean;
      } | null;
    };
    expect(component.blockEditorVm()?.blockId).toBe('day:niko');
    expect(component.blockEditorVm()?.allDay).toBe(true);
    expect(component.blockEditorVm()?.dayKey).toBe('2026-08-05');
    expect(component.blockEditorVm()?.barberIds).toEqual(['niko']);
    expect(component.blockEditorVm()?.dayIsOff).toBe(true);
  });
});
