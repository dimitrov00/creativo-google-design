import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import {
  type Actor,
  AuditEntry,
  AuditEntryId,
  type AuditEntryValidationError,
} from '@creativo/domain/governance';
import {
  AUDIT_LOG_COLLECTION,
  auditEntryToDocument,
} from '@creativo/application/shared';
import type { RequestedSeat } from '../../use-cases/decide-booking';
import {
  type AuditSubject as AuditSubjectData,
  AuditRequestedSubjectKind,
  AuditSystem,
  UserId as UserIdData,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2) — the math only. Who gets a row, the
 * people on a requested cart, and the BASIS a row id is hashed from are
 * `AuditSystem` (`targets`, `requestedSubjects`, `rowBasis`); the SHA-256
 * stays here, at the edge, and so do the reads and the batched write.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toSubjectData(subject: AuditSubject): AuditSubjectData {
  return subject.kind === 'account'
    ? { kind: 'account', userId: UserIdData.of(subject.userId) }
    : { kind: 'anonymous' };
}

function fromSubjectData(subject: AuditSubjectData): AuditSubject {
  return subject.kind === 'account'
    ? { kind: 'account', userId: subject.userId }
    : { kind: 'anonymous' };
}
import { adminFirestore } from '../firebase-admin';

/**
 * A seat's person, as the audit log sees them: an account gets a row of its
 * own, a guest does not — a label typed at the desk is not somebody a
 * per-client history can ever be asked about.
 */
export type AuditSubject =
  | { readonly kind: 'account'; readonly userId: string }
  | { readonly kind: 'anonymous' };

export interface AuditInput {
  /** `null` when there is no verified caller — see `callerActor`. */
  readonly actor: Actor | null;
  readonly action: string;
  readonly resourceId: string;
  /** The seats the act touched, guests included; `appendAudit` picks the people. */
  readonly subjects: readonly AuditSubject[];
  readonly atIso: string;
  /** Ids and CODES only (T5, R36) — never a sentence somebody typed. */
  readonly context?: Readonly<Record<string, string>>;
  /**
   * What makes this act ONE logical change — the same value however many
   * times the act is replayed, and a different value for every other change.
   *
   * The commit's or a move's `attemptId`, a staff intent's `operationId` —
   * each the client's name for one intent, the same on every re-send — or,
   * from a client that sends none, the edit's or the move's post-commit
   * `revision`; the stamp a transaction wrote. Present, every row's id is
   * DERIVED from it (see `auditEntryIdFor`) and written with `create()`, so a
   * retried callable — the client SDK's, or a double tap — finds its rows
   * already there and writes nothing twice. Absent, the ids are random and
   * every call appends: a returned ops backfill page is keyed too
   * (`backfillChangeKey`); only its failed calls stay random.
   */
  readonly changeKey?: string;
}

/**
 * The document id of one person's row for one logical change.
 *
 * A digest rather than the parts themselves, because the parts are not safe
 * as an id: a resource id or a key may contain `/` (a path separator to
 * Firestore), an id may be at most 1,500 bytes, and `.`, `..` and `__…__`
 * are reserved. SHA-256 hex is 64 characters of `[0-9a-f]` whatever goes in,
 * and the JSON array keeps the parts unambiguous — `("a:b", "c")` and
 * `("a", "b:c")` do not collide. The `v1` tag lets the derivation change
 * later without colliding with rows written under this one.
 */
export function auditEntryIdFor(parts: {
  readonly action: string;
  readonly resourceId: string;
  readonly targetUserId: string | null;
  readonly changeKey: string;
}): string {
  return createHash('sha256')
    .update(
      AuditSystem.rowBasis(
        parts.action,
        parts.resourceId,
        parts.targetUserId,
        parts.changeKey,
      ),
    )
    .digest('hex');
}

/** How a row gets its id: derived from the change key when there is one. */
function mintFor(input: AuditInput): (target: string | null) => string {
  const changeKey = input.changeKey;
  if (changeKey === undefined) return () => AuditEntryId.generate().value;
  return (target) =>
    auditEntryIdFor({
      action: input.action,
      resourceId: input.resourceId,
      targetUserId: target,
      changeKey,
    });
}

/**
 * Did the write fail only because the row is already there?
 *
 * Duck-typed off `code`, the way the Admin SDK reports it: gRPC status 6 from
 * `@google-cloud/firestore`, or the canonical string some wrappers use.
 */
