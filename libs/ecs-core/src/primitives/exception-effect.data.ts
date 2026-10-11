/**
 * What a schedule exception does to a day — the ONLY source of these
 * strings, named after the field it types (`exceptionEffect`, N15; the union
 * takes the name {@link ExceptionEffectRule}).
 */
export const ExceptionEffect = {
  /** Unavailable all day — every whole-day reason collapses here. */
  Closed: 'CLOSED',
  /** Works different hours that day — the ranges REPLACE the roster. */
  Hours: 'HOURS',
  /** Works the roster minus these ranges. */
  Blocked: 'BLOCKED',
} as const;
export type ExceptionEffect =
  (typeof ExceptionEffect)[keyof typeof ExceptionEffect];
