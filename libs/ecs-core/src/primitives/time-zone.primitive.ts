import type { Brand } from './brand';

/**
 * An IANA time zone — configuration of a shop location only
 * (`ShopLocation.timeZone`), never a field of a temporal entity (Law 7.2).
 * Stored in the engine's canonical spelling (`Europe/Sofia`, `UTC`).
 *
 * **Exception (decision F-2):** the smart constructor is
 * `ZonedTimeSystem.checkZone(raw): Result<TimeZone, TimeError>` — the one
 * brand whose cast lives outside its primitive file, because acceptance is
 * "accepted by `Intl.DateTimeFormat`" and the formatter cache lives in
 * `zoned-time.system.ts`. This file holds the alias, its JSDoc and the one
 * zone known without asking the runtime ({@link TimeZone.UTC}).
 */
export type TimeZone = Brand<string, 'TimeZone'>;

/**
 * `UTC` — the one zone every `Intl` runtime must know (ECMA-402 requires
 * it) and the canonical spelling `ZonedTimeSystem.checkZone('UTC')`
 * answers, so the brand is sound without the check (pinned by
 * `age.system.spec.ts`).
 */
const UTC = 'UTC' as TimeZone;

export const TimeZone = {
  /**
   * The clock with no shop behind it: the day a birth date is judged on
   * (`AgeSystem.judgedOn`), a request whose shop zone cannot be read, the
   * footer before a shop is known. Never a stored location's zone.
   */
  UTC,
} as const;
