import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffTimeGrid } from '../time-grid/staff-time-grid';
import {
  StaffVisitEditor,
  type VisitEditorServiceOption,
  type VisitEditorVm,
  parsePriceInput,
} from './staff-visit-editor';

/**
 * The editor's own behaviour — the ladder, the one-level page stack, the
 * derived end time and the note reveal.
 *
 * Every one of these is a property of THIS component rather than of the day
 * it was opened from, so they are exercised against a literal VM: a failure
 * here is a bug in the sheet, never a bug in a store that fed it.
 */

/**
 * Only the strings the assertions read back.
 *
 * Flat keys, deliberately: the assertions below are about the SHAPE the
 * copy takes — `45 мин · до 10:45` is a duration and the end it yields on
 * one line — and a test that asserts against `staff.visit.durationOption`
 * would pass while the interpolation was broken.
 */
@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({
      'staff.visit.title': 'Час',
      'staff.visit.editTitle': 'Редактиране на час',
      'staff.visit.day': 'Ден',
      'staff.visit.start': 'Начало',
      'staff.visit.duration': 'Времетраене',
      'staff.visit.durationOption': '{{minutes}} мин · до {{end}}',
      'staff.visit.minutes': '{{minutes}} мин',
      'staff.visit.services': 'Услуги',
      'staff.visit.barbers': 'Бръснари',
      'staff.visit.service': 'Услуга',
      'staff.visit.addService': 'Добави услуга',
      'staff.visit.removeService': 'Премахни услугата',
      'staff.visit.addClient': 'Добави клиент',
      'staff.visit.addNote': 'Добави бележка',
      'staff.visit.teamNote': 'Бележка за екипа',
      'staff.visit.notePlaceholder':
        'Напр. предпочитания, алергии, напомняния…',
      'staff.visit.money': 'Пари',
      'staff.visit.tip': 'Бакшиш',
      'staff.visit.tipNone': 'Без',
      'staff.visit.tipOther': 'Друго',
      'staff.visit.frameExpand': 'На цял екран',
      'staff.visit.frameCollapse': 'Изход от цял екран',
      'staff.visit.tipInDock': '+{{amount}} бакшиш',
      'staff.visit.price': 'Цена',
      'staff.visit.currencySymbol': '€',
      'staff.visit.atShop': 'В салона',
      'staff.visit.addPromo': 'Добави промоция',
      'staff.visit.addTip': 'Добави бакшиш',
      'staff.visit.forWhom': 'За кого',
      'staff.visit.variant': 'Вариант',
      'staff.visit.catalogMinutes': 'Каталог: {{minutes}} мин',
      'staff.visit.catalogPrice': 'Каталог: {{price}}',
      'staff.visit.seated': 'Добавена',
      'staff.visit.confirm': 'Потвърди',
      'staff.visit.peopleCount': 'Клиенти: {{count}}',
      'staff.visit.walkIn': 'Случаен клиент',
      'staff.visit.newClient': 'Нов клиент',
      'staff.visit.newClientTitle': 'Нов клиент',
      'staff.visit.clientName': 'Име',
      'staff.visit.clientPhone': 'Телефон',
      'staff.visit.clientEmail': 'Имейл',
      'staff.visit.addPerson': 'Добави клиента',
      'staff.visit.end': 'Край',
      'staff.visit.timingMode': 'Времетраене или край',
      'staff.visit.needsService': 'Всеки клиент има нужда от услуга.',
      'staff.visit.clientNoteFrom': 'От клиента',
      'staff.visit.notSavedYet': 'Още не се записва.',
      'staff.visit.custom': 'по договорка',
      'staff.visit.rebook': 'Запиши пак',
      'staff.visit.confirmRequest': 'Потвърди заявката',
      'staff.visit.requestLine': 'Клиентът чака отговор',
      'staff.visit.exits': 'Отказ или неявяване',
      'staff.visit.cancelVisit': 'Откажи часа',
      'staff.visit.cancelAndBlock': 'Откажи и блокирай времето',
      'staff.day.statusArrived': 'Дошъл',
      'staff.visit.back': 'Назад',
      'staff.day.cancelDismiss': 'Затвори',
      'staff.day.moreActions': 'Още действия',
      'staff.day.visitCall': 'Обади се',
    });
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

/** One 10:00–10:45 visit in Иван's chair: a 30-minute cut and a 15-minute beard. */
function visit(partial: Partial<VisitEditorVm> = {}): VisitEditorVm {
  return {
    appointmentId: 'appointment-1',
    rowId: 'appointment-1#ivan',
    // An ordinary one-person visit: nobody else is in this booking, so the
    // peer run does not render. The party case has its own test.
    peers: [],
    // Regime A — the status verbs write today, through a callable that
    // ships. They are not part of the draft.
    primaryVerb: { kind: 'arrived', label: 'Дойде', destructive: false },
    overflowVerbs: [],
    acting: false,
    dayKey: '2026-08-26',
    todayKey: '2026-08-26',
    /*
     * ⚠ EXACTLY what `dayLabelFor` produces for `dayKey`, and it was not.
     *
     * The VM's label comes from the parent's formatter and the draft's from
     * the editor's own — the twinning already flagged on both functions — so
     * a fixture whose label disagrees with its key makes the sheet dirty the
     * moment a day is stepped away and back. It also said `вт` for a date
     * that is a Wednesday, which no formatter would ever have written.
     */
    dayLabel: 'ср, 26.08',
    startMinute: 600,
    endMinute: 645,
    legs: [
      {
        seatId: 'seat-cut',
        serviceId: 'cut',
        variantId: null,
        serviceLabel: 'Класическо подстригване',
        minutes: 30,
        priceLabel: '20,00 €',
        barberId: 'ivan',
        barberName: 'Иван',
        barberTone: 0,
        overridden: false,
      },
      {
        seatId: 'seat-beard',
        serviceId: 'beard',
        variantId: null,
        serviceLabel: 'Оформяне на брада',
        minutes: 15,
        priceLabel: '8,00 €',
        barberId: 'niko',
        barberName: 'Нико',
        barberTone: 1,
        overridden: false,
      },
    ],
    clientLabel: 'Мартин Илиев',
    clientUserId: 'user-martin',
    phone: '+359 88 123 4567',
    phoneHref: '+359881234567',
    clientMeta: 'Нов',
    note: 'Закъснявам 5 минути.',
    teamNote: null,
    priceLabel: '28,00 €',
    priceMinorUnits: 2800,
    // Nothing recorded — NOT zero, which is why the sheet offers an add-row
    // rather than a field reading `0,00 €`.
    tipLabel: null,
    tipMinorUnits: null,
    status: 'confirmed',
    statusLabel: 'Потвърден',
    arrivedMinute: null,
    chairId: 'ivan',
    chairName: 'Иван',
    chairTone: 0,
    neighbours: [{ name: 'Мартин', startMinute: 540, endMinute: 590, tone: 2 }],
    rosterStartMinute: 540,
    rosterEndMinute: 1080,
    nowMinute: null,
    ...partial,
  };
}

/*
 * More than one row, deliberately: with a single service the quick-add menu
 * and the search page below it were indistinguishable from each other, and
 * "the query does not shorten the menu" could not tell a filtered list from
 * an unfiltered one.
 */
const CATALOGUE: readonly VisitEditorServiceOption[] = [
  {
    id: 'cut:short',
    serviceId: 'cut',
    variantId: 'short',
    variantLabel: 'Къса коса',
    label: 'Подстригване · Къса коса',
    serviceLabel: 'Подстригване',
    minutes: 30,
    priceLabel: '20,00 €',
  },
  {
    id: 'cut:long',
    serviceId: 'cut',
    variantId: 'long',
    variantLabel: 'Дълга коса',
    label: 'Подстригване · Дълга коса',
    serviceLabel: 'Подстригване',
    minutes: 45,
    priceLabel: '24,00 €',
  },
  {
    id: 'wash',
    serviceId: 'wash',
    variantId: null,
    label: 'Измиване',
    minutes: 10,
    priceLabel: '5,00 €',
  },
  {
    id: 'fade',
    serviceId: 'fade',
    variantId: null,
    label: 'Фейд',
    minutes: 45,
    priceLabel: '28,00 €',
  },
  {
    id: 'beard',
    serviceId: 'beard',
    variantId: null,
    label: 'Оформяне на брада',
    minutes: 15,
    priceLabel: '8,00 €',
  },
];

describe('parsePriceInput', () => {
  it('reads what a keypad and a formatted label both produce', () => {
    expect(parsePriceInput('18')).toBe(1800);
    expect(parsePriceInput('18,5')).toBe(1850);
    expect(parsePriceInput('18.50')).toBe(1850);
    expect(parsePriceInput('1.234,50')).toBe(123450);
    expect(parsePriceInput(' 28,00 € ')).toBe(2800);
    expect(parsePriceInput('0')).toBe(0);
  });

  it('refuses what is not money', () => {
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('free')).toBeNull();
    expect(parsePriceInput('1,234')).toBeNull();
    expect(parsePriceInput('€')).toBeNull();
  });
});

