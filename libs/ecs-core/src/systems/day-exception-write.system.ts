import { type Actor, type DayExceptionsEdit, WriteOp } from '@core/components';
import {
  type BarberId,
  BusyKey,
  defect,
  type LocalDate,
  type OperationId,
  ScheduleExceptionId,
  type UtcEpochMs,
} from '@core/primitives';
import { Collections, type ScheduleException } from '@core/entities';
import { type AuditRowPlan, AuditSystem } from './audit.system';
import { CanonicalJsonSystem } from './canonical-json.system';

/**
 * One day-exceptions act, as its transaction decided it: the pen, the day
 * documents it read (`keys`, with what each held — `stored`, `null` when
 * absent) and what each becomes (`merged`, `null` deletes), who did it and
 * the act's name. The three lists are parallel.
 */
export type DayExceptionsWrite = {
  readonly edit: DayExceptionsEdit;
  readonly keys: readonly BusyKey[];
  readonly stored: readonly (ScheduleException | null)[];
  readonly merged: readonly (ScheduleException | null)[];
  /** The caller, credited over their STORED roles (`Actor.forCaller`). */
  readonly actor: Actor;
  readonly nowUtcMs: UtcEpochMs;
  readonly operationId: OperationId;
};

/** One barber's days an act changed, in the order it changed them. */
type ChangedDays = {
  readonly barberId: BarberId;
  readonly days: LocalDate[];
};

/** Shop days compare as `YYYY-MM-DD` strings. */
function byDay(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * DayExceptionWriteSystem — the write plan of a `setDayExceptions` act
 * (team onboarding D5, D12). Pure: the pipeline's transaction reads the
 * days, the pens' own merge (`ScheduleExceptionSystem`) says what each
 * becomes, and this turns the difference into writes and audit rows.
 */
export const DayExceptionWriteSystem = {
  /**
   * The writes of one act: each day whose document really changes is SET
   * whole (the entity minus its id) or removed — a day that held nothing
   * and still holds nothing, and a day left exactly as it was, is not
   * written — and each barber with a changed day gets ONE
   * `TEAM_DAY_EXCEPTIONS_CHANGED` row under `hash(idBasis)`, naming the pen
   * and the span of their days, credited to the caller. The rows land with
   * the days or not at all. An act that changes no day plans NOTHING — a
   * save of what is already there, and the replay of an act that landed.
   */
  writesOf(
    write: DayExceptionsWrite,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    const { keys, stored, merged } = write;
    if (stored.length !== keys.length || merged.length !== keys.length) {
      return defect(
        `day exceptions: ${keys.length} keys, ${stored.length} stored, ${merged.length} merged`,
      );
    }
    const writes: WriteOp[] = [];
    const changed: ChangedDays[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as BusyKey;
      const before = stored[i] ?? null;
      const after = merged[i] ?? null;
      const path = [Collections.ScheduleExceptions, key];
      if (after === null) {
        if (before === null) continue;
        writes.push(WriteOp.remove(path));
      } else {
        const { id, ...body } = after;
        // A day's document is named by its busy key: a body for another day is a defect.
        if (id !== ScheduleExceptionId.of(key)) {
          return defect(`day exceptions: ${id} for ${key}`);
        }
        if (
          before !== null &&
          CanonicalJsonSystem.of(before) === CanonicalJsonSystem.of(after)
        ) {
          continue;
        }
        writes.push(WriteOp.set(path, body));
      }
      const { barberId, localDate } = BusyKey.split(key);
      let days: LocalDate[] | null = null;
      for (let j = 0; j < changed.length; j++) {
        const entry = changed[j] as ChangedDays;
        if (entry.barberId === barberId) {
          days = entry.days;
          break;
        }
      }
      if (days === null) {
        days = [];
        changed.push({ barberId, days });
      }
      days.push(localDate);
    }
    if (changed.length === 0) return [];
    const rows: AuditRowPlan[] = [];
    for (let i = 0; i < changed.length; i++) {
      const { barberId, days } = changed[i] as ChangedDays;
      rows.push(
        AuditSystem.planTeamDayExceptions(
          barberId,
          write.edit,
          [...days].sort(byDay),
          write.actor,
          write.nowUtcMs,
          write.operationId,
        ),
      );
    }
    return [...writes, ...AuditSystem.createsOf(rows, hash)];
  },
} as const;
