import {
  BarberId,
  type ClientOperationId,
  type LocalDate,
  type LocationId,
  Result,
  type Weekday,
} from '@core/primitives';
import type { PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import type { MinuteRange } from './minute-range.data';
import type { RosterBreak } from './roster-break.data';
import type { ShiftSegment } from './shift-segment.data';

/**
 * THE ROSTER WIRE — `amendRosterBreaks` (owner, 2026-11-06): a chair's
 * standing breaks changed «from this day on», as ONE roster write. On each
 * of `weekdays` the break `before` (`null` adds one) becomes `after`
 * (`null` removes it), from `fromLocalDate` — a day of the shop
 * `locationId`, whose clock says what «today» is. The roster has no client
 * writer (rules, pass E DEP-6): this callable is its one door from the desk.
 */
export type RosterCall = {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly fromLocalDate: LocalDate;
  readonly weekdays: readonly Weekday[];
  readonly before: MinuteRange | null;
  readonly after: MinuteRange | null;
  /** The act's name — the web mints one per change (WS-4.1). */
  readonly operationId: ClientOperationId;
};

export const RosterCall = {
  /** `amendRosterBreaks`' answer: the chair whose roster changed, or nothing usable. */
  decodeAmended(raw: unknown): Result<RosterCall.Amended, PipelineError> {
    const answer = CallAnswer.read(raw);
    const barberId =
      answer === null
        ? null
        : CallAnswer.parsed(answer, 'barberId', BarberId.parse);
    return barberId === null ? CallAnswer.unusable() : Result.ok({ barberId });
  },
} as const;

export namespace RosterCall {
  /** The chair whose roster now carries the change. */
  export type Amended = { readonly barberId: BarberId };
  /**
   * `setRosterWeek` — the hours editor's save: the chair's whole week, its
   * shifts and the breaks inside them, standing from `fromLocalDate` on (a
   * day of the shop `locationId`, whose clock says what «today» is).
   */
  export type Week = {
    readonly barberId: BarberId;
    readonly locationId: LocationId;
    readonly fromLocalDate: LocalDate;
    readonly segments: readonly ShiftSegment[];
    readonly breaks: readonly RosterBreak[];
    /** The act's name — the web mints one per save (WS-4.1). */
    readonly operationId: ClientOperationId;
  };
}
