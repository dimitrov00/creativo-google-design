/**
 * A failure is a value (Law 1). `Result<T, E>` is a plain two-variant union
 * discriminated by `ok` — no class, no prototype, nothing to `instanceof` —
 * so a decision crosses a pipeline, a callable boundary or a signal as the
 * same two shapes. The legacy kernel's `isSuccess()`/`isFailure()` methods
 * become a read of `r.ok`.
 */
export type Result<T, E> = Result.Ok<T> | Result.Err<E>;

export const Result = {
  ok<T>(value: T): Result.Ok<T> {
    return { ok: true, value };
  },

  err<E>(error: E): Result.Err<E> {
    return { ok: false, error };
  },

  /**
   * Every failure at once, not just the first — validating five fields
   * reports all five in one pass (the kernel's `combineAll`). On success the
   * values keep their positions and their own types, so a heterogeneous
   * tuple destructures fully typed:
   *
   * ```ts
   * const all = Result.all([idResult, nameResult, emailResult] as const);
   * if (!all.ok) return all; // all.error: readonly (IdError | NameError | EmailError)[]
   * const [id, name, email] = all.value;
   * ```
   */
  all<const R extends readonly Result<unknown, unknown>[]>(
    results: R,
  ): Result<Result.ValuesOf<R>, readonly Result.ErrorOf<R[number]>[]> {
    const values: unknown[] = [];
    const errors: unknown[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i] as Result<unknown, unknown>;
      if (result.ok) values.push(result.value);
      else errors.push(result.error);
    }
    return errors.length > 0
      ? { ok: false, error: errors as Result.ErrorOf<R[number]>[] }
      : { ok: true, value: values as Result.ValuesOf<R> };
  },

  /** Transform the value; a failure passes through untouched. */
  map<T, E, U>(result: Result<T, E>, f: (value: T) => U): Result<U, E> {
    return result.ok ? { ok: true, value: f(result.value) } : result;
  },

  /** Transform the error; a success passes through untouched. */
  mapError<T, E, F>(result: Result<T, E>, f: (error: E) => F): Result<T, F> {
    return result.ok ? result : { ok: false, error: f(result.error) };
  },
} as const;

export namespace Result {
  export type Ok<T> = { readonly ok: true; readonly value: T };
  export type Err<E> = { readonly ok: false; readonly error: E };

  /** The success value of a result type (`never` for a bare `Err`). */
  export type ValueOf<R> = R extends Ok<infer V> ? V : never;
  /** The error of a result type (`never` for a bare `Ok`). */
  export type ErrorOf<R> = R extends Err<infer E> ? E : never;
  /** A tuple (or array) of results → the tuple (or array) of their values. */
  export type ValuesOf<R extends readonly Result<unknown, unknown>[]> = {
    -readonly [K in keyof R]: ValueOf<R[K]>;
  };
}
