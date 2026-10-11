import { Result } from '../components/result.data';
import type { Brand } from './brand';
import { PrimitiveError, PrimitiveErrorCode } from './primitive-errors.data';

const NANOS_PER_SECOND = 1_000_000_000;

/**
 * Whole seconds since the Unix epoch — the seconds half of a D17 precise
 * instant (Firestore `Timestamp` order), never an elapsed duration.
 */
export type EpochSeconds = Brand<number, 'EpochSeconds'>;

/**
 * The nanoseconds inside one second of a D17 precise instant, an integer in
 * `[0, 1 000 000 000)`.
 */
export type SubsecondNanos = Brand<number, 'SubsecondNanos'>;

export const EpochSeconds = {
  /** The smart constructor: a safe integer. */
  of(raw: number): Result<EpochSeconds, PrimitiveError> {
    return Number.isSafeInteger(raw)
      ? Result.ok((raw + 0) as EpochSeconds)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.EpochSecondsInvalid,
            raw,
            'EpochSeconds',
          ),
        );
  },
} as const;

export const SubsecondNanos = {
  /** The smart constructor: an integer in `[0, 1e9)`. */
  of(raw: number): Result<SubsecondNanos, PrimitiveError> {
    return Number.isInteger(raw) && raw >= 0 && raw < NANOS_PER_SECOND
      ? Result.ok((raw + 0) as SubsecondNanos)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.SubsecondNanosOutOfRange,
            raw,
            'SubsecondNanos',
          ),
        );
  },
} as const;
