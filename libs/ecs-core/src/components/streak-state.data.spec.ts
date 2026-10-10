import { describe, expect, it } from 'vitest';
import { StreakDefinitionId } from '../entities/streak-definition.entity';
import { DayKey } from './day-key.data';
import {
  FreezeReason,
  StreakPeriodMark,
  StreakPhase,
  StreakPhaseKind,
  StreakState,
} from './streak-state.data';

const day = DayKey.of;

function state(streakId: string, current: number): StreakState {
  return {
    streakId: StreakDefinitionId.of(streakId),
    definitionVersion: 1,
    phase: StreakPhase.active(),
    current,
    best: current,
    lastQualifiedAtMs: null,
    dueBy: null,
    freezesBanked: 0,
    period: null,
    periods: [],
    heldBy: null,
    runStartedOn: null,
  };
}

describe('StreakPhase', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(StreakPhaseKind)).toEqual([
      'active',
      'atRisk',
      'inGrace',
      'frozen',
      'broken',
    ]);
    expect(Object.values(FreezeReason)).toEqual([
      'freeze',
      'pause',
      'clientPause',
      'excuse',
    ]);
    expect(Object.values(StreakPeriodMark)).toEqual([
      'kept',
      'protected',
      'repaired',
      'missed',
    ]);
  });

  it('builds every phase with its dates', () => {
    expect(StreakPhase.active()).toEqual({ kind: 'active' });
    expect(StreakPhase.atRisk(day('2026-10-12'))).toEqual({
      kind: 'atRisk',
      dueBy: '2026-10-12',
    });
    expect(StreakPhase.inGrace(day('2026-10-19'))).toEqual({
      kind: 'inGrace',
      graceUntil: '2026-10-19',
    });
    expect(
      StreakPhase.frozen(day('2026-11-01'), FreezeReason.ClientPause),
    ).toEqual({
      kind: 'frozen',
      until: '2026-11-01',
      reason: 'clientPause',
    });
    expect(StreakPhase.broken(day('2026-10-20'), day('2026-11-03'))).toEqual({
      kind: 'broken',
      brokenAt: '2026-10-20',
      repairableUntil: '2026-11-03',
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
});