function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

/**
 * Who gets a row: each distinct account among the subjects, in seat order —
 * a client with two services on one visit is one person, not two rows. An
 * act that touched no account (a walk-in of guests) still happened, so it
 * keeps ONE row with no target rather than none.
 */
export function auditTargets(
  subjects: readonly AuditSubject[],
): readonly (string | null)[] {
  return AuditSystem.targets(subjects.map(toSubjectData));
}

/**
 * The rows one act writes — pure, so the fan-out is testable without a
 * database. Every row shares the actor, action, instant and context; only the
 * target differs, which is what lets "everything done to Maria" be one
 * `targetUserId` query rather than a join through the appointment's seats.
 */
export function planAuditEntries(
  input: AuditInput & { readonly actor: Actor },
  mintId: (target: string | null) => string = mintFor(input),
): Result<readonly AuditEntry[], AuditEntryValidationError[]> {
  const entries: AuditEntry[] = [];
  for (const target of auditTargets(input.subjects)) {
    const entry = AuditEntry.create({
      id: mintId(target),
      actor: input.actor,
      action: input.action,
      atIso: input.atIso,
      ...(target === null ? {} : { targetUserId: target }),
      resourceId: input.resourceId,
      context: input.context,
    });
    if (entry.isFailure()) return fail(entry.error);
    entries.push(entry.value);
  }
  return ok(entries);
}

/**
 * The people on a STORED appointment, read off the raw document — tolerant of
 * any shape, because a malformed seat must cost the log a name, never the
 * mutation. `seatId` narrows to the one seat a per-seat act touched.
 */
export function seatSubjectsOf(
  data: Readonly<Record<string, unknown>> | undefined,
  seatId?: string,
): readonly AuditSubject[] {
  const seats = Array.isArray(data?.['seats'])
    ? (data['seats'] as unknown[])
    : [];
  const subjects: AuditSubject[] = [];
  for (const raw of seats) {
    if (raw === null || typeof raw !== 'object') continue;
    const seat = raw as Record<string, unknown>;
    if (seatId !== undefined && String(seat['id']) !== seatId) continue;
    const subject = seat['subject'] as Record<string, unknown> | undefined;
    subjects.push(
      subject?.['kind'] === 'account' && typeof subject['userId'] === 'string'
        ? { kind: 'account', userId: subject['userId'] }
        : { kind: 'anonymous' },
    );
  }
  return subjects;
}

/**
 * The people on a REQUESTED cart — the commit and reschedule paths know them
 * without a read, because `decideBooking` binds every `self` seat to the owner,
 * keeps a carried companion's own account and turns every guest into an
 * anonymous subject, and nothing else.
 */
export function requestedSeatSubjects(
  seats: readonly RequestedSeat[],
  ownerUserId: string | null,
): readonly AuditSubject[] {
  return AuditSystem.requestedSubjects(
    seats.map((seat) =>
      seat.subject.kind === 'companion'
        ? {
            kind: AuditRequestedSubjectKind.Companion,
            userId: UserIdData.of(seat.subject.userId),
          }
        : seat.subject.kind === 'self'
          ? { kind: AuditRequestedSubjectKind.Self, userId: null }
          : { kind: AuditRequestedSubjectKind.Guest, userId: null },
    ),
    ownerUserId === null ? null : UserIdData.of(ownerUserId),
  ).map(fromSubjectData);
}

/** Who a stored visit is about: its seats' people and its owner. */
export interface Audience {
  readonly subjects: readonly AuditSubject[];
  readonly ownerUserId: string | null;
}

export function audienceOf(
  data: Readonly<Record<string, unknown>> | undefined,
): Audience {
  const owner = data?.['ownerUserId'];
  return {
    subjects: seatSubjectsOf(data),
    ownerUserId: typeof owner === 'string' && owner.length > 0 ? owner : null,
  };
}

/**
 * A visit's audience, read OUTSIDE any transaction — for callables whose use
 * case hands no seats back. Never throws: a failed read costs the rows their
 * names (the fan-out falls back to one untargeted row), never the act.
 */
