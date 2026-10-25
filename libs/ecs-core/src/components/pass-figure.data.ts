/** What the pass's figure counts: the points balance, or — with points off — the visits the tier is judged by. */
export const PassFigure = {
  Points: 'POINTS',
  Visits: 'VISITS',
} as const;
export type PassFigure = (typeof PassFigure)[keyof typeof PassFigure];
