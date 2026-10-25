/*
 * What a visit's applied-operations ledger says about a named intent — the
 * tag of `AppointmentEditSystem.ledgerVerdict`'s answer, read by the staff
 * edit and the client move (one ledger for both kinds of intent). Moved out
 * of `appointment-edit.system.ts` (pass D, E-23): a tag dictionary is a
 * component (D-7); its answer struct stays the system's output.
 */

/** What a ledger says about a named intent — the ONLY source of these strings, the field `ledgerVerdict`. */
export const LedgerVerdict = {
  /** No name, or a name the ledger has not seen: apply it. */
  New: 'NEW',
  /** The ledger applied this name with this digest: answer it, write nothing. */
  Replay: 'REPLAY',
  /** The name is known but the batch differs: a client bug, refused by name. */
  Mismatch: 'MISMATCH',
} as const;
export type LedgerVerdict = (typeof LedgerVerdict)[keyof typeof LedgerVerdict];
