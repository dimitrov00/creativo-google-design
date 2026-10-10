import { BarberId } from '../entities/barber.entity';
import { CatalogError } from './catalog-errors.data';
import { Result } from './result.data';
import {
  ServiceTerms,
  ServiceVariantId,
  type ServiceTermsError,
  type ServiceVariant,
} from './service-terms.data';

/**
 * One per-variant override of a barber's terms — an entry of
 * `BarberOffering.overrides`, the array that replaces the legacy
 * `byVariant: Record<variantId, terms>` (blueprint §2.6: a map keyed by ids
 * is a distinct indexed field path per key, so the Record became an array of
 * structs).
 */
export type VariantTerms = {
  readonly variantId: ServiceVariantId;
  readonly terms: ServiceTerms;
};

/**
 * One barber's terms for one service (`service-terms.ts:189`): `base` terms
 * plus SPARSE per-variant overrides. Lives on the **service** document
 * (`services.offerings`), never on the barber.
 *
 * Sparse by construction: a barber who charges the same for short and long
 * hair stores no override and {@link BarberOffering.termsFor} falls back to
 * `base`, so "no override" and "override equal to base" are one state, and
 * adding a variant to a service never backfills every barber.
 */
export type BarberOffering = {
  readonly barberId: BarberId;
  readonly base: ServiceTerms;
  readonly overrides: readonly VariantTerms[];
};

/** An override as authored, before its edge guard. */
export type VariantTermsInput = {
  readonly variantId: string;
  readonly terms: ServiceTerms;
};

/** An offering as authored, before its edge guard. */
export type BarberOfferingInput = {
  readonly barberId: string;
  readonly base: ServiceTerms;
  readonly overrides: readonly VariantTermsInput[];
};

export const BarberOffering = {
  /**
   * This barber's terms for `variantId`, falling back to `base` when no
   * variant was chosen or they do not price that variant differently. A
   * linear scan — an offering overrides a handful of variants at most.
   */
  termsFor(
    offering: BarberOffering,
    variantId: ServiceVariantId | null,
  ): ServiceTerms {
    if (variantId === null) return offering.base;
    const overrides = offering.overrides;
    for (let i = 0; i < overrides.length; i++) {
      const override = overrides[i] as VariantTerms;
      if (override.variantId === variantId) return override.terms;
    }
    return offering.base;
  },

  /** Every distinct terms this barber can charge — `base`, then the overrides in order — for range math. */
  allTerms(offering: BarberOffering): readonly ServiceTerms[] {
    const all: ServiceTerms[] = [offering.base];
    for (let i = 0; i < offering.overrides.length; i++) {
      all.push((offering.overrides[i] as VariantTerms).terms);
    }
    return all;
  },

  /**
   * The edge guard for one offering against the variants its service
   * declares, every violation at once: a blank barber id
   * (`catalog.id.empty`), the base terms' own violations, and per override —
   * in order — a variant the service does not declare
   * (`catalog.service.unknown_variant_terms`: unreachable by any booking,
   * almost always a typo'd slug, so it fails loudly instead of sitting inert),
   * a variant already priced by an earlier accepted override
   * (`catalog.service.duplicate_variant_terms`), or invalid terms.
   */
  parse(
    raw: BarberOfferingInput,
    declaredVariants: readonly ServiceVariant[],
  ): Result<BarberOffering, readonly ServiceTermsError[]> {
    const errors: ServiceTermsError[] = [];
    if (raw.barberId.trim().length === 0) {
      errors.push(CatalogError.idEmpty('BarberId'));
    }
    const base = ServiceTerms.parse(raw.base);
    if (!base.ok) errors.push(...base.error);

    const overrides: VariantTerms[] = [];
    for (let i = 0; i < raw.overrides.length; i++) {
      const override = raw.overrides[i] as VariantTermsInput;
      if (!isDeclared(declaredVariants, override.variantId)) {
        errors.push(
          CatalogError.serviceUnknownVariantTerms(
            raw.barberId,
            override.variantId,
          ),
        );
        continue;
      }
      if (isOverridden(overrides, override.variantId)) {
        errors.push(
          CatalogError.serviceDuplicateVariantTerms(
            raw.barberId,
            override.variantId,
          ),
        );
        continue;
      }
      const terms = ServiceTerms.parse(override.terms);
      if (!terms.ok) {
        errors.push(...terms.error);
        continue;
      }
      overrides.push({
        variantId: ServiceVariantId.of(override.variantId),
        terms: terms.value,
      });
    }

    if (!base.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({
      barberId: BarberId.of(raw.barberId),
      base: base.value,
      overrides,
    });
  },

  /**
   * A service's offerings, in order: a barber listed a second time is
   * `catalog.service.duplicate_offering` (the repeat is skipped, not
   * parsed), and every offering's own violations are reported too.
   */
  parseAll(
    raws: readonly BarberOfferingInput[],
    declaredVariants: readonly ServiceVariant[],
  ): Result<readonly BarberOffering[], readonly ServiceTermsError[]> {
    const errors: ServiceTermsError[] = [];
    const offerings: BarberOffering[] = [];
    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i] as BarberOfferingInput;
      if (listedBefore(raws, i)) {
        errors.push(CatalogError.serviceDuplicateOffering(raw.barberId));
        continue;
      }
      const parsed = BarberOffering.parse(raw, declaredVariants);
      if (parsed.ok) offerings.push(parsed.value);
      else errors.push(...parsed.error);
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(offerings);
  },

  /**
   * The one-currency invariant of a service's terms matrix: every price on
   * the offerings — each offering's base, then its overrides, in order —
   * shares the base terms' currency, so a price range can compare minor
   * units directly. The first foreign currency is
   * `catalog.service.mixed_currency_terms`; `null` when the matrix agrees.
   */
  mixedCurrency(
    base: ServiceTerms,
    offerings: readonly BarberOffering[],
  ): CatalogError.ServiceMixedCurrencyTerms | null {
    const expected = base.currencyCode;
    for (let i = 0; i < offerings.length; i++) {
      const offering = offerings[i] as BarberOffering;
      if (offering.base.currencyCode !== expected) {
        return CatalogError.serviceMixedCurrencyTerms(
          expected,
          offering.base.currencyCode,
        );
      }
      for (let j = 0; j < offering.overrides.length; j++) {
        const found = (offering.overrides[j] as VariantTerms).terms
          .currencyCode;
        if (found !== expected) {
          return CatalogError.serviceMixedCurrencyTerms(expected, found);
        }
      }
    }
    return null;
  },
} as const;

function isDeclared(
  variants: readonly ServiceVariant[],
  variantId: string,
): boolean {
  for (let i = 0; i < variants.length; i++) {
    if ((variants[i] as ServiceVariant).id === variantId) return true;
  }
  return false;
}

function isOverridden(
  overrides: readonly VariantTerms[],
  variantId: string,
): boolean {
  for (let i = 0; i < overrides.length; i++) {
    if ((overrides[i] as VariantTerms).variantId === variantId) return true;
  }
  return false;
}

/** An earlier entry lists the same raw barber id. */
function listedBefore(
  raws: readonly BarberOfferingInput[],
  index: number,
): boolean {
  const barberId = (raws[index] as BarberOfferingInput).barberId;
  for (let j = 0; j < index; j++) {
    if ((raws[j] as BarberOfferingInput).barberId === barberId) return true;
  }
  return false;
}
