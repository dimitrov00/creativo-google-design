import type { LocalDate } from '@core/primitives';

/**
 * The bookings a barber's last working day would leave behind (team
 * onboarding D10): how many live visits they hold AFTER that day, and the
 * shop days those fall on — each day once, oldest first. Nothing is
 * cancelled for the owner: a visit stays until someone moves or cancels
 * it, so the count is what the period sheet says before the day is saved.
 */
export type LeftoverBookings = {
  readonly leftoverCount: number;
  readonly leftoverLocalDates: readonly LocalDate[];
};

/** Nothing after the day. */
const NONE: LeftoverBookings = { leftoverCount: 0, leftoverLocalDates: [] };

export const LeftoverBookings = {
  NONE,
} as const;
