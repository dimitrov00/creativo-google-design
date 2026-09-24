import { Injectable, type EnvironmentProviders } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BlockEditorCommit,
  type BlockEditorVm,
  StaffBlockEditor,
} from './staff-block-editor';

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({
      'staff.block.title': 'Блок',
      'staff.block.allDay': 'Цял ден',
      'staff.block.from': 'От',
      'staff.block.to': 'До',
      'staff.block.save': 'Запази',
      'staff.block.lift': 'Освободи',
      'staff.block.liftDay': 'Освободи целия ден',
      'staff.block.repeat': 'Повтаряне',
      'staff.block.repeatNever': 'Никога',
      'staff.block.repeatDaily': 'Всеки ден',
      'staff.block.repeatWeekdays': 'Делнични дни',
      'staff.block.repeatWeekly': 'Всяка седмица',
      'staff.block.repeatMonthly': 'Всеки месец',
      'staff.block.repeatYearly': 'Всяка година',
      'staff.block.repeatCustom': 'Персонализирано',
      'staff.block.repeatPresets': 'Повтаряне',
      'staff.block.repeatRule': 'Правило',
      'staff.block.repeatFrequency': 'Честота',
      'staff.block.repeatFrequencies.daily': 'Ежедневно',
      'staff.block.repeatFrequencies.weekly': 'Ежеседмично',
      'staff.block.repeatFrequencies.monthly': 'Ежемесечно',
      'staff.block.repeatFrequencies.yearly': 'Ежегодно',
      'staff.block.repeatInterval': 'На всеки',
      'staff.block.repeatUnit.weekly.one': 'седмица',
      'staff.block.repeatUnit.weekly.other': 'седмици',
      'staff.block.repeatUnit.monthly.one': 'месец',
      'staff.block.repeatUnit.monthly.other': 'месеца',
      'staff.block.repeatEvery.daily.one': 'Всеки ден',
      'staff.block.repeatEvery.weekly.one': 'Всяка седмица',
      'staff.block.repeatEvery.weekly.other': 'На всеки {{count}} седмици',
      'staff.block.repeatEvery.monthly.one': 'Всеки месец',
      'staff.block.repeatEvery.yearly.one': 'Всяка година',
      'staff.block.repeatWeekdaysLabel': 'Дни от седмицата',
      'staff.block.repeatMonthDay': 'В месеца',
      'staff.block.repeatOnWeekday.monday': 'в понеделник',
      'staff.block.repeatOnWeekday.wednesday': 'в сряда',
      'staff.block.repeatOnWeekday.thursday': 'в четвъртък',
      'staff.block.repeatOnDate': 'на {{date}} число',
      'staff.block.repeatDateOrdinal.1': '{{n}}-во',
      'staff.block.repeatDateOrdinal.other': '{{n}}-о',
      'staff.block.repeatOnNth.feminine.2': 'във втората {{weekday}}',
      'staff.block.repeatOnNth.masculine.2': 'във втория {{weekday}}',
      'staff.block.repeatWeekdayGender.wednesday': 'feminine',
      'staff.block.repeatOnDayOfYear': 'на {{date}}',
      'staff.block.repeatEnd': 'Край',
      'staff.block.repeatEndOn': 'На дата',
      'staff.block.repeatEndAfter': 'След брой пъти',
      'staff.block.repeatEndDate': 'Дата',
      'staff.block.repeatEndCount': 'Брой пъти',
      'staff.block.repeatTimes.one': '{{count}} път',
      'staff.block.repeatTimes.other': '{{count}} пъти',
      'staff.block.repeatTimesUnit.one': 'път',
      'staff.block.repeatTimesUnit.other': 'пъти',
      'staff.block.repeatFix': 'Смени края',
      'errors.scheduling.recurrence.invalid_count':
        'Броят пъти е от 1 до {{max}}.',
      'errors.scheduling.recurrence.never_occurs':
        'До края не се пада нито един ден.',
      'staff.visit.confirm': 'Потвърди',
      'staff.block.collisionsNamed': '{{count}} часа вътре: {{names}}',
      'staff.block.effect': 'Времето спира да е свободно за записване.',
      'staff.block.convert': 'Превърни в час',
      'staff.block.addBarber': 'Добави бръснар',
      'staff.block.removeBarber': 'Премахни бръснаря',
      'staff.visit.barbers': 'Бръснари',
      'staff.visit.conflict': 'Застъпва се с {{name}} · {{start}} – {{end}}',
      'staff.visit.exits': 'Отказ или неявяване',
      'staff.visit.minutes': '{{minutes}} мин',
      'staff.visit.dayPrevious': 'Предишен ден',
      'staff.visit.dayNext': 'Следващ ден',
      'staff.visit.monthPrevious': 'Предишен месец',
      'staff.visit.monthNext': 'Следващ месец',
    });
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/** A noon hour, drafted in Ivan's chair, over a shop of three. */
function vm(partial: Partial<BlockEditorVm> = {}): BlockEditorVm {
  return {
    blockId: null,
    barberIds: ['ivan'],
    dayKey: '2026-09-09',
    todayKey: '2026-09-09',
    allDay: false,
    startMinute: 12 * 60,
    endMinute: 13 * 60,
    lanes: [
      {
        barberId: 'ivan',
        neighbours: [
          { name: 'Мартин Илиев', startMinute: 750, endMinute: 780, tone: 0 },
        ],
        rosterStartMinute: 540,
        rosterEndMinute: 1080,
      },
      {
        barberId: 'stefan',
        neighbours: [
          { name: 'Георги Петров', startMinute: 720, endMinute: 765, tone: 2 },
        ],
        rosterStartMinute: 600,
        rosterEndMinute: 1140,
      },
      {
        barberId: 'niko',
        neighbours: [],
        rosterStartMinute: 540,
        rosterEndMinute: 1080,
      },
    ],
    nowMinute: 600,
    dayIsOff: false,
    liftArmed: false,
    acting: false,
    ...partial,
  };
}

