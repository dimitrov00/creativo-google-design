import {
  defect,
  DurationMinutes,
  MinuteCount,
  LocalDate,
  UtcEpochMs,
  Result,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';

const MS_PER_HOUR = 3_600_000;

/**
 * The ECMAScript time range's half-width in ms: a `Date` held instants up to
 * 8.64e15 ms either side of the epoch — the bound the window maximum keeps.
 */
const TIME_RANGE_MS = 8_640_000_000_000_000;

/**
 * Every number the booking flow used to hardcode, in one validated place —
 * the seven stored fields of `settings/bookingPolicy`, flat at the document
 * root (`booking-policy-document.ts:67-79`), already a flat slice
 * (flatten-spec §3.1). Tenant policy, not domain invariants: the engine takes
 * it as an argument, which is also what lets a test drive the engine at
 * 5-minute steps without touching the defaults.
 *
 * The free-cancellation window is plain whole hours here and wherever it is
 * stamped (`SeatOutcome`'s `cancellationWindowHours`), and one rule
 * ({@link BookingPolicy.isValidCancellationWindowHours}) says what a window
 * may be, so the setting and the stamp accept exactly the same numbers.
 */
export type BookingPolicy = {
  /** People per booking, the booker included. */
  readonly maxPartySize: number;
  /** Candidate starts are aligned to this grid; it divides the hour. */
  readonly slotStepMinutes: DurationMinutes;
  /** How soon from now a booking may start — the shop needs warning. */
  readonly minLeadMinutes: MinuteCount;
  /**
   * How far ahead the calendar opens, in WHOLE MONTHS — the number a shop
   * owner has an opinion about, ending where a month grid ends.
   */
  readonly horizonMonths: number;
  /** Free cancellation window, whole hours, zero allowed. */
  readonly cancellationWindowHours: number;
  /** How many days one flexible request may span — each is its own search. */
  readonly maxFlexibleDays: number;
  /**
   * Does an online booking land `CONFIRMED`, or wait for a human? Owner
   * ruling 2026-08-07: default ON. Says the shop accepted, never that the
   * client is present.
   */
  readonly autoConfirm: boolean;
};

/** A policy as authored or stored, before its edge guard — raw figures. */
export type BookingPolicyInput = {
  readonly maxPartySize: number;
  readonly slotStepMinutes: number;
  readonly minLeadMinutes: number;
  readonly horizonMonths: number;
  readonly cancellationWindowHours: number;
  readonly maxFlexibleDays: number;
  readonly autoConfirm: boolean;
};

/** A brand the module builds from a literal it knows is valid. */
function known<T>(result: Result<T, unknown>): T {
  return result.ok ? result.value : defect('BookingPolicy: a broken default');
}

/** The shipping defaults (owner rulings 2026-07-29 and 2026-08-07). */
const DEFAULT: BookingPolicy = {
  maxPartySize: 5,
  slotStepMinutes: known(DurationMinutes.of(15)),
  minLeadMinutes: known(MinuteCount.of(120)),
  horizonMonths: 2,
  cancellationWindowHours: 24,
  maxFlexibleDays: 7,
  autoConfirm: true,
};

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** A stored number, or the default when it is not a finite number at all. */
function numberOr(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const BookingPolicy = {
  /**
   * The shipping defaults: 120 minutes' notice keeps same-day walk-ups
   * bookable while giving the shop time to see the phone; auto-confirm on.
   * One constant value — identity is stable for reactive consumers.
   */
  DEFAULT,

  /**
   * The longest window a policy may hold: 2,400,000,000 hours, the time
   * range's half-width — so for any visit at or after the epoch, the
   * deadline `start − hours·1 h` is an exact, safe-integer instant. An
   * arithmetic bound, not a product one.
   */
  CANCELLATION_WINDOW_MAX_HOURS: TIME_RANGE_MS / MS_PER_HOUR,

  /**
   * The ONE rule for a free-cancellation window — the setting and every
   * stamp on a cancelled seat: an integer number of hours, zero or more,
   * within {@link CANCELLATION_WINDOW_MAX_HOURS}.
   */
  isValidCancellationWindowHours(hours: number): boolean {
    return (
      Number.isInteger(hours) &&
      hours >= 0 &&
      hours <= BookingPolicy.CANCELLATION_WINDOW_MAX_HOURS
    );
  },

  /**
   * The edge guard, every invalid field at once (one
   * `SCHEDULING_BOOKING_POLICY_INVALID` per field). The slot step must
   * divide the hour: a 25-minute grid drifts against every readable time.
   */
  create(
    raw: BookingPolicyInput,
  ): Result<BookingPolicy, readonly SchedulingError[]> {
    const errors: SchedulingError[] = [];
    const check = (ok: boolean, field: string, value: number): void => {
      if (!ok) errors.push(SchedulingError.bookingPolicyInvalid(field, value));
    };
    const step = DurationMinutes.of(raw.slotStepMinutes);
    // `+ 0` folds a negative zero: store the zero every reader compares against.
    const lead = MinuteCount.of(raw.minLeadMinutes + 0);
    check(isPositiveInt(raw.maxPartySize), 'maxPartySize', raw.maxPartySize);
    check(
      step.ok && 60 % raw.slotStepMinutes === 0,
      'slotStepMinutes',
      raw.slotStepMinutes,
    );
    check(lead.ok, 'minLeadMinutes', raw.minLeadMinutes);
    check(isPositiveInt(raw.horizonMonths), 'horizonMonths', raw.horizonMonths);
    check(
      BookingPolicy.isValidCancellationWindowHours(raw.cancellationWindowHours),
      'cancellationWindowHours',
      raw.cancellationWindowHours,
    );
    check(
      isPositiveInt(raw.maxFlexibleDays),
      'maxFlexibleDays',
      raw.maxFlexibleDays,
    );
    if (errors.length > 0 || !step.ok || !lead.ok) return Result.err(errors);
    return Result.ok({
      maxPartySize: raw.maxPartySize,
      slotStepMinutes: step.value,
      minLeadMinutes: lead.value,
      horizonMonths: raw.horizonMonths,
      cancellationWindowHours: raw.cancellationWindowHours + 0,
      maxFlexibleDays: raw.maxFlexibleDays,
      autoConfirm: raw.autoConfirm,
    });
  },

  /**
   * A stored `settings/bookingPolicy` body (or its absence) → a usable policy,
   * defaults as the floor. A missing document, a malformed one or a field an
   * admin fat-fingered all fall back — the alternative to a usable policy is a
   * `/book` that will not open. A missing `autoConfirm` means "the shop never
   * chose", which the ruling answers with ON. A policy that still fails
   * {@link create} after the per-field fallback is the whole default.
   */
  withDefaults(raw: unknown): BookingPolicy {
    if (raw === null || typeof raw !== 'object') return DEFAULT;
    const data = raw as Readonly<Record<string, unknown>>;
    const candidate: BookingPolicyInput = {
      maxPartySize: numberOr(data['maxPartySize'], DEFAULT.maxPartySize),
      slotStepMinutes: numberOr(
        data['slotStepMinutes'],
        DEFAULT.slotStepMinutes,
      ),
      minLeadMinutes: numberOr(data['minLeadMinutes'], DEFAULT.minLeadMinutes),
      horizonMonths: numberOr(data['horizonMonths'], DEFAULT.horizonMonths),
      cancellationWindowHours: numberOr(
        data['cancellationWindowHours'],
        DEFAULT.cancellationWindowHours,
      ),
      maxFlexibleDays: numberOr(
        data['maxFlexibleDays'],
        DEFAULT.maxFlexibleDays,
      ),
      autoConfirm:
        typeof data['autoConfirm'] === 'boolean'
          ? data['autoConfirm']
          : DEFAULT.autoConfirm,
    };
    const result = BookingPolicy.create(candidate);
    return result.ok ? result.value : DEFAULT;
  },

  /**
   * Field-wise equality — what "the policy changed" means. ALL seven fields:
   * the legacy `equals` ignored `autoConfirm`, so flipping it alone never
   * read as a policy change (`booking-policy.ts:196-205`).
   */
  equals(a: BookingPolicy, b: BookingPolicy): boolean {
    return (
      a.maxPartySize === b.maxPartySize &&
      a.slotStepMinutes === b.slotStepMinutes &&
      a.minLeadMinutes === b.minLeadMinutes &&
      a.horizonMonths === b.horizonMonths &&
      a.cancellationWindowHours === b.cancellationWindowHours &&
      a.maxFlexibleDays === b.maxFlexibleDays &&
      a.autoConfirm === b.autoConfirm
    );
  },

  /**
   * The last instant a cancellation under a `windowHours` window is still
   * free — the start instant minus the window, in elapsed time (a T2 row of
   * flatten-spec §2.3). THE formula: the callable that refuses a late cancel,
   * the page that names the deadline and the stats that call a past
   * cancellation late (on its stamped window) all draw it here.
   */
  cancellationDeadlineUtcMs(
    windowHours: number,
    appointmentStartUtcMs: UtcEpochMs,
  ): UtcEpochMs {
    return UtcEpochMs.plusHours(appointmentStartUtcMs, -windowHours);
  },

  /** Free at `atUtcMs`: at the deadline itself still is, a millisecond past is not. */
  allowsFreeCancelAt(
    windowHours: number,
    appointmentStartUtcMs: UtcEpochMs,
    atUtcMs: UtcEpochMs,
  ): boolean {
    return (
      UtcEpochMs.compare(
        atUtcMs,
        BookingPolicy.cancellationDeadlineUtcMs(
          windowHours,
          appointmentStartUtcMs,
        ),
      ) <= 0
    );
  },

  /** {@link allowsFreeCancelAt} under this policy's own window. */
  mayCancelAt(
    policy: BookingPolicy,
    appointmentStartUtcMs: UtcEpochMs,
    nowUtcMs: UtcEpochMs,
  ): boolean {
    return BookingPolicy.allowsFreeCancelAt(
      policy.cancellationWindowHours,
      appointmentStartUtcMs,
      nowUtcMs,
    );
  },

  /**
   * The free time a day must hold to count as bookable in a lead-time
   * sample (pass C, P-31 — `sample-lead-time`'s threshold, homed here): ONE
   * slot step of the policy's grid, as a minute count; zero should the step
   * ever not read as one (it always does — a `DurationMinutes` is a
   * positive whole count).
   */
  freeThreshold(policy: BookingPolicy): MinuteCount {
    const threshold = MinuteCount.of(policy.slotStepMinutes);
    return threshold.ok ? threshold.value : MinuteCount.ZERO;
  },

  /**
   * The last day anyone may book, counting from `today`: the LAST day of the
   * month `horizonMonths` after today's, so a two-month horizon opened on
   * 31 January ends 31 March (never a clamped 28th) and the calendar grid
   * ends where a month ends. Civil arithmetic on the shop's days, no zone.
   */
  horizonEndFrom(policy: BookingPolicy, today: LocalDate): LocalDate {
    const { year, month } = LocalDate.parts(today);
    const monthIndex = month - 1 + policy.horizonMonths;
    const endYear = year + Math.floor(monthIndex / 12);
    const endMonth = (monthIndex % 12) + 1;
    return LocalDate.fromEpochDay(
      LocalDate.epochDayOf(
        endYear,
        endMonth,
        LocalDate.daysInMonth(endYear, endMonth),
      ),
    );
  },
} as const;
