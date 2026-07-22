import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  SeatLabelEmptyError,
  SeatLabelTooLongError,
  type SeatLabelError,
} from './seat-label.errors';

export const SEAT_LABEL_MAX_LENGTH = 60;

/**
 * A short, NON-PII display label for a seat whose subject has no account
 * yet — `'Walk-in 14:30'`, `'Friend 1'`. Ported from v2's
 * `primitives/SeatLabel.ts` (an `Opaque<string>` there); re-expressed here
 * as a private-ctor VO per this repo's convention (blueprint §2.3).
 */
export class SeatLabel {
  private constructor(private readonly _value: string) {}

  static create(raw: string): Result<SeatLabel, SeatLabelError> {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return fail(new SeatLabelEmptyError());
    }
    if (trimmed.length > SEAT_LABEL_MAX_LENGTH) {
      return fail(new SeatLabelTooLongError(SEAT_LABEL_MAX_LENGTH));
    }
    return ok(new SeatLabel(trimmed));
  }

  get value(): string {
    return this._value;
  }

  equals(other: SeatLabel): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
