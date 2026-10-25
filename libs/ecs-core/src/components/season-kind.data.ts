/** A season has a track (the family its gauge draws); an event is a short window without one — the field `seasonKind`. */
export const SeasonKind = {
  Season: 'SEASON',
  Event: 'EVENT',
} as const;
export type SeasonKind = (typeof SeasonKind)[keyof typeof SeasonKind];
