/** The one cue of the medal strip — `medalCue`, first match wins. */
export const MedalCue = {
  WithThisVisit: 'WITH_THIS_VISIT',
  New: 'NEW',
  Close: 'CLOSE',
} as const;
export type MedalCue = (typeof MedalCue)[keyof typeof MedalCue];
