import type { Brand } from '@core/primitives';

/**
 * The raw value of a reachable channel — a canonical E.164 number or a
 * canonical e-mail address — as a brand over the plain string. This is what
 * is **stored** (`otps.destination`, a scalar, so index #10 and the open
 * window probe keep working; blueprint §2.6). The
 * `{ identifierChannel, identifier }` {@link ParsedIdentifier} is the
 * in-memory result of the edge parse and is never stored: the OTP keeps
 * its `otpDestinationType` beside the raw `destination`.
 */
export type Identifier = Brand<string, 'Identifier'>;

export const Identifier = {
  /** The only cast site — for a value already canonical (read back from a document). */
  of: (raw: string): Identifier => raw as Identifier,
} as const;
