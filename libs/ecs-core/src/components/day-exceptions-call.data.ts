import {
  BarberId,
  type ClientOperationId,
  type LocalDate,
  type LocationId,
  Result,
  StoredFields,
} from '@core/primitives';
import type { PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import type { MinuteRange } from './minute-range.data';

/**
 * What a `setDayExceptions` call does to a barber's days — the ONLY source
 * of these strings, the field `dayExceptionsEdit`. The staff schedule's
 * four pens, one callable.
 */
export const DayExceptionsEdit = {
  /** Stand days down whole (no range), or block ranges inside them — one day or a series. */
  Block: 'BLOCK',
  /** Lift one block from a day, or the whole day's changes. */
  Clear: 'CLEAR',
  /** An edited block: its old range lifted and its new days written, as one act. */
  Move: 'MOVE',
  /** A day's breaks said for that day alone, or handed back to the roster. */
  DayBreaks: 'DAY_BREAKS',
} as const;
export type DayExceptionsEdit =
  (typeof DayExceptionsEdit)[keyof typeof DayExceptionsEdit];

/**
 * The request half of a `setDayExceptions` call — flat variants on
 * `dayExceptionsEdit`. Shop days and wall-clock minutes only: the zone a
 * day's first instant is read in is the shop's, which the server reads.
 */
export type DayExceptionsRequest =
  | DayExceptionsRequest.Block
  | DayExceptionsRequest.Clear
  | DayExceptionsRequest.Move
  | DayExceptionsRequest.DayBreaks;

/** Whether `locationId` is already listed. */
function listed<T>(list: readonly T[], value: T): boolean {
  for (let i = 0; i < list.length; i++) if (list[i] === value) return true;
  return false;
}

export const DayExceptionsRequest = {
  /**
   * Whose days the act touches, and the shop each is filed at — one entry
   * per barber and shop the request names, in order. A lift names no shop
   * (`null`): the day's stored document keeps its own.
   */
  placements(
    request: DayExceptionsRequest,
  ): readonly DayExceptionsRequest.Placement[] {
    switch (request.dayExceptionsEdit) {
      case DayExceptionsEdit.Block:
      case DayExceptionsEdit.DayBreaks:
        return [{ barberId: request.barberId, locationId: request.locationId }];
      case DayExceptionsEdit.Clear:
        return [{ barberId: request.barberId, locationId: null }];
      case DayExceptionsEdit.Move: {
        const placements: DayExceptionsRequest.Placement[] = [
          { barberId: request.liftBarberId, locationId: null },
        ];
        for (let i = 0; i < request.writes.length; i++) {
          const write = request.writes[i] as DayExceptionsRequest.Days;
          placements.push({
            barberId: write.barberId,
            locationId: write.locationId,
          });
        }
        return placements;
      }
    }
  },

  /** The barbers the act touches, each once, in the request's order. */
  barberIds(request: DayExceptionsRequest): readonly BarberId[] {
    const placements = DayExceptionsRequest.placements(request);
    const barberIds: BarberId[] = [];
    for (let i = 0; i < placements.length; i++) {
      const barberId = (placements[i] as DayExceptionsRequest.Placement)
        .barberId;
      if (!listed(barberIds, barberId)) barberIds.push(barberId);
    }
    return barberIds;
  },

  /** The shops the act files days at, each once, in the request's order. */
  locationIds(request: DayExceptionsRequest): readonly LocationId[] {
    const placements = DayExceptionsRequest.placements(request);
    const locationIds: LocationId[] = [];
    for (let i = 0; i < placements.length; i++) {
      const locationId = (placements[i] as DayExceptionsRequest.Placement)
        .locationId;
      if (locationId !== null && !listed(locationIds, locationId)) {
        locationIds.push(locationId);
      }
    }
    return locationIds;
  },
} as const;

export namespace DayExceptionsRequest {
  /** One barber's days at one shop: no `ranges` stands each day down whole. */
  export type Days = {
    readonly barberId: BarberId;
    readonly locationId: LocationId;
    readonly ranges: readonly MinuteRange[];
    readonly localDates: readonly LocalDate[];
  };
  export type Block = Days & {
    readonly dayExceptionsEdit: typeof DayExceptionsEdit.Block;
  };
  export type Clear = {
    readonly dayExceptionsEdit: typeof DayExceptionsEdit.Clear;
    readonly barberId: BarberId;
    readonly localDate: LocalDate;
    /** The block to lift; `null` lifts the whole day's changes. */
    readonly range: MinuteRange | null;
  };
  export type Move = {
    readonly dayExceptionsEdit: typeof DayExceptionsEdit.Move;
    /** The range the block was, on one barber's one day. */
    readonly liftBarberId: BarberId;
    readonly liftLocalDate: LocalDate;
    readonly liftRange: MinuteRange;
    /** Where it now is — one entry per barber. */
    readonly writes: readonly Days[];
  };
  export type DayBreaks = {
    readonly dayExceptionsEdit: typeof DayExceptionsEdit.DayBreaks;
    readonly barberId: BarberId;
    readonly locationId: LocationId;
    readonly localDate: LocalDate;
    /** The day's breaks instead of the roster's (`[]`: none); `null` hands the day back to the roster. */
    readonly ranges: readonly MinuteRange[] | null;
  };
  /** A barber whose days an act touches, and the shop they are filed at (`null`: a lift names none). */
  export type Placement = {
    readonly barberId: BarberId;
    readonly locationId: LocationId | null;
  };
}

/**
 * THE DAY-EXCEPTIONS WIRE (team onboarding D5, O4,
 * `docs/designs/team-onboarding.md`) — `setDayExceptions`: a barber's days
 * off, blocks and one-day breaks, changed as ONE act. `scheduleExceptions`
 * has no client writer: this callable is its one door, so "a barber edits
 * only their own days" can be judged on the caller's stored account.
 */
export type DayExceptionsCall = DayExceptionsRequest & {
  /** The act's name — the web mints one per save (WS-4.1). */
  readonly operationId: ClientOperationId;
};

export const DayExceptionsCall = {
  /** `setDayExceptions`' answer: the barbers whose days the act named, or nothing usable. */
  decodeSaved(raw: unknown): Result<DayExceptionsCall.Saved, PipelineError> {
    const answer = CallAnswer.read(raw);
    const sent =
      answer === null ? undefined : StoredFields.field(answer, 'barberIds');
    if (!Array.isArray(sent) || sent.length === 0) return CallAnswer.unusable();
    const barberIds: BarberId[] = [];
    for (const entry of sent as readonly unknown[]) {
      if (typeof entry !== 'string') return CallAnswer.unusable();
      const parsed = BarberId.parse(entry);
      if (!parsed.ok) return CallAnswer.unusable();
      barberIds.push(parsed.value);
    }
    return Result.ok({ barberIds });
  },
} as const;

export namespace DayExceptionsCall {
  /** The barbers whose days the act named — the schedule's listeners redraw them. */
  export type Saved = { readonly barberIds: readonly BarberId[] };
}
