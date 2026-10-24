/*
 * Which write woke the capacity rebuild (`rebuild-capacity.pipeline.ts`,
 * the triggers' wire). A tag dictionary is a component (D-7; moved out of
 * the pipelines tier in pass C, §5 item 1).
 */

/** Which write woke the rebuild — the ONLY source of these strings, the field `capacityTrigger`. */
export const CapacityTrigger = {
  /** A busy day or an exception: one (barber, day). */
  Day: 'DAY',
  /** A roster: one barber's horizon. */
  Roster: 'ROSTER',
  /** A shop, the policy or the daily sweep: every rostered barber's horizon. */
  Sweep: 'SWEEP',
} as const;
export type CapacityTrigger =
  (typeof CapacityTrigger)[keyof typeof CapacityTrigger];
