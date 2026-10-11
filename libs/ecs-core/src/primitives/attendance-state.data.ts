/**
 * What became of one seat — the field `attendanceState` (Law 6.2, the
 * owner's example name for this state machine), the ONLY source of these
 * strings (`WORKED`, not `COMPLETED`). The stored legacy tags are the
 * lower-case forms (`scheduled`, `worked`, `no_show`, `cancelled`); the
 * legacy shims map them until the appointment flip.
 */
export const AttendanceState = {
  /** The state every seat starts in, and the only one that is not final. */
  Scheduled: 'SCHEDULED',
  Worked: 'WORKED',
  NoShow: 'NO_SHOW',
  Cancelled: 'CANCELLED',
} as const;
export type AttendanceState =
  (typeof AttendanceState)[keyof typeof AttendanceState];