export async function loadAudience(
  appointmentId: string,
  db?: Firestore,
): Promise<Audience> {
  // A request that names no visit is refused by its use case; nothing to read.
  if (appointmentId.length === 0) return { subjects: [], ownerUserId: null };
  try {
    const snap = await (db ?? adminFirestore())
      .collection('appointments')
      .doc(appointmentId)
      .get();
    return audienceOf(snap.data());
  } catch (error) {
    logger.error('audit subject read failed', {
      resourceId: appointmentId,
      error: String(error),
    });
    return { subjects: [], ownerUserId: null };
  }
}

/**
 * Append the rows for one act — "who did what to whom, when", written
 * SERVER-SIDE so the trail cannot be skipped or forged by a client.
 *
 * ### One row per person
 * A party of two is two people, and each one's history must show what was
 * done to THEIR visit: a staff edit or a companion's no-show filed under the
 * booker (or under the barber who did it) is invisible to the per-client
 * query. The rows go in one batch — an act is logged for everybody or for
 * nobody, never for half the party.
 *
 * ### After the mutation, never inside it
 * The rows are written after the transaction commits, not as part of it. An
 * audit row must record what HAPPENED, and a row written inside a
 * transaction that then retries or aborts records what almost happened.
 * The cost is a narrow crash window between commit and log — accepted for
 * these booking callables, because the alternative (a booking failing
 * because its audit write failed) punishes the client for the log's
 * problem. The support callables (P2+) are the other way round by design
 * (F1): an adjustment and its row commit in one transaction, since a manual
 * points grant without a row is the exact abuse the log exists to catch.
 *
 * ### Awaited, never fatal, loudly
 * The booking callables AWAIT this after their commit, so the row is written
 * before the caller hears the answer — an instance does not wind down with
 * the write still in flight, and "the callable returned" means "the act is
 * logged". It still never throws: a failed audit write must not fail the
 * action it describes (the commit already happened) — but it must never be
 * silent either, because a quiet gap in an audit log is worse than no log.
 * It logs at error level, where alerting can find it.
 *
 * ### Exactly once per logical change
 * Every booking callable can run twice for one change — the client SDK
 * retries a call whose response was lost, a thumb taps twice, and the commit
 * path REPLAYS a known `attemptId` by design. With a `changeKey` the rows'
 * ids are derived from the change rather than minted, and they are CREATED,
 * never set: a replay's batch fails with ALREADY_EXISTS, which is the answer
 * "this was logged", not an error, and is not logged as one. The rows are
 * then created one by one so a replay that names somebody the first call did
 * not (a narrower read on the first attempt) still gets that one row — and
 * the rows the first call wrote are never rewritten. Any OTHER failure is
 * still logged and never thrown.
 */
export async function appendAudit(
  input: AuditInput,
  db?: Firestore,
): Promise<void> {
  try {
    if (input.actor === null) {
      // Unreachable from a succeeded callable today (each refuses an
      // anonymous caller first); loud rather than guessed if that changes.
      logger.error('audit row has no verified actor', {
        action: input.action,
        resourceId: input.resourceId,
      });
      return;
    }

    const planned = planAuditEntries({ ...input, actor: input.actor });
    if (planned.isFailure()) {
      logger.error('audit entry refused by domain', {
        action: input.action,
        errors: planned.error.map((error) => error.code),
      });
      return;
    }

    const store = db ?? adminFirestore();
    const rows: (readonly [DocumentReference, Record<string, unknown>])[] =
      planned.value.map(
        (entry) =>
          [
            store.collection(AUDIT_LOG_COLLECTION).doc(entry.id.value),
            auditEntryToDocument(entry),
          ] as const,
      );

    const batch = store.batch();
    if (input.changeKey === undefined) {
      // Random ids cannot collide, and a caller without a key has no replay
      // to recognise — the write it has always had.
      for (const [ref, row] of rows) batch.set(ref, row);
      await batch.commit();
      return;
    }

    for (const [ref, row] of rows) batch.create(ref, row);
    try {
      await batch.commit();
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      // A replay: at least one row is already there. Fill any gap, row by
      // row, each one's ALREADY_EXISTS being the same "already logged".
      await Promise.all(
        rows.map(async ([ref, row]) => {
          try {
            await ref.create(row);
          } catch (rowError) {
            if (!isAlreadyExists(rowError)) throw rowError;
          }
        }),
      );
    }
  } catch (error) {
    logger.error('audit write failed', {
      action: input.action,
      resourceId: input.resourceId,
      error: String(error),
    });
  }
}
