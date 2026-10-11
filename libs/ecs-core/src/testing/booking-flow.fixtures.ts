import { ExceptionEffectRule } from '../components/exception-effect.data';
import type { Result } from '../components/result.data';
import type { ScheduleException } from '../entities/schedule-exception.entity';
import { BusyKey } from '../primitives/busy-key.primitive';
import {
  BarberId,
  LocationId,
  ScheduleExceptionId,
} from '../primitives/ids.primitive';
import { LocalDate } from '../primitives/local-date.primitive';
import { ZonedTimeSystem } from '../systems/zoned-time.system';

/**
 * The booking-flow fixtures (flatten-spec §8.1/§8.4) — the schedule
 * exception in its flat, branded shape, every field present, overridable
 * field by field. Test support only, reached through
 * `@creativo/ecs-core/testing`.
 *
 * Self-contained on purpose: `testing.ts` re-exports this file, so it never
 * imports `testing.ts` back (a cycle would hand a spec half-initialised
 * constants). The pins it shares with `testing.ts` — the fixture barber and
 * shop, `FIXTURE_TODAY`, the shop's zone — are restated here and held equal
 * by `booking-flow.fixtures.spec.ts`.
 */

function sure<T, E>(result: Result<T, E>, what: string): T {
  if (!result.ok) {
    throw new Error(
      `${what}: ${JSON.stringify(result.error)} — a broken fixture`,
    );
  }
  return result.value;
}

const BARBER = BarberId.of('b-ivan');
const LOCATION = LocationId.of('loc-center');
const TODAY = sure(LocalDate.parse('2026-09-28'), 'today');
const SHOP_ZONE = sure(ZonedTimeSystem.checkZone('Europe/Sofia'), 'zone');

/**
 * Ivan off for the whole of today — the public effect only (§9 D16(b)). The
 * id is the day's `BusyKey`, as the writer names it; `utcEpochMs` is the
 * first instant of the shop day (2026-09-28 00:00 Sofia = 2026-09-27T21:00Z).
 */
export function scheduleExceptionFixture(
  overrides: Partial<ScheduleException> = {},
): ScheduleException {
  return {
    id: ScheduleExceptionId.of(BusyKey.of(BARBER, TODAY)),
    barberId: BARBER,
    localDate: TODAY,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(TODAY, SHOP_ZONE),
    locationId: LOCATION,
    ...ExceptionEffectRule.closed(),
    ...overrides,
  } as ScheduleException;
}
