import { Weekday } from '@core/primitives';
import { DayHours, OpeningState } from '@core/components';
import type { ShopLocation } from '@core/entities';
import { ShopReachSystem } from '@core/systems';
import { ClockClosing, formatClock } from '@creativo/ui/wall-clock';
import type { ShopHoursLine, ShopVm, ShopWeekLines } from './locations.vm';

/**
 * A stored shop → what the «Visit» section prints of it (Law 10): the
 * catalogue's `ShopLocation` as the read answered it, plus its photos as
 * the session's media cache resolved them. Nothing is authored — the name,
 * the address, the number, the hours and the pin are the shop's own.
 */
export function shopVm(
  location: ShopLocation,
  gallery: readonly string[],
): ShopVm {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    phoneDisplay: location.phoneDisplay,
    callHref: ShopReachSystem.callHref(location),
    directionsHref: ShopReachSystem.mapHref(location),
    timeZone: location.timeZone,
    week: location.openingHours,
    schedule: weekLines(location.openingHours),
    gallery,
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

/** The section's heading: «Лесно ще ни намериш.» for one shop, «Нашите локации.» for more. */
export function shopsHeadingKey(shops: readonly ShopVm[]): string {
  return shops.length > 1
    ? 'landing.location.titleMulti'
    : 'landing.location.title';
}

/**
 * The week as the list prints it, Sunday first: each open day's `HH:MM`
 * pair (`formatClock`, a midnight close as «24:00» — never a locale's
 * «8:00 PM»), `null` a closed one.
 */
function weekLines(week: readonly DayHours[]): ShopWeekLines {
  const at = (weekday: Weekday): ShopHoursLine | null => {
    const day = DayHours.forWeekday(week, weekday);
    return day !== null && day.openingState === OpeningState.Open
      ? {
          open: formatClock(day.openMinutes, ClockClosing.EndOfDay),
          close: formatClock(day.closeMinutes, ClockClosing.EndOfDay),
        }
      : null;
  };
  return [
    at(Weekday.Sun),
    at(Weekday.Mon),
    at(Weekday.Tue),
    at(Weekday.Wed),
    at(Weekday.Thu),
    at(Weekday.Fri),
    at(Weekday.Sat),
  ];
}
