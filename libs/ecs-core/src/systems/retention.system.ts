import { RetentionGroup, type RetentionAnchor } from '@core/components';
import { defect, LocalDate, type Result, UtcEpochMs } from '@core/primitives';

/**
 * THE RETENTION POLICY (pass C, P-34 — the seven formulas of
 * `firestore-ttl.adapter.ts`, homed here; runbook §2.1): when the TTL
 * service may purge a document, from the anchor its group reads. The TTL
 * adapter keeps the SDK side — which group a path names, reading and
 * parsing the body's fields into a {@link RetentionAnchor}, the `Timestamp`
 * — and stamps the instant this answers.
 *
 * | group                    | `purgeAt`                                     |
 * | ------------------------ | --------------------------------------------- |
 * | `BARBER_BUSY`            | UTC midnight of `localDate` + 30 d            |
 * | `CAPACITY`               | UTC midnight of the month's last day + 40 d   |
 * | `WAITLIST_REQUESTS`      | UTC midnight of `max(localDates)` + 7 d       |
 * | `NOTIFICATIONS`          | `sentAtUtcMs` + 90 d                          |
 * | `LEAD_TIME_SAMPLES`      | UTC midnight of `localDate` + 400 d           |
 * | `OTPS`                   | `expiresAtUtcMs` + 24 h                       |
 * | `IMPERSONATION_SESSIONS` | (`endedAtUtcMs` ?? `expiresAtUtcMs`) + 30 d   |
 *
 * A TTL is an elapsed-time rule (flatten-spec §2.3 T2): every addition goes
 * through `UtcEpochMs.plusDays` / `plusHours`. A `LocalDate` anchor is that
 * civil date's UTC midnight — never the shop zone's start of day: TTL is
 * eventual and day-granular (runbook §2.4), and the integer civil math needs
 * no zone. A waitlist request watching no day keeps the epoch floor
 * (`1970-01-01` + 7 d), the legacy writer's own fallback.
 */

/** Days a busy day is kept past its shop day. */
const BARBER_BUSY_KEEP_DAYS = 30;
/** Days a capacity month is kept past its last day. */
const CAPACITY_KEEP_DAYS = 40;
/** Days a waitlist request is kept past the latest day it watches. */
const WAITLIST_KEEP_DAYS = 7;
/** Days an inbox notification is kept past its sending. */
const NOTIFICATION_KEEP_DAYS = 90;
/** Days a lead-time sample is kept past its sampled day. */
const LEAD_TIME_KEEP_DAYS = 400;
/**
 * Hours a consumed OTP challenge is kept past its expiry: a destination and
 * a code hash are PII with no purpose past the expiry, so a day's grace
 * covers debugging (identity flip (2), F2-11).
 */
const OTP_KEEP_HOURS = 24;
/** Days an impersonation session is kept past its end (else its window's expiry). */
const IMPERSONATION_KEEP_DAYS = 30;

/** The floor a waitlist request watching no day is anchored on — epoch day 0. */
const EPOCH_FLOOR_DAY: LocalDate = LocalDate.fromEpochDay(0);

/** A brand the module builds from a literal it knows is valid. */
function known<T>(result: Result<T, unknown>): T {
  return result.ok ? result.value : defect('RetentionSystem: a broken epoch');
}

/** The Unix epoch — the instant the civil-day count starts from. */
const EPOCH: UtcEpochMs = known(UtcEpochMs.of(0));

/** `localDate`'s UTC midnight, then `keepDays` × 24 h — integer civil math, no zone. */
function daysAfter(localDate: LocalDate, keepDays: number): UtcEpochMs {
  const midnight = UtcEpochMs.plusDays(EPOCH, LocalDate.toEpochDay(localDate));
  return UtcEpochMs.plusDays(midnight, keepDays);
}

/** The last civil day of the month `monthFirstDay` opens. */
function lastDayOfMonth(monthFirstDay: LocalDate): LocalDate {
  return LocalDate.addDays(LocalDate.addMonths(monthFirstDay, 1), -1);
}

/** The latest of a request's watched days — the epoch floor when it watches none (or none later). */
function latestDay(localDates: readonly LocalDate[]): LocalDate {
  let latest = EPOCH_FLOOR_DAY;
  for (let i = 0; i < localDates.length; i++) {
    const day = localDates[i] as LocalDate;
    if (LocalDate.compare(day, latest) > 0) latest = day;
  }
  return latest;
}

export const RetentionSystem = {
  BARBER_BUSY_KEEP_DAYS,
  CAPACITY_KEEP_DAYS,
  WAITLIST_KEEP_DAYS,
  NOTIFICATION_KEEP_DAYS,
  LEAD_TIME_KEEP_DAYS,
  OTP_KEEP_HOURS,
  IMPERSONATION_KEEP_DAYS,
  EPOCH_FLOOR_DAY,

  /**
   * When a document of the anchor's group may be purged — the instant the
   * adapter stamps as `purgeAt`. `null` only for an impersonation session
   * stamped with neither an end nor an expiry: nothing to anchor on, so no
   * stamp (the adapter never invents one).
   */
  purgeAtUtcMs(anchor: RetentionAnchor): UtcEpochMs | null {
    switch (anchor.retentionGroup) {
      case RetentionGroup.BarberBusy:
        return daysAfter(anchor.localDate, BARBER_BUSY_KEEP_DAYS);
      case RetentionGroup.Capacity:
        return daysAfter(
          lastDayOfMonth(anchor.monthFirstDay),
          CAPACITY_KEEP_DAYS,
        );
      case RetentionGroup.WaitlistRequests:
        return daysAfter(latestDay(anchor.localDates), WAITLIST_KEEP_DAYS);
      case RetentionGroup.Notifications:
        return UtcEpochMs.plusDays(anchor.sentAtUtcMs, NOTIFICATION_KEEP_DAYS);
      case RetentionGroup.LeadTimeSamples:
        return daysAfter(anchor.localDate, LEAD_TIME_KEEP_DAYS);
      case RetentionGroup.Otps:
        return UtcEpochMs.plusHours(anchor.expiresAtUtcMs, OTP_KEEP_HOURS);
      case RetentionGroup.ImpersonationSessions: {
        const anchorAt = anchor.endedAtUtcMs ?? anchor.expiresAtUtcMs;
        return anchorAt === null
          ? null
          : UtcEpochMs.plusDays(anchorAt, IMPERSONATION_KEEP_DAYS);
      }
    }
  },
} as const;
