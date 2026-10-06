import { describe, expect, it } from 'vitest';
import { DomainError } from '@creativo/domain/kernel';
import * as errors from './streak-definition.errors';
import {
  StreakBookingHoldOutOfRangeError,
  StreakClampInvertedError,
  StreakClientPauseOutOfRangeError,
  StreakDefinitionError,
  StreakDefinitionField,
  StreakEffectiveDayInvalidError,
  StreakFallbackOutsideClampError,
  StreakGraceNotShorterThanIntervalError,
  StreakGraceOutOfRangeError,
  StreakIdEmptyError,
  StreakIntervalOutOfRangeError,
  StreakMinGapOutOfRangeError,
  StreakNameEmptyError,
  StreakProtectionsOutOfRangeError,
  StreakQualifierEmptyError,
  StreakRepairOutOfRangeError,
  StreakRiskLeadOutOfRangeError,
  StreakScheduleIdMismatchError,
  StreakScheduledNotAfterCurrentError,
  StreakStartWithAboveCapError,
  StreakToleranceOutOfRangeError,
  StreakUnknownExcuseError,
  StreakUnknownOptionError,
  StreakVersionNotPositiveError,
  StreakVersionNotRisingError,
} from './streak-definition.errors';

/** One of every reason, with the code, the field and the value a page reads off it. */
const EVERY: readonly [
  StreakDefinitionError,
  string,
  StreakDefinitionField,
  unknown,
][] = [
  [
    new StreakIdEmptyError(' '),
    'engagement.streak_definition.id_empty',
    'id',
    ' ',
  ],
  [
    new StreakNameEmptyError('bg', ''),
    'engagement.streak_definition.name_empty',
    'name.bg',
    '',
  ],
  [
    new StreakNameEmptyError('en', ''),
    'engagement.streak_definition.name_empty',
    'name.en',
    '',
  ],
  [
    new StreakVersionNotPositiveError(0),
    'engagement.streak_definition.version_not_positive',
    'version',
    0,
  ],
  [
    new StreakEffectiveDayInvalidError('soon'),
    'engagement.streak_definition.effective_day_invalid',
    'effectiveFrom',
    'soon',
  ],
  [
    new StreakUnknownOptionError('onBreak', 'pause', ['restart', 'hold']),
    'engagement.streak_definition.unknown_option',
    'onBreak',
    'pause',
  ],
  [
    new StreakQualifierEmptyError('qualifier.serviceIds', []),
    'engagement.streak_definition.qualifier_empty',
    'qualifier.serviceIds',
    [],
  ],
  [
    new StreakQualifierEmptyError('qualifier.categoryIds', []),
    'engagement.streak_definition.qualifier_empty',
    'qualifier.categoryIds',
    [],
  ],
  [
    new StreakMinGapOutOfRangeError(15, 0, 14),
    'engagement.streak_definition.min_gap_out_of_range',
    'minGapDays',
    15,
  ],
  [
    new StreakBookingHoldOutOfRangeError(29, 0, 28),
    'engagement.streak_definition.booking_hold_out_of_range',
    'bookingHold.maxDaysPastDue',
    29,
  ],
  [
    new StreakIntervalOutOfRangeError('interval.days', 13, 14, 182),
    'engagement.streak_definition.interval_out_of_range',
    'interval.days',
    13,
  ],
  [
    new StreakToleranceOutOfRangeError(101, 0, 100),
    'engagement.streak_definition.tolerance_out_of_range',
    'interval.tolerancePct',
    101,
  ],
  [
    new StreakClampInvertedError(71, 70),
    'engagement.streak_definition.clamp_inverted',
    'interval.minDays',
    71,
  ],
  [
    new StreakFallbackOutsideClampError(84, 21, 70),
    'engagement.streak_definition.fallback_outside_clamp',
    'interval.fallbackDays',
    84,
  ],
  [
    new StreakGraceOutOfRangeError(22, 0, 21),
    'engagement.streak_definition.grace_out_of_range',
    'graceDays',
    22,
  ],
  [
    new StreakGraceNotShorterThanIntervalError(14, 14),
    'engagement.streak_definition.grace_not_shorter_than_interval',
    'graceDays',
    14,
  ],
  [
    new StreakRiskLeadOutOfRangeError(22, 0, 21),
    'engagement.streak_definition.risk_lead_out_of_range',
    'riskLeadDays',
    22,
  ],
  [
    new StreakProtectionsOutOfRangeError('protections.maxBanked', 6, 0, 5),
    'engagement.streak_definition.protections_out_of_range',
    'protections.maxBanked',
    6,
  ],
  [
    new StreakStartWithAboveCapError(3, 2),
    'engagement.streak_definition.start_with_above_cap',
    'protections.startWith',
    3,
  ],
  [
    new StreakUnknownExcuseError('weather'),
    'engagement.streak_definition.unknown_excuse',
    'excuses',
    'weather',
  ],
  [
    new StreakClientPauseOutOfRangeError(181, 0, 180),
    'engagement.streak_definition.client_pause_out_of_range',
    'clientPause.maxDaysPerYear',
    181,
  ],
  [
    new StreakRepairOutOfRangeError('repair.windowDays', 0, 1, 60),
    'engagement.streak_definition.repair_out_of_range',
    'repair.windowDays',
    0,
  ],
  [
    new StreakScheduleIdMismatchError('cadence', 'other'),
    'engagement.streak_schedule.id_mismatch',
    'scheduled.id',
    'other',
  ],
  [
    new StreakVersionNotRisingError(3, 3),
    'engagement.streak_schedule.version_not_rising',
    'scheduled.version',
    3,
  ],
  [
    new StreakScheduledNotAfterCurrentError('2026-09-01', '2026-08-31'),
    'engagement.streak_schedule.scheduled_not_after_current',
    'scheduled.effectiveFrom',
    '2026-08-31',
  ],
];

