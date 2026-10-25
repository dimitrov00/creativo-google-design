/*
 * How one staff edit call ended — `editAppointment`'s answer from its
 * transaction (pass D, D-7.7; was the pipeline-local `EditOutcome`, renamed
 * because `AppointmentEditSystem`'s fold output owns that name — one home
 * tier per name). A tag dictionary is a component (D-7); its values are
 * internal — the call answers `replayed`, never the tag.
 */

/** How a staff edit call ended — the ONLY source of these strings, the field `editCallOutcome`. */
export const EditCallOutcome = {
  /** The batch was applied: the visit written at the next revision. */
  Edited: 'EDITED',
  /** The named intent had already been applied: its original answer, nothing written. */
  Replayed: 'REPLAYED',
  /** An added account has no client record and no contact was read for it yet. */
  NeedsContacts: 'NEEDS_CONTACTS',
} as const;
export type EditCallOutcome =
  (typeof EditCallOutcome)[keyof typeof EditCallOutcome];
