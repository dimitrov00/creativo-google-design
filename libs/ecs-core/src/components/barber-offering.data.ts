import { BarberId, ServiceVariantId, Result } from '@core/primitives';
import { CatalogError } from '@core/errors';
import { ServiceTerms } from './service-terms.data';
import type { ServiceTermsInput } from './service-terms-input.data';
import type { ServiceVariant } from './service-variant.data';
import type { VariantTerms } from './variant-terms.data';

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
    raw: BarberOffering.Input,
    declaredVariants: readonly ServiceVariant[],
  ): Result<BarberOffering, readonly CatalogError.Terms[]> {
    const errors: CatalogError.Terms[] = [];
    if (raw.barberId.trim().length === 0) {
      errors.push(CatalogError.idEmpty('BarberId'));
    }
    const base = ServiceTerms.parse(raw);
    if (!base.ok) errors.push(...base.error);

    const overrides: VariantTerms[] = [];
    for (let i = 0; i < raw.overrides.length; i++) {
      const override = raw.overrides[i] as VariantTerms.Input;
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
      const terms = ServiceTerms.parse(override);
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
    raws: readonly BarberOffering.Input[],
    declaredVariants: readonly ServiceVariant[],
  ): Result<readonly BarberOffering[], readonly CatalogError.Terms[]> {
    const errors: CatalogError.Terms[] = [];
    const offerings: BarberOffering[] = [];
    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i] as BarberOffering.Input;
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
  raws: readonly BarberOffering.Input[],
  index: number,
): boolean {
  const barberId = (raws[index] as BarberOffering.Input).barberId;
  for (let j = 0; j < index; j++) {
    if ((raws[j] as BarberOffering.Input).barberId === barberId) return true;
  }
  return false;
}

export namespace BarberOffering {
  /** An offering as authored, before its edge guard. */
  export type Input = {
    readonly barberId: string;
    readonly overrides: readonly VariantTerms.Input[];
  } & ServiceTermsInput;
}
