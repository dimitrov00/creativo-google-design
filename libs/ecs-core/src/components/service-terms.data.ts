import { CatalogError } from './catalog-errors.data';
import { LocalizedText } from './localized-text.data';
import { Money } from './money.data';
import type { MoneyError } from './money-errors.data';
import { Result } from './result.data';

/**
 * What one booking of a service costs, how long it takes and how much unsold
 * chair time surrounds it — `service-terms.ts:45`'s `ServiceTerms` class as
 * the stored struct. The flat `priceMinorUnits` + `currencyCode` pair stays
 * here (blueprint §2.5's one exception to the nested-`Money` rule): one code
 * prices one figure beside the duration fields, and the whole struct is
 * snapshotted onto every seat.
 *
 * `setupMinutes` (prep before) and `cleanupMinutes` (mop-up after) are
 * **outside** the sold duration (owner ruling, 2026-07-29): the client is
 * quoted and charged for `durationMinutes`, the chair is held for
 * {@link ServiceTerms.occupiedMinutes}. Both are always present — `0` when the
 * service needs no padding, never a missing key.
 *
 * Terms are resolved per (barber, variant), so padding declared here inherits
 * both axes: "Ivan's colour needs 15 minutes of cleanup" needs no new field.
 */
export type ServiceTerms = {
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  /** The sold duration — a positive integer of minutes. */
  readonly durationMinutes: number;
  /** Unsold time BEFORE the service — mixing, prep. Never charged for. */
  readonly setupMinutes: number;
  /** Unsold time AFTER the service — the mop-up. Never charged for. */
  readonly cleanupMinutes: number;
};

/** Every way a raw terms struct can fail its edge guard. */
export type ServiceTermsError = CatalogError | MoneyError;

