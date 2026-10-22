import { BookingFlowStep, MoveRefusalReason } from '@core/components';

/*
 * THE LOWERCASE WORDS THE BOOKING FLOW SHOWS THE OUTSIDE (Phase 4a 4A-10).
 *
 * The flow decides on SCREAMING dictionaries (`bookingFlowStep`,
 * `moveRefusalReason`); the URL (`?step=`), the DOM (`data-state`,
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

/** One step's word — the URL's and the DOM's spelling of it. */
export type BookingStepWord =
  (typeof BOOKING_STEP_WORDS)[keyof typeof BOOKING_STEP_WORDS];

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
  [MoveRefusalReason.CompanionsOnly]: 'companions_only',
  [MoveRefusalReason.Unavailable]: 'unavailable',
  [MoveRefusalReason.CarriedOutOfReach]: 'carried_out_of_reach',
} as const satisfies Record<MoveRefusalReason, string>;
