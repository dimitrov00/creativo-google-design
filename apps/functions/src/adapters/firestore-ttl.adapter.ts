import { Timestamp } from 'firebase-admin/firestore';
import { LocalDate } from '@core/primitives';
import type { DocBody, DocPath } from '@core/components';
import { Collections, Subcollections } from '@core/entities';

/**
 * THE ONE `purgeAt` STAMP (flip 1, F-1-7; `firestore-layout.md`): the TTL
 * root field is the one Firestore `Timestamp` a document holds, stamped by
 * the adapter beside the entity body and never part of the entity type.
 * `firestoreCommitPlan` applies it to every `Set`/`Create` of a TTL group;
 * the lead-time sample writer, `saveOtp` and the seed call this same
 * function, so the six formulas live here and nowhere else.
 *
 * The group is matched by the LAST COLLECTION SEGMENT of the path
 * (`users/u1/notifications/n1` → `notifications`); any other group answers
 * `null` — no stamp. The formulas are today's, pinned (runbook §2.1):
 *
 * | group                   | `purgeAt`                                     |
 * | ----------------------- | --------------------------------------------- |
 * | `barberBusy`            | UTC midnight of `localDate` + 30 d            |
 * | `capacity`              | UTC midnight of the month's last day + 40 d   |
 * | `waitlistRequests`      | UTC midnight of `max(localDates)` + 7 d       |
 * | `notifications`         | `sentAtUtcMs` + 90 d                          |
 * | `barberLeadTimeSamples` | UTC midnight of `localDate` + 400 d           |
 * | `otps`                  | `expiresAtUtcMs` + 24 h                       |
 *
 * A `LocalDate` stamp is that civil date's UTC midnight — never the shop
 * zone's start of day: TTL is eventual and day-granular (runbook §2.4), and
 * the integer civil math needs no zone and no `Date`. A body missing the
 * field its formula reads is not stamped (`null`) — the adapter never
 * invents a day; a waitlist request watching no day keeps today's epoch
 * floor (`1970-01-01` + 7 d), the legacy writer's own fallback. A consumed
 * challenge holds a destination and a code hash — PII with no purpose past
 * its own expiry, so a day's grace covers debugging (identity flip (2),
 * F2-11, the pre-flip OTP repository's formula); its `Update`s never
 * re-stamp (the expiry does not move).
 */

const MS_PER_DAY = 86_400_000;

/** Days each TTL group keeps a document past its anchor instant. */
const KEEP_DAYS = {
  busy: 30,
  capacity: 40,
  waitlist: 7,
  notification: 90,
  leadTime: 400,
} as const;

/** Hours an OTP challenge is kept past its expiry. */
const OTP_KEEP_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

/** The epoch floor the legacy waitlist writer stamped a dayless request from. */
const EPOCH_DAY = '1970-01-01';

/** A root field of the body by name — no dynamic index. */
function fieldOf(body: DocBody, field: string): unknown {
  return Object.getOwnPropertyDescriptor(body, field)?.value;
}

/** The UTC midnight of a civil date, in epoch ms — integer civil math, no zone. */
function utcMidnightMs(localDate: LocalDate): number {
  return LocalDate.toEpochDay(localDate) * MS_PER_DAY;
}

/** A stored `LocalDate`, or `null` when the field is absent or no civil date. */
function localDateOf(raw: unknown): LocalDate | null {
  if (typeof raw !== 'string') return null;
  const parsed = LocalDate.parse(raw);
  return parsed.ok ? parsed.value : null;
}

/** `localDate` + `days`, as the TTL `Timestamp`. */
function stampAfter(localDate: LocalDate, days: number): Timestamp {
  return Timestamp.fromMillis(utcMidnightMs(localDate) + days * MS_PER_DAY);
}

/** The last civil day of a `YYYY-MM` month, or `null` when it is no month. */
function lastDayOfMonth(raw: unknown): LocalDate | null {
  const first = typeof raw === 'string' ? localDateOf(`${raw}-01`) : null;
  if (first === null) return null;
  return LocalDate.addDays(LocalDate.addMonths(first, 1), -1);
}

/** The latest of a request's watched days, the epoch floor when it watches none. */
function latestDay(raw: unknown): LocalDate | null {
  let latest: LocalDate | null = localDateOf(EPOCH_DAY);
  if (!Array.isArray(raw)) return latest;
  for (const entry of raw) {
    const day = localDateOf(entry);
    if (day !== null && (latest === null || day > latest)) latest = day;
  }
  return latest;
}

/** The collection a document path sits in — its last collection segment. */
function groupOf(path: DocPath): string | null {
  return path.length >= 2 ? (path[path.length - 2] ?? null) : null;
}

/**
 * The TTL stamp of one document about to be written — `null` for a group
 * with no TTL (or a body missing what its formula reads).
 */
export function purgeAtFor(path: DocPath, body: DocBody): Timestamp | null {
  switch (groupOf(path)) {
    case Collections.BarberBusy: {
      const day = localDateOf(fieldOf(body, 'localDate'));
      return day === null ? null : stampAfter(day, KEEP_DAYS.busy);
    }
    case Collections.Capacity: {
      const day = lastDayOfMonth(fieldOf(body, 'month'));
      return day === null ? null : stampAfter(day, KEEP_DAYS.capacity);
    }
    case Collections.WaitlistRequests: {
      const day = latestDay(fieldOf(body, 'localDates'));
      return day === null ? null : stampAfter(day, KEEP_DAYS.waitlist);
    }
    case Subcollections.Notifications: {
      const sent = fieldOf(body, 'sentAtUtcMs');
      return typeof sent === 'number' && Number.isFinite(sent)
        ? Timestamp.fromMillis(sent + KEEP_DAYS.notification * MS_PER_DAY)
        : null;
    }
    case Collections.BarberLeadTimeSamples: {
      const day = localDateOf(fieldOf(body, 'localDate'));
      return day === null ? null : stampAfter(day, KEEP_DAYS.leadTime);
    }
    case Collections.Otps: {
      const expires = fieldOf(body, 'expiresAtUtcMs');
      return typeof expires === 'number' && Number.isFinite(expires)
        ? Timestamp.fromMillis(expires + OTP_KEEP_HOURS * MS_PER_HOUR)
        : null;
    }
    default:
      return null;
  }
}

/**
 * The body as written: the entity body plus its TTL stamp when its group
 * has one, else the body untouched (the same object — nothing to add).
 */
export function withPurgeAt(path: DocPath, body: DocBody): DocBody {
  const purgeAt = purgeAtFor(path, body);
  return purgeAt === null ? body : { ...body, purgeAt };
}
