declare const __brand: unique symbol;

/**
 * Nominal typing without runtime cost: `Brand<string, 'UserId'>` is not
 * assignable to/from `Brand<string, 'ServiceId'>` even though both are
 * structurally just a `string` — the phantom `__brand` property only ever
 * exists at the type level, never read or written at runtime.
 */
export type Brand<TBase, TTag extends string> = TBase & {
  readonly [__brand]: TTag;
};
