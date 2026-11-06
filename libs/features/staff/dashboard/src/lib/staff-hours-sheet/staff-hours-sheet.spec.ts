import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  MinuteRange,
  RosterBreak,
  ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import type { BarberSchedule } from '@core/entities';
import {
  BarberId,
  LocationId,
  MinuteCount,
  Result,
  Weekday,
} from '@core/primitives';
import { endMinute, localDate, minute } from '@core/testing';
import { StaffDayStore } from '../staff-day.store';
import { StaffHoursSheet } from './staff-hours-sheet';
import { hoursWeekVm } from './staff-hours.presenter';

/*
 * The weekly hours sheet: the week read from the chair's roster, a weekday
 * edited on its own page and copied to others, and «Запази» sending the
 * whole week from «В сила от» as ONE roster write (`setRosterWeek`).
 */

const IVAN = BarberId.of('ivan');
const CENTER = LocationId.of('loc-center');
const TODAY = localDate('2026-11-06');
const LUNCH = MinuteRange.of(minute(780), endMinute(840));
const WORKDAYS = [
  Weekday.Mon,
  Weekday.Tue,
  Weekday.Wed,
  Weekday.Thu,
  Weekday.Fri,
];

const roster: BarberSchedule = {
  id: IVAN,
  turnaroundMinutes: MinuteCount.ZERO,
  versions: ScheduleVersion.startingWith(
    WORKDAYS.map((day) =>
      ShiftSegment.of(day, CENTER, minute(540), endMinute(1080)),
    ),
    localDate('2026-01-01'),
    WORKDAYS.map((day) => RosterBreak.of(day, LUNCH)),
  ),
};

@Component({
  imports: [StaffHoursSheet],
  template: `@if (open()) {
    <lib-staff-hours-sheet
      [uiChairs]="[{ id: chair, label: 'Иван' }]"
      [uiChairId]="chair"
      [uiToday]="today"
      [uiHomeOf]="home"
      (closed)="open.set(false)"
    />
  }`,
})
class Host {
  readonly open = signal(true);
  readonly chair = IVAN;
  readonly today = TODAY;
  readonly home = () => CENTER;
}

describe('StaffHoursSheet', () => {
  let fixture: ComponentFixture<Host>;
  const setRosterWeek = vi.fn(async () => true);

  async function mount(): Promise<void> {
    setRosterWeek.mockClear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideTransloco({
          config: {
            availableLangs: ['bg'],
            defaultLang: 'bg',
            missingHandler: { logMissingKey: false },
          },
          loader: class {
            getTranslation() {
              return of({});
            }
          },
        }),
        {
          provide: StaffDayStore,
          useValue: {
            rosterOf: () => of(Result.ok(roster)),
            setRosterWeek,
            absencePending: signal(false),
            absenceError: signal(null),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const host = () => fixture.nativeElement as HTMLElement;
  const find = (testId: string) =>
    host().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const press = (testId: string) => {
    find(testId)?.click();
    fixture.detectChanges();
  };

  it('lists the week the roster holds, its breaks under each day', async () => {
    await mount();
    expect(find('staff-hours-day-1')?.getAttribute('aria-label')).toBe(
      'staff.hours.weekday.monday, 09:00–18:00, staff.hours.breakLine',
    );
    expect(find('staff-hours-day-7')?.textContent).toContain('staff.hours.off');
    expect((find('staff-hours-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it("takes Wednesday's lunch off, copies the day to Thursday and saves the week once", async () => {
    await mount();
    press('staff-hours-day-3');
    expect(find('staff-hours-page')).not.toBeNull();
    press('staff-hours-breaks-0-remove');
    (
      host().querySelector(
        '[data-testid="staff-hours-copy-4"]',
      ) as HTMLElement | null
    )?.click();
    fixture.detectChanges();
    press('staff-hours-done');
    expect(find('staff-hours-day-3')?.getAttribute('aria-label')).toBe(
      'staff.hours.weekday.wednesday, 09:00–18:00',
    );
    press('staff-hours-save');
    await fixture.whenStable();
    expect(setRosterWeek).toHaveBeenCalledTimes(1);
    const [week] = setRosterWeek.mock.calls[0] as unknown as [
      { fromLocalDate: string; breaks: readonly RosterBreak[] },
    ];
    expect(week.fromLocalDate).toBe('2026-11-06');
    expect(week.breaks.map((entry) => entry.weekday)).not.toContain(
      Weekday.Wed,
    );
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('turns a day off, and keeps a break inside the day', async () => {
    await mount();
    press('staff-hours-day-6');
    press('staff-hours-working');
    expect(find('staff-hours-shifts')).not.toBeNull();
    press('staff-hours-add-breaks');
    expect(find('staff-hours-breaks-0-start')).not.toBeNull();
    press('staff-hours-done');
    expect(find('staff-hours-day-6')?.getAttribute('aria-label')).toContain(
      '09:00–18:00',
    );
  });
});

describe('hoursWeekVm', () => {
  it('words each weekday: its shifts or «Почивен», and its breaks', () => {
    const words = {
      weekday: (day: Weekday) => `d${day}`,
      off: 'Почивен',
      breakLine: (ranges: string) => `Почивка ${ranges}`,
    };
    const days = hoursWeekVm(
      {
        segments: [
          ShiftSegment.of(Weekday.Mon, CENTER, minute(540), endMinute(780)),
          ShiftSegment.of(Weekday.Mon, CENTER, minute(840), endMinute(1440)),
        ],
        breaks: [RosterBreak.of(Weekday.Mon, LUNCH)],
      },
      words,
    );
    expect(days[0]).toEqual({
      weekday: Weekday.Mon,
      name: 'd1',
      hours: '09:00–13:00, 14:00–00:00',
      breaks: 'Почивка 13:00–14:00',
      off: false,
      accessibleName: 'd1, 09:00–13:00, 14:00–00:00, Почивка 13:00–14:00',
    });
    expect(days[6]?.hours).toBe('Почивен');
    expect(days[6]?.breaks).toBeNull();
  });
});
