/**
 * What became of one seat — the field `attendanceState` (Law 6.2, the
 * owner's example name for this state machine), the ONLY source of these
 * strings (`WORKED`, not `COMPLETED`). The legacy stored tags were the
 * lower-case forms (`scheduled`, `worked`, `no_show`, `cancelled`), which
 * the legacy shims mapped until the appointment flip.
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
