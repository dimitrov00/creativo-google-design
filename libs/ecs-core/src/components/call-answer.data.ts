import { Result, StoredFields, Tag } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';

/**
 * A callable's answer as the web received it — a plain object, its own
 * fields read by name (never a dynamic index, never a cast to a branded
 * answer, Law 7.4). The call components' answer decoders
 * (`BookingCall.decodeCommitted`, …) read through it, so every decoder
 * refuses alike: an answer that is no object, or one with nothing usable in
 * it, is `PIPELINE_UNKNOWN` — today's "a 200 with nothing usable in it"
 * (reporting a write that may not have happened is the one failure worse
 * than reporting none).
 */
export type CallAnswer = { readonly [field: string]: unknown };

export const CallAnswer = {
  /** The answer as an object of fields, or `null` when it is no object. */
  read(raw: unknown): CallAnswer | null {
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as CallAnswer)
      : null;
  },

  /** The one refusal of an answer the call cannot use. */
  unusable<T>(): Result<T, PipelineError> {
    return Result.err(PipelineError.bare(PipelineErrorCode.Unknown));
  },

  /** A text field, `null` when absent or not a string. */
  text(answer: CallAnswer, name: string): string | null {
    const value = StoredFields.field(answer, name);
    return typeof value === 'string' ? value : null;
  },

  /** A boolean field, `null` when absent or not a boolean. */
  flag(answer: CallAnswer, name: string): boolean | null {
    const value = StoredFields.field(answer, name);
    return typeof value === 'boolean' ? value : null;
  },

  /** A whole-number field (≥ `min`), `null` otherwise. */
  whole(answer: CallAnswer, name: string, min: number): number | null {
    const value = StoredFields.field(answer, name);
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= min
      ? value
      : null;
  },

  /**
   * A field read through a primitive's smart constructor (`AppointmentId.parse`):
   * the brand, or `null` when the field is no string or the constructor refuses.
   */
  parsed<T>(
    answer: CallAnswer,
    name: string,
    parse: (raw: string) => Result<T, unknown>,
  ): T | null {
    const value = StoredFields.field(answer, name);
    if (typeof value !== 'string') return null;
    const parsed = parse(value);
    return parsed.ok ? parsed.value : null;
  },

  /**
   * A field that must be one of a dictionary's members — read through
   * {@link Tag.has}, the one membership scan; `null` otherwise.
   */
  tag<D extends Readonly<Record<string, string | number>>>(
    answer: CallAnswer,
    name: string,
    d: D,
  ): Tag<D> | null {
    const value = StoredFields.field(answer, name);
    return Tag.has(d, value) ? value : null;
  },

  /**
   * A field that must be one of a SUBSET list's values (a closed list that
   * is not a whole dictionary, `StreakPublishError.ANSWERED_CODES`); a whole
   * dictionary is read with {@link CallAnswer.tag}.
   */
  oneOf<T extends string>(
    answer: CallAnswer,
    name: string,
    values: readonly T[],
  ): T | null {
    const value = StoredFields.field(answer, name);
    for (let i = 0; i < values.length; i++) {
      if (values[i] === value) return values[i] as T;
    }
    return null;
  },
} as const;
