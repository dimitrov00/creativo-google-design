import {
  BarberId,
  ServiceVariantId,
  CatalogError,
  Result,
} from '@core/primitives';
import {
  ServiceTerms,
  type ServiceTermsError,
  type ServiceTermsInput,
  type ServiceVariant,
} from './service-terms.data';

/**
 * One per-variant override of a barber's terms — an element of
 * `BarberOffering.overrides`, the array that replaces the legacy
 * `byVariant: Record<variantId, terms>` (blueprint §2.6: a map keyed by ids
 * is a distinct indexed field path per key). Flat (Law 6): the variant's id
 * beside the five `ServiceTerms` fields.
 */
export type VariantTerms = {
  readonly variantId: ServiceVariantId;
} & ServiceTerms;

/**
 * One barber's terms for one service (`service-terms.ts:189`) — an element
 * of `Service.offerings`, flat: the barber, the SPARSE per-variant overrides,
 * and the barber's BASE terms as the element's own five `ServiceTerms`
 * fields. Lives on the **service** document, never on the barber.
 *
 * Sparse by construction: a barber who charges the same for short and long
 * hair stores no override and {@link BarberOffering.termsFor} falls back to
 * the offering itself, so "no override" and "override equal to base" are one
 * state, and adding a variant to a service never backfills every barber.
 */
export type BarberOffering = {
  readonly barberId: BarberId;
  readonly overrides: readonly VariantTerms[];
} & ServiceTerms;

/** An override as authored, before its edge guard. */
export type VariantTermsInput = {
  readonly variantId: string;
} & ServiceTermsInput;

/** An offering as authored, before its edge guard. */
export type BarberOfferingInput = {
  readonly barberId: string;
  readonly overrides: readonly VariantTermsInput[];
} & ServiceTermsInput;

/** The five terms fields of anything that carries them — a fresh `ServiceTerms`. */
function termsOf(raw: ServiceTermsInput): ServiceTermsInput {
  return {
    priceCents: raw.priceCents,
    currency: raw.currency,
    durationMinutes: raw.durationMinutes,
    setupMinutes: raw.setupMinutes,
    cleanupMinutes: raw.cleanupMinutes,
  };
}

export const BarberOffering = {
  /**
   * This barber's terms for `variantId`, falling back to the offering's own
   * base terms when no variant was chosen or they do not price that variant
   * differently — the offering itself, no mapping. A linear scan — an
   * offering overrides a handful of variants at most.
   */
  termsFor(
    offering: BarberOffering,
    variantId: ServiceVariantId | null,
  ): ServiceTerms {
    if (variantId === null) return offering;
    const overrides = offering.overrides;
    for (let i = 0; i < overrides.length; i++) {
      const override = overrides[i] as VariantTerms;
      if (override.variantId === variantId) return override;
    }
    return offering;
  },

  /** Every distinct terms this barber can charge — the base, then the overrides in order — for range math. */
  allTerms(offering: BarberOffering): readonly ServiceTerms[] {
    const all: ServiceTerms[] = [offering];
    for (let i = 0; i < offering.overrides.length; i++) {
      all.push(offering.overrides[i] as VariantTerms);
    }
    return all;
  },

  /**
   * The edge guard for one offering against the variants its service
   * declares, every violation at once: a blank barber id
   * (`CATALOG_ID_EMPTY`), the base terms' own violations, and per override —
   * in order — a variant the service does not declare
   * (`CATALOG_SERVICE_UNKNOWN_VARIANT_TERMS`: unreachable by any booking,
   * almost always a typo'd slug, so it fails loudly instead of sitting inert),
   * a variant already priced by an earlier accepted override
   * (`CATALOG_SERVICE_DUPLICATE_VARIANT_TERMS`), or invalid terms.
   */
  parse(
    raw: BarberOfferingInput,
    declaredVariants: readonly ServiceVariant[],
  ): Result<BarberOffering, readonly ServiceTermsError[]> {
    const errors: ServiceTermsError[] = [];
    if (raw.barberId.trim().length === 0) {
      errors.push(CatalogError.idEmpty('BarberId'));
    }
    const base = ServiceTerms.parse(termsOf(raw));
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
      const terms = ServiceTerms.parse(termsOf(override));
      if (!terms.ok) {
        errors.push(...terms.error);
        continue;
      }
      overrides.push({
        variantId: ServiceVariantId.of(override.variantId),
        ...terms.value,
      });
    }

    if (!base.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({
      barberId: BarberId.of(raw.barberId),
      overrides,
      ...base.value,
    });
  },

  /**
   * A service's offerings, in order: a barber listed a second time is
   * `CATALOG_SERVICE_DUPLICATE_OFFERING` (the repeat is skipped, not
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
   * shares the base terms' currency, so a price range can compare cents
   * directly. The first foreign currency is
   * `CATALOG_SERVICE_MIXED_CURRENCY_TERMS`; `null` when the matrix agrees.
   */
  mixedCurrency(
    base: ServiceTerms,
    offerings: readonly BarberOffering[],
  ): CatalogError.ServiceMixedCurrencyTerms | null {
    const expected = base.currency;
    for (let i = 0; i < offerings.length; i++) {
      const offering = offerings[i] as BarberOffering;
      if (offering.currency !== expected) {
        return CatalogError.serviceMixedCurrencyTerms(
          expected,
          offering.currency,
        );
      }
      for (let j = 0; j < offering.overrides.length; j++) {
        const found = (offering.overrides[j] as VariantTerms).currency;
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
    if ((variants[i] as ServiceVariant).variantId === variantId) return true;
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
