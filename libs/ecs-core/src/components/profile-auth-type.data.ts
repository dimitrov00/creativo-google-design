/**
 * The Firestore trigger's `authType` — who the platform says wrote a
 * document (`audit-profile-changes.ts`). The ONLY source of these tags; the
 * platform delivers them lower-case (`service_account`), and
 * `AuditSystem.profileWriter` reads either spelling. Any other value is a
 * writer the event cannot attribute.
 */
export const ProfileAuthType = {
  ServiceAccount: 'SERVICE_ACCOUNT',
  System: 'SYSTEM',
  ApiKey: 'API_KEY',
  Unauthenticated: 'UNAUTHENTICATED',
} as const;
export type ProfileAuthType =
  (typeof ProfileAuthType)[keyof typeof ProfileAuthType];
