import { BarberId, LocationId } from '@creativo/domain/catalog';
import {
  CalendarDay,
  LocalTimeRange,
  ScheduleException,
  ScheduleExceptionId,
  type ScheduleExceptionKind,
} from '@creativo/domain/scheduling';
import {
  ExceptionDetail,
  ExceptionEffectKind,
  LocationId as EcsLocationId,
  MinuteRange,
  ScheduleExceptionSystem,
} from '@creativo/ecs-core';

/**
 * The PUBLIC face of a schedule exception — how "Ivan is off on the 14th"
 * reaches the anonymous booking grid.
 *
 * The domain's `ScheduleException` carries WHY (`sick`, `training`,
 * `travel`…), and why is exactly what must never be public: a sick day is
 * GDPR Art. 9 special-category data, and `/book` is browsable anonymously
 * against documents rules cannot redact. So the public doc stores only the
 * EFFECT — closed, different hours, or blocked ranges — and this module has
 * no field a reason could even ride in. The staff editor keeps the full
 * aggregate wherever staff-only data lives; what it publishes here is the
 * sanitized availability consequence, keyed like `barberBusy` so the range
 * reader can query it with the same `(barberId, dayKey)` index shape.
 *
 * Shared by both SDKs for the same reason `appointment-document.ts` is: the
 * browser grid and the server's commit re-check must read one schema with
 * one parser, or the grid offers what the commit refuses.
 */
export const SCHEDULE_EXCEPTIONS_COLLECTION = 'scheduleExceptions';

export function scheduleExceptionDocId(
  barberId: string,
  dayKey: string,
): string {
  return `${barberId}__${dayKey}`;
}

/** What the public doc may say. `closed` removes the day entirely. */
export type PublicExceptionEffect =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'hours';
      readonly ranges: readonly {
        readonly from: string;
        readonly to: string;
      }[];
    }
  | {
      readonly kind: 'blocked';
      readonly ranges: readonly {
        readonly from: string;
        readonly to: string;
      }[];
    };

/**
 * Domain exception → public doc. **This function is the GDPR boundary.**
 *
 * Written as an explicit switch rather than a structural dump for the same
 * reason `seatOutcomeToDocument` is: a new `ScheduleExceptionKind` arm must
 * not be able to reach public storage without someone deciding how it is
 * sanitized. The compiler enforces that — add an arm and this stops building.
 *
 * The sanitizing is the point, not a side effect. `sick` (Art. 9 special-
 * category health data), `time_off`, `training` and `travel` all collapse to
 * the SAME `closed` effect, so the public document cannot distinguish a
 * barber who is ill from one who is on holiday — not by field, not by
 * absence of a field, not by inference. `break` and `admin` collapse to
 * `blocked` for the same reason.
 */
export function exceptionToDocument(
  exception: ScheduleException,
): Record<string, unknown> {
  return {
    barberId: exception.barberId?.value ?? '',
    dayKey: exception.day.key(),
    zone: exception.day.zone,
    locationId: exception.locationId.value,
    effect: toEffect(exception.detail),
  };
}

function toEffect(detail: ScheduleExceptionKind): PublicExceptionEffect {
  const effect = ScheduleExceptionSystem.publicEffect(detailOf(detail));
  if (!effect.ok) {
    // A range-bearing arm holding no range: the legacy writer published it
    // as it stood, an empty list of spans.
    return { kind: detail.kind === 'hours' ? 'hours' : 'blocked', ranges: [] };
  }
  const value = effect.value;
  switch (value.kind) {
    case ExceptionEffectKind.Closed:
      return { kind: 'closed' };
    case ExceptionEffectKind.Hours:
      return { kind: 'hours', ranges: toSpans(value.ranges) };
    case ExceptionEffectKind.Blocked:
      return { kind: 'blocked', ranges: toSpans(value.ranges) };
  }
}

function toSpans(
  ranges: readonly MinuteRange[],
): readonly { readonly from: string; readonly to: string }[] {
  return ranges.map((range) => ({
    from: clockOf(range.startMinutes),
    to: clockOf(range.endMinutes),
  }));
}

/**
 * Public doc → domain exception, fail-closed the availability-friendly way:
 * a doc that does not parse contributes NO exception, so the roster stands.
 * (Refusing the whole day on a malformed doc would let one bad write silently
 * close a barber's calendar.)
 *
 * The sanitized kinds map onto reason-free domain arms: `closed` → `time_off`
 * (whole-day, per-barber), `blocked` → `admin` with an empty note.
 */
