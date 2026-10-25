import type {
  DurationMinutes,
  MinuteCount,
  MinuteOfDay,
} from '@core/primitives';

/**
 * What a seat's chair geometry reads — its start and its snapshotted
 * minutes. A whole `Seat` passes straight in; so does any slice that holds
 * these (the staff grid's occupancy rows). (Split out of `seat.data.ts`,
 * pass D, L-2.)
 */
export type ChairGeometry = {
  readonly startMinutes: MinuteOfDay;
  readonly durationMinutes: DurationMinutes;
  readonly setupMinutes: MinuteCount;
  readonly cleanupMinutes: MinuteCount;
};
