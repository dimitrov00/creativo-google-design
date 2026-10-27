import { RegistrationField } from './registration.data';

/**
 * The `users/{uid}` fields whose change is worth a profile row — the
 * plain tag list `profileFields` of a `PROFILE_*` row (audit-hardening WS-3,
 * RU-16): {@link RegistrationField}'s five names, then `roles` and
 * `accountStatus`, which no writer audits on its own (`completeRegistration`
 * sets the roles, nothing sets the status, the Admin SDK and the console
 * can change either). The values ARE document field names (the
 * `RegistrationField` precedent, flatten-spec §3.7), so they are exempt
 * from the SCREAMING sweep; the five registration names are spread from
 * their own dictionary, never restated.
 */
export const AuditedProfileField = {
  ...RegistrationField,
  Roles: 'roles',
  AccountStatus: 'accountStatus',
} as const;
export type AuditedProfileField =
  (typeof AuditedProfileField)[keyof typeof AuditedProfileField];
