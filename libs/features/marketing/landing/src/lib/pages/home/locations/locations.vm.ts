import type { DayHours, LocalizedText } from '@core/components';
import type { LocationId, TimeZone } from '@core/primitives';

/** One open day as the week list prints it: «09:00» – «20:00». */
export interface ShopHoursLine {
  readonly open: string;
  readonly close: string;
}

/** The week as the list prints it, Sunday first (the ISO weekday mod 7); `null` a closed day. */
export type ShopWeekLines = readonly [
  ShopHoursLine | null,
  ShopHoursLine | null,
  ShopHoursLine | null,
  ShopHoursLine | null,
  ShopHoursLine | null,
  ShopHoursLine | null,
  ShopHoursLine | null,
];

/**
 * One stored shop as the «Visit» section draws it (`shopVm`): its name and
 * address as the catalogue's localized pairs (resolved at render time, like
 * every catalogue view model), the number as the shop prints it beside the
 * `tel:` it dials, where «directions» leads, and its week — the stored
 * `DayHours` its open/closed line is judged on, and the same week worded.
 */
export interface ShopVm {
  readonly id: LocationId;
  readonly name: LocalizedText;
  readonly address: LocalizedText;
  readonly phoneDisplay: string;
  readonly callHref: string;
  readonly directionsHref: string;
  /** The shop's IANA zone: its open/closed line runs on the SHOP's clock. */
  readonly timeZone: TimeZone;
  /** The stored week, Monday first — what `RosterSystem.shopOpeningAt` judges. */
  readonly week: readonly DayHours[];
  /** The same week as the list prints it. */
  readonly schedule: ShopWeekLines;
  /** The shop's own photos, resolved; `[]` hides the sheet's gallery. */
  readonly gallery: readonly string[];
  readonly latitude: number;
  readonly longitude: number;
}
