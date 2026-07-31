import { LocationId } from '@creativo/domain/catalog';
import { Money } from '@creativo/domain/kernel';
import { Interval } from './interval';
import { OccupancyClass, classifyOccupancy } from './occupancy-class';
import { OccupancyReason } from './occupancy-reason';

export interface OccupancyBlockProps {
  readonly id: string;
  readonly interval: Interval;
  /** `null` for a barber-scoped absence that belongs to no shop. */
  readonly locationId: LocationId | null;
  readonly reason: OccupancyReason;
  readonly klass: OccupancyClass;
  readonly policyVersion: number;
  readonly revenueMinorUnits: number;
  readonly currencyCode: string;
  /**
   * Placed outside the day's rostered windows — a staff-recorded appointment
   * a barber took before opening, say. Legitimate and tracked (owner ruling
   * R1), and counted as overtime rather than as a corruption.
   */
  readonly outsideWindow: boolean;
}

/**
 * One stretch of a barber's day that is spoken for, with the reason attached.
 *
 * Two design points do the heavy lifting:
 *
 * 1. **`id` is deterministic** — `svc:{appointmentId}:{seatId}`,
 *    `buf:{...}`, `exc:{exceptionId}[:{n}]`. It IS the idempotency key: a
 *    duplicated trigger delivery writes the same block over the same id, so
 *    re-processing is a set operation rather than an append. That is why this
 *    design needs no processed-event table.
 * 2. **`klass` is FROZEN at write time** — not recomputed on read. When the
 *    owner decides next year that unpaid breaks should count toward capacity,
 *    last July's utilisation must not silently move. `classifyOccupancy` is
 *    the write-time policy; this stored triple is the answer it gave, and
 *    `policyVersion` says which policy that was.
 */
export class OccupancyBlock {
  private constructor(
    readonly id: string,
    readonly interval: Interval,
    readonly locationId: LocationId | null,
    readonly reason: OccupancyReason,
    readonly klass: OccupancyClass,
    readonly policyVersion: number,
    readonly revenueMinorUnits: number,
    readonly currencyCode: string,
    readonly outsideWindow: boolean,
  ) {}

  /** Trusted assembler — every argument is already a validated value. */
  static of(props: OccupancyBlockProps): OccupancyBlock {
    return new OccupancyBlock(
      props.id,
      props.interval,
      props.locationId,
      props.reason,
      props.klass,
      props.policyVersion,
      props.revenueMinorUnits,
      props.currencyCode,
      props.outsideWindow,
    );
  }

  /**
   * Classify and assemble in one step — the normal path. Callers that are
   * REBUILDING historical blocks must use `of` with the stored class instead,
   * or a policy change would rewrite the past.
   */
  static classifying(
    props: Omit<OccupancyBlockProps, 'klass' | 'policyVersion'>,
    policyVersion: number,
  ): OccupancyBlock {
    return OccupancyBlock.of({
      ...props,
      klass: classifyOccupancy(props.reason),
      policyVersion,
    });
  }

  /** Exact minutes, from the instants — local clock arithmetic cannot distort it. */
  minutes(): number {
    return Interval.durationMinutes(this.interval);
  }

  revenue(): Money | null {
    if (this.revenueMinorUnits === 0) return null;
    const result = Money.fromMinorUnitsAndCode(
      this.revenueMinorUnits,
      this.currencyCode,
    );
    return result.isSuccess() ? result.value : null;
  }

  /** Does this block consume sellable capacity? */
  consumesCapacity(): boolean {
    return this.klass.capacity === 'scheduled';
  }

  isProductive(): boolean {
    return this.klass.productive;
  }
}

/** `svc:{appointmentId}:{seatId}` — one block per seat of an appointment. */
export function serviceBlockId(appointmentId: string, seatId: string): string {
  return `svc:${appointmentId}:${seatId}`;
}

/** `buf:{appointmentId}:{seatId}` — the turnaround that seat produced. */
export function bufferBlockId(appointmentId: string, seatId: string): string {
  return `buf:${appointmentId}:${seatId}`;
}

/** `exc:{exceptionId}[:{n}]` — `n` indexes a multi-range exception's windows. */
export function exceptionBlockId(exceptionId: string, index?: number): string {
  return index === undefined
    ? `exc:${exceptionId}`
    : `exc:${exceptionId}:${index}`;
}
