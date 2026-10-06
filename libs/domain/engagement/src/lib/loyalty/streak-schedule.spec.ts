import { describe, expect, it } from 'vitest';
import {
  StreakDefinition,
  StreakDefinitionProps,
  StreakRuleChange,
  StreakRuleDirection,
} from './streak-definition';
import {
  STREAK_TRANSITIONS,
  StreakDefinitionSchedule,
  StreakTransition,
  addDays,
} from './streak-schedule';

function rule(patch: Partial<StreakDefinitionProps> = {}): StreakDefinition {
  const result = StreakDefinition.create({
    ...StreakDefinition.default().toProps(),
    version: 3,
    effectiveFrom: '2026-09-01',
    ...patch,
  });
  if (result.isFailure()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const CURRENT = rule();
const NEXT = rule({
  version: 4,
  effectiveFrom: '2026-10-01',
  interval: { kind: 'fixed', days: 35 },
});

function schedule(
  scheduled: {
    definition: StreakDefinition;
    transition: StreakTransition;
  } | null = { definition: NEXT, transition: 'grandfather' },
  current: StreakDefinition = CURRENT,
): StreakDefinitionSchedule {
  const result = StreakDefinitionSchedule.create({ current, scheduled });
  if (result.isFailure()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Each fault as `code field`, in the order they were found. */
function faults(
  definition: StreakDefinition,
  transition: StreakTransition = 'grandfather',
): string[] {
  const result = StreakDefinitionSchedule.create({
    current: CURRENT,
    scheduled: { definition, transition },
  });
  return result.isFailure()
    ? result.error.map((e) => `${e.code.split('.').pop()} ${e.field}`)
    : [];
}

describe('StreakDefinitionSchedule.create', () => {
  it('holds the rule in force alone', () => {
    const head = schedule(null);
    expect(head.id).toBe('cadence');
    expect(head.current).toBe(CURRENT);
    expect(head.scheduled).toBeNull();
  });

  it('holds the rule in force and the one that waits', () => {
    const head = schedule();
    expect(head.current).toBe(CURRENT);
    expect(head.scheduled).toEqual({
      definition: NEXT,
      transition: 'grandfather',
    });
  });

  it.each(STREAK_TRANSITIONS)('takes the transition %s', (transition) => {
    expect(faults(NEXT, transition)).toEqual([]);
  });

  it('refuses a version of another rule', () => {
    const result = StreakDefinitionSchedule.create({
      current: CURRENT,
      scheduled: {
        definition: rule({
          id: 'other',
          version: 4,
          effectiveFrom: '2026-10-01',
        }),
        transition: 'grandfather',
      },
    });
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.streak_schedule.id_mismatch',
      field: 'scheduled.id',
      value: 'other',
      currentId: 'cadence',
    });
  });

  it.each([3, 2])('refuses version %s after version 3', (version) => {
    const result = StreakDefinitionSchedule.create({
      current: CURRENT,
      scheduled: {
        definition: rule({ version, effectiveFrom: '2026-10-01' }),
        transition: 'grandfather',
      },
    });
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.streak_schedule.version_not_rising',
      field: 'scheduled.version',
      value: version,
      currentVersion: 3,
    });
  });

  it('takes a version that skips a number', () => {
    // A withdrawn version keeps its number: the next one is two above.
    expect(faults(rule({ version: 5, effectiveFrom: '2026-10-01' }))).toEqual(
      [],
    );
  });

  it.each(['2026-09-01', '2026-08-31'])(
    'refuses a rule that waits for %s when the one in force began on 2026-09-01',
    (effectiveFrom) => {
      const result = StreakDefinitionSchedule.create({
        current: CURRENT,
        scheduled: {
          definition: rule({ version: 4, effectiveFrom }),
          transition: 'grandfather',
        },
      });
      expect(result.isFailure() && result.error).toHaveLength(1);
      expect(result.isFailure() && result.error[0]).toMatchObject({
        code: 'engagement.streak_schedule.scheduled_not_after_current',
        field: 'scheduled.effectiveFrom',
        value: effectiveFrom,
        currentEffectiveFrom: '2026-09-01',
      });
    },
  );

  it('takes a rule that waits for the very next day', () => {
    expect(faults(rule({ version: 4, effectiveFrom: '2026-09-02' }))).toEqual(
      [],
    );
  });

  it('refuses a transition it does not know', () => {
    const result = StreakDefinitionSchedule.create({
      current: CURRENT,
      scheduled: {
        definition: NEXT,
        transition: 'forget' as string as StreakTransition,
      },
    });
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.streak_definition.unknown_option',
      field: 'scheduled.transition',
      value: 'forget',
      options: ['grandfather', 'recompute'],
    });
  });

  it('reports every fault at once', () => {
    expect(
      faults(
        rule({ id: 'other', version: 1, effectiveFrom: '2026-01-01' }),
        'forget' as string as StreakTransition,
      ),
    ).toEqual([
      'id_mismatch scheduled.id',
      'version_not_rising scheduled.version',
      'scheduled_not_after_current scheduled.effectiveFrom',
      'unknown_option scheduled.transition',
    ]);
  });

  it('cannot be re-scheduled in place', () => {
    const head = schedule();
    expect(() => {
      (head.scheduled as { transition: StreakTransition }).transition =
        'recompute';
    }).toThrow(TypeError);
  });
});