describe('StaffVisitEditor', () => {
  let fixture: ComponentFixture<StaffVisitEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StaffVisitEditor],
      providers: [...provideTestI18n()],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffVisitEditor);
  });

  function render(vm: VisitEditorVm = visit()): HTMLElement {
    fixture.componentRef.setInput('vm', vm);
    fixture.componentRef.setInput('uiServices', CATALOGUE);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const find = (host: HTMLElement, testId: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  /**
   * A node's words, with the icon ligatures taken out.
   *
   * `ui-icon` renders its glyph as TEXT (a material-symbols ligature), so a
   * row's `textContent` carries `arrow_drop_down` beside the value. Reading
   * around it keeps the assertions about copy rather than about glyphs.
   */
  const text = (host: HTMLElement, testId: string) => {
    const node = find(host, testId)?.cloneNode(true) as HTMLElement | undefined;
    node?.querySelectorAll('ui-icon').forEach((icon) => icon.remove());
    return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  };

  const click = (host: HTMLElement, testId: string) => {
    find(host, testId)?.click();
    fixture.detectChanges();
  };

  /**
   * A pick inside the OPEN menu. Every ladder row carries the same choice
   * menus, so an option's test id appears once per row; only the open
   * surface holds the one that means this row.
   */
  const pickOpen = (host: HTMLElement, testId: string) => {
    host
      .querySelector<HTMLElement>(
        `ui-menu[data-open] [data-testid="${testId}"]`,
      )
      ?.click();
    fixture.detectChanges();
  };

  /** The way back lives in the sheet shell's bar; here it is the public call. */
  const back = () => {
    fixture.componentInstance.pop();
    fixture.detectChanges();
  };

  /**
   * ⚠ REGRESSION. The frame's drag copy must reach the grid UNTRANSPILED.
   *
   * The grid fills `{{minutes}}` itself, once per pointer move. Sourcing that
   * string with `translate('staff.visit.minutes', { minutes: '{{minutes}}' })`
   * — passing the placeholder as its own value — makes Transloco substitute
   * the hole with itself and rescan the result forever. It is a synchronous
   * infinite loop inside `afterNextRender`, so the tab wedges with no error
   * and this suite hangs rather than fails. Asserting the RAW template is
   * what pins it: `translate()` cannot return this string by any argument.
   */
  /** The grid the frame draws into, for assertions about what it was handed. */
  function frameGrid(): StaffTimeGrid {
    const found = fixture.debugElement.query(By.directive(StaffTimeGrid));
    expect(found).not.toBeNull();
    return found.componentInstance as StaffTimeGrid;
  }

  /**
   * ⚠ The frame draws the WHOLE CIVIL DAY (owner ruling 2026-08-26).
   *
   * A hundred minutes was not merely a small view — the grid DROPS what falls
   * outside the window, so the afternoon was not in the frame at all and no
   * amount of scrolling or dragging could reach it. Widening it to the roster
   * plus a margin had the same shape one size larger. Midnight to midnight is
   * a constant, so it can never disagree with the roster and has no fallback
   * to get wrong; the shift is drawn INSIDE it as shaded closed hours.
   */
  it('hands the frame the whole civil day, whatever the roster says', () => {
    render();
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // The roster is 09:00–18:00 in the fixture and does not narrow it…
    render(visit({ rosterStartMinute: 540, rosterEndMinute: 1080 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // …nor does a visit that starts before the shift, nor an unreadable one.
    render(visit({ startMinute: 60, endMinute: 105 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });
  });

  it('does not draw the day shut when the roster reads across midnight', () => {
    // A chair rostered 14:00–00:00 arrives as 840 → 0, because the dashboard
    // reads that end as a wall-clock minute without anchoring it to the day.
    // Handed to the grid raw, an inverted window is DROPPED by `closedRuns`
    // and the whole frame paints as shut hours — under a visit sitting
    // squarely inside the shift.
    render(
      visit({
        rosterStartMinute: 840,
        rosterEndMinute: 0,
        startMinute: 900,
        endMinute: 945,
      }),
    );

    expect(frameGrid().columns()[0]?.open).toEqual([
      { startMinute: 0, endMinute: 1440 },
    ]);
  });

  /**
   * The barbers are participants, and two legs worked by one barber are ONE
   * participant — a visit is a list of legs, so the naive render says his
   * name once per service.
   */
  it('names each barber once, as one row, with no service on it', () => {
    const host = render(
      visit({
        legs: [
          {
            seatId: 'a',
            serviceLabel: 'Подстригване',
            minutes: 30,
            priceLabel: '20,00 €',
            barberId: 'ivan',
            barberName: 'Иван',
            barberTone: 0,
          },
          {
            seatId: 'b',
            serviceLabel: 'Брада',
            minutes: 15,
            priceLabel: '8,00 €',
            barberId: 'ivan',
            barberName: 'Иван',
            barberTone: 0,
          },
        ],
      }),
    );

    // ONE row, not one per leg — and NO service on it: the ladder's own
    // services section says that a few rows down, and a participant that
    // repeats it says the same thing twice.
    expect(
      host.querySelectorAll('[data-testid="staff-visit-barber-ivan"]'),
    ).toHaveLength(1);
    // `И Иван` — the avatar's monogram rides in the row's own text.
    expect(text(host, 'staff-visit-barber-ivan')).toContain('Иван');
    expect(text(host, 'staff-visit-barber-ivan')).not.toContain('Подстригване');
  });

  /**
   * The barber picker is the SAME `ui-menu` the view toolbar's scope switcher
   * uses — portrait, tone badge, name, a check on the current one.
   *
   * ONE MENU PER ROW is what makes a split visit unambiguous: the menu on
   * Иван's row re-chairs Иван's legs and leaves Нико's alone. A single field
   * for the whole visit had to guess whose legs a pick meant.
   */
  it('hands the frame to the chair the visit was moved to', () => {
    // Owner, 2026-09-09: switching the barber must switch the frame to that
    // barber's day. The sheet reports its chair; the frame names it.
    fixture.componentRef.setInput('uiBarbers', [
      { id: 'ivan', label: 'Иван', tone: 0, avatarSrc: null },
      { id: 'stefan', label: 'Стефан', tone: 2, avatarSrc: null },
    ]);
    const host = render();
    const chairs: string[] = [];
    fixture.componentInstance.chairChanged.subscribe((id) => chairs.push(id));
    click(host, 'staff-visit-barber-ivan');
    click(host, 'staff-visit-barber-pick-stefan');
    expect(chairs.at(-1)).toBe('stefan');
    expect(text(host, 'staff-visit-frame-summary')).toContain('Стефан');
  });

  it('re-chairs from a menu, and only the row it was opened from', () => {
    fixture.componentRef.setInput('uiBarbers', [
      { id: 'ivan', label: 'Иван', tone: 0, avatarSrc: '/ivan.jpg' },
      { id: 'niko', label: 'Нико', tone: 1, avatarSrc: null },
      { id: 'stefan', label: 'Стефан', tone: 2, avatarSrc: null },
    ]);
    const host = render();

    // ⚠ THE PORTRAIT. `ui-avatar` falls back to a monogram whenever `uiSrc`
    // is absent, so a missing src does not fail — it quietly draws initials,
    // which is exactly how every barber here ended up wearing them.
    const face = find(host, 'staff-visit-barber-ivan')?.querySelector(
      'ui-avatar img, ui-avatar ui-async-image',
    );
    expect(face).not.toBeNull();

    // The whole roster is offered, with a check against the current chair.
    click(host, 'staff-visit-barber-ivan');
    fixture.detectChanges();
    expect(
      host.querySelectorAll('[role="menuitemradio"]').length,
    ).toBeGreaterThan(2);

    click(host, 'staff-visit-barber-pick-stefan');
    fixture.detectChanges();

    expect(text(host, 'staff-visit-barber-stefan')).toContain('Стефан');
    expect(
      host.querySelector('[data-testid="staff-visit-barber-ivan"]'),
    ).toBeNull();
    // Нико's leg is untouched — the menu re-chaired the row it belongs to.
    expect(text(host, 'staff-visit-barber-niko')).toContain('Нико');
  });

  it('hands the frame the whole civil day, whatever the roster says', () => {
    render();
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // The roster is 09:00–18:00 in the fixture and does not narrow it…
    render(visit({ rosterStartMinute: 540, rosterEndMinute: 1080 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // …nor does a visit that starts before the shift, nor an unreadable one.
    render(visit({ startMinute: 60, endMinute: 105 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });
  });

  it('does not draw the day shut when the roster reads across midnight', () => {
    // A chair rostered 14:00–00:00 arrives as 840 → 0, because the dashboard
    // reads that end as a wall-clock minute without anchoring it to the day.
    // Handed to the grid raw, an inverted window is DROPPED by `closedRuns`
    // and the whole frame paints as shut hours — under a visit sitting
    // squarely inside the shift.
    render(
      visit({
        rosterStartMinute: 840,
        rosterEndMinute: 0,
        startMinute: 900,
        endMinute: 945,
      }),
    );

    expect(frameGrid().columns()[0]?.open).toEqual([
      { startMinute: 0, endMinute: 1440 },
    ]);
  });

  it('hands the frame its drag copy with the placeholder intact', async () => {
    const host = render();
    await fixture.whenStable();
    fixture.detectChanges();

    const grid = fixture.debugElement.query(By.directive(StaffTimeGrid));
    expect(grid).not.toBeNull();
    const copy = (grid.componentInstance as StaffTimeGrid).uiDragCopy();

    expect(copy.minutes).toBe('{{minutes}} мин');
    // Not the empty hole the no-argument call would have left behind.
    expect(copy.minutes).not.toBe(' мин');
    expect(host).toBeTruthy();
  });

  /*
   * THE REST OF THE BOOKING.
   *
   * This sheet frames ONE chair's share of a party, so it has to say when
   * there is more of it — otherwise a barber editing their own seat reads the
   * sheet as the whole visit and cannot reach the other half at all.
   */
  it('says nothing about a party on an ordinary one-person visit', () => {
    const host = render();
    expect(host.querySelector('[data-testid^="staff-visit-peer-"]')).toBeNull();
  });

  it('names the other chairs of a party, and pushes the sheet to one', () => {
    const host = render(
      visit({
        peers: [
          {
            rowId: 'appointment-1#stefan',
            clientLabel: 'Синът на Стоян',
            chairName: 'Стефан Илиев',
            chairTone: 3,
            timeLabel: '16:00 – 16:30',
          },
        ],
      }),
    );

    const testId = 'staff-visit-peer-appointment-1#stefan';
    const peer = find(host, testId);
    expect(peer).not.toBeNull();
    // The PERSON in that chair, not this sheet's client — on a party they are
    // different people, which is the whole reason the row is worth drawing.
    expect(text(host, testId)).toContain('Синът на Стоян');
    expect(text(host, testId)).toContain('Стефан Илиев');

    let picked: string | null = null;
    fixture.componentInstance.peerPicked.subscribe((id) => (picked = id));
    peer?.click();
    fixture.detectChanges();
    // The ROW's name, not the appointment's — the appointment names both
    // halves and could not say which one to re-frame on.
    expect(picked).toBe('appointment-1#stefan');
  });

  it('renders the ladder: participants, the framed day with its clock beneath it', () => {
    const host = render();

    // ⚠ The SUMMARY STRIP is gone (owner ruling 2026-08-27), and with it the
    // component's own name, `⋯` and `✕`. The shell carries a plain title and
    // a close button like every other sheet on this page; the strip
    // duplicated that job, carried a second dismiss, and — projected as one
    // element — could never reach the `sheet-accessory` slot, so the `✕` it
    // held scrolled away with the content.
    expect(
      host.querySelector('[data-testid="staff-visit-summary"]'),
    ).toBeNull();
    expect(host.querySelector('.staff-visit__strip')).toBeNull();
    expect(host.querySelector('[data-testid="staff-visit-close"]')).toBeNull();
    /*
     * ⚠ NO LARGE TITLE AT ALL (owner ruling 2026-09-04, reversing
     * 2026-08-27). The name is `Редактиране на час` on every visit — never
     * the answer to a question anybody opened this sheet with — and it was
     * spending a `largeTitle` block at the top of an eight-group ladder to
     * say it. The shell carries it in the bar permanently
     * (`titleAlwaysVisible`), and the `labelledBy` id moved to the
     * `[sheet-title]` span with it, which is the OWNER's markup and so is
     * asserted in the dashboard's suite, not here.
     */
    expect(host.querySelector('#staff-visit-title')).toBeNull();
    expect(find(host, 'staff-visit-large-title')).toBeNull();
    expect(host.querySelector('[uiSheetLargeTitle]')).toBeNull();
    // NOTHING TO TRACK (owner, 2026-09-09): an ordinary confirmed visit
    // has no state strip at all — the first thing under the thumb is the
    // chair. The head speaks only for a decision (see `the head of the
    // sheet`).
    expect(find(host, 'staff-visit-state')).toBeNull();
    expect(
      host
        .querySelector('.staff-visit__body > :first-child')
        ?.getAttribute('aria-label'),
    ).toBe('Бръснари');

    // ⚠ The overflow is ABSENT here (owner ruling 2026-09-04): this fixture's
    // graph allows nothing but the primary verb, and a `⋯` that opens on an
    // empty menu is the disabled promise this surface keeps refusing. When
    // the graph DOES allow more it is in the dock — see `the overflow`.
    expect(find(host, 'staff-visit-more')).toBeNull();

    // STATE → picture → clock → people (owner review 2026-09-08, moving the
    // frame up from under the participants): time is the second thing on
    // the sheet, with the two authored facts BELOW the frame and no `До`
    // field anywhere; the date navigator heads the frame.
    const order = [...host.querySelectorAll('[data-testid]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter(
        (id): id is string =>
          id === 'staff-visit-barber-ivan' ||
          id === 'staff-visit-client-row-user-martin' ||
          id === 'staff-visit-frame' ||
          id === 'staff-visit-start',
      );
    // REVERSED AGAIN (owner, 2026-09-09): the people and the services come
    // BEFORE the frame — a barber picks what and for whom, and the duration
    // follows; the time is confirmed last. The barber row stays with the
    // clock, under the frame.
    // The chair comes first of all (owner, 2026-09-09): it decides which
    // services are on offer, so it is answered before the ladder is drawn.
    // …and the PEOPLE come after the time (owner, 2026-09-09): who it is
    // for is the last thing agreed — a walk-in has no name to give until
    // the cut is.
    // …and the typed pair sits ABOVE the picture (owner, 2026-09-09): the
    // figures are the truth, the frame beneath them is the check.
    expect(order).toEqual([
      'staff-visit-barber-ivan',
      'staff-visit-frame',
      'staff-visit-start',
      'staff-visit-client-row-user-martin',
    ]);
    // The Today chip is gone: the popover's own Днес does that job.
    expect(find(host, 'staff-visit-day-today')).toBeNull();

    // ⚠ The pill is INSIDE the frame now, so a document-order list would put
    // the ancestor first and say nothing. `contains` is the assertion that
    // actually encodes "the date navigator heads the picture".
    const frame = find(host, 'staff-visit-frame');
    const pill = find(host, 'staff-visit-day-pill');
    expect(pill && frame?.contains(pill)).toBe(true);
    // …and it heads it: the navigator precedes the grid inside the section.
    expect(
      pill?.compareDocumentPosition(
        host.querySelector('lib-staff-time-grid') as Node,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The barbers are PARTICIPANTS, named at the top with the services they
    // work — the frame's own chair header, which used to be the only place a
    // barber was named, is gone with the avatar that carried it.
    expect(text(host, 'staff-visit-barber-ivan')).toContain('Иван');
    expect(text(host, 'staff-visit-barber-niko')).toContain('Нико');
    expect(
      find(host, 'staff-visit-frame')?.querySelector('ui-avatar'),
    ).toBeNull();
    expect(host.querySelector('.staff-frame__owner')).toBeNull();
    expect(host.querySelector('lib-staff-time-grid')).not.toBeNull();

    // The pill is always value-bearing, and the calendar is closed until asked.
    expect(text(host, 'staff-visit-day-pill')).toContain('ср, 26.08');
    expect(
      find(host, 'staff-visit-day-pill')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(find(host, 'staff-visit-calendar')).toBeNull();

    // The barber is named on a leg's line ONLY when he is not the chair.
    expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe('30 мин');
    expect(text(host, 'staff-visit-leg-line-seat-beard')).toBe('15 мин · Нико');

    // No section eyebrows anywhere: a group's name is its aria-label.
    expect(host.querySelector('ui-section-header')).toBeNull();

    // No honesty footnote any more: nothing the sheet shows is unsaved
    // (owner, 2026-09-10 — the promotion left with its page).
    expect(find(host, 'staff-visit-not-built')).toBeNull();
  });

  it('carries its chips on the ladder row — variant, and the way off — and swipes to remove', () => {
    // One row is one seat (owner, 2026-09-10): the title with its variant,
    // the variant chip, and a visible «−». No counter, no money — the
    // receipt says what a seat costs. No barber chip (2026-09-09): the
    // sheet is opened for a chair, and the chair row above is where it
    // changes.
    const host = render();
    const row = find(host, 'staff-visit-leg-seat-cut');
    expect(row?.tagName).toBe('LI');
    expect(row?.querySelector('ui-list-row')).not.toBeNull();
    expect(find(host, 'staff-visit-page')).toBeNull();
    expect(find(host, 'staff-visit-leg-barber-seat-cut')).toBeNull();
    expect(
      host.querySelector('[data-testid^="staff-visit-leg-count-"]'),
    ).toBeNull();
    expect(row?.textContent).not.toContain('20,00 €');
    // The way off is in sight, and named — HIG's alternative to a swipe.
    const remove = find(host, 'staff-visit-remove-leg-seat-cut');
    expect(remove?.tagName).toBe('BUTTON');
    expect(remove?.getAttribute('aria-label')).toContain('Премахни услугата');

    // The variant chip is an ICON on the service that has variants; the
    // title carries the variant's name, joined the way the catalogue does.
    const variant = find(host, 'staff-visit-leg-variant-seat-cut');
    expect(variant).not.toBeNull();
    expect(variant?.hasAttribute('data-icon-only')).toBe(true);
    expect(variant?.textContent).not.toContain('Къса коса');
    expect(find(host, 'staff-visit-leg-variant-seat-beard')).toBeNull();
    // This seat was stored without a variant: its title is the stored
    // name until a variant is picked, and then the catalogue's joined one.
    expect(row?.textContent).toContain('Класическо подстригване');
    expect(variant?.getAttribute('aria-label')).toContain('—');
    click(host, 'staff-visit-leg-variant-seat-cut');
    pickOpen(host, 'staff-visit-variant-pick-long');
    // The variant is a DESCRIPTION now — under the service, not welded to it.
    expect(row?.textContent).toContain('Подстригване');
    expect(row?.textContent).toContain('Дълга коса');
    expect(row?.textContent).not.toContain('Подстригване · Дълга коса');
    expect(variant?.getAttribute('aria-label')).toContain('Дълга коса');
    expect(text(host, 'staff-visit-leg-line-seat-cut')).toContain('45 мин');

    // The «−» removes the seat; the swipe's own act is a button too.
    expect(find(host, 'staff-visit-swipe-leg-seat-beard')?.tagName).toBe(
      'BUTTON',
    );
    click(host, 'staff-visit-remove-leg-seat-cut');
    expect(find(host, 'staff-visit-leg-seat-cut')).toBeNull();
  });

  it('moves the derived end when the visit gets longer, and leaves the price alone', () => {
    const host = render();
    const duration = () =>
      find(host, 'staff-visit-duration') as HTMLInputElement;
    expect(duration().value).toBe('45');
    // Length is the VISIT's now (the leg page is retired): the typed figure
    // pins the whole span, the end follows as a computation, the price
    // stays what the seats say.
    duration().value = '75';
    duration().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(duration().value).toBe('75');
    expect(text(host, 'staff-visit-frame-summary')).toContain('11:15');
    expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
  });

  describe('adding a service', () => {
    it('opens a dropdown of the catalogue on the row — searchable, one tap, never a page', () => {
      // Owner, 2026-09-10: "like the country code dropdown — one tap and
      // hide, no check, no page".
      const host = render();
      const add = find(host, 'staff-visit-add-service');
      expect(add?.hasAttribute('uiMenuTrigger')).toBe(true);
      click(host, 'staff-visit-add-service');
      expect(find(host, 'staff-visit-page')).toBeNull();
      expect(find(host, 'staff-visit-page-done')).toBeNull();

      // The search sits at the top of the menu, and is NOT focused: a
      // catalogue this size is scanned first.
      const query = find(host, 'staff-visit-service-query');
      expect(query?.closest('ui-menu')).not.toBeNull();
      expect(document.activeElement).not.toBe(query);

      const rows = [
        ...host.querySelectorAll('button[data-testid^="staff-visit-service-"]'),
      ];
      expect(rows.length).toBe(CATALOGUE.length);
      expect(rows[0]?.getAttribute('role')).toBe('menuitem');
      // Each row carries the value it would add — minutes and price.
      expect(rows[0]?.textContent).toContain(CATALOGUE[0]?.serviceLabel ?? '');
      expect(rows[0]?.textContent).toContain(CATALOGUE[0]?.variantLabel ?? '');
      // The variant is the row's DESCRIPTION, never welded to the name.
      expect(rows[0]?.textContent).not.toContain(CATALOGUE[0]?.label);
      expect(rows[0]?.textContent).toContain('мин');
    });

    it('seats the service on tap and closes — and marks nothing', () => {
      const host = render();
      // The ROWS only: a leg's footnote span and its chips share the prefix.
      const LEG_ROWS = 'li[data-testid^="staff-visit-leg-"]';
      const legsBefore = host.querySelectorAll(LEG_ROWS).length;

      click(host, 'staff-visit-add-service');
      const fresh = CATALOGUE.find((option) => option.id === 'wash');
      if (!fresh) throw new Error('no wash in the catalogue');
      click(host, `staff-visit-service-${fresh.id}`);

      // One tap and hide: the seat is on the ladder, the menu is gone.
      expect(host.querySelectorAll(LEG_ROWS).length).toBe(legsBefore + 1);
      expect(
        find(host, 'staff-visit-add-service')?.getAttribute('aria-expanded'),
      ).toBe('false');

      // Next time, NO mark on it (owner, 2026-09-10): a service may be
      // wanted twice, and a check would read as done.
      click(host, 'staff-visit-add-service');
      expect(
        host.querySelector('[data-testid^="staff-visit-seated-"]'),
      ).toBeNull();
    });

    /*
     * SEARCH and MULTI-SELECT are the two things a menu cannot do, so the
     * page is not gone — it is the last item. A shop whose catalogue
     * outgrows a menu still has a way through.

    /*
     * The menu lists the WHOLE catalogue. A query typed on the pushed page
     * outlives that page, and if the menu shared the page's filtered list a
     * stale search would silently shorten it the next time it opened.
     */
    it('takes a letter typed anywhere into its search while it is open — and stops listening once closed', () => {
      const host = render();
      click(host, 'staff-visit-add-service');
      const query = () =>
        find(host, 'staff-visit-service-query') as HTMLInputElement;
      // Focus is on the sheet, not in the menu — where a tap in Safari
      // leaves it. The key still lands in the field.
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ф', bubbles: true }),
      );
      fixture.detectChanges();
      expect(query().value).toBe('ф');
      expect(document.activeElement).toBe(query());
      expect(
        host.querySelectorAll('button[data-testid^="staff-visit-service-"]')
          .length,
      ).toBeLessThan(CATALOGUE.length);
      // Typing IN the field is its own business — no doubled letter.
      query().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'е', bubbles: true }),
      );
      expect(query().value).toBe('ф');

      // Closed, the document is left alone.
      query()
        .closest('.ui-menu__surface')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      fixture.detectChanges();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'х', bubbles: true }),
      );
      fixture.detectChanges();
      expect(query().value).toBe('ф');
    });

    it('opens on the whole catalogue every time, whatever was typed last', () => {
      const host = render();
      const query = () =>
        find(host, 'staff-visit-service-query') as HTMLInputElement;
      const rows = () =>
        host.querySelectorAll('button[data-testid^="staff-visit-service-"]')
          .length;

      click(host, 'staff-visit-add-service');
      query().value = 'фейд';
      query().dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(rows()).toBeLessThan(CATALOGUE.length);

      // Escape closes the menu, and the menu alone.
      find(host, 'staff-visit-service-query')
        ?.closest('.ui-menu__surface')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      fixture.detectChanges();
      click(host, 'staff-visit-add-service');
      expect(query().value).toBe('');
      expect(rows()).toBe(CATALOGUE.length);
    });
  });

  /*
   * ── THE DRAFT SURVIVES A NEW VM ───────────────────────────────────────
   *
   * The draft is reseeded when the SUBJECT changes and never otherwise. That
   * was always the intent and it was not the behaviour: `linkedSignal`
   * re-derives when its source's DEPENDENCIES change, not only when the
   * source's value does, so any fresh `VisitEditorVm` object wiped what the
   * barber had typed while the appointment id beside it stayed identical.
   *
   * It was silent because `nowMinute` is on the VM and ticks every sixty
   * seconds: a draft left open across a minute boundary reset itself, and a
   * suite that never pushes a second VM could not see it.
   */
  describe('the draft', () => {
    it('survives a new VM for the same appointment', () => {
      const host = render();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(host.getAttribute('data-draft-day')).toBe('2026-08-27');
      expect(host.hasAttribute('data-dirty')).toBe(true);

      // The clock ticks: same appointment, new object, one volatile field.
      fixture.componentRef.setInput('vm', visit({ nowMinute: 601 }));
      fixture.detectChanges();

      expect(host.getAttribute('data-draft-day')).toBe('2026-08-27');
      expect(host.hasAttribute('data-dirty')).toBe(true);
    });

    it('is reseeded when the sheet is handed a different appointment', () => {
      const host = render();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(host.getAttribute('data-draft-day')).toBe('2026-08-27');

      fixture.componentRef.setInput(
        'vm',
        visit({ appointmentId: 'appointment-2' }),
      );
      fixture.detectChanges();

      expect(host.getAttribute('data-draft-day')).toBe('2026-08-26');
      expect(host.hasAttribute('data-dirty')).toBe(false);
    });

    /*
     * Re-dating is a CHANGE. The seed used to be fed from the drafted day
     * itself, so it moved with the value it was measuring and `dirty` stayed
     * false — no discard control, and any future `Запази` would have had
     * nothing to tell it the booking had moved.
     */
    it('counts a moved day as dirty', () => {
      const host = render();
      expect(host.hasAttribute('data-dirty')).toBe(false);

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(host.hasAttribute('data-dirty')).toBe(true);
      // The dock's one commit appears with the change it would commit.
      expect(find(host, 'staff-visit-save')).not.toBeNull();

      find(host, 'staff-visit-day-prev')?.click();
      fixture.detectChanges();
      expect(host.hasAttribute('data-dirty')).toBe(false);
    });
  });

  /*
   * ── THE FRAME FOLLOWS THE PILL ────────────────────────────────────────
   *
   * The frame is fed by the VM, which the parent computes from the day the
   * AGENDA is showing — so stepping the pill moved the draft and left the
   * picture behind. The day has to cross the boundary for the parent to keep
   * it live and hand back the right lane.
   */
  describe('the drafted day', () => {
    it('is published whenever it moves, and on open', () => {
      const seen: string[] = [];
      fixture.componentRef.setInput('vm', visit());
      fixture.componentRef.setInput('uiServices', CATALOGUE);
      fixture.componentInstance.dayChanged.subscribe((day) => seen.push(day));
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      // On open, so the parent never has to guess the starting day.
      expect(seen).toEqual(['2026-08-26']);

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(seen.at(-1)).toBe('2026-08-27');

      find(host, 'staff-visit-day-prev')?.click();
      fixture.detectChanges();
      expect(seen.at(-1)).toBe('2026-08-26');
    });

    /*
     * An EFFECT on the draft, not an emit in each handler: there are four
     * ways the day moves — three buttons and the month grid — and the month
     * grid is the one a per-handler emit would have missed.
     */
    it('publishes a day picked from the month grid too', () => {
      const seen: string[] = [];
      fixture.componentRef.setInput('vm', visit());
      fixture.componentRef.setInput('uiServices', CATALOGUE);
      fixture.componentInstance.dayChanged.subscribe((day) => seen.push(day));
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      find(host, 'staff-visit-day-pill')?.click();
      fixture.detectChanges();
      // The grid is the DS month picker's, so the day carries its id.
      find(host, 'ui-month-day-2026-08-30')?.click();
      fixture.detectChanges();

      expect(seen.at(-1)).toBe('2026-08-30');
    });
  });

  /*
   * ── THE DAY PILL'S FORMAT ────────────────────────────────────────────
   *
   * The VM's own `dayLabel` is a literal in this fixture, so `dayLabelFor`
   * — the formatter behind it — was never once executed by this suite. It
   * only runs when the draft's day CHANGES, which is what stepping does.
   */
  describe('the day pill', () => {
    it("names the day the way the toolbar does — the locale's compact date", () => {
      // One pill component, one grammar, both places (owner, 2026-09-09):
      // the compact date exactly as `Intl` renders it — numeric month in
      // Bulgarian, `чт, 27.08`.
      const host = render();
      expect(text(host, 'staff-visit-day-pill')).toContain('ср, 26.08');

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();

      expect(text(host, 'staff-visit-day-pill')).toContain('чт, 27.08');
    });
  });

  /*
   * ── СТАТУС ───────────────────────────────────────────────────────────
   *
   * One control at the top holds the state AND every way out of it. Before
   * this, `status`/`statusLabel`/`statusTone()` sat on the contract unused
   * while the transitions were split across a prominent CTA and a `⋯` —
   * a seam the state machine does not have.
   */
  /*
   * ── THE HEAD OF THE SHEET ────────────────────────────────────────────
   *
   * NOTHING TO TRACK (owner, 2026-09-09): the status chip and the stamps —
   * «Дойде», «Готово» — are gone. No barber has the time to note who came
   * and when a cut ended, and the frame already shows where the clock is.
   * What the head still says is a DECISION: a request to answer. Nothing
   * else — not the clock, not the kind (both tried and withdrawn the same
   * day).
   */
  describe('the head of the sheet', () => {
    it('tracks nothing: no status, no stamp, no picker on an ordinary visit', () => {
      const host = render();
      expect(find(host, 'staff-visit-state')).toBeNull();
      expect(find(host, 'staff-visit-status')).toBeNull();
      expect(
        host.querySelector('[data-testid^="staff-visit-verb-"]'),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid^="staff-visit-act-"]'),
      ).toBeNull();
      // …nor once the party is in, nor once the time has gone.
      expect(
        find(
          render(visit({ arrivedMinute: 590, nowMinute: 596 })),
          'staff-visit-state',
        ),
      ).toBeNull();
      expect(
        find(render(visit({ nowMinute: 700 })), 'staff-visit-state'),
      ).toBeNull();
    });

    it('asks to answer a request, and only a request, at the top', () => {
      const host = render(
        visit({
          status: 'pending',
          statusLabel: 'Заявен',
          primaryVerb: {
            kind: 'confirmed',
            label: 'Потвърди',
            destructive: false,
          },
          overflowVerbs: [
            { kind: 'cancelled', label: 'Откажи', destructive: true },
          ],
        }),
      );
      expect(find(host, 'staff-visit-state')?.getAttribute('data-head')).toBe(
        'request',
      );
      expect(find(host, 'staff-visit-state')?.getAttribute('data-tone')).toBe(
        'warning',
      );
      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      click(host, 'staff-visit-confirm');
      expect(acted).toEqual(['confirmed']);
      // The refusal is an exit, at the foot, with the others.
      expect(
        find(host, 'staff-visit-cancel')?.closest(
          '[data-testid="staff-visit-exits"]',
        ),
      ).not.toBeNull();
    });

    it('says nothing about the clock — not before, not late, not after', () => {
      // The «закъснява · +10 · +15» nudge lasted a day (owner, 2026-09-09:
      // "what sense does this make"). A barber who is late moves the block
      // or types the start; the head does not guess by how much.
      let host: HTMLElement | null = null;
      for (const nowMinute of [590, 606, 650]) {
        host = render(visit({ nowMinute }));
        expect(find(host, 'staff-visit-state')).toBeNull();
      }
      expect(
        host?.querySelector('[data-testid^="staff-visit-late-"]'),
      ).toBeNull();
    });
  });

  /*
   * ── THE EXITS ────────────────────────────────────────────────────────
   *
   * What the sheet can still do that is not an edit, as its LAST group —
   * the way iOS Calendar keeps «Delete Event» last. Named acts, the
   * destructive ones after the rest, never a stamp among them.
   */
  describe('the exits', () => {
    const cancellable = (nowMinute: number) =>
      visit({
        nowMinute,
        primaryVerb: { kind: 'arrived', label: 'Дойде', destructive: false },
        overflowVerbs: [
          { kind: 'completed', label: 'Готово', destructive: false },
          { kind: 'no_show', label: 'Не дойде', destructive: false },
          { kind: 'cancelled', label: 'Откажи', destructive: true },
        ],
      });
    const ids = (host: HTMLElement) =>
      [
        ...host.querySelectorAll(
          '[data-testid="staff-visit-exits"] [data-testid]',
        ),
      ].map((el) => el.getAttribute('data-testid'));

    it('are the last group: cancel and cancel-and-block, never a stamp', () => {
      const host = render(cancellable(590));
      const exits = find(host, 'staff-visit-exits');
      expect(exits).not.toBeNull();
      expect(exits?.nextElementSibling).toBeNull();
      // Before the start nobody has failed to come; the stamps are not
      // offered at all, whatever the graph allows.
      expect(ids(host)).toEqual([
        'staff-visit-cancel',
        'staff-visit-cancel-block',
      ]);
      expect(text(host, 'staff-visit-cancel')).toContain('Откажи часа');
      expect(
        find(host, 'staff-visit-cancel')?.classList.contains(
          'staff-visit__exit--destructive',
        ),
      ).toBe(true);

      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      const blocked: number[] = [];
      fixture.componentInstance.blockedInstead.subscribe(() => blocked.push(1));
      click(host, 'staff-visit-cancel');
      expect(acted).toEqual(['cancelled']);
      click(host, 'staff-visit-cancel-block');
      expect(blocked.length).toBe(1);
    });

    it('offers «Не дойде» once the start has passed, first of the three', () => {
      const host = render(cancellable(606));
      expect(ids(host)).toEqual([
        'staff-visit-no-show',
        'staff-visit-cancel',
        'staff-visit-cancel-block',
      ]);
      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      click(host, 'staff-visit-no-show');
      expect(acted).toEqual(['no_show']);
    });

    it('offers the way back from a no-show, and the next visit after any settled one', () => {
      const missed = render(
        visit({
          status: 'no_show',
          statusLabel: 'Пропуснат',
          primaryVerb: {
            kind: 'confirmed',
            label: 'Върни часа',
            destructive: false,
          },
          overflowVerbs: [],
        }),
      );
      expect(ids(missed)).toEqual([
        'staff-visit-reinstate',
        'staff-visit-rebook',
      ]);
      expect(text(missed, 'staff-visit-reinstate')).toContain('Върни часа');
      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      click(missed, 'staff-visit-reinstate');
      expect(acted).toEqual(['confirmed']);

      const done = render(
        visit({
          status: 'completed',
          statusLabel: 'Минал',
          primaryVerb: null,
          overflowVerbs: [],
        }),
      );
      expect(ids(done)).toEqual(['staff-visit-rebook']);
      const rebooked: number[] = [];
      fixture.componentInstance.rebooked.subscribe(() => rebooked.push(1));
      click(done, 'staff-visit-rebook');
      expect(rebooked.length).toBe(1);
      expect(find(done, 'staff-visit-state')).toBeNull();
    });
  });

  /*
   * ── THE DOCK ─────────────────────────────────────────────────────────
   *
   * With every transition in the picker, an overflow has nothing to
   * overflow and a prominent verb would be a second door onto a control the
   * sheet already states at the top. What is left is the one thing a barber
   * does from here that is not an edit.
   */
  describe('the dock', () => {
    it('carries no `⋯` and no verb button', () => {
      const host = render(
        visit({
          overflowVerbs: [
            { kind: 'cancelled', label: 'Откажи', destructive: true },
          ],
        }),
      );

      const bar = host.querySelector('ui-sheet-action-bar');
      expect(find(host, 'staff-visit-more')).toBeNull();
      expect(
        bar?.querySelector('[data-testid^="staff-visit-cancel"]'),
      ).toBeNull();
      // The cancel did not vanish — it is an exit, at the foot.
      expect(
        find(host, 'staff-visit-cancel')?.closest(
          '[data-testid="staff-visit-exits"]',
        ),
      ).not.toBeNull();
    });

    /*
     * The dock is the figure, the call and the verb. The call went to the
     * client row on 2026-09-08 and came back the next day (owner: "the
     * most common action you do when you open the appointment") — a dock
     * target is reached without looking, a row target has to be found.
     * The row keeps the number to read; it no longer carries a chip.
     */
    it('carries the call — the most common act — beside the save', () => {
      const host = render();
      const call = find(host, 'staff-visit-call');
      expect(call?.closest('ui-sheet-action-bar')).not.toBeNull();
      expect(call?.getAttribute('href')).toMatch(/^tel:/);
      expect(call?.getAttribute('aria-label')).toContain('Мартин Илиев');
      expect(find(host, 'staff-visit-call-user-martin')).toBeNull();
    });

    /*
     * `Затвори` was a discard wearing the word "close" — the sheet's ✕
     * already closes, so the dock held a second dismissal and no way to keep
     * anything. A sheet whose only dock verb throws work away cannot be used
     * to change something.
     */
    it('commits from the dock, rightmost, and never discards', () => {
      const host = render();
      expect(find(host, 'staff-visit-discard')).toBeNull();
      // Absent until there is something to commit.
      expect(find(host, 'staff-visit-save')).toBeNull();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();

      const save = find(host, 'staff-visit-save');
      expect(save).not.toBeNull();
      expect(save?.getAttribute('uiButtonStyle')).toBe('borderedProminent');
      /*
       * ⚠ NOT spread. A spread CTA eats the bar's leftover width and pushes
       * the call away from it, leaving the two verbs at opposite ends of the
       * row. They hug and travel together on the thumb rail; the auto margin
       * that docks a prominent child moves onto the call in CSS.
       */
      expect(save?.hasAttribute('data-spread')).toBe(false);

      // Last of the controls, with the call immediately before it (back in
      // the dock, owner 2026-09-09) and the total leading — the honesty
      // line is `order: -1` and renders above them all.
      const controls = [
        ...(host.querySelector('ui-sheet-action-bar')?.children ?? []),
      ].filter((el) => !el.classList.contains('staff-visit__honesty'));
      expect(controls.at(-1)).toBe(save);
      expect(controls.at(-2)).toBe(find(host, 'staff-visit-call'));
      expect(controls.at(0)).toBe(find(host, 'staff-visit-total'));
    });

    /*
     * The save publishes the WHOLE draft and does not close the sheet: the
     * write is a round trip that can be refused, and a sheet that dismissed
     * itself on the tap would take the draft with it.
     */
    it('publishes the whole draft, and stays open', () => {
      const host = render();
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      find(host, 'staff-visit-save')?.click();
      fixture.detectChanges();

      expect(commits).toEqual([
        {
          kind: 'save',
          dayKey: '2026-08-27',
          startMinute: 600,
          endMinute: 645,
          note: null,
          clients: [
            {
              id: 'user-martin',
              label: 'Мартин Илиев',
              phone: '+359 88 123 4567',
            },
          ],
          legs: [
            {
              seatId: 'seat-cut',
              serviceId: 'cut',
              variantId: null,
              minutes: 30,
              priceLabel: '20,00 €',
              barberId: 'ivan',
              clientId: 'user-martin',
            },
            {
              seatId: 'seat-beard',
              serviceId: 'beard',
              variantId: null,
              minutes: 15,
              priceLabel: '8,00 €',
              barberId: 'niko',
              clientId: 'user-martin',
            },
          ],
        },
      ]);
      // Still rendered: the write is a round trip that can be refused, and
      // the owner closes the sheet only once the server has agreed.
      expect(find(host, 'staff-visit-root')).not.toBeNull();
    });

    /*
     * ⚠ ONE TAP, NOT TWO.
     *
     * `Запази` is rendered by `@if (dirty())` and the fields committed on
     * `change`, which fires on BLUR — so the tap reaching for the button was
     * the tap that CREATED it. The press landed on nothing, the blur made
     * the button appear under the finger, and the release had no element to
     * complete a click on. Committing while typing is what puts the button
     * on screen before the thumb arrives.
     */
    it('exists while the field is still being typed in', () => {
      const host = render();
      expect(find(host, 'staff-visit-save')).toBeNull();

      const field = find(host, 'staff-visit-duration') as HTMLInputElement;
      field.value = '60';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // No `change`, no blur — and the button is already there.
      expect(find(host, 'staff-visit-save')).not.toBeNull();
    });

    /*
     * The typing arm must not fight the typist: `6` on the way to `60` is
     * not a six-minute visit, and applying it would shrink the frame under
     * the reader between two keystrokes.
     */
    it('ignores a half-typed duration until it is whole', () => {
      const host = render();
      const field = find(host, 'staff-visit-duration') as HTMLInputElement;

      field.value = '6';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).toBeNull();
      // ⚠ And the box still reads what was typed — the write-back that snaps
      // a value belongs to `change`, on blur, not under the cursor.
      expect(field.value).toBe('6');

      field.value = '60';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      expect(field.value).toBe('60');
    });

    /*
     * ⚠ THE BUTTON MUST GO AWAY. It did not, and the reason was not timing:
     * the sheet and the server encode one visit two ways. A `resize` writes
     * the seat's own duration, so a 30-minute service stretched to 45 comes
     * back AS a 45-minute service while the draft still holds a 30-minute
     * leg under a 45-minute override. Two encodings, never string-equal,
     * `dirty` true forever.
     */
    it('goes away once the appointment says what was saved', () => {
      const host = render();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).not.toBeNull();

      // The write lands: the owner reports it and pushes the stored visit.
      fixture.componentRef.setInput('vm', visit({ dayKey: '2026-08-27' }));
      fixture.componentRef.setInput('uiSavedMark', 1);
      fixture.detectChanges();

      expect(host.hasAttribute('data-dirty')).toBe(false);
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    /*
     * The team note SAVES now (its own staff-only document beside the
     * appointment, 2026-09-08), so typing one is a change worth the button —
     * and it travels in the commit, trimmed, `null` when cleared.
     */
    it('raises the button for a typed note, and carries it in the commit', () => {
      const host = render();
      const commits: { note?: string | null }[] = [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as { note?: string | null }),
      );

      find(host, 'staff-visit-add-note')?.click();
      fixture.detectChanges();
      const note = find(host, 'staff-visit-note-field') as HTMLTextAreaElement;
      note.value = '  къса отстрани ';
      note.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(find(host, 'staff-visit-save')).not.toBeNull();
      find(host, 'staff-visit-save')?.click();
      expect(commits[0]?.note).toBe('къса отстрани');
    });

    it('seeds the note from the team note the sheet was handed', () => {
      const host = render(visit({ teamNote: 'дължи 5 €' }));
      const note = find(host, 'staff-visit-note-field') as HTMLTextAreaElement;
      expect(note?.value).toBe('дължи 5 €');
      // Unchanged, so not dirty.
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    it('draws no call at all when there is no number', () => {
      const host = render(visit({ phone: null, phoneHref: null }));
      expect(
        host.querySelector('[data-testid^="staff-visit-call"]'),
      ).toBeNull();
    });
  });

  /*
   * ── THE TOTAL IS IN THE DOCK ─────────────────────────────────────────
   *
   * It used to close `ПАРИ` as a semibold row, and it was not a peer of the
   * rows above it: promo and tip are inputs, `В салона` is the output, and
   * the figure sums `УСЛУГИ` as well — a summary that crosses the seam
   * cannot live inside one of the sections that feeds it. In the empty
   * state, which is most states, the money group contributed NOTHING to its
   * own total while rendering the heaviest — and only inert — row in the
   * section.
   */
  describe('the total', () => {
    it('is docked, not a row of the money group', () => {
      const host = render();

      const total = find(host, 'staff-visit-total');
      expect(total).not.toBeNull();
      expect(total?.closest('ui-sheet-action-bar')).not.toBeNull();
      // Label OVER figure — the Apple Pay stack, not a key/value row.
      expect(total?.firstElementChild?.textContent?.trim()).toBe('В салона');
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');

      // THE RECEIPT (owner, 2026-09-10): every seat with what it costs, in
      // the money group rather than on the service row; a barber reads it
      // as text. Nothing pushes.
      const money = find(host, 'staff-visit-money');
      expect(money).not.toBeNull();
      expect(money?.contains(total as Node)).toBe(false);
      expect(text(host, 'staff-visit-price-seat-cut')).toBe('20,00 €');
      expect(text(host, 'staff-visit-price-seat-beard')).toBe('8,00 €');
      // The tip row is on every saved visit now (owner, 2026-09-10).
      expect(find(host, 'staff-visit-tip')).not.toBeNull();
      expect(find(host, 'staff-visit-payment')).toBeNull();
    });

    /*
     * ── THE TIP ROW, INLINE AND CONDITIONAL (owner, 2026-09-10) ─────────
     * Money changes hands at the chair, so the row is there once the visit
     * has begun, and whenever a tip is already recorded. It writes straight
     * through and says so. A future booking carries no money row at all.
     */
    it('offers the tip as a choice — none, three shares of the total — and «Друго» is typed inside the menu', () => {
      // Owner, 2026-09-10: a choice pill, the repeat row's grammar, on
      // every saved visit; not a bare field, not a chip run.
      const host = render();
      const row = find(host, 'staff-visit-tip');
      expect(row?.closest('[data-testid="staff-visit-money"]')).not.toBeNull();
      expect(row?.textContent).toContain('Бакшиш');
      // Nothing recorded: the pill says «Без», and the dock carries no plus.
      expect(text(host, 'staff-visit-tip-value')).toBe('Без');
      expect(find(host, 'staff-visit-dock-tip')).toBeNull();
      // The field lives INSIDE the menu, so the row never changes shape.
      expect(
        find(host, 'staff-visit-tip-field')?.closest('ui-menu'),
      ).not.toBeNull();
      expect(host.querySelector('ui-menu[data-open]')).toBeNull();

      click(host, 'staff-visit-tip-choice');
      for (const id of ['none', '5', '10', '15']) {
        expect(find(host, `staff-visit-tip-pick-${id}`)).not.toBeNull();
      }
      expect(find(host, 'staff-visit-tip-pick-other')).toBeNull();
      // A share names what it would leave: 10% of 28,00 € is 2,80 € — the
      // figure a trailing detail of the row, never part of its label.
      expect(text(host, 'staff-visit-tip-pick-10')).toContain('2,80');
      expect(
        find(host, 'staff-visit-tip-pick-10')?.querySelector(
          '.ui-choice-menu__detail',
        )?.textContent,
      ).toContain('2,80');
      expect(text(host, 'staff-visit-tip-pick-10')).not.toContain('10% ·');
      // The trigger is a ROW pill: the small size the typed pills wear.
      expect(
        find(host, 'staff-visit-tip-choice')?.getAttribute('data-control-size'),
      ).toBe('small');

      const tips: (number | null)[] = [];
      fixture.componentInstance.tipped.subscribe((tip) => tips.push(tip));
      pickOpen(host, 'staff-visit-tip-pick-10');
      expect(tips).toEqual([280]);

      // «Друго» is the menu's second group: the word labels the unit field
      // — a placeholder, never a blank — and a committed sum writes through
      // and closes the menu.
      click(host, 'staff-visit-tip-choice');
      const other = host.querySelector<HTMLElement>(
        'ui-menu[data-open] [data-testid="staff-visit-tip-other"]',
      );
      expect(other).not.toBeNull();
      const field = other?.querySelector(
        '[data-testid="staff-visit-tip-field"]',
      ) as HTMLInputElement;
      expect(field.getAttribute('placeholder')).toBe('0,00');
      expect(field.closest('ui-unit-field')).not.toBeNull();
      expect(field.closest('.staff-sheet__pill')).not.toBeNull();
      expect(other?.querySelector('label')?.getAttribute('for')).toBe(field.id);
      field.value = '5,50';
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(tips).toEqual([280, 550]);
      expect(host.querySelector('ui-menu[data-open]')).toBeNull();
    });

    it('reads a recorded tip back as its share — or as «Друго» with the sum — and the dock shows the plus', () => {
      // 2,80 € is 10% of 28,00 €: the pill says so, with the figure muted.
      let host = render(visit({ tipLabel: '2,80 €', tipMinorUnits: 280 }));
      expect(text(host, 'staff-visit-tip-value')).toContain('10%');
      expect(text(host, 'staff-visit-tip-value')).toContain('2,80');
      // The dock: the bill, then the tip as a green plus.
      expect(text(host, 'staff-visit-dock-tip')).toContain('+');
      expect(text(host, 'staff-visit-dock-tip')).toContain('2,80');
      expect(text(host, 'staff-visit-dock-tip')).toContain('бакшиш');
      expect(
        find(host, 'staff-visit-dock-tip')?.getAttribute(
          'data-foreground-style',
        ),
      ).toBe('success');
      // A share is read back on its own row: the menu's field stays empty.
      click(host, 'staff-visit-tip-choice');
      expect(
        (
          host.querySelector(
            'ui-menu[data-open] [data-testid="staff-visit-tip-field"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('');
      // «Без» clears it.
      const tips: (number | null)[] = [];
      fixture.componentInstance.tipped.subscribe((tip) => tips.push(tip));
      pickOpen(host, 'staff-visit-tip-pick-none');
      expect(tips).toEqual([null]);

      // 5,00 € is no share of 28,00 €: «Друго» with the sum on the pill, and
      // the menu's field holding it, the unit beside, its row tinted.
      host = render(visit({ tipLabel: '5,00 €', tipMinorUnits: 500 }));
      expect(text(host, 'staff-visit-tip-value')).toContain('Друго');
      expect(text(host, 'staff-visit-tip-value')).toContain('5,00');
      click(host, 'staff-visit-tip-choice');
      const field = host.querySelector(
        'ui-menu[data-open] [data-testid="staff-visit-tip-field"]',
      ) as HTMLInputElement;
      expect(field.value).toBe('5,00');
      expect(
        field
          .closest('ui-unit-field')
          ?.querySelector('.ui-unit-field__unit')
          ?.textContent?.trim(),
      ).toBe('€');
      expect(
        find(host, 'staff-visit-tip-other')?.hasAttribute('data-selected'),
      ).toBe(true);
    });

    it('withholds the tip row only from a draft and from a visit that is gone', () => {
      // Tomorrow's booking has the row — the shares just say «Без».
      expect(
        find(
          render(visit({ dayKey: '2026-08-27', dayLabel: 'чт, 27.08' })),
          'staff-visit-tip',
        ),
      ).not.toBeNull();
      // A visit the server has not seen has nothing to attach a tip to.
      expect(
        find(
          render(visit({ appointmentId: '', rowId: 'new-1' })),
          'staff-visit-tip',
        ),
      ).toBeNull();
      // Cancelled: no money group at all.
      expect(
        find(
          render(visit({ status: 'cancelled', statusLabel: 'Отказан' })),
          'staff-visit-tip',
        ),
      ).toBeNull();
      // A tip already recorded reads back — clearing it is the only way
      // back from a mistyped one.
      const host = render(visit({ tipLabel: '5,00 €', tipMinorUnits: 500 }));
      expect(text(host, 'staff-visit-tip-value')).toContain('Друго');
    });

    /*
     * The dock's honesty sentence used to be a second greedy flex child
     * beside the spread primary, which pushed the CTA off the trailing
     * gutter. It takes a line of its own now — a caption ABOUT the sheet,
     * never a control in it — and only this consumer's bar wraps.
     */
    it('shares the bar with nothing but the save', () => {
      const host = render();

      const bar = host.querySelector<HTMLElement>('ui-sheet-action-bar');
      expect(bar?.classList.contains('staff-visit__dock')).toBe(true);
      // Nothing but controls in the dock: the honesty sentence is gone.
      expect(bar?.querySelector('p')).toBeNull();
    });
  });

  /*
   * ── A TYPED DURATION ─────────────────────────────────────────────────
   *
   * The menu offered five rungs around the catalogue span, so anything it
   * had not guessed was unreachable. A field reaches every value — and has
   * to defend the two that are real: the five-minute grain the grid draws
   * on, and the floor below which it will not draw at all.
   */
  describe('the duration field', () => {
    const type = (host: HTMLElement, value: string) => {
      const input = find(host, 'staff-visit-duration') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      return input;
    };

    it('takes a duration the old ladder could not offer', () => {
      const host = render();
      // 95 is nowhere near the catalogue's 45-minute span, so no rung held it.
      expect(type(host, '95').value).toBe('95');
      expect(text(host, 'staff-visit-frame-summary')).toContain('11:35');
    });

    it('snaps a typed value onto the five-minute grain', () => {
      const host = render();
      // 47 is not a time this grid can draw; 45 is the nearest that is.
      expect(type(host, '47').value).toBe('45');
    });

    it('refuses to shrink a visit below the floor', () => {
      const host = render();
      // Not a two-minute booking — a typo. Pulled onto the floor rather than
      // written through.
      expect(type(host, '2').value).toBe('5');
    });

    it('leaves the visit alone when the field is cleared', () => {
      const host = render();
      // Clearing and tabbing away is a no-op, never a zero-minute visit.
      expect(type(host, '').value).toBe('45');
    });

    it('lets the services drive the length: a change to them drops a typed one', () => {
      // Owner, 2026-09-09: services first — adding or removing one sets the
      // duration; the barber types over it afterwards if they want to.
      const host = render();
      expect(type(host, '95').value).toBe('95');
      expect(find(host, 'staff-visit-catalog')).not.toBeNull();
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-wash');
      // 45 of services became 55, and the typed 95 went with the change.
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('55');
      expect(find(host, 'staff-visit-catalog')).toBeNull();
      expect(text(host, 'staff-visit-frame-summary')).toContain('10:55');
    });
  });

  /*
   * ── CREATING ────────────────────────────────────────────────────────
   *
   * The same sheet, drafting a visit that does not exist yet: an empty
   * appointment id. Nothing to save until there is a service, because a
   * visit without one is not a visit; then the whole draft publishes.
   */
  describe('a new visit', () => {
    const fresh = () =>
      visit({
        appointmentId: '',
        rowId: 'new-1',
        // The dashboard hands a new visit a 30-minute span to draw.
        endMinute: 630,
        legs: [],
        clientLabel: '',
        clientUserId: null,
        phone: null,
        phoneHref: null,
        status: 'new',
        statusLabel: 'Нов час',
        primaryVerb: null,
        priceLabel: null,
      });

    it('has no head — the ＋ already chose — invites a client, and withholds Запази', () => {
      const host = render(fresh());
      expect(find(host, 'staff-visit-state')).toBeNull();
      // Nothing to cancel yet.
      expect(find(host, 'staff-visit-exits')).toBeNull();
      expect(find(host, 'staff-visit-add-client')).not.toBeNull();
      expect(find(host, 'staff-visit-save')).toBeNull();
      // A default span, so the frame has a block to draw and drag.
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('30');
    });

    it('adds a new client from the dock, with what was typed already in place', () => {
      // «Нов клиент» is always in the dock of the search (owner,
      // 2026-09-09), and a typed number lands in the phone field, a name in
      // the name field. The ✓ seats the person and returns to the ladder.
      const host = render(fresh());
      click(host, 'staff-visit-add-client');
      expect(find(host, 'staff-visit-new-client')).not.toBeNull();
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      query.value = '0888 123 456';
      query.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click(host, 'staff-visit-new-client');
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe('clientNew');
      expect(
        (find(host, 'staff-visit-new-name') as HTMLInputElement).value,
      ).toBe('');
      // Nothing to seat without a name.
      expect(
        (find(host, 'staff-visit-new-client-save') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      const name = find(host, 'staff-visit-new-name') as HTMLInputElement;
      name.value = 'Петър Нов';
      name.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click(host, 'staff-visit-new-client-save');
      expect(find(host, 'staff-visit-page')).toBeNull();
      expect(text(host, 'staff-visit-client-row-guest-0')).toContain(
        'Петър Нов',
      );
      expect(text(host, 'staff-visit-client-row-guest-0')).toContain('+359');
    });

    it('goes back from the form to the search, not to the ladder', () => {
      const host = render(fresh());
      click(host, 'staff-visit-add-client');
      click(host, 'staff-visit-new-client');
      back();
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe(
        'clientSearch',
      );
      back();
      expect(find(host, 'staff-visit-page')).toBeNull();
    });

    it('changes barber before any service, and seats the service on that chair', () => {
      // Owner, 2026-09-09: on a new visit the chair row re-chaired nothing,
      // because there was no leg yet. The draft carries the chair itself.
      fixture.componentRef.setInput('uiBarbers', [
        { id: 'ivan', label: 'Иван', tone: 0, avatarSrc: null },
        { id: 'stefan', label: 'Стефан', tone: 2, avatarSrc: null },
      ]);
      const host = render(fresh());
      const chairs: string[] = [];
      fixture.componentInstance.chairChanged.subscribe((id) => chairs.push(id));
      click(host, 'staff-visit-barber-ivan');
      click(host, 'staff-visit-barber-pick-stefan');
      expect(chairs.at(-1)).toBe('stefan');
      expect(text(host, 'staff-visit-frame-summary')).toContain('Стефан');
      expect(find(host, 'staff-visit-barber-stefan')).not.toBeNull();

      const commits: { legs: { barberId: string }[] }[] = [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as (typeof commits)[number]),
      );
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-fade');
      click(host, 'staff-visit-save');
      expect(commits[0]?.legs.map((leg) => leg.barberId)).toEqual(['stefan']);
    });

    it('puts the same service on a visit twice — two rows — and takes one off again', () => {
      // Owner, 2026-09-10: no fold and no counter. Each seat is a row with
      // its own chips; the dropdown marks nothing.
      const host = render(fresh());
      const rows = () =>
        host.querySelectorAll<HTMLElement>(
          'li[data-testid^="staff-visit-leg-"]',
        );
      const seatOf = (index: number) =>
        rows()[index]?.dataset['testid']?.replace('staff-visit-leg-', '') ?? '';

      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-cut:short');
      expect(rows().length).toBe(1);
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-cut:short');
      expect(rows().length).toBe(2);
      expect(
        host.querySelector('[data-testid^="staff-visit-leg-count-"]'),
      ).toBeNull();

      // The variant chip re-takes the variant for THIS seat alone.
      click(host, `staff-visit-leg-variant-${seatOf(0)}`);
      pickOpen(host, 'staff-visit-variant-pick-long');
      expect(rows()[0]?.textContent).toContain('Дълга коса');
      expect(rows()[1]?.textContent).toContain('Къса коса');
      const commits: { legs: { serviceId: string; variantId: string }[] }[] =
        [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as (typeof commits)[number]),
      );
      click(host, 'staff-visit-save');
      expect(
        commits[0]?.legs.map((leg) => `${leg.serviceId}@${leg.variantId}`),
      ).toEqual(['cut@long', 'cut@short']);

      // «−» takes one row; the other stays. «−» again, and none.
      click(host, `staff-visit-remove-leg-${seatOf(0)}`);
      expect(rows().length).toBe(1);
      expect(rows()[0]?.textContent).toContain('Къса коса');
      click(host, `staff-visit-remove-leg-${seatOf(0)}`);
      expect(rows().length).toBe(0);
    });
    it('offers Запази once a service is picked, and publishes it', () => {
      const host = render(fresh());
      const commits: { legs: { serviceId: string }[] }[] = [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as { legs: { serviceId: string }[] }),
      );
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-fade');
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      click(host, 'staff-visit-save');
      expect(commits[0]?.legs.map((leg) => leg.serviceId)).toEqual(['fade']);
    });

    /*
     * ── THE PARTY GRAMMAR ──────────────────────────────────────────────
     *
     * A visit for two is two people with a service each, never one person
     * with a crowd beside them. Every leg names its person; a person
     * without a service withholds Запази and says why; the leg page grows a
     * `За кого` row only once there is a choice to make.
     */
    describe('a party', () => {
      const CLIENTS = [
        {
          id: 'user-martin',
          label: 'Мартин Илиев',
          phone: '+359 88 1',
          meta: null,
        },
        { id: 'user-petar', label: 'Петър Ганев', phone: null, meta: null },
      ];
      const legRow = (host: HTMLElement) =>
        host.querySelector<HTMLElement>(
          '[data-testid^="staff-visit-leg-draft-"]',
        );
      const withTwo = () => {
        const host = render(fresh());
        fixture.componentRef.setInput('uiClients', CLIENTS);
        fixture.detectChanges();
        click(host, 'staff-visit-add-client');
        click(host, 'staff-visit-client-user-martin');
        click(host, 'staff-visit-client-user-petar');
        back();
        return host;
      };

      it('withholds Запази until everyone has a service, and says so', () => {
        const host = withTwo();
        click(host, 'staff-visit-add-service');
        click(host, 'staff-visit-service-fade');
        // One service, two people: the second is not served yet.
        expect(find(host, 'staff-visit-save')).toBeNull();
        expect(text(host, 'staff-visit-needs-service')).toBe(
          'Всеки клиент има нужда от услуга.',
        );
        // The leg names its person, now that there is more than one.
        expect(legRow(host)?.textContent).toContain('Мартин Илиев');

        click(host, 'staff-visit-add-service');
        click(host, 'staff-visit-service-beard');
        // Both seeded to the first person — still one unserved.
        expect(find(host, 'staff-visit-save')).toBeNull();

        const commits: { legs: { serviceId: string; clientId: string }[] }[] =
          [];
        fixture.componentInstance.committed.subscribe((c) =>
          commits.push(c as (typeof commits)[number]),
        );
        // The row's person chip hands the beard to Петър.
        const beard = host.querySelectorAll<HTMLElement>(
          '[data-testid^="staff-visit-leg-draft-"]',
        )[1];
        const chip = beard?.querySelector<HTMLElement>(
          '[data-testid^="staff-visit-leg-person-"]',
        );
        expect(chip?.getAttribute('aria-label')).toContain('Мартин Илиев');
        chip?.click();
        fixture.detectChanges();
        pickOpen(host, 'staff-visit-leg-client-user-petar');

        expect(find(host, 'staff-visit-needs-service')).toBeNull();
        click(host, 'staff-visit-save');
        expect(
          commits[0]?.legs.map((leg) => [leg.serviceId, leg.clientId]),
        ).toEqual([
          ['fade', 'user-martin'],
          ['beard', 'user-petar'],
        ]);
      });

      it('asks WHAT before WHEN, on a new visit and an old one', () => {
        // Owner, 2026-09-09: a barber should not have to remember how long a
        // service takes before placing it — the duration follows from the
        // services and the start came from the tap on the grid. The same
        // order on both, so the sheet reads one way.
        for (const vm of [fresh(), visit()]) {
          const host = render(vm);
          const root = find(host, 'staff-visit-root');
          const services = root?.querySelector('.staff-visit__group--services');
          const frame = find(host, 'staff-visit-frame');
          expect(services).not.toBeNull();
          expect(
            services!.compareDocumentPosition(frame!) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        }
      });

      it('reopens a saved party as a party: each person a row, each leg named', () => {
        const host = render(
          visit({
            people: [
              {
                id: 'user-martin',
                label: 'Мартин Илиев',
                phone: '+359 88 1',
                phoneHref: 'tel:+359881',
                meta: null,
              },
              {
                id: 'guest-Петър Гост',
                label: 'Петър Гост',
                phone: null,
                phoneHref: null,
                meta: null,
              },
            ],
            legs: [
              {
                seatId: 'seat-cut',
                serviceId: 'cut',
                variantId: null,
                clientId: 'user-martin',
                serviceLabel: 'Подстригване',
                minutes: 30,
                priceLabel: '20,00 €',
                barberId: 'ivan',
                barberName: 'Иван',
                barberTone: 1,
                overridden: false,
              },
              {
                seatId: 'seat-beard',
                serviceId: 'beard',
                variantId: null,
                clientId: 'guest-Петър Гост',
                serviceLabel: 'Оформяне на брада',
                minutes: 15,
                priceLabel: '8,00 €',
                barberId: 'ivan',
                barberName: 'Иван',
                barberTone: 1,
                overridden: false,
              },
            ],
          }),
        );
        expect(
          host.querySelectorAll('[data-testid^="staff-visit-client-row-"]')
            .length,
        ).toBe(2);
        expect(text(host, 'staff-visit-leg-line-seat-cut')).toContain(
          'Мартин Илиев',
        );
        expect(text(host, 'staff-visit-leg-line-seat-beard')).toContain(
          'Петър Гост',
        );
        // Everyone is served, so the party is saveable the moment it changes.
        expect(find(host, 'staff-visit-needs-service')).toBeNull();
      });

      it('draws no За кого for one person, and hands seats to the first left', () => {
        const host = withTwo();
        click(host, 'staff-visit-add-service');
        click(host, 'staff-visit-service-fade');
        legRow(host)
          ?.querySelector<HTMLElement>(
            '[data-testid^="staff-visit-leg-person-"]',
          )
          ?.click();
        fixture.detectChanges();
        pickOpen(host, 'staff-visit-leg-client-user-petar');
        expect(legRow(host)?.textContent).toContain('Петър Ганев');

        // Петър leaves; his fade stays on the visit, on Мартин.
        click(host, 'staff-visit-add-client');
        click(host, 'staff-visit-client-user-petar');
        back();
        expect(find(host, 'staff-visit-save')).not.toBeNull();
        expect(legRow(host)?.textContent).not.toContain('Петър Ганев');
        expect(
          legRow(host)?.querySelector(
            '[data-testid^="staff-visit-leg-person-"]',
          ),
        ).toBeNull();
      });
    });
  });

  /*
   * ── THE END, AS A CLOCK ─────────────────────────────────────────────
   * The duration row's title is a choice (owner, 2026-09-09): the same
   * fact, entered as minutes or as an end time. Both write the override.
   */
  describe('the duration row', () => {
    it('offers Край as the other way of saying the same thing', () => {
      const host = render();
      expect(text(host, 'staff-visit-timing-mode')).toContain('Времетраене');
      expect(find(host, 'staff-visit-end')).toBeNull();
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-end');
      expect(text(host, 'staff-visit-timing-mode')).toContain('Край');
      expect(find(host, 'staff-visit-duration')).toBeNull();
      // 10:00 + 45 min, the fixture's derived end.
      expect((find(host, 'staff-visit-end') as HTMLInputElement).value).toBe(
        '10:45',
      );
    });

    it('turns a typed end into a duration, and a past-midnight end into the next day', () => {
      const host = render();
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-end');
      const end = find(host, 'staff-visit-end') as HTMLInputElement;
      end.value = '11:30';
      end.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(text(host, 'staff-visit-frame-summary')).toContain('11:30');
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-duration');
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('90');

      // Start 10:00, end typed 00:15 → tomorrow: 14 h 15 min = 855.
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-end');
      const again = find(host, 'staff-visit-end') as HTMLInputElement;
      again.value = '00:15';
      again.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-duration');
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('855');
    });
  });

  /*
   * ── AFTER THE CUT, AND DURING IT ───────────────────────────────────────
   * Owner, 2026-09-09: a 10:00 cut at 09:55 read «Минал» (seed data), and a
   * finished visit could not be corrected. A finished visit is EDITABLE —
   * the sheet gets filled in after the cut; a cancelled one is not. And a
   * visit inside its own window, unstamped, is «В момента».
   */
  describe('a finished visit', () => {
    it('is still editable — rows, frame and services', () => {
      const host = render(visit({ status: 'completed', statusLabel: 'Минал' }));
      expect(find(host, 'staff-visit-remove-leg-seat-cut')).not.toBeNull();
      expect(find(host, 'staff-visit-add-service')).not.toBeNull();
      expect(find(host, 'staff-visit-duration')).not.toBeNull();
      // …the head says nothing, and the next visit is on offer at the foot.
      expect(find(host, 'staff-visit-state')).toBeNull();
      expect(
        find(host, 'staff-visit-rebook')?.closest(
          '[data-testid="staff-visit-exits"]',
        ),
      ).not.toBeNull();
    });

    it('locks a cancelled one — nothing happened, nothing to correct', () => {
      const host = render(
        visit({ status: 'cancelled', statusLabel: 'Отказан' }),
      );
      expect(find(host, 'staff-visit-remove-leg-seat-cut')).toBeNull();
      expect(find(host, 'staff-visit-add-service')).toBeNull();
      expect(find(host, 'staff-visit-duration')).toBeNull();
    });
  });

  /*
   * ── THE SERVICE PAGE'S VARIANT ROW AND CATALOGUE READOUT (2026-09-09) ──
   */
  describe('money and length, after the service page', () => {
    it("edits a seat's price on the receipt, for whoever may reprice", () => {
      // Owner, 2026-09-10: the service row carries no money; the receipt
      // line does — text for a barber (the default), a pill for the front
      // desk and the owners.
      const host = render();
      expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe('30 мин');
      expect(find(host, 'staff-visit-leg-price-seat-cut')).toBeNull();
      expect(text(host, 'staff-visit-price-seat-cut')).toBe('20,00 €');

      fixture.componentRef.setInput('uiMayReprice', true);
      fixture.detectChanges();
      expect(find(host, 'staff-visit-price-seat-cut')).toBeNull();
      const price = find(
        host,
        'staff-visit-leg-price-seat-cut',
      ) as HTMLInputElement;
      expect(price.closest('[data-testid="staff-visit-money"]')).not.toBeNull();
      // The figure alone; the unit is the field's own word beside it.
      expect(price.value).toBe('20,00');
      expect(
        price
          .closest('ui-unit-field')
          ?.querySelector('.ui-unit-field__unit')
          ?.textContent?.trim(),
      ).toBe('€');
      // The service row still says nothing about money.
      expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe('30 мин');

      // A keypad's `18` is written back as money, and the save carries it
      // in minor units.
      price.value = '18';
      price.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      // `Intl` sets the euro off with the locale's narrow space; read past it.
      const plain = (label: string | null) =>
        label?.replace(/\s/g, ' ') ?? null;
      expect(price.value).toBe('18,00');
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));
      click(host, 'staff-visit-save');
      const saved = commits[0] as {
        legs: {
          seatId: string;
          priceLabel: string | null;
          priceMinorUnits?: number | null;
        }[];
      };
      const cut = saved.legs.find((leg) => leg.seatId === 'seat-cut');
      expect(plain(cut?.priceLabel ?? null)).toBe('18,00 €');
      expect(cut?.priceMinorUnits).toBe(1800);
      expect(
        saved.legs.find((leg) => leg.seatId === 'seat-beard')
          ?.priceMinorUnits ?? null,
      ).toBeNull();

      // Not money springs the field back to what the row says.
      price.value = 'free';
      price.dispatchEvent(new Event('change'));
      expect(price.value).toBe('18,00');

      // A seat added in this draft is a line with a pill too (owner,
      // 2026-09-10: "why only the first service price could be changed?"),
      // and its typed price rides the save beside its addSeat.
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-wash');
      const added = host.querySelector<HTMLInputElement>(
        '[data-testid^="staff-visit-leg-price-draft-"]',
      );
      expect(added).not.toBeNull();
      if (!added) throw new Error('no pill on the added seat');
      added.value = '9';
      added.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      click(host, 'staff-visit-save');
      const again = commits.at(-1) as {
        legs: { seatId: string; priceMinorUnits?: number | null }[];
      };
      expect(
        again.legs.find((leg) => leg.seatId.startsWith('draft-'))
          ?.priceMinorUnits,
      ).toBe(900);
    });

    it('reads out the catalogue total and the distance when the visit is shortened', () => {
      const host = render();
      expect(find(host, 'staff-visit-catalog')).toBeNull();
      const field = find(host, 'staff-visit-duration') as HTMLInputElement;
      field.value = '35';
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(text(host, 'staff-visit-catalog')).toBe(
        'Каталог: 45 мин · −10 мин',
      );
      expect(text(host, 'staff-grid-tag')).toBe('−10 мин');
    });
  });

  it('replaces the add-note row with the textarea, in place', () => {
    const host = render();

    // At rest the group is one row, and the row says what it is — which is
    // why there is no heading over it.
    expect(text(host, 'staff-visit-add-note')).toBe('Добави бележка');
    expect(find(host, 'staff-visit-note-field')).toBeNull();

    click(host, 'staff-visit-add-note');

    const field = find(host, 'staff-visit-note-field');
    expect(field?.tagName).toBe('TEXTAREA');
    // The button BECAME the field: it is not still sitting above it.
    expect(find(host, 'staff-visit-add-note')).toBeNull();

    // And the client's own words are a quotation outside every group —
    // never merged with the team's note, never a control — and ATTRIBUTED,
    // so nobody mistakes them for the shop's (owner review 2026-09-08).
    const quote = find(host, 'staff-visit-client-note');
    expect(quote?.querySelector('blockquote')?.textContent?.trim()).toBe(
      'Закъснявам 5 минути.',
    );
    expect(quote?.querySelector('figcaption')?.textContent?.trim()).toBe(
      'От клиента',
    );
    expect(quote?.closest('.ui-list-group')).toBeNull();
  });

  describe('full screen', () => {
    it('lifts the frame to full screen and back, and Escape leaves it without reaching the sheet', () => {
      // Owner, 2026-09-10; HIG: an expand control top-trailing, the same
      // control flipped to leave, and always an obvious way out.
      const host = render();
      const frame = find(host, 'staff-visit-frame');
      const toggle = find(host, 'staff-visit-frame-expand');
      expect(frame?.hasAttribute('data-expanded')).toBe(false);
      expect(toggle?.getAttribute('aria-label')).toBe('На цял екран');

      // Either way through, the block is centred again in the picture's
      // new height (owner, 2026-09-10: "on exit the event should be
      // scrolled to, centred") — instantly, under the view transition.
      const grid = fixture.debugElement.query(By.directive(StaffTimeGrid))
        .componentInstance as StaffTimeGrid;
      const recentred = vi.spyOn(grid, 'recenter');

      click(host, 'staff-visit-frame-expand');
      expect(frame?.hasAttribute('data-expanded')).toBe(true);
      // The whole screen: a manual popover while expanded, so the top
      // layer positions it against the viewport, not the sheet's surface.
      expect(frame?.getAttribute('popover')).toBe('manual');
      expect(toggle?.getAttribute('aria-label')).toBe('Изход от цял екран');
      expect(toggle?.getAttribute('aria-pressed')).toBe('true');
      expect(recentred).toHaveBeenCalledWith('auto');
      recentred.mockClear();

      // Escape inside the frame closes FULL SCREEN, and nothing above it
      // hears the key — the sheet must not take it as "close".
      let reached = 0;
      host.addEventListener('keydown', () => (reached += 1));
      toggle?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(frame?.hasAttribute('data-expanded')).toBe(false);
      expect(frame?.hasAttribute('popover')).toBe(false);
      expect(reached).toBe(0);
      expect(recentred).toHaveBeenCalledWith('auto');

      // Not expanded: Escape is the sheet's, as before.
      toggle?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(reached).toBe(1);
    });
  });
});
