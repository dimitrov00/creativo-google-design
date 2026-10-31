import {
  BarberId,
  DurationMinutes,
  MinuteCount,
  MinuteDelta,
  ServiceId,
  ServiceVariantId,
  StoredFields,
} from '@core/primitives';

/**
 * One carried seat as the booking flow holds it while the client moves the
 * visit — what the review step shows and the grid keeps room for: its
 * wall-clock distance from the move anchor and the chair time it was SOLD
 * at. Plain data a component (the flat `BookingDraft`) names, so it lives in
 * the components tier (Law 8; moved down from `move.system.ts`, Phase 4a
 * 4A-9).
 */
export type MoveRider = {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly offsetMinutes: MinuteDelta;
  readonly durationMinutes: DurationMinutes;
  readonly setupMinutes: MinuteCount;
  readonly cleanupMinutes: MinuteCount;
};

/** A text a rider id is read from: a non-empty id with no `/`. */
function idOk(raw: unknown, parse: (raw: string) => { readonly ok: boolean }) {
  return typeof raw === 'string' && parse(raw).ok;
}

/** A whole number a minute primitive accepts. */
function minutesOk(
  raw: unknown,
  of: (raw: number) => { readonly ok: boolean },
): boolean {
  return typeof raw === 'number' && of(raw).ok;
}

export const MoveRider = {
  /**
   * The restore guard (the booking store's `isRider`, lifted): every
   * identity parses as its brand and every figure is whole — a duration of
   * a minute or more, setup and cleanup of zero or more, any whole offset.
   * A rider the guard lets through is always one the grid can measure, so a
   * restored move never silently drops a carried seat.
   */
  is(raw: unknown): raw is MoveRider {
    if (raw === null || typeof raw !== 'object') return false;
    const variantId = StoredFields.field(raw, 'variantId');
    return (
      idOk(StoredFields.field(raw, 'serviceId'), ServiceId.parse) &&
      idOk(StoredFields.field(raw, 'barberId'), BarberId.parse) &&
      (variantId === null || idOk(variantId, ServiceVariantId.parse)) &&
      minutesOk(StoredFields.field(raw, 'offsetMinutes'), MinuteDelta.of) &&
      minutesOk(
        StoredFields.field(raw, 'durationMinutes'),
        DurationMinutes.of,
      ) &&
      minutesOk(StoredFields.field(raw, 'setupMinutes'), MinuteCount.of) &&
      minutesOk(StoredFields.field(raw, 'cleanupMinutes'), MinuteCount.of)
    );
  },
} as const;
