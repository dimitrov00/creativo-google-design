import { Result } from '../components/result.data';
import type { Brand } from './brand';
import { PrimitiveError, PrimitiveErrorCode } from './primitive-errors.data';

/**
 * Money in minor units (cents, stotinki) — a safe integer, always read beside
 * a `currency`. Non-negative for a price ({@link PriceCents.of}); a delta or
 * a balance may go below zero ({@link PriceCents.signed}). Never a float,
 * never a formatted string.
 */
export type PriceCents = Brand<number, 'PriceCents'>;

function refuse(raw: number): Result.Err<PrimitiveError> {
  return Result.err(
    PrimitiveError.of(PrimitiveErrorCode.PriceCentsInvalid, raw, 'PriceCents'),
  );
}

export const PriceCents = {
  /** The smart constructor for a price: a safe integer `≥ 0`. */
  of(raw: number): Result<PriceCents, PrimitiveError> {
    // `+ 0` folds a negative zero, so `-0` never reaches a document.
    return Number.isSafeInteger(raw) && raw >= 0
      ? Result.ok((raw + 0) as PriceCents)
      : refuse(raw);
  },

  /** The smart constructor for a signed amount (a delta, a balance): any safe integer. */
  signed(raw: number): Result<PriceCents, PrimitiveError> {
    return Number.isSafeInteger(raw)
      ? Result.ok((raw + 0) as PriceCents)
      : refuse(raw);
  },

  /** Nothing — the identity of {@link add} and the empty {@link sum}. */
  ZERO: 0 as PriceCents,

  add(a: PriceCents, b: PriceCents): PriceCents {
    return (a + b) as PriceCents;
  },

  /** `a − b`; the result may be negative (a difference, not a price). */
  sub(a: PriceCents, b: PriceCents): PriceCents {
    return (a - b + 0) as PriceCents;
  },

  /** The total of `items` — one linear scan, no intermediate arrays. */
  sum(items: readonly PriceCents[]): PriceCents {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += items[i] as PriceCents;
    return (total + 0) as PriceCents;
  },
} as const;
