/**
 * What a barber record is to the person looking at its page (staff
 * permissions P9, "The owner as a barber") — the ONLY source of these
 * strings, named after the field that carries one (`recordClaim`).
 */
export const RecordClaim = {
  /** The viewer's own account is linked to the record: «Не съм аз» is offered. */
  Mine: 'MINE',
  /** Nobody is linked, and the viewer may take it: «Това съм аз» is offered. */
  Open: 'OPEN',
  /** Neither: someone else's record, a leaver's, or a viewer who assigns no roles. */
  None: 'NONE',
} as const;
export type RecordClaim = (typeof RecordClaim)[keyof typeof RecordClaim];
