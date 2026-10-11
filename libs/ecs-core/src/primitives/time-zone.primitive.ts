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
 * `zoned-time.system.ts`. This file holds the alias and its JSDoc only.
 */
export type TimeZone = Brand<string, 'TimeZone'>;
