import type { MinuteRange } from '@core/components';
import type { ScheduleException } from '@core/entities';
import type { RepositoryError, SchedulingError } from '@core/errors';
import type { ScheduleExceptionPorts } from '@core/ports';
import {
  type BarberId,
  BusyKey,
  type LocalDate,
  type LocationId,
  Result,
  ScheduleExceptionId,
  type TimeZone,
} from '@core/primitives';
import { ScheduleExceptionSystem, ZonedTimeSystem } from '@core/systems';

/**
 * Block time on one chair's days — one day (`blockTime`) or a series
 * (`blockSeries`), the same act. `ranges` empty stands each day down whole.
 * `timeZone` is the zone of the shop the block is written at, which the
 * caller has resolved (`ShopZoneSystem.zoneOr`): each day's first instant is
 * read in it once, here at the ingestion boundary (Law 7.3).
 */
export type ScheduleBlocksCommand = {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly timeZone: TimeZone;
  readonly ranges: readonly MinuteRange[];
  readonly localDates: readonly LocalDate[];
};

/** Lift ONE block from a chair's day — or, with `range` `null`, the whole day. */
export type ClearScheduleBlockCommand = {
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly range: MinuteRange | null;
};

/**
 * `writeScheduleBlocks` — the staff's pen on the roster (pass C, D-10; the
 * store's `writeBlocks`). ONE exception write for every day, in the given
 * order: the transaction reads each day's stored body and hands it to the
 * pure decision, `ScheduleExceptionSystem.block` (Law 4 — the transaction is
 * the sandwich), which answers the day's new body — or "keep it" for a day
 * already off whole, written back as stored — or refuses, in which case
 * nothing is written. Every day's identity slice is its busy key, the
 * barber, the day, the shop and the day's first instant in the shop's zone.
 */
export const writeScheduleBlocks =
  (ports: ScheduleExceptionPorts) =>
  (
    cmd: ScheduleBlocksCommand,
  ): Promise<Result<void, SchedulingError | RepositoryError>> =>
    ports.writeScheduleException(
      cmd.localDates.map((localDate) => BusyKey.of(cmd.barberId, localDate)),
      (stored) => {
        const next: (ScheduleException | null)[] = [];
        for (const [index, localDate] of cmd.localDates.entries()) {
          const existing = stored.at(index) ?? null;
          const decided = ScheduleExceptionSystem.block(existing, cmd.ranges, {
            id: ScheduleExceptionId.of(BusyKey.of(cmd.barberId, localDate)),
            barberId: cmd.barberId,
            localDate,
            utcEpochMs: ZonedTimeSystem.startOfLocalDay(
              localDate,
              cmd.timeZone,
            ),
            locationId: cmd.locationId,
          });
          if (!decided.ok) return decided;
          next.push(decided.value ?? existing);
        }
        return Result.ok(next);
      },
    );

/**
 * `clearScheduleBlock` — lift a block, or the whole day (pass C, D-10; the
 * store's `clearBlock`). One key; the transaction reads the stored day and
 * hands it to `ScheduleExceptionSystem.unblock`, whose `null` deletes the
 * day's document and whose refusal (a range lifted from a day off whole)
 * writes nothing.
 */
export const clearScheduleBlock =
  (ports: ScheduleExceptionPorts) =>
  (
    cmd: ClearScheduleBlockCommand,
  ): Promise<Result<void, SchedulingError | RepositoryError>> =>
    ports.writeScheduleException(
      [BusyKey.of(cmd.barberId, cmd.localDate)],
      (stored) => {
        const decided = ScheduleExceptionSystem.unblock(
          stored[0] ?? null,
          cmd.range,
        );
        return decided.ok ? Result.ok([decided.value]) : decided;
      },
    );