export const ServiceTerms = {
  /**
   * The struct from trusted figures, every field named. Validate untrusted
   * input with {@link parse}.
   */
  of(
    priceMinorUnits: number,
    currencyCode: string,
    durationMinutes: number,
    setupMinutes: number,
    cleanupMinutes: number,
  ): ServiceTerms {
    return {
      priceMinorUnits,
      currencyCode,
      durationMinutes,
      setupMinutes,
      cleanupMinutes,
    };
  },

  /**
   * Terms with no padding — both pads `0`, as the legacy `ServicePadding`
   * defaulted them. The named shorthand for {@link of}, never a default
   * parameter.
   */
  unpadded(
    priceMinorUnits: number,
    currencyCode: string,
    durationMinutes: number,
  ): ServiceTerms {
    return ServiceTerms.of(
      priceMinorUnits,
      currencyCode,
      durationMinutes,
      0,
      0,
    );
  },

  /**
   * The edge guard (the catalogue seed, an admin write), every violation at
   * once: the price must be `Money` (a non-negative safe integer in a
   * recognised currency — `money.unknown_currency` / `money.invalid_amount`),
   * the duration a positive integer and each pad a non-negative integer
   * (`catalog.service.invalid_duration`, carrying the offending figure — a
   * negative or fractional pad is the same authoring mistake as a negative
   * duration and reaches the same place, the grid's arithmetic). The
   * currency code comes back normalised (`'eur'` → `'EUR'`).
   */
  parse(raw: ServiceTerms): Result<ServiceTerms, readonly ServiceTermsError[]> {
    const errors: ServiceTermsError[] = [];
    const price = Money.of(raw.priceMinorUnits, raw.currencyCode);
    if (!price.ok) errors.push(price.error);
    if (!Number.isInteger(raw.durationMinutes) || raw.durationMinutes <= 0) {
      errors.push(CatalogError.serviceInvalidDuration(raw.durationMinutes));
    }
    if (!isPad(raw.setupMinutes)) {
      errors.push(CatalogError.serviceInvalidDuration(raw.setupMinutes));
    }
    if (!isPad(raw.cleanupMinutes)) {
      errors.push(CatalogError.serviceInvalidDuration(raw.cleanupMinutes));
    }
    if (!price.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({
      priceMinorUnits: price.value.amountMinorUnits,
      currencyCode: price.value.currencyCode,
      durationMinutes: raw.durationMinutes,
      setupMinutes: raw.setupMinutes,
      cleanupMinutes: raw.cleanupMinutes,
    });
  },

  /** Chair time one booking consumes — setup + sold duration + cleanup. */
  occupiedMinutes(terms: ServiceTerms): number {
    return terms.setupMinutes + terms.durationMinutes + terms.cleanupMinutes;
  },

  /** The price as a standalone `Money` figure. */
  price(terms: ServiceTerms): Money {
    return {
      amountMinorUnits: terms.priceMinorUnits,
      currencyCode: terms.currencyCode,
    };
  },

  /** Same price, currency, duration and padding — terms that differ only in padding are different terms. */
  equals(a: ServiceTerms, b: ServiceTerms): boolean {
    return (
      a.priceMinorUnits === b.priceMinorUnits &&
      a.currencyCode === b.currencyCode &&
      a.durationMinutes === b.durationMinutes &&
      a.setupMinutes === b.setupMinutes &&
      a.cleanupMinutes === b.cleanupMinutes
    );
  },
} as const;

/**
 * A variant's author-chosen slug (`short`, `long`) — the key a barber's
 * per-variant terms are stored under, so it stays stable across edits and is
 * never generated. A brand over the plain stored string.
 */
export type ServiceVariantId = string & { readonly __brand: unique symbol };

export const ServiceVariantId = {
  /** The only cast site. Validate with `ServiceVariant.parse` at the edge, not here. */
  of: (raw: string): ServiceVariantId => raw as ServiceVariantId,
} as const;

/**
 * A choice WITHIN a service that can move its terms — "short hair" vs "long
 * hair" on a haircut (`service-terms.ts:151`). Deliberately just id + name:
 * the price and duration live on each barber's offering
 * (`barber-offering.data.ts`), because the same variant costs different
 * amounts depending on who performs it.
 */
export type ServiceVariant = {
  readonly id: ServiceVariantId;
  readonly name: LocalizedText;
};

/** A variant as authored, before its edge guard. */
export type ServiceVariantInput = {
  readonly id: string;
  readonly name: LocalizedText;
};

export const ServiceVariant = {
  /**
   * The edge guard for one variant, every violation at once: a blank id
   * (`catalog.id.empty`) and each blank locale of the name. The id is kept
   * exactly as given; the name is trimmed.
   */
  parse(
    raw: ServiceVariantInput,
  ): Result<ServiceVariant, readonly CatalogError[]> {
    const errors: CatalogError[] = [];
    if (raw.id.trim().length === 0) {
      errors.push(CatalogError.idEmpty('ServiceVariantId'));
    }
    const name = LocalizedText.parse(raw.name);
    if (!name.ok) errors.push(...name.error);
    if (!name.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({ id: ServiceVariantId.of(raw.id), name: name.value });
  },

  /**
   * A service's declared variants, in order: an id declared a second time is
   * `catalog.service.duplicate_variant` (the repeat is skipped, not parsed),
   * and every variant's own violations are reported too.
   */
  parseAll(
    raws: readonly ServiceVariantInput[],
  ): Result<readonly ServiceVariant[], readonly CatalogError[]> {
    const errors: CatalogError[] = [];
    const variants: ServiceVariant[] = [];
    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i] as ServiceVariantInput;
      if (declaredBefore(raws, i)) {
        errors.push(CatalogError.serviceDuplicateVariant(raw.id));
        continue;
      }
      const parsed = ServiceVariant.parse(raw);
      if (parsed.ok) variants.push(parsed.value);
      else errors.push(...parsed.error);
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(variants);
  },
} as const;

function isPad(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0;
}

/** An earlier entry declares the same raw id — a linear scan; variant lists are a handful long. */
function declaredBefore(
  raws: readonly ServiceVariantInput[],
  index: number,
): boolean {
  const id = (raws[index] as ServiceVariantInput).id;
  for (let j = 0; j < index; j++) {
    if ((raws[j] as ServiceVariantInput).id === id) return true;
  }
  return false;
}
