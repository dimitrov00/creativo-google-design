/** A genuinely closed enum — no value-object wrapper needed. */
export type Role = 'client' | 'owner' | 'performer' | 'admin';

export const ROLES: readonly Role[] = ['client', 'owner', 'performer', 'admin'];

export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (ROLES as readonly string[]).includes(value)
  );
}
