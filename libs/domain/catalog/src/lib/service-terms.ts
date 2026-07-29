import { Money, Result, fail, ok } from '@creativo/domain/kernel';
import { BarberId, ServiceVariantId } from './ids';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import {
  DuplicateVariantTermsError,
  InvalidServiceDurationError,
  ServiceTermsValidationError,
  UnknownVariantTermsError,
} from './service.errors';

/**
 * What one booking of a service actually costs and how long it takes —
 * the (price, duration) pair v2 called `Terms`.
 *
 * A value object, not an entity: two barbers charging 15,00 € for 45
 * minutes hold equal terms, and terms have no identity or lifecycle of
 * their own. Every price/duration on the aggregate is one of these, so
 * "which price?" always has a `Terms` to answer it.
 */
export class ServiceTerms {
  private constructor(
    readonly price: Money,
    readonly durationMinutes: number,
  ) {}

  static create(
    price: Money,
    durationMinutes: number,
  ): Result<ServiceTerms, InvalidServiceDurationError> {
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return fail(new InvalidServiceDurationError(durationMinutes));
    }
    return ok(new ServiceTerms(price, durationMinutes));
  }

  equals(other: ServiceTerms): boolean {
    return (
      this.durationMinutes === other.durationMinutes &&
      this.price.equals(other.price)
    );
  }
}

export interface ServiceVariantProps {
  readonly id: string;
  readonly name: LocalizedTextProps;
}

/**
 * A choice WITHIN a service that can move its terms — "short hair" vs
 * "long hair" on a haircut. Deliberately just id + name: the price and
 * duration live on each barber's offering, because the same variant costs
 * different amounts depending on who performs it.
 */
export class ServiceVariant {
  private constructor(
    readonly id: ServiceVariantId,
    readonly name: LocalizedText,
  ) {}

  static create(
    props: ServiceVariantProps,
  ): Result<ServiceVariant, ServiceTermsValidationError[]> {
    const idResult = ServiceVariantId.create(props.id);
    const nameResult = LocalizedText.create(props.name);
    const errors: ServiceTermsValidationError[] = [];
    if (idResult.isFailure()) errors.push(idResult.error);
    if (nameResult.isFailure()) errors.push(...nameResult.error);
    if (idResult.isFailure() || nameResult.isFailure()) {
      return fail(errors);
    }
    return ok(new ServiceVariant(idResult.value, nameResult.value));
  }
}

export interface BarberOfferingProps {
  readonly barberId: string;
  readonly base: {
    priceMinorUnits: number;
    currencyCode: string;
    durationMinutes: number;
  };
  /** Per-variant overrides, keyed by `ServiceVariantId`. Absent keys fall back to `base`. */
  readonly byVariant?: Readonly<
    Record<
      string,
      { priceMinorUnits: number; currencyCode: string; durationMinutes: number }
    >
  >;
}

/**
 * One barber's terms for one service: `base` terms, plus optional
 * per-variant overrides.
 *
 * Overrides are SPARSE by construction — a barber who charges the same for
 * short and long hair stores nothing, and `termsFor` falls back to `base`.
 * That keeps "no override" and "override equal to base" the same state
 * instead of two ways to say one thing, and means adding a variant to a
 * service never has to backfill every barber.
 */
export class BarberOffering {
  private constructor(
    readonly barberId: BarberId,
    readonly base: ServiceTerms,
    private readonly overrides: ReadonlyMap<string, ServiceTerms>,
  ) {}

  static create(
    props: BarberOfferingProps,
    /** The variants its owning service declares — overrides may only name these. */
    declaredVariants: readonly ServiceVariant[],
  ): Result<BarberOffering, ServiceTermsValidationError[]> {
    const errors: ServiceTermsValidationError[] = [];
    const barberIdResult = BarberId.create(props.barberId);
    if (barberIdResult.isFailure()) errors.push(barberIdResult.error);

    const baseResult = BarberOffering.termsFromProps(props.base);
    if (baseResult.isFailure()) errors.push(...baseResult.error);

    const declared = new Set(declaredVariants.map((v) => v.id.value));
    const overrides = new Map<string, ServiceTerms>();
    for (const [variantId, raw] of Object.entries(props.byVariant ?? {})) {
      if (!declared.has(variantId)) {
        // A price for a variant the service doesn't offer is unreachable
        // by any booking — almost always a typo'd slug, so it fails loudly
        // rather than sitting inert in Firestore.
        errors.push(new UnknownVariantTermsError(props.barberId, variantId));
        continue;
      }
      if (overrides.has(variantId)) {
        errors.push(new DuplicateVariantTermsError(props.barberId, variantId));
        continue;
      }
      const termsResult = BarberOffering.termsFromProps(raw);
      if (termsResult.isFailure()) {
        errors.push(...termsResult.error);
        continue;
      }
      overrides.set(variantId, termsResult.value);
    }

    if (errors.length > 0) return fail(errors);
    if (barberIdResult.isFailure() || baseResult.isFailure()) {
      return fail(errors); // unreachable — narrows both Results below
    }
    return ok(
      new BarberOffering(barberIdResult.value, baseResult.value, overrides),
    );
  }

  /** This barber's terms for `variantId`, falling back to `base` when they don't price that variant differently (or none was chosen). */
  termsFor(variantId?: ServiceVariantId | null): ServiceTerms {
    if (!variantId) return this.base;
    return this.overrides.get(variantId.value) ?? this.base;
  }

  /** Every distinct terms this barber can charge — `base` plus overrides, for range math. */
  allTerms(): readonly ServiceTerms[] {
    return [this.base, ...this.overrides.values()];
  }

  private static termsFromProps(raw: {
    priceMinorUnits: number;
    currencyCode: string;
    durationMinutes: number;
  }): Result<ServiceTerms, ServiceTermsValidationError[]> {
    const priceResult = Money.fromMinorUnitsAndCode(
      raw.priceMinorUnits,
      raw.currencyCode,
    );
    if (priceResult.isFailure()) return fail([priceResult.error]);
    const termsResult = ServiceTerms.create(
      priceResult.value,
      raw.durationMinutes,
    );
    if (termsResult.isFailure()) return fail([termsResult.error]);
    return ok(termsResult.value);
  }
}
