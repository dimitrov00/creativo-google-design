/**
 * The arrival callable's verb — the field `markArrivalAction`, the ONLY
 * source of these strings (moved out of `mark-arrival.pipeline.ts`, values
 * unchanged, so no tag dictionary lives in the pipelines tier): the party
 * walked in, or the stamp is taken back. (Split out of `staff-verb.data.ts`,
 * pass D, L-1.)
 */
export const MarkArrivalAction = {
  Arrive: 'ARRIVE',
  Clear: 'CLEAR',
} as const;
export type MarkArrivalAction =
  (typeof MarkArrivalAction)[keyof typeof MarkArrivalAction];