describe('StreakDefinitionSchedule, by date', () => {
  it.each([
    { today: '2026-09-01', inForce: 3, upcoming: 4 },
    { today: '2026-09-29', inForce: 3, upcoming: 4 },
    { today: '2026-09-30', inForce: 3, upcoming: 4 },
    { today: '2026-10-01', inForce: 4, upcoming: null },
    { today: '2026-10-02', inForce: 4, upcoming: null },
    { today: '2027-03-15', inForce: 4, upcoming: null },
  ])(
    'on $today version $inForce is in force and $upcoming waits',
    ({ today, inForce, upcoming }) => {
      const head = schedule();
      expect(head.inForceOn(today).version).toBe(inForce);
      expect(head.upcomingOn(today)?.definition.version ?? null).toBe(upcoming);
    },
  );

  it('hands the waiting rule over with what it does to the runs that exist', () => {
    expect(
      schedule({ definition: NEXT, transition: 'recompute' }).upcomingOn(
        '2026-09-29',
      ),
    ).toEqual({ definition: NEXT, transition: 'recompute' });
  });

  it('with nothing waiting, the rule in force is the rule on any day', () => {
    const head = schedule(null);
    for (const today of ['2026-09-01', '2026-09-29', '2030-01-01']) {
      expect(head.inForceOn(today)).toBe(CURRENT);
      expect(head.upcomingOn(today)).toBeNull();
    }
  });

  it('a first rule that has not begun yet is still the only rule there is', () => {
    expect(schedule(null).inForceOn('2026-08-15')).toBe(CURRENT);
  });

  it('hands a rule that is off over as the rule in force: the reader asks it', () => {
    const off = rule({
      version: 4,
      effectiveFrom: '2026-10-01',
      enabled: false,
    });
    const head = schedule({ definition: off, transition: 'grandfather' });
    expect(head.inForceOn('2026-09-30').enabled).toBe(true);
    expect(head.inForceOn('2026-10-01').enabled).toBe(false);
  });
});

describe('StreakDefinitionSchedule.earliestEffectiveDay', () => {
  const TODAY = '2026-09-29';
  const change = (direction: StreakRuleDirection): StreakRuleChange => ({
    direction,
    changed: [],
  });
  const unseen = { clientsSeeRhythm: false, noticeDays: 30 };
  const seen = { clientsSeeRhythm: true, noticeDays: 30 };

  it.each<[StreakRuleDirection, typeof seen, string, string]>([
    ['neutral', unseen, '2026-09-29', 'today'],
    ['neutral', seen, '2026-09-29', 'today'],
    ['looser', unseen, '2026-09-30', 'tomorrow'],
    ['looser', seen, '2026-09-30', 'tomorrow'],
    ['switch', unseen, '2026-09-30', 'tomorrow'],
    ['switch', seen, '2026-09-30', 'tomorrow'],
    ['stricter', unseen, '2026-09-30', 'tomorrow'],
    ['mixed', unseen, '2026-09-30', 'tomorrow'],
    ['stricter', seen, '2026-10-29', 'a notice period ahead'],
    ['mixed', seen, '2026-10-29', 'a notice period ahead'],
  ])('a %s change with %o may begin on %s (%s)', (direction, policy, day) => {
    expect(
      StreakDefinitionSchedule.earliestEffectiveDay(
        change(direction),
        TODAY,
        policy,
      ),
    ).toBe(day);
  });

  it('never lets what takes something away begin today, whatever the notice', () => {
    for (const noticeDays of [0, -5]) {
      expect(
        StreakDefinitionSchedule.earliestEffectiveDay(
          change('stricter'),
          TODAY,
          { clientsSeeRhythm: true, noticeDays },
        ),
      ).toBe('2026-09-30');
    }
  });

  it('reads the change the rule itself classified', () => {
    const stricter = NEXT.changeFrom(CURRENT);
    expect(stricter.direction).toBe('stricter');
    expect(
      StreakDefinitionSchedule.earliestEffectiveDay(stricter, TODAY, seen),
    ).toBe('2026-10-29');
  });
});

describe('addDays', () => {
  it.each([
    ['2026-09-29', 0, '2026-09-29'],
    ['2026-09-29', 1, '2026-09-30'],
    ['2026-09-30', 1, '2026-10-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
    ['2026-09-29', 42, '2026-11-10'],
    ['2026-09-29', 182, '2027-03-30'],
    ['2026-10-01', -1, '2026-09-30'],
    ['2026-03-01', -42, '2026-01-18'],
  ])('%s and %s days is %s', (day, days, expected) => {
    expect(addDays(day, days)).toBe(expected);
  });

  it('counts calendar days across both of Sofia’s clock changes', () => {
    // 29.03.2026 has 23 hours in Sofia and 25.10.2026 has 25: a date has neither.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });
});
