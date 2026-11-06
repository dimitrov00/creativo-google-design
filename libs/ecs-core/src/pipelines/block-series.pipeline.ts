import type {
  BlockSeriesScope,
  MinuteRange,
  RecurrenceRule,
} from '@core/components';
import type { BlockSeries, ScheduleException } from '@core/entities';
import { type RepositoryError, SchedulingError } from '@core/errors';
import type {
  BlockSeriesState,
  BlockSeriesWritePorts,
  ClockPorts,
  EndlessBlockSeriesPorts,
  IdPorts,
  LocationLoadPorts,
} from '@core/ports';
import {
  type BarberId,
  BlockSeriesId,
  BusyKey,
  type LocalDate,
  type LocationId,
  Result,
  ScheduleExceptionId,
  type TimeZone,
} from '@core/primitives';
import {
  BlockSeriesSystem,
  ScheduleExceptionSystem,
  ZonedTimeSystem,
} from '@core/systems';

/** A new repeating block: one chair, its range, the rule from its first day. */
export type CreateBlockSeriesCommand = {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly timeZone: TimeZone;
  readonly range: MinuteRange;
  readonly startLocalDate: LocalDate;
  readonly rule: RecurrenceRule;
};

/**
 * An edit of a repeating block's day, as far as `scope` reaches: the series
 * AS THIS SCREEN READ IT (the transaction checks it still stands), the day,
 * the new range — `null` lifts it — and the zone of the shop it is filed at.
 */
export type EditBlockSeriesCommand = {
  readonly series: BlockSeries;
  readonly localDate: LocalDate;
  readonly scope: BlockSeriesScope;
  readonly range: MinuteRange | null;
  readonly timeZone: TimeZone;
};

/** What the write-ahead did: series written ahead, and the ones it could not. */
export type BlockSeriesTopUpReport = {
  readonly written: number;
  readonly failed: readonly BlockSeriesId[];
};

/** A day's exception identity: its busy key, the chair, the shop, its first instant in the shop's zone. */
function dayMeta(
  barberId: BarberId,
  localDate: LocalDate,
  locationId: LocationId,
  timeZone: TimeZone,
) {
  return {
    id: ScheduleExceptionId.of(BusyKey.of(barberId, localDate)),
    barberId,
    localDate,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(localDate, timeZone),
    locationId,
  };
}

/** Each day's exception with `range` blocked on it — a day off whole stays as stored. */
function blockDays(
  stored: readonly (ScheduleException | null)[],
  days: readonly LocalDate[],
  range: MinuteRange,
  series: BlockSeries,
  timeZone: TimeZone,
): Result<readonly (ScheduleException | null)[], SchedulingError> {
  const next: (ScheduleException | null)[] = [];
  for (const [index, localDate] of days.entries()) {
    const existing = stored.at(index) ?? null;
    const decided = ScheduleExceptionSystem.block(
      existing,
      [range],
      dayMeta(series.barberId, localDate, series.locationId, timeZone),
    );
    if (!decided.ok) return decided;
    next.push(decided.value ?? existing);
  }
  return Result.ok(next);
}

/**
 * `createBlockSeries` — «Запази» on a repeating block (owner, 2026-11-06:
 * "a lunch break is a recurring blocker"): the series is bound to its rule
 * (`BlockSeriesSystem.create` — a rule that never lands is refused before
 * anything is read), then every day it lists is blocked AND the series
 * document written, in one transaction.
 */
export const createBlockSeries =
  (ports: BlockSeriesWritePorts & IdPorts) =>
  async (
    cmd: CreateBlockSeriesCommand,
  ): Promise<Result<BlockSeries, SchedulingError | RepositoryError>> => {
    const created = BlockSeriesSystem.create({
      id: BlockSeriesId.of(ports.nextId()),
      barberId: cmd.barberId,
      locationId: cmd.locationId,
      range: cmd.range,
      startLocalDate: cmd.startLocalDate,
      rule: cmd.rule,
    });
    if (!created.ok) return created;
    const series = created.value;
    const written = await ports.writeBlockSeries(
      series.localDates.map((day) => BusyKey.of(series.barberId, day)),
      [series.id],
      (stored): Result<BlockSeriesState, SchedulingError> => {
        const days = blockDays(
          stored.exceptions,
          series.localDates,
          cmd.range,
          series,
          cmd.timeZone,
        );
        return days.ok
          ? Result.ok({ exceptions: days.value, series: [series] })
          : days;
      },
    );
    return written.ok ? Result.ok(series) : written;
  };

