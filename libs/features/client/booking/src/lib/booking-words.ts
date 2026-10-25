import { BookingFlowStep, SeatArrangement } from '@core/components';
import { MoveErrorCode, type MoveRefusal } from '@core/errors';

/*
 * THE LOWERCASE WORDS THE BOOKING FLOW SHOWS THE OUTSIDE (Phase 4a 4A-10).
 *
 * The flow decides on SCREAMING dictionaries (`bookingFlowStep`, a move
 * refusal's `errorCode`); the URL (`?step=`), the DOM (`data-state`,
 * `data-reason`) and the i18n keys (`booking.moveRefused.<word>.…`) keep the
 * lowercase spelling deep links, the e2e suite and the catalogue have always
 * read. ONE table per dictionary, `satisfies` its whole dictionary, and never
 * a bare lowercase literal compared at a use site (Law 1).
 */

/** `?step=` and the shell's `data-state` — one word per wizard step. */
export const BOOKING_STEP_WORDS = {
  [BookingFlowStep.Location]: 'location',
  [BookingFlowStep.Services]: 'services',
  [BookingFlowStep.Schedule]: 'schedule',
  [BookingFlowStep.Review]: 'review',
  [BookingFlowStep.Confirmed]: 'confirmed',
  [BookingFlowStep.Waitlisted]: 'waitlisted',
} as const satisfies Record<BookingFlowStep, string>;

const STEP_BY_WORD: ReadonlyMap<string, BookingFlowStep> = new Map(
  Object.values(BookingFlowStep).map((step) => [
    // eslint-disable-next-line security/detect-object-injection -- `step` is a member of the closed dictionary the table is total over.
    BOOKING_STEP_WORDS[step],
    step,
  ]),
);

/**
 * The step a `?step=` word names, or `null` for a word that names none — a
 * hand-typed or stale param is no step at all, never a guess.
 */
export function bookingStepOfWord(
  word: string | null | undefined,
): BookingFlowStep | null {
  return word === null || word === undefined
    ? null
    : (STEP_BY_WORD.get(word) ?? null);
}

/**
 * Why a move link did not become a move, as the refusal panel's i18n keys
 * (`booking.moveRefused.<word>.title|body`) and its `data-reason` spell it.
 */
export const MOVE_REFUSAL_WORDS = {
  [MoveErrorCode.CompanionsOnly]: 'companions_only',
  [MoveErrorCode.Unavailable]: 'unavailable',
  [MoveErrorCode.CarriedOutOfReach]: 'carried_out_of_reach',
} as const satisfies Record<MoveRefusal['errorCode'], string>;

/**
 * How the picked arrangement seats the party
 * (`BookingCartSystem.arrangementOf`), as the time sheet's heading key
 * (`booking.schedule.arrangement.<word>`) spells it.
 */
export const SEAT_ARRANGEMENT_WORDS = {
  [SeatArrangement.Parallel]: 'parallel',
  [SeatArrangement.Sequential]: 'sequential',
} as const satisfies Record<SeatArrangement, string>;
