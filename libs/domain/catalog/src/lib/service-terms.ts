import { Money, Result, fail, ok } from '@creativo/domain/kernel';
import { BarberId, ServiceVariantId } from './ids';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import {
  DuplicateVariantTermsError,
  InvalidServiceDurationError,
  ServiceTermsValidationError,
  UnknownVariantTermsError,
} from './service.errors';

/** Setup before / cleanup after. Both default to 0 — most services need none. */
export interface ServicePadding {
  readonly setupMinutes?: number;
  readonly cleanupMinutes?: number;
}

/**
 * What one booking of a service actually costs, how long it takes, and how
 * much unsold time surrounds it — the (price, duration) pair v2 called
 * `Terms`, plus the padding ruling below.
 *
 * A value object, not an entity: two barbers charging 15,00 € for 45
 * minutes hold equal terms, and terms have no identity or lifecycle of
 * their own. Every price/duration on the aggregate is one of these, so
 * "which price?" always has a `Terms` to answer it.
 *
 * ### Why setup/cleanup live here (owner ruling, 2026-07-29)
 * The owner asked the right question: if a colour needs cleanup, why not just
 * declare a longer duration? For the availability grid alone the two are
 * indistinguishable. Separating them earns its place elsewhere:
 *
 * - The client is quoted, and charged for, the SERVICE — not the mop-up. A
 *   duration that swallows cleanup lies in the confirmation.
 * - Utilisation would inflate: cleanup would count as productive time, and
 *   `bufferMinutes` — the reported cost of the padding policy — becomes
 *   uncomputable.
 * - Two seats of one party can share the chair back-to-back, which is only
 *   expressible when the pad is outside the sold duration.
 *
 * `ServiceTerms` is already resolved per (barber, variant), so padding
 * declared here inherits BOTH axes for free: "Ivan's colour needs 15 minutes
 * of cleanup" needs no new structure, which is exactly the per-barber and
 * per-service accuracy the owner asked for.
 */
export class ServiceTerms {
  private constructor(
    readonly price: Money,
    readonly durationMinutes: number,
    /** Unsold time BEFORE the service — mixing, prep. Never charged for. */
    readonly setupMinutes: number,
    /** Unsold time AFTER the service — the mop-up. Never charged for. */
    readonly cleanupMinutes: number,
  ) {}

  static create(
    price: Money,
    durationMinutes: number,
    padding: ServicePadding = {},
  ): Result<ServiceTerms, InvalidServiceDurationError> {
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return fail(new InvalidServiceDurationError(durationMinutes));
    }
    const setupMinutes = padding.setupMinutes ?? 0;
    const cleanupMinutes = padding.cleanupMinutes ?? 0;
    // A negative or fractional pad is the same class of authoring mistake as
    // a negative duration, and reaches the same place — the grid's arithmetic.
    for (const pad of [setupMinutes, cleanupMinutes]) {
      if (!Number.isInteger(pad) || pad < 0) {
        return fail(new InvalidServiceDurationError(pad));
      }
    }
    return ok(
      new ServiceTerms(price, durationMinutes, setupMinutes, cleanupMinutes),
    );
  }

  /** Chair time this booking actually consumes, padding included. */
  occupiedMinutes(): number {
    return this.setupMinutes + this.durationMinutes + this.cleanupMinutes;
  }

  /**
   * Build straight from persisted primitives — the shape every adapter and
   * seed row actually holds.
   *
   * Exists so callers outside this context never have to construct a
   * `Money` themselves: `Seat` snapshots terms, so feature code and
   * infrastructure both need to build them, and neither should have to
   * reach past the catalog facade for a kernel type to do it. Collects both
   * failure modes rather than short-circuiting on the price.
   */
  static fromMinorUnits(
    priceMinorUnits: number,
    currencyCode: string,
    durationMinutes: number,
    padding: ServicePadding = {},
  ): Result<ServiceTerms, ServiceTermsValidationError[]> {
    const priceResult = Money.fromMinorUnitsAndCode(
      priceMinorUnits,
      currencyCode,
    );
    if (priceResult.isFailure()) {
      return fail([priceResult.error]);
    }
    const termsResult = ServiceTerms.create(
      priceResult.value,
      durationMinutes,
      padding,
    );
    if (termsResult.isFailure()) {
      return fail([termsResult.error]);
    }
    return ok(termsResult.value);
  }

  equals(other: ServiceTerms): boolean {
    return (
      this.durationMinutes === other.durationMinutes &&
      this.setupMinutes === other.setupMinutes &&
      this.cleanupMinutes === other.cleanupMinutes &&
      this.price.equals(other.price)
    );
  }
}

/**
 * Persisted terms — the shape a Firestore offering row actually holds.
 *
 * `setupMinutes`/`cleanupMinutes` are optional and default to 0, so the great
 * majority of rows (a haircut needs no mop-up) stay exactly as they were.
 */
export interface BarberTermsProps {
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  readonly durationMinutes: number;
  readonly setupMinutes?: number;
  readonly cleanupMinutes?: number;
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
  readonly base: BarberTermsProps;
  /** Per-variant overrides, keyed by `ServiceVariantId`. Absent keys fall back to `base`. */
  readonly byVariant?: Readonly<Record<string, BarberTermsProps>>;
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
    setupMinutes?: number;
    cleanupMinutes?: number;
  }): Result<ServiceTerms, ServiceTermsValidationError[]> {
    const priceResult = Money.fromMinorUnitsAndCode(
      raw.priceMinorUnits,
      raw.currencyCode,
    );
    if (priceResult.isFailure()) return fail([priceResult.error]);
    const termsResult = ServiceTerms.create(
      priceResult.value,
      raw.durationMinutes,
      {
        setupMinutes: raw.setupMinutes,
        cleanupMinutes: raw.cleanupMinutes,
      },
    );
    if (termsResult.isFailure()) return fail([termsResult.error]);
    return ok(termsResult.value);
  }
}