export function exceptionFromDocument(
  data: Record<string, unknown>,
): ScheduleException | null {
  const rawBarber = String(data['barberId'] ?? '');
  const dayKey = String(data['dayKey'] ?? '');
  const zone = String(data['zone'] ?? '');
  const rawLocation = String(data['locationId'] ?? '');
  if (!rawBarber || !dayKey || !zone || !rawLocation) return null;

  const barberId = BarberId.create(rawBarber);
  const locationId = LocationId.create(rawLocation);
  const day = CalendarDay.create(dayKey, zone);
  if (barberId.isFailure() || locationId.isFailure() || day.isFailure()) {
    return null;
  }

  const detail = toDetail(data['effect']);
  if (detail === null) return null;

  const result = ScheduleException.create({
    id: ScheduleExceptionId.of(scheduleExceptionDocId(rawBarber, dayKey)),
    day: day.value,
    barberId: barberId.value,
    locationId: locationId.value,
    detail,
  });
  return result.isSuccess() ? result.value : null;
}

function toDetail(raw: unknown): ScheduleExceptionKind | null {
  const effect = (raw ?? {}) as Record<string, unknown>;
  switch (effect['kind']) {
    case 'closed':
      return { kind: 'time_off' };
    case 'hours': {
      const ranges = toRanges(effect['ranges']);
      return ranges.length > 0 ? { kind: 'hours', ranges } : null;
    }
    case 'blocked': {
      const ranges = toRanges(effect['ranges']);
      return ranges.length > 0 ? { kind: 'admin', ranges, note: '' } : null;
    }
    default:
      return null;
  }
}

function toRanges(raw: unknown): readonly LocalTimeRange[] {
  if (!Array.isArray(raw)) return [];
  const ranges: LocalTimeRange[] = [];
  for (const entry of raw) {
    const span = (entry ?? {}) as Record<string, unknown>;
    const range = LocalTimeRange.create(
      String(span['from'] ?? ''),
      String(span['to'] ?? ''),
    );
    if (range.isSuccess()) ranges.push(range.value);
  }
  return ranges;
}

/**
 * The union of a day's blocks: sorted, overlapping and touching spans merged.
 * Pure, so the writer and a test can both say what a second block does.
 */
export function coalesceRanges(
  ranges: readonly LocalTimeRange[],
): readonly LocalTimeRange[] {
  return ScheduleExceptionSystem.merge(ranges.map(minuteRangeOf), []).flatMap(
    (range) => legacyRangeOf(ranges, range),
  );
}

export function withoutRange(
  ranges: readonly LocalTimeRange[],
  gone: LocalTimeRange,
): readonly LocalTimeRange[] {
  const kept = ScheduleExceptionSystem.withoutRange(
    ranges.map(minuteRangeOf),
    minuteRangeOf(gone),
  );
  // Every kept range is one of the caller's, in order: hand those back.
  return ranges.filter((range) =>
    kept.some(
      (struct) =>
        struct.startMinutes === range.start.minutesFromMidnight() &&
        struct.endMinutes === range.end.minutesFromMidnight(),
    ),
  );
}

// ── The bridge: legacy shapes ↔ ecs-core structs (Phase 4 deletes it) ────

function minuteRangeOf(range: LocalTimeRange): MinuteRange {
  return MinuteRange.of(
    range.start.minutesFromMidnight(),
    range.end.minutesFromMidnight(),
  );
}

/** Minutes of the day as the stored `HH:mm` (zero-padded, as `LocalTimeOfDay` prints it). */
function clockOf(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * A merged range as the caller's own object when it is one of theirs
 * untouched, else a new one spanning it (none, should the clock not parse).
 */
function legacyRangeOf(
  ranges: readonly LocalTimeRange[],
  merged: MinuteRange,
): readonly LocalTimeRange[] {
  const own = ranges.find(
    (range) =>
      range.start.minutesFromMidnight() === merged.startMinutes &&
      range.end.minutesFromMidnight() === merged.endMinutes,
  );
  if (own !== undefined) return [own];
  const built = LocalTimeRange.create(
    clockOf(merged.startMinutes),
    clockOf(merged.endMinutes),
  );
  return built.isSuccess() ? [built.value] : [];
}

/** The reasoned detail as `ScheduleExceptionSystem` reads it. */
function detailOf(detail: ScheduleExceptionKind): ExceptionDetail {
  switch (detail.kind) {
    case 'closed':
      return ExceptionDetail.closed();
    case 'time_off':
      return ExceptionDetail.timeOff();
    case 'sick':
      return ExceptionDetail.sick(detail.paid);
    case 'training':
      return ExceptionDetail.training(detail.topic);
    case 'travel':
      return ExceptionDetail.travel(
        EcsLocationId.of(detail.toLocationId.value),
      );
    case 'hours':
      return ExceptionDetail.hours(detail.ranges.map(minuteRangeOf));
    case 'break':
      return ExceptionDetail.break(
        detail.ranges.map(minuteRangeOf),
        detail.paid,
      );
    case 'admin':
      return ExceptionDetail.admin(
        detail.ranges.map(minuteRangeOf),
        detail.note,
      );
  }
}
