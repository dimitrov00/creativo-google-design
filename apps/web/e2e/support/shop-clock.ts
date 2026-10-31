/**
 * THE SHOP'S CLOCK, ONCE, for the e2e suite — the one zone source every
 * support module and spec reads: the shop's zone checked once through
 * `ZonedTimeSystem.checkZone`, its today through `ZonedTimeSystem.shopNow`,
 * an instant's shop day through `ZonedTimeSystem.toLocal` and a wall-clock
 * moment through `ZonedTimeSystem.toUtc` — the zone engine the app itself
 * runs (Law 7), never a second `Intl` reading of the zone.
 *
 * Firebase-free and Node-free on purpose: `appointment-seed-document.ts`
 * builds on it, and the web unit-test build compiles that one too — which
 * is why the PURE half of the suite's clock lives here
 * (`apps/web/src/testing/e2e-suite-clock.spec.ts` holds it): the instant a
 * text names, the browser's pinned instant for a shop day, and the run's
 * one instant. The env-reading half is `suite-clock.ts` (Phase 3 WS-A,
 * P3-DEP-3). The live `shopToday()` stays for the unpinned specs, which
 * book or edit days from tomorrow on against the live browser and the
 * live server (P3-L-1).
 */
import type { TimeError } from '@core/errors';
import {
  LocalDate,
  MinuteOfDay,
  type PrimitiveError,
  type Result,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';

/** A smart constructor's answer for a value that is one by construction — a refusal fails the run loudly. */
export function sure<T, E>(result: Result<T, E>, what: string): T {
  if (!result.ok) throw new Error(`e2e seed: ${what} is not valid`);
  return result.value;
}

/** The shop's zone: every seeded slot is shop time. */
export const SHOP_ZONE = 'Europe/Sofia';

/** The shop's zone, checked once at this edge. */
export const SHOP_TIME_ZONE: TimeZone = sure(
  ZonedTimeSystem.checkZone(SHOP_ZONE),
  SHOP_ZONE,
);

/** An instant on the shop's wall clock — `day` at `hour:minute`, read in its zone. */
export function shopInstant(day: string, hour: number, minute = 0): UtcEpochMs {
  return sure(
    ZonedTimeSystem.toUtc(
      sure(LocalDate.parse(day), day),
      sure(MinuteOfDay.of(hour * 60 + minute), `${hour}:${minute}`),
      SHOP_TIME_ZONE,
    ),
    `${day} ${hour}:${minute}`,
  );
}

/** The shop day an instant falls on — `YYYY-MM-DD`, whatever the device's zone. */
export function shopDayOf(at: UtcEpochMs): LocalDate {
  return ZonedTimeSystem.toLocal(at, SHOP_TIME_ZONE).localDate;
}

/** Today on the shop's wall clock — `YYYY-MM-DD`, whatever the device's zone. */
export function shopToday(): LocalDate {
  return ZonedTimeSystem.shopNow(
    sure(UtcEpochMs.of(Date.now()), 'now'),
    SHOP_TIME_ZONE,
  ).localDate;
}

/**
 * The minute of the shop day a PINNED browser reads (`pinBrowserClock`):
 * 10:00 — inside every open day's hours, and never inside a DST gap.
 */
export const BROWSER_PIN_MINUTE: MinuteOfDay = sure(
  MinuteOfDay.of(10 * 60),
  '10:00',
);

/**
 * Where a pinned spec's "today" visits start, as the naive wall time
 * `HH:mm:00` a seed reads: 21:00 — eleven hours ahead of the pinned 10:00,
 * so the visit is still to come (`VisitStorySystem.isUpcoming`) whatever
 * the real hour, and the dev chair's 30-minute visit ends 21:30, the same
 * shop day.
 */
export const EVENING_VISIT_START = '21:00:00';

/** Epoch milliseconds, the one form the suite hands its workers. */
const EPOCH_DIGITS = /^\d+$/;

/**
 * One instant from the suite's text — the seed's grammar (P3-RU-3): epoch
 * milliseconds (digits), a wall time on the SHOP's clock
 * (`2026-10-27T23:40`), or an ISO instant with `Z` or an offset. A time in
 * the spring-forward gap refuses (`DST_GAP_INVALID_TIME`), a fall-back
 * repeat takes the earlier offset (Law 7.3); a refusal fails the run
 * loudly through {@link sure}, naming its `errorCode`.
 */
export function instantOfText(text: string): UtcEpochMs {
  const parsed: Result<UtcEpochMs, PrimitiveError | TimeError> =
    EPOCH_DIGITS.test(text)
      ? UtcEpochMs.of(Number(text))
      : ZonedTimeSystem.parseIsoIn(text, SHOP_TIME_ZONE);
  return sure(
    parsed,
    `the instant '${text}'${parsed.ok ? '' : ` (${parsed.error.errorCode})`}`,
  );
}

/** The browser's pinned instant for a shop day: `day` at {@link BROWSER_PIN_MINUTE} on the shop's clock. */
export function browserPinOf(day: LocalDate): UtcEpochMs {
  return sure(
    ZonedTimeSystem.toUtc(day, BROWSER_PIN_MINUTE, SHOP_TIME_ZONE),
    `${day} 10:00`,
  );
}

/**
 * The run's ONE instant: `text` (the suite's `E2E_NOW`) when given — it
 * must fall on the REAL shop day of `realNowMs`, else the run stops here —
 * or `realNowMs` itself. Global setup alone calls it (`fixSuiteInstant`):
 * the workers inherit the answer and never check the day again, so a
 * worker that starts after the real midnight keeps the run's day.
 */
export function resolveSuiteInstant(
  text: string | null,
  realNowMs: UtcEpochMs,
): UtcEpochMs {
  if (text === null) return realNowMs;
  const instant = instantOfText(text);
  const realDay = shopDayOf(realNowMs);
  const day = shopDayOf(instant);
  if (day !== realDay) {
    throw new Error(
      `e2e: E2E_NOW '${text}' falls on the shop day ${day}, not on today's ${realDay}`,
    );
  }
  return instant;
}
