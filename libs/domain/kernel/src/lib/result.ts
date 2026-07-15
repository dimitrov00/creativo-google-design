export class Success<T, E = never> {
  readonly kind = 'success' as const;
  constructor(readonly value: T) {}

  isSuccess(): this is Success<T, E> {
    return true;
  }
  isFailure(): this is Failure<T, E> {
    return false;
  }
}

export class Failure<T, E> {
  readonly kind = 'failure' as const;
  constructor(readonly error: E) {}

  isSuccess(): this is Success<T, E> {
    return false;
  }
  isFailure(): this is Failure<T, E> {
    return true;
  }
}

export type Result<T, E> = Success<T, E> | Failure<T, E>;

export const ok = <T, E = never>(value: T): Result<T, E> => new Success(value);
export const fail = <T = never, E = unknown>(error: E): Result<T, E> =>
  new Failure(error);

/**
 * Collects every failure at once, not just the first — constructing an
 * entity from five invalid fields reports all five in one Result, not one
 * error per re-attempt.
 */
export function combine<T, E>(results: Result<T, E>[]): Result<T[], E[]> {
  const failures = results.filter((r): r is Failure<T, E> => r.isFailure());
  if (failures.length > 0) {
    return fail(failures.map((f) => f.error));
  }
  return ok((results as Success<T, E>[]).map((r) => r.value));
}

type ValuesOf<T extends readonly Result<unknown, unknown>[]> = {
  [K in keyof T]: T[K] extends Result<infer V, unknown> ? V : never;
};
type ErrorsOf<T extends readonly Result<unknown, unknown>[]> =
  T[number] extends Result<unknown, infer E> ? E : never;

/**
 * Like `combine`, but preserves each element's own type in a tuple instead
 * of requiring a homogeneous array — this is what entity construction
 * needs: combining a `Result<TenantId, ...>`, a `Result<string, ...>`, and
 * a `Result<Email | null, ...>` together, collecting every field error at
 * once, and getting a fully-typed tuple back on success.
 *
 * Usage:
 * ```ts
 * const combined = combineAll([idResult, nameResult, emailResult] as const);
 * if (combined.isFailure()) return fail(combined.error);
 * const [id, name, email] = combined.value;
 * ```
 */
export function combineAll<T extends readonly Result<unknown, unknown>[]>(
  results: T,
): Result<ValuesOf<T>, ErrorsOf<T>[]> {
  const failures = results.filter((r): r is Failure<unknown, unknown> =>
    r.isFailure(),
  );
  if (failures.length > 0) {
    return fail(failures.map((f) => f.error)) as Result<
      ValuesOf<T>,
      ErrorsOf<T>[]
    >;
  }
  const values = results.map((r) => (r as Success<unknown, unknown>).value);
  return ok(values) as Result<ValuesOf<T>, ErrorsOf<T>[]>;
}

/**
 * Pattern-matches a Result, forcing both branches to be handled —
 * primarily useful at an outer boundary (e.g. an `onCall` handler)
 * converting a Result into a thrown error or a response payload.
 */
export function match<T, E, R>(
  result: Result<T, E>,
  handlers: { success: (value: T) => R; failure: (error: E) => R },
): R {
  return result.isSuccess()
    ? handlers.success(result.value)
    : handlers.failure(result.error);
}
