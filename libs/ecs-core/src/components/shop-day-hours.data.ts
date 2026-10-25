import type { EndMinute, MinuteOfDay } from '@core/primitives';

/**
 * The shop's own opening hours for one day, on its wall clock — the
 * in-memory envelope a roster window is clamped to (`roster-window.ts:39`).
 * A shop that publishes no hours, or is closed that day, is the caller's
 * `null` / empty list, never a zero-length struct. Split out of
 * `roster-window.data.ts` (pass D, D-7).
 */
export type ShopDayHours = {
  readonly openMinutes: MinuteOfDay;
  readonly closeMinutes: EndMinute;
};

export const ShopDayHours = {
  of(openMinutes: MinuteOfDay, closeMinutes: EndMinute): ShopDayHours {
    return { openMinutes, closeMinutes };
  },
} as const;
