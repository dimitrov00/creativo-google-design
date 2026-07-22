import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { CurrencyCode } from './currency-code';
import { FeatureFlags } from './feature-flags';
import { Locale, parseLocale } from './locale';
import {
  EmptyTenantConfigNameError,
  InvalidTenantConfigTimezoneError,
  TenantConfigValidationError,
} from './tenant-config.errors';

export interface TenantConfigProps {
  name: string;
  /** IANA timezone identifier — e.g. `'Europe/Sofia'`. */
  timezone: string;
  locale: string;
  currencyCode: string;
  /** Already-validated composed VO, embedded as-is (same pattern as `User` embedding an already-validated `AccountStatus`) — not re-validated here. */
  featureFlags: FeatureFlags;
}

/**
 * **Aggregate root.** Per-deployment configuration — a deliberately
 * lighter port of v2's `TenantConfig` (that one is a full Backstage-style
 * `apiVersion`/`kind`/`spec` envelope with schema migrations, auth
 * strategy, branding, and multi-location booking policy; none of that is
 * this governance context's concern). What's ported is the shape that
 * belongs here: the tenant's identity/locale/currency/timezone plus its
 * `FeatureFlags`. A richer config aggregate (branding, auth, locations)
 * is a future context's own build, not a retrofit onto this one — see
 * this lib's final report for the deviation note.
 *
 * There are no creation-only invariants for a config profile (mirrors
 * `models/tenant.ts`) — `create`/`reconstitute` validate identically.
 */
export class TenantConfig {
  private constructor(
    readonly name: string,
    readonly timezone: string,
    readonly locale: Locale,
    readonly currencyCode: CurrencyCode,
    readonly featureFlags: FeatureFlags,
  ) {}

  static create(
    props: TenantConfigProps,
  ): Result<TenantConfig, TenantConfigValidationError[]> {
    return TenantConfig.build(props);
  }

  static reconstitute(
    props: TenantConfigProps,
  ): Result<TenantConfig, TenantConfigValidationError[]> {
    return TenantConfig.build(props);
  }

  private static build(
    props: TenantConfigProps,
  ): Result<TenantConfig, TenantConfigValidationError[]> {
    const nameResult = TenantConfig.validateName(props.name);
    const timezoneResult = TenantConfig.validateTimezone(props.timezone);
    const localeResult = parseLocale(props.locale);
    const currencyResult = CurrencyCode.create(props.currencyCode);

    const combined = combineAll([
      nameResult,
      timezoneResult,
      localeResult,
      currencyResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }

    const [name, timezone, locale, currencyCode] = combined.value;
    return ok(
      new TenantConfig(
        name,
        timezone,
        locale,
        currencyCode,
        props.featureFlags,
      ),
    );
  }

  private static validateName(
    raw: string,
  ): Result<string, EmptyTenantConfigNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0
      ? ok(trimmed)
      : fail(new EmptyTenantConfigNameError());
  }

  private static validateTimezone(
    raw: string,
  ): Result<string, InvalidTenantConfigTimezoneError> {
    return ZonedDateTime.isValidZone(raw)
      ? ok(raw)
      : fail(new InvalidTenantConfigTimezoneError(raw));
  }

  /** Immutable transition — returns a new instance, never mutates `this`. */
  withFeatureFlags(featureFlags: FeatureFlags): TenantConfig {
    return new TenantConfig(
      this.name,
      this.timezone,
      this.locale,
      this.currencyCode,
      featureFlags,
    );
  }
}
