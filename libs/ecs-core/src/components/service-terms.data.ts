import {
  Currency,
  defect,
  DurationMinutes,
  MinuteCount,
  ServiceVariantId,
  PriceCents,
  Result,
} from '@core/primitives';
import { CatalogError, type MoneyError } from '@core/errors';
import { LocalizedText } from './localized-text.data';
import { Money } from './money.data';

/**
 * What one booking of a service costs, how long it takes and how much unsold
 * chair time surrounds it — a SLICE (Law 6): its five fields sit at the root
 * of whatever carries terms (a `Service`, a `BarberOffering`, a `Seat`), the
 * way the service document already stores them. Money is `priceCents` beside
 * one `currency` (N6); durations are branded minutes (N14).
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
  readonly priceCents: PriceCents;
  readonly currency: Currency;
  /** The sold duration — a positive whole number of minutes. */
  readonly durationMinutes: DurationMinutes;
  /** Unsold time BEFORE the service — mixing, prep. Never charged for. */
  readonly setupMinutes: MinuteCount;
  /** Unsold time AFTER the service — the mop-up. Never charged for. */
  readonly cleanupMinutes: MinuteCount;
};

/** Terms as authored (the catalogue seed, an admin write), before their edge guard — raw figures. */
export type ServiceTermsInput = {
  readonly priceCents: number;
  readonly currency: string;
  readonly durationMinutes: number;
  readonly setupMinutes: number;
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
    priceCents: PriceCents,
    currency: Currency,
    durationMinutes: DurationMinutes,
    setupMinutes: MinuteCount,
    cleanupMinutes: MinuteCount,
  ): ServiceTerms {
    return {
      priceCents,
      currency,
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
    priceCents: PriceCents,
    currency: Currency,
    durationMinutes: DurationMinutes,
  ): ServiceTerms {
    return ServiceTerms.of(
      priceCents,
      currency,
      durationMinutes,
      MinuteCount.ZERO,
      MinuteCount.ZERO,
    );
  },

  /**
   * The edge guard (the catalogue seed, an admin write), every violation at
   * once: the price must be `Money` (a non-negative safe integer in a
   * recognised currency — `MONEY_UNKNOWN_CURRENCY` / `MONEY_INVALID_AMOUNT`),
   * the duration a positive integer and each pad a non-negative integer
   * (`CATALOG_SERVICE_INVALID_DURATION`, carrying the offending figure — a
   * negative or fractional pad is the same authoring mistake as a negative
   * duration and reaches the same place, the grid's arithmetic). The
   * currency comes back normalised (`'eur'` → `'EUR'`).
   */
  parse(
    raw: ServiceTermsInput,
  ): Result<ServiceTerms, readonly ServiceTermsError[]> {
    const errors: ServiceTermsError[] = [];
    const price = Money.of(raw.priceCents, raw.currency);
    if (!price.ok) errors.push(price.error);
    const duration = DurationMinutes.of(raw.durationMinutes);
    if (!duration.ok) {
      errors.push(CatalogError.serviceInvalidDuration(raw.durationMinutes));
    }
    const setup = MinuteCount.of(raw.setupMinutes);
    if (!setup.ok) {
      errors.push(CatalogError.serviceInvalidDuration(raw.setupMinutes));
    }
    const cleanup = MinuteCount.of(raw.cleanupMinutes);
    if (!cleanup.ok) {
      errors.push(CatalogError.serviceInvalidDuration(raw.cleanupMinutes));
    }
    if (
      !price.ok ||
      !duration.ok ||
      !setup.ok ||
      !cleanup.ok ||
      errors.length > 0
    ) {
      return Result.err(errors);
    }
    return Result.ok(
      ServiceTerms.of(
        price.value.amountCents,
        price.value.currency,
        duration.value,
        setup.value,
        cleanup.value,
      ),
    );
  },

  /** Chair time one booking consumes — setup + sold duration + cleanup. */
  occupiedMinutes(terms: ServiceTerms): DurationMinutes {
    const total = DurationMinutes.of(
      terms.setupMinutes + terms.durationMinutes + terms.cleanupMinutes,
    );
    // A positive duration plus two non-negative pads is positive.
    return total.ok ? total.value : defect('ServiceTerms: broken duration');
  },

  /** The price as a standalone `Money` figure — the system arithmetic value. */
  price(terms: ServiceTerms): Money {
    return Money.fromCents(terms.priceCents, terms.currency);
  },

  /** Same price, currency, duration and padding — terms that differ only in padding are different terms. */
  equals(a: ServiceTerms, b: ServiceTerms): boolean {
    return (
      a.priceCents === b.priceCents &&
      a.currency === b.currency &&
      a.durationMinutes === b.durationMinutes &&
      a.setupMinutes === b.setupMinutes &&
      a.cleanupMinutes === b.cleanupMinutes
    );
  },
} as const;

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

/** A variant as authored, before its edge guard. */
export type ServiceVariantInput = {
  readonly variantId: string;
  readonly name: LocalizedText;
};

export const ServiceVariant = {
  /**
   * The edge guard for one variant, every violation at once: a blank id
   * (`CATALOG_ID_EMPTY`) and each blank locale of the name. The id is kept
   * exactly as given; the name is trimmed.
   */
  parse(
    raw: ServiceVariantInput,
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
    raws: readonly ServiceVariantInput[],
  ): Result<readonly ServiceVariant[], readonly CatalogError[]> {
    const errors: CatalogError[] = [];
    const variants: ServiceVariant[] = [];
    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i] as ServiceVariantInput;
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
  raws: readonly ServiceVariantInput[],
  index: number,
): boolean {
  const id = (raws[index] as ServiceVariantInput).variantId;
  for (let j = 0; j < index; j++) {
    if ((raws[j] as ServiceVariantInput).variantId === id) return true;
  }
  return false;
}
