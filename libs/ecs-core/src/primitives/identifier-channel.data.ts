/**
 * The two channels a person can be reached at — the ONLY source of these
 * strings, the discriminator `identifierChannel` of {@link ParsedIdentifier}.
 */
export const IdentifierChannel = {
  Phone: 'PHONE',
  Email: 'EMAIL',
} as const;
export type IdentifierChannel =
  (typeof IdentifierChannel)[keyof typeof IdentifierChannel];
