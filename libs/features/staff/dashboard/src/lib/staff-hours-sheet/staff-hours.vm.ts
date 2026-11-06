import type { Weekday } from '@core/primitives';

/** One weekday row of the hours sheet — «Понеделник · 09:00–18:00 · Почивка 13:00–14:00». */
export type HoursDayVm = {
  readonly weekday: Weekday;
  /** «Понеделник». */
  readonly name: string;
  /** «09:00–18:00», «09:00–13:00, 15:00–19:00», or «Почивен». */
  readonly hours: string;
  /** «Почивка 13:00–14:00», or `null` with no break. */
  readonly breaks: string | null;
  readonly off: boolean;
  /** «Понеделник, 09:00–18:00, Почивка 13:00–14:00». */
  readonly accessibleName: string;
};

/** The words the hours sheet's rows are made of. */
export type HoursWords = {
  /** «Понеделник» — `staff.hours.weekday.<day>`. */
  readonly weekday: (weekday: Weekday) => string;
  /** «Почивен» — `staff.hours.off`. */
  readonly off: string;
  /** «Почивка 13:00–14:00» — `staff.hours.breakLine`. */
  readonly breakLine: (ranges: string) => string;
};
