import type { BarberId } from '@core/primitives';

/** One last day to decide on, as the schedule says it: one line and «Удължи». */
export type ScheduleReminderVm = {
  readonly barberId: BarberId;
  /** «Последният ден на Георги е пт, 20.11» — «Днес е …» on the day itself. */
  readonly line: string;
  /** «Удължи» */
  readonly action: string;
  readonly testId: string;
};