const BARBERS = [
  { id: 'ivan', label: 'Иван Колев', tone: 0, avatarSrc: null },
  { id: 'stefan', label: 'Стефан Петров', tone: 2, avatarSrc: null },
  { id: 'niko', label: 'Нико Димов', tone: 1, avatarSrc: null },
];

describe('StaffBlockEditor', () => {
  let fixture: ComponentFixture<StaffBlockEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StaffBlockEditor],
      providers: [provideTestI18n()],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffBlockEditor);
  });

  function render(model: BlockEditorVm = vm()): HTMLElement {
    fixture.componentRef.setInput('vm', model);
    fixture.componentRef.setInput('uiBarbers', BARBERS);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const find = (host: HTMLElement, testId: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const click = (host: HTMLElement, testId: string) => {
    find(host, testId)?.click();
    fixture.detectChanges();
  };
  const columns = (host: HTMLElement) =>
    host.querySelectorAll('.staff-grid__column').length;

  it("runs in the visit sheet's order: chairs, the pair, the picture, the effect", () => {
    const host = render();
    const order = [...host.querySelectorAll('.staff-visit__body > *')].map(
      (el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label'),
    );
    expect(order.slice(0, 3)).toEqual([
      'staff-block-barbers',
      'От',
      'staff-block-frame',
    ]);
    // No state strip, no list of the visits underneath.
    expect(find(host, 'staff-block-state')).toBeNull();
    expect(find(host, 'staff-block-collisions')).toBeNull();
  });

  it('blocks several chairs at once — discretely — and never none', () => {
    // Owner, 2026-09-09: "what if there are 20 barbers — be discrete like
    // Apple, an add-barber button". Only the chosen chairs are rows; the
    // rest wait behind «Добави бръснар», in the app's one choice menu.
    const host = render();
    expect(find(host, 'staff-block-barber-ivan')).not.toBeNull();
    expect(find(host, 'staff-block-barber-stefan')).toBeNull();
    expect(columns(host)).toBe(1);

    click(host, 'staff-block-add-barber');
    click(host, 'staff-block-barber-pick-stefan');
    expect(find(host, 'staff-block-barber-stefan')).not.toBeNull();
    // One column per chosen chair, the block drawn over each real day.
    expect(columns(host)).toBe(2);
    expect(find(host, 'staff-block-add-barber')).not.toBeNull();

    // A chosen chair swipes off like a service row; the last one does not.
    click(host, 'staff-block-remove-barber-ivan');
    expect(find(host, 'staff-block-barber-ivan')).toBeNull();
    expect(find(host, 'staff-block-remove-barber-stefan')).toBeNull();

    const commits: { barberIds: readonly string[] }[] = [];
    fixture.componentInstance.committed.subscribe((c) => commits.push(c));
    click(host, 'staff-block-save');
    expect(commits[0]?.barberIds).toEqual(['stefan']);
  });

  it('draws an all-day block across the whole axis, in both pictures', () => {
    // Owner, 2026-09-09: "all-day blockers should span full width for the
    // barber row". The roster used to bound it, which read as a timed block
    // that happened to fit the shift.
    const host = render();
    click(host, 'staff-block-all-day');
    const block = find(host, 'staff-grid-block');
    expect(Number(block?.style.getPropertyValue('--staff-event-top'))).toBe(0);
    expect(Number(block?.style.getPropertyValue('--staff-event-height'))).toBe(
      1,
    );
    expect(block?.getAttribute('aria-label')).toBe('Блок, Цял ден');
    // No handles: there is nothing to drag on a whole day.
    expect(find(host, 'staff-frame-handle-start')).toBeNull();

    click(host, 'staff-block-add-barber');
    click(host, 'staff-block-barber-pick-stefan');
    click(host, 'staff-block-add-barber');
    click(host, 'staff-block-barber-pick-niko');
    const band = find(host, 'staff-timeline-band');
    expect(Number(band?.style.getPropertyValue('--staff-bar-from'))).toBe(0);
    expect(Number(band?.style.getPropertyValue('--staff-bar-span'))).toBe(1);
    expect(band?.hasAttribute('inert')).toBe(true);
    expect(find(host, 'staff-timeline-handle-end')).toBeNull();
  });

  it('turns the picture on its side from the third chair — rows of chairs, hours across', () => {
    // Owner, 2026-09-09: "when more than two barbers are selected, switch
    // strategy — horizontal like MS Calendar, each row a barber".
    const host = render();
    click(host, 'staff-block-add-barber');
    click(host, 'staff-block-barber-pick-stefan');
    expect(columns(host)).toBe(2);
    expect(find(host, 'staff-timeline-row')).toBeNull();

    click(host, 'staff-block-add-barber');
    click(host, 'staff-block-barber-pick-niko');
    // Everyone is on; nothing left to add — and the grid has given way.
    expect(find(host, 'staff-block-add-barber')).toBeNull();
    expect(columns(host)).toBe(0);
    expect(
      host.querySelectorAll('[data-testid="staff-timeline-row"]'),
    ).toHaveLength(3);
    // ONE band across the rows, at the draft's own hour; the booking under
    // it marked, and the same red sentence under the picture.
    const band = find(host, 'staff-timeline-band');
    expect(band?.getAttribute('aria-label')).toContain('12:00');
    expect(
      host.querySelectorAll(
        '[data-testid="staff-timeline-bar"][data-collides]',
      ),
    ).toHaveLength(2);
    expect(find(host, 'staff-block-frame-note')?.textContent).toContain(
      '2 часа вътре',
    );

    // A step on the band is the sheet's own draft: the typed pair follows.
    band?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    expect(
      find(host, 'staff-block-from')?.getAttribute('value') ??
        (find(host, 'staff-block-from') as HTMLInputElement | null)?.value,
    ).toBe('12:05');

    // Back under three chairs, the columns return.
    click(host, 'staff-block-remove-barber-niko');
    expect(find(host, 'staff-timeline-row')).toBeNull();
    expect(columns(host)).toBe(2);
  });
  it('names what the block sits on, in red under the picture, across the chosen chairs', () => {
    const host = render();
    // Ivan's noon hour sits on Мартин's 12:30 — one sentence, the visit sheet's.
    const note = find(host, 'staff-block-frame-note');
    expect(note?.getAttribute('data-verdict')).toBe('conflict');
    expect(note?.textContent).toContain(
      'Застъпва се с Мартин Илиев · 12:30 – 13:00',
    );
    expect(note?.closest('[data-testid="staff-block-frame"]')).not.toBeNull();

    // Two chairs, two visits inside: a count and the names.
    click(host, 'staff-block-add-barber');
    click(host, 'staff-block-barber-pick-stefan');
    expect(find(host, 'staff-block-frame-note')?.textContent).toContain(
      '2 часа вътре: Мартин Илиев, Георги Петров',
    );
  });

  /* ── The repeat (2026-09-24: "like Apple Calendar, MS Calendar, Google
     Calendar — defining which days it occurs, from, to") ─────────────── */

  const commitsOf = () => {
    const commits: BlockEditorCommit[] = [];
    fixture.componentInstance.committed.subscribe((c) => commits.push(c));
    return commits;
  };
  const text = (host: HTMLElement, testId: string) =>
    find(host, testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  /** A pop-up button's value — its label, without the glyph's ligature text. */
  const pill = (host: HTMLElement, testId: string) =>
    find(host, testId)?.querySelector('span')?.textContent?.trim() ?? null;
  const typeInto = (host: HTMLElement, testId: string, value: string) => {
    const input = find(host, testId) as HTMLInputElement | null;
    if (input === null) throw new Error(`no field ${testId}`);
    input.value = value;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const checked = (host: HTMLElement) =>
    [...host.querySelectorAll('[role="radio"][aria-checked="true"]')].map(
      (row) => row.getAttribute('data-testid'),
    );

  it('repeats through a value row that pushes its own page, Apple-style', () => {
    const host = render();
    const editor = fixture.componentInstance;
    // THE VALUE IS THE CHOICE, and it travels: «Повтаряне · Никога ›».
    expect(text(host, 'staff-block-repeat-value')).toBe('Никога');
    expect(find(host, 'staff-block-repeat-facts')).toBeNull();
    expect(find(host, 'staff-block-until')).toBeNull();

    click(host, 'staff-block-repeat');
    // A page in this sheet, not a menu: the ladder gives way, the bar names it.
    expect(find(host, 'staff-block-page')).not.toBeNull();
    expect(find(host, 'staff-block-root')).toBeNull();
    expect(editor.depth()).toBe(1);
    expect(editor.pageTitle()).toBe('Повтаряне');
    expect(checked(host)).toEqual(['staff-block-repeat-never']);
    // Each shortcut says what it means from THIS start — a Wednesday.
    expect(text(host, 'staff-block-repeat-weekly')).toContain('в сряда');
    expect(text(host, 'staff-block-repeat-monthly')).toContain('на 9-о число');

    click(host, 'staff-block-repeat-weekdays');
    expect(checked(host)).toEqual(['staff-block-repeat-weekdays']);
    // Four weeks by default: the 9th through 7 October, weekdays only.
    expect(text(host, 'staff-block-repeat-summary')).toContain('21 пъти');
    expect(find(host, 'staff-block-until')).not.toBeNull();

    // The dock's ✓ goes back; the row now reads the series.
    click(host, 'staff-block-page-done');
    expect(find(host, 'staff-block-page')).toBeNull();
    expect(editor.depth()).toBe(0);
    expect(text(host, 'staff-block-repeat-value')).toBe('Делнични дни');
    expect(text(host, 'staff-block-repeat-facts')).toContain('21 пъти');

    const commits = commitsOf();
    click(host, 'staff-block-save');
    const days = commits[0]?.days ?? [];
    expect(days).toHaveLength(21);
    expect(days[0]).toBe('2026-09-09');
    expect(days[days.length - 1]).toBe('2026-10-07');
    // No Saturday the 12th, no Sunday the 13th.
    expect(days).not.toContain('2026-09-12');
    expect(days).not.toContain('2026-09-13');
  });

  it('builds a rule of its own: every 2 weeks, on Monday and Wednesday, 4 times', () => {
    const host = render();
    click(host, 'staff-block-repeat');
    click(host, 'staff-block-repeat-custom');
    // Google's own custom default: weekly, on the start's weekday.
    expect(checked(host)).toEqual(['staff-block-repeat-custom']);
    expect(pill(host, 'staff-block-repeat-frequency')).toBe('Ежеседмично');
    expect(
      find(host, 'staff-block-repeat-weekday-3')?.getAttribute('aria-pressed'),
    ).toBe('true');

    click(host, 'staff-block-repeat-weekday-1');
    typeInto(host, 'staff-block-repeat-interval', '2');
    click(host, 'staff-block-repeat-end-kind');
    click(host, 'staff-block-repeat-end-count');
    typeInto(host, 'staff-block-repeat-count', '4');

    expect(text(host, 'staff-block-repeat-summary')).toContain(
      'На всеки 2 седмици',
    );
    expect(text(host, 'staff-block-repeat-summary')).toContain('4 пъти');
    // A shaped rule stays under «Персонализирано».
    expect(checked(host)).toEqual(['staff-block-repeat-custom']);

    click(host, 'staff-block-page-done');
    expect(text(host, 'staff-block-repeat-value')).toBe('На всеки 2 седмици');
    const commits = commitsOf();
    click(host, 'staff-block-save');
    // Weeks count from the start's own week: Wed 9; then the week of the
    // 21st (Mon, Wed); then the week of 5 October.
    expect(commits[0]?.days).toEqual([
      '2026-09-09',
      '2026-09-21',
      '2026-09-23',
      '2026-10-05',
    ]);
  });

  it('reads a month the way Google does — the date, or «the second Wednesday»', () => {
    const host = render();
    click(host, 'staff-block-repeat');
    click(host, 'staff-block-repeat-monthly');
    click(host, 'staff-block-repeat-custom');
    expect(pill(host, 'staff-block-repeat-month-day')).toBe('На 9-о число');
    click(host, 'staff-block-repeat-month-day');
    click(host, 'staff-block-repeat-month-day-wednesday-2');
    expect(pill(host, 'staff-block-repeat-month-day')).toBe(
      'Във втората сряда',
    );
    expect(text(host, 'staff-block-repeat-summary')).toContain(
      'във втората сряда',
    );

    click(host, 'staff-block-page-done');
    const commits = commitsOf();
    click(host, 'staff-block-save');
    // Half a year by default, to 9 March: its second Wednesday is the 10th.
    expect(commits[0]?.days).toEqual([
      '2026-09-09',
      '2026-10-14',
      '2026-11-11',
      '2026-12-09',
      '2027-01-13',
      '2027-02-10',
    ]);
  });

  it('dots the series on its end calendar, and will not end before it starts', () => {
    const host = render();
    click(host, 'staff-block-repeat');
    click(host, 'staff-block-repeat-weekly');
    click(host, 'staff-block-until');
    // The calendar opens on the end's own month, October.
    expect(
      find(host, 'ui-month-day-2026-10-07')?.hasAttribute('data-marked'),
    ).toBe(true);
    expect(
      find(host, 'ui-month-day-2026-10-08')?.hasAttribute('data-marked'),
    ).toBe(false);
    click(host, 'ui-month-prev');
    expect(
      find(host, 'ui-month-day-2026-09-16')?.hasAttribute('data-marked'),
    ).toBe(true);
    expect(
      (find(host, 'ui-month-day-2026-09-08') as HTMLButtonElement | null)
        ?.disabled,
    ).toBe(true);
    click(host, 'ui-month-day-2026-09-23');
    expect(text(host, 'staff-block-repeat-summary')).toContain('3 пъти');
  });

  it('refuses a series it cannot write — in words, and «Запази» says where to fix it', () => {
    const host = render();
    click(host, 'staff-block-repeat');
    click(host, 'staff-block-repeat-custom');
    // A typed count past the cap is refused, never clamped.
    click(host, 'staff-block-repeat-end-kind');
    click(host, 'staff-block-repeat-end-count');
    typeInto(host, 'staff-block-repeat-count', '500');
    expect(text(host, 'staff-block-repeat-error')).toBe(
      'Броят пъти е от 1 до 366.',
    );
    typeInto(host, 'staff-block-repeat-count', '3');
    expect(find(host, 'staff-block-repeat-error')).toBeNull();

    // Ending on the start, Mondays only: a Wednesday start has no Monday.
    click(host, 'staff-block-repeat-end-kind');
    click(host, 'staff-block-repeat-end-until');
    click(host, 'staff-block-until');
    click(host, 'ui-month-day-2026-09-09');
    click(host, 'staff-block-repeat-weekday-1');
    click(host, 'staff-block-repeat-weekday-3');
    expect(text(host, 'staff-block-repeat-error')).toBe(
      'До края не се пада нито един ден.',
    );

    click(host, 'staff-block-page-done');
    // The row says it in red; the dock withholds «Запази» and says where.
    expect(
      find(host, 'staff-block-repeat-facts')?.getAttribute(
        'data-foreground-style',
      ),
    ).toBe('destructive');
    expect(find(host, 'staff-block-save')).toBeNull();
    click(host, 'staff-block-repeat-fix');
    expect(find(host, 'staff-block-page')).not.toBeNull();
  });

  it('follows the frame: a start stepped to Thursday carries «every week» to Thursdays', () => {
    const host = render();
    click(host, 'staff-block-repeat');
    click(host, 'staff-block-repeat-weekly');
    click(host, 'staff-block-page-done');
    click(host, 'staff-block-day-next');
    expect(text(host, 'staff-block-repeat-value')).toBe('Всяка седмица');
    const commits = commitsOf();
    click(host, 'staff-block-save');
    // The weekday went with the start; the end it still fits stays put
    // (7 October, Google's reading), so the last Thursday is the 1st.
    expect(commits[0]?.days).toEqual([
      '2026-09-10',
      '2026-09-17',
      '2026-09-24',
      '2026-10-01',
    ]);
  });

  it('steps its day like the visit sheet, and tells the owner', () => {
    const host = render();
    const days: string[] = [];
    fixture.componentInstance.dayChanged.subscribe((day) => days.push(day));
    click(host, 'staff-block-day-next');
    expect(days).toEqual(['2026-09-10']);
    expect(find(host, 'staff-block-day')?.textContent).toContain('10.09');
    const commits: { dayKey: string }[] = [];
    fixture.componentInstance.committed.subscribe((c) => commits.push(c));
    click(host, 'staff-block-save');
    expect(commits[0]?.dayKey).toBe('2026-09-10');
  });
});
