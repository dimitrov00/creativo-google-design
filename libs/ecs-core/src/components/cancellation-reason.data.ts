/**
 * Why a seat was called off — a CLOSED vocabulary, because prose cannot be
 * aggregated. `CLIENT_*` and `STAFF_*` must never share a bucket (a reminder
 * problem vs a rostering problem). Code-only (§9 D23): free text a staff
 * member types is an appointment note, never a reason. The field
 * `cancellationReason` of a cancelled seat (`SeatOutcome.Cancelled`) and the
 * code a `CancellationReasonSet` joins (its own file since pass D, L-1: the
 * dictionary both read, so neither imports the other's file at runtime).
 */
export const CancellationReason = {
  ClientChangedPlans: 'CLIENT_CHANGED_PLANS',
  ClientUnwell: 'CLIENT_UNWELL',
  StaffBarberAbsence: 'STAFF_BARBER_ABSENCE',
  StaffShopClosure: 'STAFF_SHOP_CLOSURE',
  /** A no-show the shop later reclassified — stamped, never picked. */
  NoShowConverted: 'NO_SHOW_CONVERTED',
  /** Nobody said why — what picking nothing is filed as, its own countable bucket. */
  Unspecified: 'UNSPECIFIED',
  /** A reason outside the list. */
  Other: 'OTHER',
} as const;
export type CancellationReason =
  (typeof CancellationReason)[keyof typeof CancellationReason];
