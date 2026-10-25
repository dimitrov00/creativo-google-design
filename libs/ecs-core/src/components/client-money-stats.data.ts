import { Currency, PriceCents } from '@core/primitives';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1).
 */

/**
 * Lifetime spend, tips excluded (a tip is not the shop's money), in the
 * cents of `currency` — the flat `lifetimeSpendMinor` + `currencyCode` the
 * document stores today, branded (N6). Its own slice because it lives in its
 * own admin-only document: rules cannot hide a field (R33). The content
 * only — whose spend it is is the record's `ClientStatsKey`.
 */
export type ClientMoneyStats = {
  readonly lifetimeSpendCents: PriceCents;
  readonly currency: Currency;
};

export const ClientMoneyStats = {
  /** Nothing spent yet, in the shop's currency. */
  zero(): ClientMoneyStats {
    return {
      lifetimeSpendCents: PriceCents.ZERO,
      currency: Currency.EUR,
    };
  },
} as const;
