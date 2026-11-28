import { type CallableName, Callables } from '@core/ports';

/**
 * Whether a callable answers a SUPPORT READ-AS (OR-24,
 * docs/designs/support-read-as.md) — the ONLY source of these strings.
 * The functions' alone: only the callable edge reads it, so it never rides
 * the shared callable registry into the web's bundle.
 */
export const ReadAsAccess = {
  /** A read, or the session's own end — answered as it is to anyone else. */
  Open: 'OPEN',
  /** A write, or one of the owner's privacy acts — refused under every read-as. */
  Closed: 'CLOSED',
} as const;
export type ReadAsAccess = (typeof ReadAsAccess)[keyof typeof ReadAsAccess];

/**
 * Which callables a support read-as may call — the ONE table the callable
 * edge reads: under a live read-as token a `CLOSED` callable is refused
 * before its handler runs (`GOVERNANCE_IMPERSONATION_READ_ONLY`). `OPEN`:
 * the two reads (`staffAnalytics`, `listTeam`), the session's own end
 * (`endImpersonation`, which admits a read-as only for its own session)
 * and the client issue sink (no uid, no line of ours — OR-34). Everything
 * else writes, or is one of the owner's privacy acts the walls keep from
 * support (`exportClientData`, `previewClientErasure`, owner ruling
 * 2026-11-24). Total over {@link CallableName} by its mapped type, so a new
 * callable does not compile until someone decides.
 */
export const CALLABLE_READ_AS_ACCESS: {
  readonly [N in CallableName]: ReadAsAccess;
} = {
  [Callables.RequestOtpChallenge]: ReadAsAccess.Closed,
  [Callables.VerifyOtpChallenge]: ReadAsAccess.Closed,
  [Callables.CompleteRegistration]: ReadAsAccess.Closed,
  [Callables.UpdateProfile]: ReadAsAccess.Closed,
  [Callables.CommitBooking]: ReadAsAccess.Closed,
  [Callables.CancelAppointment]: ReadAsAccess.Closed,
  [Callables.RescheduleAppointment]: ReadAsAccess.Closed,
  [Callables.TransitionAppointment]: ReadAsAccess.Closed,
  [Callables.MarkArrived]: ReadAsAccess.Closed,
  [Callables.ClearArrival]: ReadAsAccess.Closed,
  [Callables.RecordSeatTip]: ReadAsAccess.Closed,
  [Callables.StaffEditAppointment]: ReadAsAccess.Closed,
  [Callables.RequestWaitlist]: ReadAsAccess.Closed,
  [Callables.CancelWaitlist]: ReadAsAccess.Closed,
  [Callables.RunBackfill]: ReadAsAccess.Closed,
  [Callables.PublishStreakDefinition]: ReadAsAccess.Closed,
  [Callables.StartImpersonation]: ReadAsAccess.Closed,
  [Callables.EndImpersonation]: ReadAsAccess.Open,
  [Callables.RedeemInvitation]: ReadAsAccess.Closed,
  [Callables.ReportClientIssues]: ReadAsAccess.Open,
  [Callables.ExportClientData]: ReadAsAccess.Closed,
  [Callables.PreviewClientErasure]: ReadAsAccess.Closed,
  [Callables.EraseClient]: ReadAsAccess.Closed,
  [Callables.SetRoles]: ReadAsAccess.Closed,
  [Callables.AmendRosterBreaks]: ReadAsAccess.Closed,
  [Callables.SetRosterWeek]: ReadAsAccess.Closed,
  [Callables.StaffAnalytics]: ReadAsAccess.Open,
  [Callables.SetAnalyticsGoal]: ReadAsAccess.Closed,
  [Callables.AddBarber]: ReadAsAccess.Closed,
  [Callables.EditBarber]: ReadAsAccess.Closed,
  [Callables.ActivateBarber]: ReadAsAccess.Closed,
  [Callables.DeleteDraftBarber]: ReadAsAccess.Closed,
  [Callables.SetBarberPhoto]: ReadAsAccess.Closed,
  [Callables.SetBarberOfferings]: ReadAsAccess.Closed,
  [Callables.SetDayExceptions]: ReadAsAccess.Closed,
  [Callables.ListTeam]: ReadAsAccess.Open,
  [Callables.SetStaffPermissions]: ReadAsAccess.Closed,
  [Callables.AddProgramImage]: ReadAsAccess.Closed,
};
