/**
 * What a staff account's page on the Team screen is to the person looking
 * at it (team onboarding D8) — the ONLY source of these strings, named
 * after the field that carries one (`accountStanding`).
 */
export const AccountStanding = {
  /** The account's roles are the viewer's to change. */
  Editable: 'EDITABLE',
  /** The viewer's own account: its roles are not changed from this page. */
  Own: 'OWN',
  /** The vendor's support account (`sysadmin`): nobody at the shop changes it. */
  Vendor: 'VENDOR',
  /** The person has not finished registering: `setRoles` takes no such account. */
  Unregistered: 'UNREGISTERED',
  /** The viewer does not assign roles: the account is read. */
  ReadOnly: 'READ_ONLY',
} as const;
export type AccountStanding =
  (typeof AccountStanding)[keyof typeof AccountStanding];
