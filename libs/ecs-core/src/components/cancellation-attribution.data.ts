/*
 * Who a cancellation is on, when an outcome correction said so — the
 * attribution `ClientStatsSystem` counts a late cancel by. A tag dictionary
 * is a component (D-7); moved out of `client-stats.system.ts` (pass D,
 * S-21), values unchanged.
 */

/**
 * Who a cancellation is on, when an outcome correction said so (P4, R49) —
 * the ONLY source of these strings.
 */
export const CancellationAttribution = {
  Client: 'CLIENT',
  Shop: 'SHOP',
} as const;
export type CancellationAttribution =
  (typeof CancellationAttribution)[keyof typeof CancellationAttribution];
