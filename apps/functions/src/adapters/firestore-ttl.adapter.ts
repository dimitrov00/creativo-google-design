import { Timestamp } from 'firebase-admin/firestore';
import { LocalDate, UtcEpochMs } from '@core/primitives';
import { type DocBody, type DocPath, RetentionAnchor } from '@core/components';
import { Collections, Subcollections } from '@core/entities';
import { RetentionSystem } from '@core/systems';

/**
 * THE ONE `purgeAt` STAMP (flip 1, F-1-7; `firestore-layout.md`): the TTL
 * root field is the one Firestore `Timestamp` a document holds, stamped by
 * the adapter beside the entity body and never part of the entity type.
 * `firestoreCommitPlan` applies it to every `Set`/`Create` of a TTL group
 * (the issued OTP challenge's `Set` among them — `requestOtp`'s commit,
 * audit-hardening Phase 3 P3-RU-6); the lead-time sample writer and the
 * seed call this same function, so every write stamps through here.
 *
 * The group is matched by the LAST COLLECTION SEGMENT of the path
 * (`users/u1/notifications/n1` → `notifications`); any other group answers
 * `null` — no stamp. This adapter reads and parses the fields the group's
 * formula reads into a branded {@link RetentionAnchor}; the seven formulas
 * (runbook §2.1) are `RetentionSystem.purgeAtUtcMs`'s (pass C, P-34), and
 * the instant it answers becomes the `Timestamp`.
 *
 * A body missing the field its formula reads, or holding one that is no
 * civil date / no instant, is not stamped (`null`, no anchor) — the adapter
 * never invents a day. A waitlist request's unreadable days are skipped, so
 * a request watching no readable day keeps the epoch floor (the system's).
 * An impersonation session is anchored on its end when the body carries a
 * numeric `endedAtUtcMs` (an unreadable one is no stamp, never a fall-back
 * to the expiry), on its window's expiry otherwise. A consumed challenge's
 * `Update`s never re-stamp (the expiry does not move); the
 * `startImpersonation` / `endImpersonation` callables write each body with
 * a `Create` / `Set`, so the end re-stamps (Phase 4a 4A-3 (4), runbook
 * §2.1).
 */

/** A root field of the body by name — no dynamic index. */
function fieldOf(body: DocBody, field: string): unknown {
  return Object.getOwnPropertyDescriptor(body, field)?.value;
}

/** A stored `LocalDate`, or `null` when the field is absent or no civil date. */
function localDateOf(raw: unknown): LocalDate | null {
  if (typeof raw !== 'string') return null;
  const parsed = LocalDate.parse(raw);
  return parsed.ok ? parsed.value : null;
}

/** A stored instant, or `null` when the field is absent or no instant. */
function instantOf(raw: unknown): UtcEpochMs | null {
  if (typeof raw !== 'number') return null;
  const parsed = UtcEpochMs.of(raw);
  return parsed.ok ? parsed.value : null;
}

/** The first day of a stored `YYYY-MM` month, or `null` when it is no month. */
function monthFirstDayOf(raw: unknown): LocalDate | null {
  return typeof raw === 'string' ? localDateOf(`${raw}-01`) : null;
}

/** A request's readable watched days — none when the field is no list. */
function localDatesOf(raw: unknown): readonly LocalDate[] {
  const days: LocalDate[] = [];
  if (!Array.isArray(raw)) return days;
  for (const entry of raw) {
    const day = localDateOf(entry);
    if (day !== null) days.push(day);
  }
  return days;
}

/**
 * An impersonation session's anchor: its end when the body carries a
 * numeric one (unreadable → none), else its window's expiry.
 */
function impersonationAnchorOf(
  body: DocBody,
): RetentionAnchor.ImpersonationSessions | null {
  const ended = fieldOf(body, 'endedAtUtcMs');
  const expiresAtUtcMs = instantOf(fieldOf(body, 'expiresAtUtcMs'));
  if (typeof ended === 'number') {
    const endedAtUtcMs = instantOf(ended);
    return endedAtUtcMs === null
      ? null
      : RetentionAnchor.impersonationSessions(endedAtUtcMs, expiresAtUtcMs);
  }
  return expiresAtUtcMs === null
    ? null
    : RetentionAnchor.impersonationSessions(null, expiresAtUtcMs);
}

/** The collection a document path sits in — its last collection segment. */
function groupOf(path: DocPath): string | null {
  return path.length >= 2 ? (path[path.length - 2] ?? null) : null;
}

/**
 * What one document about to be written is anchored on — `null` for a
 * group with no TTL, or a body missing (or unreadable in) what its formula
 * reads.
 */
function anchorOf(path: DocPath, body: DocBody): RetentionAnchor | null {
  switch (groupOf(path)) {
    case Collections.BarberBusy: {
      const day = localDateOf(fieldOf(body, 'localDate'));
      return day === null ? null : RetentionAnchor.barberBusy(day);
    }
    case Collections.Capacity: {
      const first = monthFirstDayOf(fieldOf(body, 'month'));
      return first === null ? null : RetentionAnchor.capacity(first);
    }
    case Collections.WaitlistRequests:
      return RetentionAnchor.waitlistRequests(
        localDatesOf(fieldOf(body, 'localDates')),
      );
    case Subcollections.Notifications: {
      const sent = instantOf(fieldOf(body, 'sentAtUtcMs'));
      return sent === null ? null : RetentionAnchor.notifications(sent);
    }
    case Collections.BarberLeadTimeSamples: {
      const day = localDateOf(fieldOf(body, 'localDate'));
      return day === null ? null : RetentionAnchor.leadTimeSamples(day);
    }
    case Collections.Otps: {
      const expires = instantOf(fieldOf(body, 'expiresAtUtcMs'));
      return expires === null ? null : RetentionAnchor.otps(expires);
    }
    case Collections.ImpersonationSessions:
      return impersonationAnchorOf(body);
    default:
      return null;
  }
}

/**
 * The TTL stamp of one document about to be written — `null` for a group
 * with no TTL (or a body missing what its formula reads).
 */
export function purgeAtFor(path: DocPath, body: DocBody): Timestamp | null {
  const anchor = anchorOf(path, body);
  if (anchor === null) return null;
  const purgeAtUtcMs = RetentionSystem.purgeAtUtcMs(anchor);
  return purgeAtUtcMs === null ? null : Timestamp.fromMillis(purgeAtUtcMs);
}

/**
 * The body as written: the entity body plus its TTL stamp when its group
 * has one, else the body untouched (the same object — nothing to add).
 */
export function withPurgeAt(path: DocPath, body: DocBody): DocBody {
  const purgeAt = purgeAtFor(path, body);
  return purgeAt === null ? body : { ...body, purgeAt };
}
