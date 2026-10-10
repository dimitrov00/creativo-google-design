import type { Firestore } from 'firebase-admin/firestore';
import { onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';
import type { Result } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  Actor,
  AuditEntry,
  type AuditEntryValidationError,
} from '@creativo/domain/governance';
import {
  AUDIT_LOG_COLLECTION,
  auditEntryToDocument,
} from '@creativo/application/shared';
import {
  type Actor as EcsActor,
  ActorKind,
  AuditSystem,
  SystemSource,
} from '@creativo/ecs-core';
import { adminFirestore } from '../firebase-admin';
import {
  attemptFailure,
  failureCode,
  reportAttempt,
} from '../trigger-attempts';

/**
 * The profile fields whose change is worth a row. `roles` and `status` are
 * deliberately absent: their writers (the P2 pause callable, the P4
 * `setUserRoles`) audit themselves inside their own transactions, and a
 * second, vaguer row here would only blur theirs.
 */
export const AUDITED_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'birthDate',
] as const;

/**
 * The audited fields whose value changed, in `AUDITED_PROFILE_FIELDS` order.
 * NAMES only: the row says THAT the phone changed, never from what to what
 * (R36) — an audit log is kept for good, and a copy of every number and
 * address a client ever had is personal data it has no business holding.
 */
export function changedProfileFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly string[] {
  return AuditSystem.changedProfileFields(before, after);
}

export function profileAuditAction(
  beforeExists: boolean,
  afterExists: boolean,
): string {
  return AuditSystem.profileAction(beforeExists, afterExists);
}

/**
 * WHO wrote the profile, from the event's auth context — not the profile's
 * owner, which was only ever a guess that happened to be right while the
 * owner was the sole writer. The rule is `AuditSystem.profileWriter`
 * (`@creativo/ecs-core`): the Admin SDK and the platform are processes, an
 * end user is credited by a uid-shaped id, and an id that is not one is
 * never guessed at.
 */
export function profileWriter(
  authType: string,
  authId: string | undefined,
): Actor {
  return legacyActorOf(AuditSystem.profileWriter(authType, authId ?? null));
}

/**
 * The one row a profile write produces. Its id IS the event id: the trigger
 * retries, the platform delivers at least once, and a row keyed by anything
 * minted here would be written once per delivery. The instant is the
 * event's, so a redelivery an hour later still says when the write happened.
 */
export function profileAuditEntry(input: {
  readonly eventId: string;
  readonly eventTime: string;
  readonly ownerUserId: string;
  readonly writer: Actor;
  readonly action: string;
  readonly fields: readonly string[];
}): Result<AuditEntry, AuditEntryValidationError[]> {
  const ms = Date.parse(input.eventTime);
  return AuditEntry.create({
    id: input.eventId,
    actor: input.writer,
    action: input.action,
    atIso: new Date(Number.isNaN(ms) ? Date.now() : ms).toISOString(),
    targetUserId: input.ownerUserId,
    resourceId: `users/${input.ownerUserId}`,
    context: { fields: input.fields.join(',') },
  });
}

const FN = 'auditProfileChanges';

/** The slice of a Firestore auth-context write event the handler reads. */
export interface ProfileWriteEvent {
  readonly id: string;
  readonly time: string;
  readonly params: { readonly uid: string };
  readonly authType: string;
  readonly authId?: string;
  readonly data?: {
    readonly before?: ProfileSnapshot;
    readonly after?: ProfileSnapshot;
  };
}

interface ProfileSnapshot {
  readonly exists: boolean;
  data(): Readonly<Record<string, unknown>> | undefined;
}

/**
 * One delivery of one profile write: at most one row, keyed by the event.
 *
 * Redelivery cannot duplicate: the row's id is the event id and it is written
 * with `create()`, so a second delivery finds its row already there and
 * stops. Each failed attempt is one structured line — ids and codes only —
 * and only a transient failure is rethrown for the platform to redeliver.
 */
export async function auditProfileWrite(
  event: ProfileWriteEvent,
  db: Firestore,
  nowMs: () => number = Date.now,
): Promise<void> {
  const before = event.data?.before;
  const after = event.data?.after;
  const fields = changedProfileFields(
    before?.data() ?? {},
    after?.data() ?? {},
  );
  if (fields.length === 0) return;

  const entry = profileAuditEntry({
    eventId: event.id,
    eventTime: event.time,
    ownerUserId: event.params.uid,
    writer: profileWriter(event.authType, event.authId),
    action: profileAuditAction(before?.exists === true, after?.exists === true),
    fields,
  });
  if (entry.isFailure()) {
    // A domain refusal is permanent by construction — no redelivery fixes it.
    reportAttempt(
      FN,
      event,
      attemptFailure(entry.error, entry.error[0]?.code ?? 'invalid-argument'),
      nowMs(),
    );
    return;
  }

  try {
    await db
      .collection(AUDIT_LOG_COLLECTION)
      .doc(entry.value.id.value)
      .create(auditEntryToDocument(entry.value));
  } catch (error) {
    const code = failureCode(error);
    // A redelivery of an event whose row is already written: done.
    if (code === 'already-exists') return;
    reportAttempt(FN, event, attemptFailure(error, code), nowMs());
  }
}

/**
 * Every profile change becomes an audit row — whatever wrote it.
 *
 * A TRIGGER rather than instrumentation in each writer, because the writers
 * are plural and one of them is the browser: the profile screen and the
 * booking contact sheet both save through the client SDK, and a client
 * cannot be trusted to log its own actions. The document watcher catches
 * every path, including ones not written yet.
 *
 * `retry: true`, because without it a transient failure (a deploy, a
 * contended write) drops the event silently — see `auditProfileWrite` for
 * why a redelivery is safe. The auth context is what lets the row name the
 * WRITER (`profileWriter`) instead of assuming the owner.
 */
export const auditProfileChanges = onDocumentWrittenWithAuthContext(
  { document: 'users/{uid}', retry: true },
  (event) => auditProfileWrite(event, adminFirestore()),
);

// ── The bridge: ecs-core's actor → the legacy class (Phase 4 deletes it) ──

/** The writer as the legacy row holds it: a process by its source, a person by uid. */
function legacyActorOf(actor: EcsActor): Actor {
  if (actor.kind === ActorKind.User) {
    const uid = UserId.create(actor.userId);
    if (uid.isSuccess()) return Actor.user(uid.value);
  }
  return Actor.system(
    actor.kind === ActorKind.System
      ? actor.source
      : SystemSource.UnattributedUnknown,
  );
}
