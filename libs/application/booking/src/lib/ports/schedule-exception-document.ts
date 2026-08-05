import { BarberId, LocationId } from '@creativo/domain/catalog';
import {
  CalendarDay,
  LocalTimeRange,
  ScheduleException,
  ScheduleExceptionId,
  type ScheduleExceptionKind,
} from '@creativo/domain/scheduling';

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
