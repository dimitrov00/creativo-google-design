import { describe, expect, it } from 'vitest';
import { StreakDefinitionId } from '@core/primitives';
import { localDate } from '@core/testing';
import { StreakIntervalSource } from './streak-interval.data';
import {
  FreezeReason,
  StreakPeriodMark,
  StreakPhase,
  StreakPhaseState,
  StreakState,
} from './streak-state.data';

const day = localDate;

function state(streakId: string, current: number): StreakState {
  return {
    streakId: StreakDefinitionId.of(streakId),
    definitionVersion: 1,
    ...StreakPhaseState.active(),
    current,
    best: current,
    lastQualifiedAtUtcMs: null,
    dueBy: null,
    freezesBanked: 0,
    periodIntervalDays: null,
    periodGraceDays: null,
    periodSource: null,
    periodHabitDays: null,
    periods: [],
    heldByAppointmentId: null,
    heldOn: null,
    runStartedOn: null,
  };
}

describe('StreakPhaseState', () => {
  it('declares the tags SCREAMING (the discriminator `streakPhase`)', () => {
    expect(Object.values(StreakPhase)).toEqual([
      'ACTIVE',
      'AT_RISK',
      'IN_GRACE',
      'FROZEN',
      'BROKEN',
    ]);
    expect(Object.values(FreezeReason)).toEqual([
      'FREEZE',
      'PAUSE',
      'CLIENT_PAUSE',
      'EXCUSE',
    ]);
    expect(Object.values(StreakPeriodMark)).toEqual([
      'KEPT',
      'PROTECTED',
      'REPAIRED',
      'MISSED',
    ]);
  });

  it('builds every phase with its dates, each variant-only field prefixed `phase`', () => {
    expect(StreakPhaseState.active()).toEqual({ streakPhase: 'ACTIVE' });
    expect(StreakPhaseState.atRisk(day('2026-10-12'))).toEqual({
      streakPhase: 'AT_RISK',
      phaseDueBy: '2026-10-12',
    });
    expect(StreakPhaseState.inGrace(day('2026-10-19'))).toEqual({
      streakPhase: 'IN_GRACE',
      phaseGraceUntil: '2026-10-19',
    });
    expect(
      StreakPhaseState.frozen(day('2026-11-01'), FreezeReason.ClientPause),
    ).toEqual({
      streakPhase: 'FROZEN',
      phaseFrozenUntil: '2026-11-01',
      phaseFreezeReason: 'CLIENT_PAUSE',
    });
    expect(
      StreakPhaseState.broken(day('2026-10-20'), day('2026-11-03')),
    ).toEqual({
      streakPhase: 'BROKEN',
      phaseBrokenOn: '2026-10-20',
      phaseRepairableUntil: '2026-11-03',
    });
  });
});

describe('StreakState', () => {
  it('keeps twelve closed periods', () => {
    expect(StreakState.PERIODS_KEPT).toBe(12);
  });

  it('finds one rhythm on an account by its id — the map read, as a scan', () => {
    const states = [state('cadence', 4), state('summer', 2)];
    expect(StreakState.find(states, StreakDefinitionId.of('summer'))).toBe(
      states[1],
    );
    expect(
      StreakState.find(states, StreakDefinitionId.of('cadence'))?.current,
    ).toBe(4);
    expect(
      StreakState.find(states, StreakDefinitionId.of('winter')),
    ).toBeNull();
    expect(StreakState.find([], StreakDefinitionId.of('cadence'))).toBeNull();
  });

  it('reads the open period’s flat terms back as the value, or none while no period is open', () => {
    expect(StreakState.periodTerms(state('cadence', 4))).toBeNull();
    expect(
      StreakState.periodTerms({
        ...state('cadence', 4),
        periodIntervalDays: 39,
        periodGraceDays: 7,
        periodSource: StreakIntervalSource.Personal,
        periodHabitDays: 26,
      }),
    ).toEqual({
      intervalDays: 39,
      graceDays: 7,
      source: 'PERSONAL',
      habitDays: 26,
    });
  });
});
