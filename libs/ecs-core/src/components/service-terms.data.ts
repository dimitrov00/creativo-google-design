import {
  Currency,
  defect,
  DurationMinutes,
  MinuteCount,
  PriceCents,
  Result,
  type StoredFields,
} from '@core/primitives';
import { CatalogError } from '@core/errors';
import { Money } from './money.data';
import type { ServiceTermsInput } from './service-terms-input.data';

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
  ): Result<ServiceTerms, readonly CatalogError.Terms[]> {
    const errors: CatalogError.Terms[] = [];
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

  /**
   * The read-time check of stored terms (edge hardening D-1): the NAME of
   * the first field that is not well-formed — `priceCents` (a non-negative
   * safe integer), `currency` (a known code as stored), `durationMinutes`
   * (positive), `setupMinutes`, `cleanupMinutes` (non-negative) — or
   * `null`. What the bill sums and the chair-time math adds. No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    if (!PriceCents.is(raw['priceCents'])) return 'priceCents';
    if (!Currency.is(raw['currency'])) return 'currency';
    if (!DurationMinutes.is(raw['durationMinutes'])) return 'durationMinutes';
    if (!MinuteCount.is(raw['setupMinutes'])) return 'setupMinutes';
    return MinuteCount.is(raw['cleanupMinutes']) ? null : 'cleanupMinutes';
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
