import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AccessScope, BarberId, LocalDate } from '@core/primitives';
import { barberFixture, localDate, unwrapOk } from '@core/testing';
import type { Barber } from '@core/entities';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import { StaffDayStore } from '../staff-day.store';
import { AnalyticsEntry, analyticsEntryQueryOf } from './analytics-entry';

const DAY = unwrapOk(LocalDate.parse('2026-08-05'));
const IVAN = BarberId.of('ivan');

describe('analyticsEntryQueryOf', () => {
  it('a reader of the shop’s viewing one chair opens that barber’s day', () => {
    expect(analyticsEntryQueryOf(true, IVAN, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
      barber: IVAN,
    });
  });

  it('a reader of the shop’s viewing every chair opens the shop (no barber)', () => {
    expect(analyticsEntryQueryOf(true, null, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
    });
  });

  it('a reader of their own opens their own, whatever chair the book shows', () => {
    expect(analyticsEntryQueryOf(false, IVAN, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
    });
    expect(analyticsEntryQueryOf(false, null, DAY)).toEqual({
      span: 'DAY',
      from: DAY,
    });
  });
});

/*
 * THE BADGE (owner ruling 2026-11-25, Q2): how many decisions «Анализи»
 * opens with — the team's last days within the week, for whoever may
 * extend them, the same answer `lib-analytics-reminders` lists.
 */
describe('AnalyticsEntry.pending', () => {
  const TODAY = localDate('2026-11-16');
  const ending = (id: string, days: number): Barber =>
    barberFixture({
      id: BarberId.of(id),
      barberStartsLocalDate: localDate('2026-01-01'),
      barberLastWorkingLocalDate: LocalDate.addDays(TODAY, days),
    });

  function entry(options: {
    readonly barbers: readonly Barber[];
    readonly reads?: boolean;
    readonly teamManage?: AccessScope;
    readonly teamKnown?: boolean;
    readonly today?: LocalDate | null;
  }): AnalyticsEntry {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        AnalyticsEntry,
        {
          provide: StaffAccessService,
          useValue: {
            opens: () => options.reads ?? true,
            scopeOf: () => options.teamManage ?? AccessScope.All,
          },
        },
        {
          provide: TeamCatalogService,
          useValue: {
            teamKnown: signal(options.teamKnown ?? true),
            teamBarbers: signal(options.barbers),
          },
        },
        {
          provide: StaffDayStore,
          useValue: {
            todayKey: signal(
              options.today === undefined ? TODAY : options.today,
            ),
          },
        },
      ],
    });
    return TestBed.inject(AnalyticsEntry);
  }

  it('counts the last days within the week, never one further off nor an open period', () => {
    const team = [
      ending('georgi', 0),
      ending('martin', 3),
      ending('far', 20),
      barberFixture({ id: BarberId.of('open') }),
    ];
    expect(entry({ barbers: team }).pending()).toBe(2);
  });

  it('is 0 for someone who may not extend them, or who cannot open «Анализи»', () => {
    const team = [ending('georgi', 3)];
    expect(
      entry({ barbers: team, teamManage: AccessScope.None }).pending(),
    ).toBe(0);
    expect(entry({ barbers: team, reads: false }).pending()).toBe(0);
  });

  it('is 0 until the team stream and the shop’s today are known', () => {
    const team = [ending('georgi', 3)];
    expect(entry({ barbers: team, teamKnown: false }).pending()).toBe(0);
    expect(entry({ barbers: team, today: null }).pending()).toBe(0);
  });
});
