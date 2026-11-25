import { describe, expect, it } from 'vitest';
import { BarberStatus } from '@core/components';
import { BarberId } from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  barberFixture,
  deepFreeze,
  localDate,
} from '@core/testing';
import { EmploymentReminderSystem } from './employment-reminder.system';

describe('EmploymentReminderSystem.remindersOf — the last days close enough to decide on (team onboarding D10)', () => {
  const TODAY = localDate('2026-11-16');
  const ending = (id: string, last: string, starts = '2026-01-01') =>
    barberFixture({
      id: BarberId.of(id),
      barberStartsLocalDate: localDate(starts),
      barberLastWorkingLocalDate: localDate(last),
    });

  it('names the working barbers whose last day is today or within seven days, soonest first', () => {
    expect(
      EmploymentReminderSystem.remindersOf(
        [
          ending('in-four', '2026-11-20'),
          ending('today', '2026-11-16'),
          ending('in-seven', '2026-11-23'),
          ending('in-eight', '2026-11-24'),
          ending('passed', '2026-11-15'),
          barberFixture({ id: BarberId.of('open') }),
        ],
        TODAY,
      ).map((barber) => barber.id),
    ).toEqual(['today', 'in-four', 'in-seven']);
  });

  it('says nothing of a period of seven days or less, a record in preparation or one that has left — and is pure', () => {
    const guest = ending('guest', '2026-11-20', '2026-11-14');
    const preparing = barberFixture(
      {
        id: BarberId.of('draft'),
        barberLastWorkingLocalDate: localDate('2026-11-20'),
      },
      {
        barberStatus: BarberStatus.Draft,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberDraftTargetStatus: BarberStatus.Public,
      },
    );
    const left = barberFixture(
      {
        id: BarberId.of('left'),
        barberLastWorkingLocalDate: localDate('2026-11-20'),
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
    const input = deepFreeze([guest, preparing, left]);
    expect(EmploymentReminderSystem.remindersOf(input, TODAY)).toEqual([]);
    expect(EmploymentReminderSystem.remindersOf(input, TODAY)).toEqual(
      EmploymentReminderSystem.remindersOf(input, TODAY),
    );
  });
});
