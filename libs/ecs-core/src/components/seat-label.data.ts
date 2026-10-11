import type { Brand } from '../primitives/brand';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';

/**
 * A short, NON-PII display label for a seat whose subject has no account —
 * `'Walk-in 14:30'`, `'Friend 1'`. Trimmed, never blank, at most
 * {@link SeatLabel.MAX_LENGTH} characters (`seat-label.ts:8-16`). A brand over
 * the plain stored string (`seats[].guestLabel`), so a guest's label is
 * both their identity on the wire and what the receipt prints.
 */
export type SeatLabel = Brand<string, 'SeatLabel'>;

export const SeatLabel = {
  MAX_LENGTH: 60,

  /** The only cast site — for a label already canonical (read back from a document). */
  of: (raw: string): SeatLabel => raw as SeatLabel,

  /** The edge guard: trimmed, non-blank, within the ceiling. */
  parse(raw: string): Result<SeatLabel, SchedulingError> {
    const trimmed = raw.trim();
    if (trimmed.length === 0)
      return Result.err(SchedulingError.seatLabelEmpty());
    if (trimmed.length > SeatLabel.MAX_LENGTH) {
      return Result.err(SchedulingError.seatLabelTooLong(SeatLabel.MAX_LENGTH));
    }
    return Result.ok(SeatLabel.of(trimmed));
  },

  /** Canonical (trimmed) form makes equality plain string equality — case kept. */
  equals(a: SeatLabel, b: SeatLabel): boolean {
    return a === b;
  },
} as const;
