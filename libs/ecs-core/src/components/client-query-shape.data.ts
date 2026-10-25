/**
 * Which part of a typed client query leads the lookup — the field
 * `clientQueryShape` (N15), the ONLY source of these strings (moved from
 * `client-query.system.ts`, values unchanged).
 */
export const ClientQueryShape = {
  Empty: 'EMPTY',
  Name: 'NAME',
  Phone: 'PHONE',
  Email: 'EMAIL',
} as const;
export type ClientQueryShape =
  (typeof ClientQueryShape)[keyof typeof ClientQueryShape];
