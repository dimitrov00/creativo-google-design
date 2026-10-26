import type { ShopNow } from '@core/components';
import type { TimeZone, UtcEpochMs } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { formatWallClock } from '@creativo/ui/wall-clock';
import type { PhotoMomentVm } from './photo-moment.vm';
import { visitClockOf } from './visit-row.presenter';

/**
 * A photo's moment in the active language (OR-5): its stamp read ONCE onto
 * the shop's calendar (`ZonedTimeSystem.toLocal`, the one zone engine, on
 * the location's `timeZone` — Law 7.2), then worded three ways from that
 * one wall-clock reading. The year shows only outside the shop's current
 * one, by the visit clock's own rule (`VisitClock.yearIfElsewhere`, R59) —
 * this year is the shop's `now`, never the device's. `locale` is an `Intl`
 * tag (`intlLocaleOf`): «4.09, 16:21» / «4.09» / «16:21» in `bg-BG`,
 * «4 Sept, 16:21» / «4/09» / «16:21» in `en-GB`.
 */
export function photoMomentOf(
  takenAtUtcMs: UtcEpochMs,
  timeZone: TimeZone,
  now: ShopNow,
  locale: string,
): PhotoMomentVm {
  const taken = ZonedTimeSystem.toLocal(takenAtUtcMs, timeZone);
  const clock = visitClockOf(
    taken.localDate,
    taken.minute,
    now,
    locale,
    timeZone,
  );
  return {
    when: formatWallClock(taken.localDate, taken.minute, locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    day: formatWallClock(taken.localDate, null, locale, {
      day: 'numeric',
      month: '2-digit',
      ...clock.yearIfElsewhere(taken.localDate),
    }),
    time: clock.time(),
  };
}
