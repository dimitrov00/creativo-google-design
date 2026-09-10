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
  type BlockEditorVm,
  StaffBlockEditor,
  expandRepeat,
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
      'staff.block.repeatNone': 'Не',
      'staff.block.repeatDaily': 'Всеки ден',
      'staff.block.repeatWeekdays': 'Работни дни',
      'staff.block.repeatWeekly': 'Всяка седмица',
      'staff.block.repeatUntil': 'Повтаря се до',
      'staff.block.repeatDays': '{{count}} дни',
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

describe('expandRepeat', () => {
  it('is the one day when nothing repeats', () => {
    expect(expandRepeat('2026-09-09', null)).toEqual(['2026-09-09']);
  });

  it('walks every day, or every weekday, or every week, up to the end', () => {
    // Wednesday the 9th through Monday the 14th.
    expect(
      expandRepeat('2026-09-09', { kind: 'daily', untilDayKey: '2026-09-14' }),
    ).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    expect(
      expandRepeat('2026-09-09', {
        kind: 'weekdays',
        untilDayKey: '2026-09-14',
      }),
    ).toEqual(['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14']);
    expect(
      expandRepeat('2026-09-09', { kind: 'weekly', untilDayKey: '2026-09-30' }),
    ).toEqual(['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']);
  });
});

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

  it('repeats: the row says how far and on how many days, and the commit carries it', () => {
    const host = render();
    expect(find(host, 'staff-block-until')).toBeNull();
    // The VALUE is the choice: the trailing pill opens the menu.
    expect(
      find(host, 'staff-block-repeat')?.closest('[uitrailing]'),
    ).not.toBeNull();
    click(host, 'staff-block-repeat');
    click(host, 'staff-block-repeat-weekdays');
    expect(find(host, 'staff-block-repeat-value')?.textContent?.trim()).toBe(
      'Работни дни',
    );
    // Four weeks by default: the 9th through 7 October, weekdays only.
    expect(find(host, 'staff-block-until')).not.toBeNull();
    expect(find(host, 'staff-block-repeat-days')?.textContent?.trim()).toBe(
      '21 дни',
    );

    const commits: { repeat: { kind: string; untilDayKey: string } | null }[] =
      [];
    fixture.componentInstance.committed.subscribe((c) => commits.push(c));
    click(host, 'staff-block-save');
    expect(commits[0]?.repeat).toEqual({
      kind: 'weekdays',
      untilDayKey: '2026-10-07',
    });
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
