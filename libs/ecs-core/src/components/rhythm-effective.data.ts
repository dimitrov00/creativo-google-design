/**
 * Which of the admin's three «От» choices a rule's effective day is — the
 * field `rhythmEffectiveChoice` (Law 6), `RhythmDraftSystem.effectiveChoiceOf`'s
 * answer (Law 10.2: the page words it, never decides it). `TOMORROW` wins
 * a tie: on the last day of a month tomorrow IS the first of the next.
 */
export const RhythmEffectiveChoice = {
  /** «От утре». */
  Tomorrow: 'TOMORROW',
  /** «От 1-во число» — the first of the coming month. */
  FirstOfMonth: 'FIRST_OF_MONTH',
  /** Any other day the admin picked. */
  Picked: 'PICKED',
} as const;
export type RhythmEffectiveChoice =
  (typeof RhythmEffectiveChoice)[keyof typeof RhythmEffectiveChoice];
