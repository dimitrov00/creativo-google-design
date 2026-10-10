import type { MinuteRange } from './minute-range.data';

/** The parts of the day, in the day's order — the tag source of {@link Daypart}. */
const DAYPART = {
  Morning: 'morning',
  Afternoon: 'afternoon',
  Evening: 'evening',
} as const;

/**
 * A part of the day, the way people say it: «сутрин», «следобед», «вечер»
 * (`daypart.ts`). ONE rule for the whole product (lead ruling LR5,
 * 2026-09-28): the booking time sheet heads its starts with these parts and a
 * waiting request's row names the parts its windows ask for, so a client who
 * picked a time under «следобед» reads «следобед» back. A claim about the
 * clock in the shop — minutes of the day — never about UTC.
 */
export type Daypart = (typeof DAYPART)[keyof typeof DAYPART];

/** Before 12:00 is the morning — so 12:00 sharp is already the afternoon. */
const AFTERNOON_STARTS = 12 * 60;
/** Before 17:00 is the afternoon — so 17:00 sharp is the evening. */
const EVENING_STARTS = 17 * 60;
const MIDNIGHT = 24 * 60;

/** Each part as the half-open span `[from, to)` of minutes from midnight. */
const SPANS: readonly {
  readonly part: Daypart;
  readonly from: number;
  readonly to: number;
}[] = [
  { part: DAYPART.Morning, from: 0, to: AFTERNOON_STARTS },
  { part: DAYPART.Afternoon, from: AFTERNOON_STARTS, to: EVENING_STARTS },
  { part: DAYPART.Evening, from: EVENING_STARTS, to: MIDNIGHT },
];

export const Daypart = {
  ...DAYPART,

  /** The boundary minutes, exposed for the time sheet's grouping. */
  AFTERNOON_STARTS,
  EVENING_STARTS,

  /** In the day's order — the order the time sheet heads its runs in. */
  ALL: [
    DAYPART.Morning,
    DAYPART.Afternoon,
    DAYPART.Evening,
  ] as readonly Daypart[],

  /** The part of the day a wall-clock minute (`0…1439`) falls in. */
  of(minuteOfDay: number): Daypart {
    if (minuteOfDay < AFTERNOON_STARTS) return DAYPART.Morning;
    if (minuteOfDay < EVENING_STARTS) return DAYPART.Afternoon;
    return DAYPART.Evening;
  },

  /**
   * The parts the spans touch, in the day's order, each once. Half-open like
   * the spans: `09:00–12:00` is the morning alone, `11:30–12:30` touches the
   * morning and the afternoon. No spans, no parts — a caller whose empty list
   * means "any time that day" says so itself (`DayWindows.isWholeDay`).
   */
  touchedBy(ranges: readonly MinuteRange[]): readonly Daypart[] {
    const parts: Daypart[] = [];
    for (let p = 0; p < SPANS.length; p++) {
      const span = SPANS[p] as (typeof SPANS)[number];
      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i] as MinuteRange;
        if (range.startMinutes < span.to && range.endMinutes > span.from) {
          parts.push(span.part);
          break;
        }
      }
    }
    return parts;
  },
} as const;
