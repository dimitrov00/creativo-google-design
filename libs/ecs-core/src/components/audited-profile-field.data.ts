import { RegistrationField } from './registration.data';

/**
 * The `users/{uid}` fields whose change is worth a profile row — the
 * plain tag list `profileFields` of a `PROFILE_*` row (audit-hardening WS-3,
 * RU-16): {@link RegistrationField}'s five names, then `roles` and
 * `accountStatus`, which no writer audits on its own (`completeRegistration`
 * sets the roles, nothing sets the status, the Admin SDK and the console
 * can change either), then the block's own `blockReason` and
 * `blockedUntilUtcMs` (next pass, 2026-11-03 — the WS-3 inventory's R11): a
 * block extended or re-reasoned without its status changing is still a
 * change of who may sign in; then `linkedBarberId` (staff analytics): which
 * barber record the account is, whose change `setRoles` audits itself and
 * an Admin SDK or seed write leaves to the trigger. The values ARE document field names (the
 * `RegistrationField` precedent, flatten-spec §3.7), so they are exempt
 * from the SCREAMING sweep; the five registration names are spread from
 * their own dictionary, never restated.
 */
export const AuditedProfileField = {
  ...RegistrationField,
  Roles: 'roles',
  AccountStatus: 'accountStatus',
  BlockReason: 'blockReason',
  BlockedUntilUtcMs: 'blockedUntilUtcMs',
  LinkedBarberId: 'linkedBarberId',
} as const;
export type AuditedProfileField =
  (typeof AuditedProfileField)[keyof typeof AuditedProfileField];
