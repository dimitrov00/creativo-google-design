import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BarberStatus } from '@core/components';
import type { Barber } from '@core/entities';
import { AccessScope, BarberId, LocalDate, Locale } from '@core/primitives';
import { FIXTURE_NOW_UTC_MS, barberFixture, localDate } from '@core/testing';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import { StaffDayStore } from '../staff-day.store';
import { ScheduleReminders } from './schedule-reminders';
import { scheduleRemindersVm } from './schedule-reminders.presenter';

/*
 * The last days to decide on, above the schedule (team onboarding D10):
 * the words, then the component over doubles of what it reads.
 */

const TODAY = localDate('2026-11-16');
const WORDS = {
  title: (name: string, date: string) => `Последният ден на ${name} е ${date}`,
  today: (name: string) => `Днес е последният ден на ${name}`,
  extend: 'Удължи',
};
const NBSP = ' ';
const ending = (id: string, name: string, last: string): Barber =>
  barberFixture({
    id: BarberId.of(id),
    name: { bg: name, en: name },
    barberStartsLocalDate: localDate('2026-01-01'),
    barberLastWorkingLocalDate: localDate(last),
  });

describe('scheduleRemindersVm', () => {
  it('words each last day on one line by the first name — «Днес» on the day itself — with «Удължи»', () => {
    const rows = scheduleRemindersVm({
      barbers: [
        ending('georgi', 'Георги Иванов', '2026-11-16'),
        ending('martin', 'Мартин Колев', '2026-11-20'),
      ],
      today: TODAY,
      locale: Locale.Bg,
      words: WORDS,
    });
    expect(
      rows.map((row) => ({ ...row, line: row.line.replaceAll(NBSP, ' ') })),
    ).toEqual([
      {
        barberId: 'georgi',
        line: 'Днес е последният ден на Георги',
        action: 'Удължи',
        testId: 'schedule-reminder-georgi',
      },
      {
        barberId: 'martin',
        line: 'Последният ден на Мартин е пт, 20.11',
        action: 'Удължи',
        testId: 'schedule-reminder-martin',
      },
    ]);
  });
});

describe('ScheduleReminders', () => {
  async function render(options: {
    readonly barbers: readonly Barber[];
    readonly scope?: AccessScope;
  }) {
    TestBed.configureTestingModule({
      imports: [ScheduleReminders],
      providers: [
        provideRouter([]),
        provideTransloco({
          config: {
            availableLangs: ['bg'],
            defaultLang: 'bg',
            missingHandler: { logMissingKey: false },
          },
          loader: class {
            getTranslation() {
              return of({
                admin: {
                  team: {
                    reminder: {
                      title: 'Последният ден на {{name}} е {{date}}',
                      today: 'Днес е последният ден на {{name}}',
                      extend: 'Удължи',
                    },
                  },
                },
              });
            }
          },
        }),
        { provide: StaffDayStore, useValue: { todayKey: signal(TODAY) } },
        {
          provide: TeamCatalogService,
          useValue: {
            teamKnown: signal(true),
            teamBarbers: signal(options.barbers),
          },
        },
        {
          provide: StaffAccessService,
          useValue: { scopeOf: () => options.scope ?? AccessScope.All },
        },
      ],
    });
    const fixture = TestBed.createComponent(ScheduleReminders);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host };
  }

  it('shows a compact notice for a last day within the week, and «Удължи» opens the record’s working period', async () => {
    const { host } = await render({
      barbers: [
        ending('georgi', 'Георги Иванов', LocalDate.addDays(TODAY, 3)),
        ending('far', 'Далеч Далечев', LocalDate.addDays(TODAY, 20)),
        barberFixture({ id: BarberId.of('open') }),
      ],
    });
    const notices = host.querySelectorAll('ui-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.getAttribute('data-testid')).toBe(
      'schedule-reminder-georgi',
    );
    expect(notices[0]?.getAttribute('data-tone')).toBe('accent');
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="schedule-reminder-extend"]',
      )
      ?.click();
    expect(navigate).toHaveBeenCalledWith(['/admin/team/member', 'georgi'], {
      queryParams: { edit: 'period' },
    });
  });

  it('says nothing to someone who does not manage the team, nor of a record that has left', async () => {
    const soon = ending('georgi', 'Георги Иванов', LocalDate.addDays(TODAY, 3));
    const barber = await render({ barbers: [soon], scope: AccessScope.None });
    expect(barber.host.querySelector('ui-notice')).toBeNull();
    TestBed.resetTestingModule();

    const left = barberFixture(
      {
        id: BarberId.of('left'),
        barberLastWorkingLocalDate: LocalDate.addDays(TODAY, 3),
      },
      {
        barberStatus: BarberStatus.Departed,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberDepartedUserId: null,
        barberSessionsRevokedAtUtcMs: null,
        barberKeptAccessUserId: null,
        barberRehireStatus: BarberStatus.Public,
      },
    );
    const owner = await render({ barbers: [left] });
    expect(owner.host.querySelector('ui-notice')).toBeNull();
  });
});
