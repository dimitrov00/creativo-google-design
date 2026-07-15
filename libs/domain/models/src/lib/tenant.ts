import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { Email } from './email';
import { InvalidEmailError } from './email.errors';
import { TenantId } from './ids';
import {
  EmptyTenantNameError,
  InvalidTenantSlugError,
  InvalidTenantTimezoneError,
  TenantValidationError,
} from './tenant.errors';

const SLUG_SEGMENT_REGEX = /^[a-z0-9]+$/;

export interface TenantProps {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface TenantContact {
  readonly email: Email | null;
  readonly phone: string | null;
}

export class Tenant {
  private constructor(
    readonly id: TenantId,
    readonly name: string,
    readonly slug: string,
    readonly timezone: string,
    readonly contact: TenantContact,
  ) {}

  /** New tenants and tenants read back from persistence validate identically — there are no creation-only invariants for a business profile. */
  static create(props: TenantProps): Result<Tenant, TenantValidationError[]> {
    return Tenant.build(props);
  }

  static reconstitute(
    props: TenantProps,
  ): Result<Tenant, TenantValidationError[]> {
    return Tenant.build(props);
  }

  private static build(
    props: TenantProps,
  ): Result<Tenant, TenantValidationError[]> {
    const idResult = TenantId.create(props.id);
    const nameResult = Tenant.validateName(props.name);
    const slugResult = Tenant.validateSlug(props.slug);
    const timezoneResult = Tenant.validateTimezone(props.timezone);
    const emailResult: Result<Email | null, InvalidEmailError> =
      props.contactEmail ? Email.create(props.contactEmail) : ok(null);

    const combined = combineAll([
      idResult,
      nameResult,
      slugResult,
      timezoneResult,
      emailResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }

    const [id, name, slug, timezone, email] = combined.value;
    const phone = props.contactPhone?.trim();
    return ok(
      new Tenant(id, name, slug, timezone, {
        email,
        phone: phone && phone.length > 0 ? phone : null,
      }),
    );
  }

  private static validateName(
    raw: string,
  ): Result<string, EmptyTenantNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? ok(trimmed) : fail(new EmptyTenantNameError());
  }

  private static validateSlug(
    raw: string,
  ): Result<string, InvalidTenantSlugError> {
    // Split-then-test-each-segment instead of one `+(-+)*`-shaped regex —
    // same "lowercase/digit segments joined by single hyphens" semantics,
    // without the nested-quantifier shape eslint-plugin-security flags as
    // a potential ReDoS pattern.
    const segments = raw.split('-');
    const isValid =
      segments.length > 0 &&
      segments.every((segment) => SLUG_SEGMENT_REGEX.test(segment));
    return isValid ? ok(raw) : fail(new InvalidTenantSlugError(raw));
  }

  private static validateTimezone(
    raw: string,
  ): Result<string, InvalidTenantTimezoneError> {
    return ZonedDateTime.isValidZone(raw)
      ? ok(raw)
      : fail(new InvalidTenantTimezoneError(raw));
  }
}
