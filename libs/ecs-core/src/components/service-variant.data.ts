import { ServiceVariantId, Result } from '@core/primitives';
import { CatalogError } from '@core/errors';
import { LocalizedText } from './localized-text.data';

/**
 * A choice WITHIN a service that can move its terms — "short hair" vs "long
 * hair" on a haircut (`service-terms.ts:151`), an element of
 * `Service.variants`. Deliberately just id + name: the price and duration
 * live on each barber's offering (`barber-offering.data.ts`), because the same
 * variant costs different amounts depending on who performs it. Its own id is
 * `variantId` (N10).
 */
export type ServiceVariant = {
  readonly variantId: ServiceVariantId;
  readonly name: LocalizedText;
};

export const ServiceVariant = {
  /**
   * The edge guard for one variant, every violation at once: a blank id
   * (`CATALOG_ID_EMPTY`) and each blank locale of the name. The id is kept
   * exactly as given; the name is trimmed.
   */
  parse(
    raw: ServiceVariant.Input,
  ): Result<ServiceVariant, readonly CatalogError[]> {
    const errors: CatalogError[] = [];
    if (raw.variantId.trim().length === 0) {
      errors.push(CatalogError.idEmpty('ServiceVariantId'));
    }
    const name = LocalizedText.parse(raw.name);
    if (!name.ok) errors.push(...name.error);
    if (!name.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({
      variantId: ServiceVariantId.of(raw.variantId),
      name: name.value,
    });
  },

  /**
   * A service's declared variants, in order: an id declared a second time is
   * `CATALOG_SERVICE_DUPLICATE_VARIANT` (the repeat is skipped, not parsed),
   * and every variant's own violations are reported too.
   */
  parseAll(
    raws: readonly ServiceVariant.Input[],
  ): Result<readonly ServiceVariant[], readonly CatalogError[]> {
    const errors: CatalogError[] = [];
    const variants: ServiceVariant[] = [];
    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i] as ServiceVariant.Input;
      if (declaredBefore(raws, i)) {
        errors.push(CatalogError.serviceDuplicateVariant(raw.variantId));
        continue;
      }
      const parsed = ServiceVariant.parse(raw);
      if (parsed.ok) variants.push(parsed.value);
      else errors.push(...parsed.error);
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(variants);
  },
} as const;

/** An earlier entry declares the same raw id — a linear scan; variant lists are a handful long. */
function declaredBefore(
  raws: readonly ServiceVariant.Input[],
  index: number,
): boolean {
  const id = (raws[index] as ServiceVariant.Input).variantId;
  for (let j = 0; j < index; j++) {
    if ((raws[j] as ServiceVariant.Input).variantId === id) return true;
  }
  return false;
}

export namespace ServiceVariant {
  /** A variant as authored, before its edge guard. */
  export type Input = {
    readonly variantId: string;
    readonly name: LocalizedText;
  };
}
