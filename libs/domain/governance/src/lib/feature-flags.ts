import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  FeatureFlagsValidationError,
  InvalidFeatureFlagValueError,
  UnknownFeatureFlagKeyError,
} from './feature-flags.errors';

/**
 * Closed vocabulary of platform-wide kill-switch / gradual-rollout flags
 * (ported from v2's `FeatureFlags`, flattened to dotted-path keys instead
 * of a nested object shape — the nested-object + recursive-`Paths<T>`
 * trick v2 used to derive `FeatureFlagPath` isn't needed here: a flat
 * closed union does the same "adding a flag is a compile-time-visible
 * change" job with far less type-level machinery).
 */
export type FeatureFlagKey =
  | 'referrals.invitations'
  | 'rewards.points'
  | 'rewards.achievements'
  | 'discounts.grants';

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  'referrals.invitations',
  'rewards.points',
  'rewards.achievements',
  'discounts.grants',
];

export function isFeatureFlagKey(value: unknown): value is FeatureFlagKey {
  return (
    typeof value === 'string' &&
    (FEATURE_FLAG_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Application-wide feature flags, stored as a single config doc. Modeled
 * as a real entity (not v2's plain interface + free functions) so the raw
 * `Record<string, unknown>` a config doc round-trips through is validated
 * exactly once, at the `create`/`reconstitute` boundary, per this repo's
 * primitive-obsession ban — v2's version never validates the doc shape at
 * all (a stray key silently no-ops instead of surfacing as a domain
 * error).
 */
export class FeatureFlags {
  private constructor(
    private readonly flags: ReadonlyMap<FeatureFlagKey, boolean>,
  ) {}

  /** All-disabled default — safe when the doc is missing or partial. */
  static defaults(): FeatureFlags {
    return new FeatureFlags(
      new Map(FEATURE_FLAG_KEYS.map((key) => [key, false])),
    );
  }

  static create(
    raw: Readonly<Record<string, unknown>>,
  ): Result<FeatureFlags, FeatureFlagsValidationError[]> {
    return FeatureFlags.build(raw);
  }

  static reconstitute(
    raw: Readonly<Record<string, unknown>>,
  ): Result<FeatureFlags, FeatureFlagsValidationError[]> {
    return FeatureFlags.build(raw);
  }

  private static build(
    raw: Readonly<Record<string, unknown>>,
  ): Result<FeatureFlags, FeatureFlagsValidationError[]> {
    const errors: FeatureFlagsValidationError[] = [];
    const flags = new Map<FeatureFlagKey, boolean>(
      FEATURE_FLAG_KEYS.map((key) => [key, false]),
    );

    for (const [key, value] of Object.entries(raw)) {
      if (!isFeatureFlagKey(key)) {
        errors.push(new UnknownFeatureFlagKeyError(key));
        continue;
      }
      if (typeof value !== 'boolean') {
        errors.push(new InvalidFeatureFlagValueError(key));
        continue;
      }
      flags.set(key, value);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    return ok(new FeatureFlags(flags));
  }

  isEnabled(key: FeatureFlagKey): boolean {
    return this.flags.get(key) ?? false;
  }

  /** Immutable transition — returns a new instance with one flag flipped, never mutates `this`. */
  withFlag(key: FeatureFlagKey, value: boolean): FeatureFlags {
    const next = new Map(this.flags);
    next.set(key, value);
    return new FeatureFlags(next);
  }

  /** Persistence-shaped snapshot — the door back out to a config doc's raw record. */
  toRecord(): Readonly<Record<FeatureFlagKey, boolean>> {
    return Object.fromEntries(this.flags) as Record<FeatureFlagKey, boolean>;
  }
}
