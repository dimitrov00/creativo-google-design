/**
 * A staff-edit batch's word on the bill — the field `billPending`: the
 * stored set kept, or a named one. The ONLY source of these strings (moved
 * from `billing.system.ts`, values unchanged; the `PendingDiscounts` /
 * `PendingVouchers` unions it types stay system I/O).
 */
export const BillPending = {
  /** The batch never mentioned it: the stored value is carried forward. */
  Keep: 'KEEP',
  /** The batch named the whole set. */
  Set: 'SET',
} as const;
export type BillPending = (typeof BillPending)[keyof typeof BillPending];
