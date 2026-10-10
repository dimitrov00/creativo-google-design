import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  DayKey,
  DayWindows as DayWindowsData,
  FlexibleWhen as WhenData,
  MinuteRange,
} from '@creativo/ecs-core';
import { CalendarDay } from './calendar-day';
import {
  DayWindows,
  type DayWindowsError,
  type DayWindowsProps,
} from './day-windows';
import {
  FlexibleWhenFullError,
  type FlexibleWhenError,
} from './flexible-when.errors';

/*
 * THIN SHIM (ECS migration Phase 2). The declaration's rules — one entry per
 * day, chronological, a re-selected day keeps its windows, the day cap,
 * windows only for a selected day — are the ECS `FlexibleWhen` component.
 * This class keeps the legacy API and the legacy `DayWindows` objects its
 * callers read, and only converts.
 */

export interface FlexibleWhenProps {
  readonly days: readonly DayWindowsProps[];
}

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toDayData(day: DayWindows): DayWindowsData {
  return DayWindowsData.of(
    DayKey.of(day.dayKey),
    day.windows.map((range) =>
      MinuteRange.of(
        range.start.minutesFromMidnight(),
        range.end.minutesFromMidnight(),
      ),
    ),
  );
}

/**
 * WHEN a client can come, said flexibly: a set of days, each optionally
 * narrowed to spans within it — the input to the flexible search and to a
 * waitlist request. Days are keyed by their own date and always listed
 * chronologically. Delegates to the ECS `FlexibleWhen` component.
 */
export class FlexibleWhen {
  private constructor(
    private readonly data: WhenData,
    private readonly byDayKey: ReadonlyMap<string, DayWindows>,
  ) {}

  static empty(): FlexibleWhen {
    return new FlexibleWhen(WhenData.empty(), new Map());
  }

  static of(days: readonly DayWindows[]): FlexibleWhen {
    return new FlexibleWhen(
      WhenData.of(days.map(toDayData)),
      new Map(days.map((day) => [day.dayKey, day])),
    );
  }

  static create(
    props: FlexibleWhenProps,
    zone: string,
  ): Result<FlexibleWhen, DayWindowsError> {
    const days: DayWindows[] = [];
    for (const raw of props.days) {
      const day = DayWindows.create(raw, zone);
      if (day.isFailure()) return fail(day.error);
      days.push(day.value);
    }
    return ok(FlexibleWhen.of(days));
  }

  /** Chronological, always — never tap order. */
  get days(): readonly DayWindows[] {
    return this.data.days.map(
      (day) => this.byDayKey.get(day.dayKey) as DayWindows,
    );
  }

  get dayCount(): number {
    return this.data.days.length;
  }

  isEmpty(): boolean {
    return WhenData.isEmpty(this.data);
  }

  has(day: CalendarDay): boolean {
    return WhenData.has(this.data, DayKey.of(day.key()));
  }

  for(day: CalendarDay): DayWindows | null {
    return this.has(day) ? (this.byDayKey.get(day.key()) ?? null) : null;
  }

  /** Select a day, as "any time"; re-selecting a held day is a no-op, past `maxDays` a refusal. */
  withDay(
    day: CalendarDay,
    maxDays: number,
  ): Result<FlexibleWhen, FlexibleWhenError> {
    const next = WhenData.withDay(this.data, DayKey.of(day.key()), maxDays);
    if (!next.ok) return fail(new FlexibleWhenFullError(maxDays));
    if (next.value === this.data) return ok(this);
    const byDayKey = new Map(this.byDayKey);
    byDayKey.set(day.key(), DayWindows.of(day));
    return ok(new FlexibleWhen(next.value, byDayKey));
  }

  /** Deselect a day — its windows leave with it, which is the point. */
  withoutDay(day: CalendarDay): FlexibleWhen {
    const next = WhenData.withoutDay(this.data, DayKey.of(day.key()));
    if (next === this.data) return this;
    const byDayKey = new Map(this.byDayKey);
    byDayKey.delete(day.key());
    return new FlexibleWhen(next, byDayKey);
  }

  /** Replace one SELECTED day's windows; an unselected day is ignored. */
  withWindows(dayWindows: DayWindows): FlexibleWhen {
    const next = WhenData.withWindows(this.data, toDayData(dayWindows));
    if (next === this.data) return this;
    const byDayKey = new Map(this.byDayKey);
    byDayKey.set(dayWindows.dayKey, dayWindows);
    return new FlexibleWhen(next, byDayKey);
  }

  toProps(): FlexibleWhenProps {
    return { days: this.days.map((day) => day.toProps()) };
  }
}