/**
 * `editBlockSeries` — a repeating block's day moved, resized or lifted,
 * reaching «Само този ден» or «Този и следващите»
 * (`BlockSeriesSystem.edit`). One transaction reads every day it reaches and
 * the series: a series that changed since the screen read it is refused
 * (`SCHEDULING_BLOCK_SERIES_MOVED`), so two devices never cut one series
 * twice; otherwise each day's series range is lifted and the new one
 * written, and the series documents land as the edit left them (the old one
 * cut or gone, a new one from that day).
 */
export const editBlockSeries =
  (ports: BlockSeriesWritePorts & IdPorts) =>
  (
    cmd: EditBlockSeriesCommand,
  ): Promise<Result<void, SchedulingError | RepositoryError>> => {
    const read = cmd.series;
    const plan = BlockSeriesSystem.edit(
      read,
      cmd.localDate,
      cmd.scope,
      cmd.range,
      () => BlockSeriesId.of(ports.nextId()),
    );
    const fresh = plan.series.filter((series) => series.id !== read.id);
    const ids = [read.id, ...fresh.map((series) => series.id)];
    const was: MinuteRange = {
      startMinutes: read.startMinutes,
      endMinutes: read.endMinutes,
    };
    return ports.writeBlockSeries(
      plan.days.map((day) => BusyKey.of(read.barberId, day)),
      ids,
      (stored): Result<BlockSeriesState, SchedulingError> => {
        if (!BlockSeriesSystem.stands(stored.series[0] ?? null, read)) {
          return Result.err(SchedulingError.blockSeriesMoved(read.id));
        }
        const lifted: (ScheduleException | null)[] = [];
        for (let i = 0; i < plan.days.length; i++) {
          const left = ScheduleExceptionSystem.unblock(
            stored.exceptions[i] ?? null,
            was,
          );
          if (!left.ok) return left;
          lifted.push(left.value);
        }
        const days =
          plan.range === null
            ? Result.ok(lifted)
            : blockDays(lifted, plan.days, plan.range, read, cmd.timeZone);
        if (!days.ok) return days;
        return Result.ok({
          exceptions: days.value,
          series: ids.map(
            (id) => plan.series.find((series) => series.id === id) ?? null,
          ),
        });
      },
    );
  };

/**
 * `topUpBlockSeries` — the daily write-ahead of the series that never end
 * (`BlockSeriesSystem.topUp`): each is read in its shop's zone for today,
 * its next days blocked and the series' list moved on, one transaction per
 * series; a series somebody changed meanwhile is left for tomorrow. One
 * series failing never stops the rest.
 */
export const topUpBlockSeries =
  (
    ports: EndlessBlockSeriesPorts &
      BlockSeriesWritePorts &
      LocationLoadPorts &
      ClockPorts,
  ) =>
  async (): Promise<Result<BlockSeriesTopUpReport, RepositoryError>> => {
    const listed = await ports.listEndlessBlockSeries();
    if (!listed.ok) return listed;
    let written = 0;
    const failed: BlockSeriesId[] = [];
    const now = ports.nowUtcMs();
    for (const series of listed.value) {
      const location = await ports.loadLocation(series.locationId);
      if (!location.ok || location.value === null) {
        failed.push(series.id);
        continue;
      }
      const timeZone = location.value.timeZone;
      const today = ZonedTimeSystem.shopNow(now, timeZone).localDate;
      const top = BlockSeriesSystem.topUp(series, today);
      if (top === null) continue;
      const range: MinuteRange = {
        startMinutes: series.startMinutes,
        endMinutes: series.endMinutes,
      };
      const done = await ports.writeBlockSeries(
        top.days.map((day) => BusyKey.of(series.barberId, day)),
        [series.id],
        (stored): Result<BlockSeriesState, SchedulingError> => {
          if (!BlockSeriesSystem.stands(stored.series[0] ?? null, series)) {
            return Result.err(SchedulingError.blockSeriesMoved(series.id));
          }
          const days = blockDays(
            stored.exceptions,
            top.days,
            range,
            series,
            timeZone,
          );
          return days.ok
            ? Result.ok({ exceptions: days.value, series: [top.series] })
            : days;
        },
      );
      if (done.ok) written += 1;
      else failed.push(series.id);
    }
    return Result.ok({ written, failed });
  };
