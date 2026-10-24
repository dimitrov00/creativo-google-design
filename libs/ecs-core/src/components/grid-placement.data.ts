/**
 * Why a drafted interval cannot stand as drawn — the field
 * `placementVerdict`, the ONLY source of these strings
 * (`GridLayoutSystem.placementVerdict`'s answer; moved from the staff grid's
 * `time-grid/grid-gesture.ts`, values unchanged — the grid re-exports it).
 * Shared by the time grid's frame and the chair timeline: a tag, never a
 * word — the frame's readout words it, and its tone reads it.
 */
export const PlacementVerdict = {
  /** The span is at or under the duration floor. */
  Short: 'SHORT',
  /** Another booking holds the chair for part of the span. */
  Overlap: 'OVERLAP',
  /** Some chosen chair is shut for part of the span — past the shift. */
  Outside: 'OUTSIDE',
} as const;
export type PlacementVerdict =
  (typeof PlacementVerdict)[keyof typeof PlacementVerdict];
