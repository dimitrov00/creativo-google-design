import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidPointsError } from './points.errors';

/**
 * Non-negative integer reward points. Ports v2's `primitives/Points.ts`
 * Opaque-type rule into a class + Result factory (this repo's VO
 * template, blueprint §2.3) — `Points` can never go negative;
 * `subtract` clamps to zero so accidental over-spend is unrepresentable.
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

  /** Subtract `other` from this, clamping at zero — over-spend is unrepresentable. */
  subtract(other: Points): Points {
    return new Points(Math.max(0, this._amount - other._amount));
  }

  equals(other: Points): boolean {
    return this._amount === other._amount;
  }
}
