/**
 * The ONE brand helper of the core (Law 7.4). Every coordinate, amount, zone
 * and id is `Brand<base, 'Tag'>`: nominal per tag — a `LocalDate` is never a
 * `TenantId`, a raw literal is never either — with zero runtime cost, because
 * the symbol below is declared, never created, and the type erases entirely
 * (verified on the repo's TS 6.0.3, 2026-10-10).
 *
 * The cast to a brand lives only in that brand's own `*.primitive.ts` file
 * (its smart constructor and its invariant-preserving helpers); everywhere
 * else a brand is made by the companion (`LocalDate.parse(raw)`,
 * `MinuteOfDay.of(raw)`, `AppointmentId.parse(raw)`).
 */
declare const BrandSymbol: unique symbol;

/** Nominal type over a JavaScript primitive — zero runtime cost. */
export type Brand<T, B extends string> = T & { readonly [BrandSymbol]: B };
