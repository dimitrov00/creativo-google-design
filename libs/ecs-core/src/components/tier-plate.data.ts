/**
 * The hero's tier plate and the ring round the face (the client card's
 * head, A2/A3) — the ONLY source of these strings (Law 1, Law 6.2), the
 * field `tierPlateState: TierPlateState` of `TierSystem.plate`'s answer:
 * the account stands on the LAST step of the track (`TOP`, the ring full);
 * on a tier no next step climbs from — an override held above what the
 * visits reached (`HELD_ABOVE`, the plate alone, nothing promised); or on
 * the way to the next tier (`CLIMBING`, the ring from the tier's own
 * threshold to the next one's).
 */
export const TierPlateState = {
  Top: 'TOP',
  HeldAbove: 'HELD_ABOVE',
  Climbing: 'CLIMBING',
} as const;
export type TierPlateState =
  (typeof TierPlateState)[keyof typeof TierPlateState];
