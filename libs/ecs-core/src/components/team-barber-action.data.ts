import type { AuditAction } from './audit-context.data';

/**
 * The seven verbs of a team callable's write of a barber record (team
 * onboarding D12). A verb subset of the {@link AuditAction} dictionary,
 * read from it member by member (the `ProfileAction` precedent: its own
 * file, it has readers outside `audit-context.data.ts`).
 */
export type TeamBarberAction =
  | typeof AuditAction.TeamBarberAdded
  | typeof AuditAction.TeamBarberProfileChanged
  | typeof AuditAction.TeamBarberShopsChanged
  | typeof AuditAction.TeamBarberPeriodChanged
  | typeof AuditAction.TeamBarberPoolChanged
  | typeof AuditAction.TeamBarberStatusChanged
  | typeof AuditAction.TeamBarberDeleted;