describe('the rhythm rule’s errors', () => {
  it.each(EVERY)(
    '%o carries %s, %s and what was handed in',
    (error, code, field, value) => {
      expect(error).toBeInstanceOf(StreakDefinitionError);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(code);
      expect(error.field).toBe(field);
      expect(error.value).toEqual(value);
      expect(error.params).toMatchObject({ field, value });
      expect(error.message.length).toBeGreaterThan(0);
    },
  );

  it('lists one of every class the file exports', () => {
    const exported = Object.values(errors).filter(
      (member): member is typeof StreakDefinitionError =>
        typeof member === 'function' && member !== StreakDefinitionError,
    );
    const listed = new Set(EVERY.map(([error]) => error.constructor));
    expect(
      exported.filter((cls) => !listed.has(cls)).map((c) => c.name),
    ).toEqual([]);
    // The seventeen the contract names (revision 3 §4.1), the two a version
    // is identified by, the closed choices, and the head's three.
    expect(exported).toHaveLength(23);
  });

  it('gives every reason a code of its own', () => {
    const byClass = new Map(
      EVERY.map(([error, code]) => [error.constructor.name, code]),
    );
    expect(new Set(byClass.values()).size).toBe(byClass.size);
  });

  it('carries the range a figure missed, for the page to word', () => {
    expect(new StreakGraceOutOfRangeError(22, 0, 21).params).toEqual({
      field: 'graceDays',
      value: 22,
      min: 0,
      max: 21,
    });
    expect(new StreakClampInvertedError(71, 70).params).toEqual({
      field: 'interval.minDays',
      value: 71,
      minDays: 71,
      maxDays: 70,
    });
    expect(
      new StreakUnknownOptionError('interval.kind', 'calendar', [
        'fixed',
        'personal',
      ]).params,
    ).toEqual({
      field: 'interval.kind',
      value: 'calendar',
      options: ['fixed', 'personal'],
    });
  });

  it('words what was handed in, whatever it was', () => {
    expect(new StreakEffectiveDayInvalidError('soon').message).toContain(
      '"soon"',
    );
    expect(new StreakVersionNotPositiveError(undefined).message).toContain(
      'undefined',
    );
    expect(new StreakGraceOutOfRangeError(2.5, 0, 21).message).toContain('2.5');
  });
});
