/** A window on a day: announced — shown «от 1.11», no progress yet; open; ended — archived. */
export const SeasonPhase = {
  Announced: 'ANNOUNCED',
  Open: 'OPEN',
  Ended: 'ENDED',
} as const;
export type SeasonPhase = (typeof SeasonPhase)[keyof typeof SeasonPhase];
