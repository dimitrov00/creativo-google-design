import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { StaffTimeGrid } from '../time-grid/staff-time-grid';
import {
  StaffVisitEditor,
  type VisitEditorServiceOption,
  type VisitEditorVm,
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
      'staff.visit.service': 'Услуга',
      'staff.visit.addService': 'Добави услуга',
      'staff.visit.removeService': 'Премахни услугата',
      'staff.visit.addClient': 'Добави клиент',
      'staff.visit.addNote': 'Добави бележка',
      'staff.visit.teamNote': 'Бележка за екипа',
      'staff.visit.notBuiltYet': 'Запазването още не е свързано със сървъра.',
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
    // Regime A — the status verbs write today, through a callable that
    // ships. They are not part of the draft.
    primaryVerb: { kind: 'arrived', label: 'Дойде', destructive: false },
    overflowVerbs: [],
    acting: false,
    dayKey: '2026-08-26',
    dayLabel: 'вт, 26 авг',
    startMinute: 600,
    endMinute: 645,
    legs: [
      {
        seatId: 'seat-cut',
        serviceLabel: 'Класическо подстригване',
        minutes: 30,
        priceLabel: '20,00 €',
        barberId: 'ivan',
        barberName: 'Иван',
        barberTone: 0,
      },
      {
        seatId: 'seat-beard',
        serviceLabel: 'Оформяне на брада',
        minutes: 15,
        priceLabel: '8,00 €',
        barberId: 'niko',
        barberName: 'Нико',
        barberTone: 1,
      },
    ],
    clientLabel: 'Мартин Илиев',
    phone: '+359 88 123 4567',
    phoneHref: '+359881234567',
    clientMeta: 'Нов',
    note: 'Закъснявам 5 минути.',
    priceLabel: '28,00 €',
    status: 'confirmed',
    statusLabel: 'Потвърден',
    chairName: 'Иван',
    chairTone: 0,
    neighbours: [{ name: 'Мартин', startMinute: 540, endMinute: 590, tone: 2 }],
    rosterStartMinute: 540,
    rosterEndMinute: 1080,
    nowMinute: null,
    ...partial,
  };
}

const CATALOGUE: readonly VisitEditorServiceOption[] = [
  {
    id: 'wash',
    label: 'Измиване',
    minutes: 10,
    priceLabel: '5,00 €',
  },
];

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

  it('renders the ladder: participants, the framed day, then the clock', () => {
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
    // The name is a LARGE TITLE at the top of the ladder, which is how every
    // other sheet on this page states one — the bar's own title is its
    // collapsed twin, revealed by `uiSheetLargeTitle` as this scrolls under
    // it. The id the shell's `labelledBy` points at lives here.
    const title = host.querySelector('#staff-visit-title');
    expect(title?.hasAttribute('uiSheetLargeTitle')).toBe(true);
    expect(title?.textContent?.trim()).toBe('Редактиране на час');

    // The overflow moved to the dock, where the verbs it belongs to live.
    const more = find(host, 'staff-visit-more');
    expect(more).not.toBeNull();
    expect(more?.closest('ui-sheet-action-bar')).not.toBeNull();

    // PEOPLE → picture → clock (owner ruling 2026-08-26), with the two
    // authored facts BELOW the frame and no `До` field anywhere. Who is
    // doing this and for whom is the first thing the sheet says; the date
    // navigator is no longer a rung of its own, it heads the frame.
    const order = [...host.querySelectorAll('[data-testid]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter(
        (id): id is string =>
          id === 'staff-visit-barber-ivan' ||
          id === 'staff-visit-client-row-primary' ||
          id === 'staff-visit-frame' ||
          id === 'staff-visit-start',
      );
    expect(order).toEqual([
      'staff-visit-barber-ivan',
      'staff-visit-client-row-primary',
      'staff-visit-frame',
      'staff-visit-start',
    ]);

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
    expect(text(host, 'staff-visit-day-pill')).toContain('вт, 26 авг');
    expect(
      find(host, 'staff-visit-day-pill')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(find(host, 'staff-visit-calendar')).toBeNull();

    // The barber is named on a leg's line ONLY when he is not the chair.
    expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe(
      '30 мин · 20,00 €',
    );
    expect(text(host, 'staff-visit-leg-line-seat-beard')).toBe(
      '15 мин · 8,00 € · Нико',
    );

    // No section eyebrows anywhere: a group's name is its aria-label.
    expect(host.querySelector('ui-section-header')).toBeNull();

    // The dock is honest about the missing server path rather than offering
    // a `Запази` that cannot save.
    expect(text(host, 'staff-visit-not-built')).toBe(
      'Запазването още не е свързано със сървъра.',
    );
  });

  it('pushes a service page and pops back to the ladder it left', () => {
    const host = render();
    expect(find(host, 'staff-visit-root')).not.toBeNull();

    click(host, 'staff-visit-leg-seat-cut');

    const page = find(host, 'staff-visit-page');
    expect(page?.getAttribute('data-page')).toBe('service');
    expect(page?.getAttribute('tabindex')).toBe('-1');
    // The root is suspended, not stacked beside the child.
    expect(find(host, 'staff-visit-root')).toBeNull();
    // The child's title IS the object you navigated to.
    expect(page?.querySelector('h2')?.textContent?.trim()).toBe(
      'Класическо подстригване',
    );
    // The consequence rides into the child, live.
    expect(text(host, 'staff-visit-consequence')).toContain('10:00 – 10:45');
    // ONE commit boundary: no `Готово`, no second commit-shaped control.
    expect(page?.textContent).not.toContain('Готово');
    expect(text(host, 'staff-visit-remove-leg')).toBe('Премахни услугата');

    // Depth is exactly one, and that is a law: nothing pushes from a page.
    click(host, 'staff-visit-leg-barber');
    expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
      'service',
    );

    // `‹` pops, and the ladder comes back with its own rows intact.
    click(host, 'staff-visit-back');
    expect(find(host, 'staff-visit-page')).toBeNull();
    expect(find(host, 'staff-visit-root')).not.toBeNull();
    expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe(
      '30 мин · 20,00 €',
    );
  });

  it('moves the derived end when a leg gets longer, and leaves the price alone', () => {
    const host = render();
    expect(text(host, 'staff-visit-duration')).toBe('45 мин · до 10:45');

    click(host, 'staff-visit-leg-seat-cut');
    // The ladder is built around the catalogue span, so 60 is on it.
    click(host, 'staff-visit-leg-duration-60');
    click(host, 'staff-visit-back');

    // 60 + 15 = 75 minutes, so the end moved to 11:15 — and it moved because
    // it is a computation, not because anything wrote it down.
    expect(text(host, 'staff-visit-duration')).toBe('75 мин · до 11:15');
    // The price is untouched: changing the time does not change the price.
    expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe(
      '60 мин · 20,00 €',
    );
    expect(host.querySelector('lib-staff-time-grid')).not.toBeNull();
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

    // And the client's own words are a blockquote outside every group —
    // never merged with the team's note, never a control.
    const quote = find(host, 'staff-visit-client-note');
    expect(quote?.tagName).toBe('BLOCKQUOTE');
    expect(quote?.textContent?.trim()).toBe('Закъснявам 5 минути.');
    expect(quote?.closest('.ui-list-group')).toBeNull();
  });
});
