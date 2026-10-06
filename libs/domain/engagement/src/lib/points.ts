import { Result, fail, ok } from '@creativo/domain/kernel';
import { InsufficientPointsError, InvalidPointsError } from './points.errors';

/**
 * Non-negative integer reward points. Ports v2's `primitives/Points.ts`
 * Opaque-type rule into a class + Result factory (this repo's VO
 * template, blueprint §2.3) — `Points` can never go negative.
 *
 * `subtract` REFUSES an over-spend rather than clamping it (T2, R27). A clamp
 * makes the shortfall vanish, and a ledger whose entries no longer sum to its
 * balance cannot be audited or reversed. A system cascade that genuinely
 * leaves a client in debt records that as an explicit owed balance on the
 * account, never as a `Points` value.
 */
export class Points {
  private constructor(private readonly _amount: number) {}

  /** Validating factory — the ONLY way a raw number becomes Points. */
  static create(raw: number): Result<Points, InvalidPointsError> {
    if (!Number.isInteger(raw) || raw < 0) {
      return fail(new InvalidPointsError(raw));
    }
    return ok(new Points(raw));
  }

  /** Rebuild from persistence that was validated on the way in. Never call with user input. */
  static fromPrimitive(trusted: number): Points {
    return new Points(trusted);
  }

  static zero(): Points {
    return new Points(0);
  }

  get amount(): number {
    return this._amount;
  }

  add(other: Points): Points {
    return new Points(this._amount + other._amount);
  }

  /** Take `other` from this balance, or refuse when it is more than the balance holds. */
  subtract(other: Points): Result<Points, InsufficientPointsError> {
    if (other._amount > this._amount) {
      return fail(new InsufficientPointsError(other._amount, this._amount));
    }
    return ok(new Points(this._amount - other._amount));
  }

  equals(other: Points): boolean {
    return this._amount === other._amount;
  }
}
