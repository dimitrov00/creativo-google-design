/** A detail page's progress card — `medalProgressCard`. */
export const MedalProgressCard = {
  /** A single act: its day once done, «0 от 1» until then. */
  OneOff: 'ONE_OFF',
  /** A ladder climbed to its top: its last threshold. */
  Complete: 'COMPLETE',
  /** A family that can no longer move: where it stopped. */
  Stopped: 'STOPPED',
  /** Towards the next level: the figure, its threshold, what is left. */
  ToNext: 'TO_NEXT',
} as const;
export type MedalProgressCard =
  (typeof MedalProgressCard)[keyof typeof MedalProgressCard];
