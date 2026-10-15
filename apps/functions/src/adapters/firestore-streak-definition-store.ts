import type {
  CollectionReference,
  DocumentReference,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import type { StreakDefinitionSchedule } from '@creativo/domain/engagement';
import {
  STREAK_DEFINITIONS_COLLECTION,
  STREAK_DEFINITION_VERSIONS_COLLECTION,
  streakDefinitionVersionFromDocument,
  streakDefinitionVersionId,
  streakDefinitionVersionToDocument,
  streakScheduleFromDocument,
  streakScheduleToDocument,
} from '@creativo/application/engagement';
import {
  AuditEntryId,
  AuditResourceId,
  StreakDefinitionId,
} from '@core/primitives';
import { AuditAction } from '@core/components';
import type { AuditEntry } from '@core/entities';
import { AuditSystem } from '@core/systems';
import { sha256Hex } from './crypto.adapter';
import { auditRowCreate, auditRowRef } from './firestore-audit.adapter';
import {
  type PublishStreakDefinitionFailure,
  PublishStreakDefinitionStoreError,
} from '../use-cases/publish-streak-definition.errors';
import {
  type StreakDefinitionAudit,
  type StreakDefinitionDecision,
  type StreakDefinitionIntent,
  type StreakDefinitionOutcome,
  type StreakDefinitionReceipt,
  type StreakDefinitionSnapshot,
  type StreakDefinitionStore,
} from '../use-cases/publish-streak-definition.use-case';

/** A version's document id: six digits or more, nothing else (`streakDefinitionVersionId`). */
const VERSION_ID = /^\d{6,}$/;

/**
 * The rhythm's rule, written: `streakDefinitions/{id}` (the head), its
 * `versions/{n:06}` and the act's ONE `auditLog` row, in one Firestore
 * transaction (client-card-revision-3 §4.3, §4.4).
 *
 * ### Everything is read inside the transaction
 * The head is what the decision is made on, so it is read where it will be
 * written: two admins saving at once both read the same head, Firestore
 * lets one commit, and the other's retry reads a head that moved and is
 * refused `stale`, never written over the first.
 *
 * ### The row commits WITH the act, not after it
 * The booking callables log after their commit, because a booking must not
 * fail over its log. This is the other way round by design (`appendAudit`,
 * F1): a rule that changed how every client is judged, with no row saying
 * who changed it, is the gap the log exists to close. No row, no rule.
 *
 * ### A version is written ONCE
 * Version documents and the row are `create()`d, never set: a number that
 * is taken fails the transaction instead of rewriting history. The one
 * field of a version that is ever set later is `withdrawnAt`.
 *
 * ### A retry writes nothing
 * A publish leaves its `requestId` on the version it wrote; a withdrawal
 * leaves its row, whose id is derived from the `requestId`
 * (`hash(AuditSystem.rowBasis(…))`). Either is looked for FIRST. Without that, the retry
 * of a publish whose answer was lost would read its own write as a head
 * that moved, and tell the admin somebody else changed the rule.
 *
 * ### The row is the flat `AuditEntry` (F1-8)
 * Planned by `AuditSystem.plan` — one untargeted row, the act's actor,
 * instant and context at the root — its id `hash(rowBasis(…))` of the
 * intent's `requestId`, staged through the audit adapter's
 * `auditRowCreate`: the same body `appendAudit` writes, created in THIS
 * transaction. The rest of the store (head, versions) waits for flip 3.
 *
 * Reads strictly precede writes, as Firestore requires.
 */
export class FirestoreStreakDefinitionStore implements StreakDefinitionStore {
  constructor(private readonly db: Firestore) {}

  async commit(
    intent: StreakDefinitionIntent,
    decide: (
      snapshot: StreakDefinitionSnapshot,
    ) => Result<StreakDefinitionDecision, PublishStreakDefinitionFailure>,
  ): Promise<Result<StreakDefinitionOutcome, PublishStreakDefinitionFailure>> {
    try {
      return await this.db.runTransaction(async (tx) => {
        const head = this.db
          .collection(STREAK_DEFINITIONS_COLLECTION)
          .doc(intent.streakId);
        const versions = head.collection(STREAK_DEFINITION_VERSIONS_COLLECTION);

        const schedule = await this.scheduleOf(tx, head);
        const replayed = await this.replayOf(tx, intent, versions, schedule);
        if (replayed !== null) {
          return ok<StreakDefinitionOutcome, PublishStreakDefinitionFailure>({
            kind: 'replayed',
            receipt: replayed,
          });
        }

        const decision = decide({
          schedule,
          highestVersion: await this.highestVersion(tx, versions),
        });
        if (decision.isFailure()) return fail(decision.error);

        await this.write(tx, head, versions, decision.value);
        return ok<StreakDefinitionOutcome, PublishStreakDefinitionFailure>({
          kind: 'written',
          decision: decision.value,
        });
      });
    } catch (error) {
      // A transaction out of retries, a network fault, a stored document
      // that would not read, a version number that was taken: all the same
      // to the caller. The rule did not change and nothing partial stands.
      return fail(new PublishStreakDefinitionStoreError(error));
    }
  }

  /**
   * The head as a model, `null` when nobody has published the rule. A head
   * that does not read is THROWN, not answered as "none": deciding over a
   * rule nobody could read would publish on top of it.
   */
  private async scheduleOf(
    tx: Transaction,
    head: DocumentReference,
  ): Promise<StreakDefinitionSchedule | null> {
    const stored = await tx.get(head);
    if (!stored.exists) return null;
    const schedule = streakScheduleFromDocument(head.id, stored.data());
    if (schedule.isFailure()) throw schedule.error;
    return schedule.value;
  }

  /** What this very intent wrote before, as the answer it was given then; `null` when it wrote nothing. */
  private async replayOf(
    tx: Transaction,
    intent: StreakDefinitionIntent,
    versions: CollectionReference,
    schedule: StreakDefinitionSchedule | null,
  ): Promise<StreakDefinitionReceipt | null> {
    if (intent.act === 'withdraw') {
      const row = await tx.get(
        auditRowRef(
          this.db,
          withdrawalRowId(intent.streakId, intent.requestId),
        ),
      );
      return row.exists ? { kind: 'withdrawn', version: intent.version } : null;
    }

    // No head, no version: the first publish writes both in one breath.
    if (schedule === null) return null;
    const written = await tx.get(
      versions.where('requestId', '==', intent.requestId).limit(1),
    );
    const found = written.docs[0];
    if (found === undefined) return null;
    const { name } = schedule.current;
    const version = streakDefinitionVersionFromDocument(
      intent.streakId,
      found.id,
      found.data(),
      { bg: name.bg, en: name.en },
    );
    if (version.isFailure()) throw version.error;
    return {
      kind: 'published',
      version: version.value.definition.version,
      effectiveFrom: version.value.definition.effectiveFrom,
      direction: version.value.direction,
    };
  }

  /**
   * The highest version ever written, read off the document ids alone
   * (`select()` fetches no body). Ids and not the head, because a version
   * that was called off is no longer on the head and its number is still
   * taken.
   */
  private async highestVersion(
    tx: Transaction,
    versions: CollectionReference,
  ): Promise<number> {
    const written = await tx.get(versions.select());
    return written.docs
      .map((version) => version.id)
      .filter((id) => VERSION_ID.test(id))
      .reduce((highest, id) => Math.max(highest, Number(id)), 0);
  }

  private async write(
    tx: Transaction,
    head: DocumentReference,
    versions: CollectionReference,
    decision: StreakDefinitionDecision,
  ): Promise<void> {
    // Planned before anything is written: a row the domain refuses fails
    // the act with nothing behind it.
    const row = auditRowCreate(this.db, rowOf(decision.audit));

    // The last reads. A version that waited and has no document of its own
    // (a head seeded without its history) has nothing to stamp.
    const calledOff: DocumentReference[] = [];
    for (const version of decision.calledOff) {
      const ref = versions.doc(streakDefinitionVersionId(version));
      if ((await tx.get(ref)).exists) calledOff.push(ref);
    }

    if (decision.version !== null) {
      tx.create(
        versions.doc(
          streakDefinitionVersionId(decision.version.definition.version),
        ),
        streakDefinitionVersionToDocument(decision.version),
      );
    }
    for (const ref of calledOff) {
      tx.update(ref, { withdrawnAt: decision.at.toISOString() });
    }
    // `set`, not `update`: the head is the schedule document, written
    // whole, so nothing of what stood before survives a publish.
    tx.set(head, { ...streakScheduleToDocument(decision.head, decision.at) });
    tx.create(row.ref, row.body);
  }
}

/**
 * The act's ONE row as the flat log stores it — planned by `AuditSystem`
 * (no subjects: a rule is about no one client, so one untargeted row), its
 * id the hash of the basis the intent's `requestId` keys. A row the planner
 * refuses fails the act with nothing behind it.
 */
function rowOf(audit: StreakDefinitionAudit): AuditEntry {
  const planned = AuditSystem.plan(
    [
      {
        resourceId: audit.resourceId,
        subjects: [],
        changeKey: audit.changeKey,
        context: audit.context,
      },
    ],
    audit.actor,
    audit.atUtcMs,
  );
  if (!planned.ok) {
    throw new Error(
      `audit entry refused by domain: ${planned.error.errorCode}`,
    );
  }
  const [plan] = planned.value;
  if (plan === undefined || plan.idBasis === null) {
    throw new Error('audit entry was not planned');
  }
  return { id: AuditEntryId.of(sha256Hex(plan.idBasis)), ...plan.row };
}

/** Where a withdrawal's row is, written or not: the id `rowOf` derives for the intent. */
function withdrawalRowId(streakId: string, requestId: string): AuditEntryId {
  return AuditEntryId.of(
    sha256Hex(
      AuditSystem.rowBasis(
        AuditAction.LoyaltyStreakDefinitionWithdrawn,
        AuditResourceId.forStreakDefinition(StreakDefinitionId.of(streakId)),
        null,
        requestId,
      ),
    ),
  );
}
