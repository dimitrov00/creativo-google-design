import {
  type Actor,
  AuditAction,
  type DocPath,
  FlagName,
  StreakPublishCall,
  StreakRule,
  type StreakRuleInput,
  type StreakTransition,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  AuditResourceId,
  defect,
  type LocalDate,
  type PublishRequestId,
  Result,
  type StreakDefinitionId,
  StreakDefinitionVersionId,
  type TimeZone,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type RepositoryError,
  StreakPublishError,
  StreakRuleField,
} from '@core/errors';
import {
  Collections,
  QueryOp,
  type StreakDefinition,
  type StreakDefinitionVersion,
  Subcollections,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  FlagsPorts,
  HashPorts,
  LocationLoadPorts,
  ReadTx,
} from '@core/ports';
import {
  type AuditRowPlan,
  AuditSystem,
  type StreakNoticePolicy,
  StreakPublishSystem,
  StreakRuleSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

/**
 * `publishStreakDefinition` / `withdrawStreakDefinition` — the rhythm's
 * rule published or called off (client-card-revision-3 §4.4; loyalty flip
 * (3), F3-8), behind the admin-only `publishStreakDefinition` callable
 * whose wire is frozen (`apps/functions/src/wire/loyalty.wire.ts`). The
 * ONLY writer of `streakDefinitions/{id}` and its `versions`
 * (`firestore.rules` refuses every client write), so there is no second
 * door.
 *
 * ONE transaction (`CommitPorts`) reads the head where it will be written —
 * two admins saving at once both read the same head, Firestore lets one
 * commit, and the other's retry reads a head that moved and is refused
 * `STALE`, never written over the first — then decides
 * (`StreakPublishSystem`), and writes the version (`Create`: a number that
 * is taken fails the act instead of rewriting history), the called-off
 * version's `withdrawnAtUtcMs`, the head (whole) and the act's ONE audit row
 * (`Create`, F1-8: no row, no rule) — all of it or none of it.
 *
 * - **A retry writes nothing.** A publish leaves its `requestId` on the
 *   version it wrote; a withdrawal leaves its audit row, whose id is the
 *   hash of the basis its `requestId` keys. Either is looked for FIRST and
 *   answers the original receipt — without that, the retry of a publish
 *   whose answer was lost would read its own write as a head that moved.
 * - **The writer numbers the version**, one above the highest ever written
 *   (withdrawn included): `versions orderBy version desc limit 1`, under the
 *   invariant `id == StreakDefinitionVersionId.forVersion(version)` every
 *   writer keeps.
 * - **The server's clock and calendar**, never the caller's: `nowUtcMs`
 *   once, the shop day on the default location's zone (`ZonedTimeSystem`,
 *   T5; F-4 — a rhythm names no shop; a zone that cannot be read is the
 *   act's store failure, 4A-2 (e)), and
 *   the notice a stricter rule owes once clients can see their rhythm
 *   (`loyalty.selfView`, `StreakRule.RULE_CHANGE_NOTICE_DAYS`).
 *
 * A commit failure is the `RepositoryError` the commit port answers (a
 * taken version number's `ALREADY_EXISTS` included); the composition root
 * turns a REJECTED commit into one too. It contains NO engine: publishing
 * changes the rule a reader resolves by date; nobody's run is recomputed.
 */

export type PublishStreakDefinitionPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  FlagsPorts &
  LocationLoadPorts &
  DefaultLocationPorts;

/**
 * «Запази», decoded at the wire. The verified caller sits FLAT at the
 * command's root (decoded off the token, never the payload) — the flipped
 * pipelines' `callerUserId` precedent; no nested caller record.
 */
export type PublishStreakDefinitionCommand = {
  /** `null` when the request carries no signed-in uid. */
  readonly callerUserId: UserId | null;
  readonly callerIsAdmin: boolean;
  /** The audit row's actor, as the wire attributes the token's claims; `null` with no caller. */
  readonly callerActor: Actor | null;
  /** One per intent, kept across retries of it. */
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  /** The newest version the head held when the draft was made; 0 when the shop has published none. */
  readonly baseVersion: number;
  /**
   * The draft, decoded at the wire (a value not of the wire's kind is its
   * `INVALID` already) but judged only after the head is admitted (order
   * frozen). Its own `version` and day are never read: the writer numbers
   * the version and the day is the request's.
   */
  readonly draft: Result<StreakRuleInput, StreakPublishError.Invalid>;
  /** The day asked, as sent; a non-string reads as '' — `StreakRule.parse` refuses it. */
  readonly effectiveFrom: string;
  readonly streakTransition: StreakTransition;
  /** The preview this was confirmed on; `null` until the server has one. */
  readonly previewHash: string | null;
};

/** «Отмени»: the version that waits, named by its number. */
export type WithdrawStreakDefinitionCommand = {
  readonly callerUserId: UserId | null;
  readonly callerIsAdmin: boolean;
  readonly callerActor: Actor | null;
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  readonly version: number;
};

/** What a withdrawal answers: the version called off. */
export type StreakWithdrawReceipt = { readonly version: number };

export type PublishStreakDefinitionError = StreakPublishError | RepositoryError;

/** What a publish's transaction read. */
type PublishSnapshot = {
  readonly head: StreakDefinition | null;
  /** The version this very intent wrote before, or `null`. */
  readonly replayed: StreakDefinitionVersion | null;
  /** The highest version ever written, the withdrawn among them; 0 with none. */
  readonly highestVersion: number;
  /** The waiting version's number when its document exists — what a publish can stamp. */
  readonly stored: readonly number[];
};

/** What a withdrawal's transaction read. */
type WithdrawSnapshot = {
  readonly head: StreakDefinition | null;
  /** This very intent's audit row exists: it was written before. */
  readonly replayed: boolean;
  /** The named version's number when its document exists. */
  readonly stored: readonly number[];
};

/** A decision and its plan, as the commit port takes it. */
type Planned<D> = D & { readonly writes: readonly WriteOp[] };

export const publishStreakDefinition =
  (ports: PublishStreakDefinitionPorts) =>
  async (
    cmd: PublishStreakDefinitionCommand,
  ): Promise<
    Result<StreakPublishCall.Receipt, PublishStreakDefinitionError>
  > => {
    const admitted = StreakPublishSystem.admitCaller(
      cmd.callerUserId,
      cmd.callerIsAdmin,
    );
    if (!admitted.ok) return admitted;
    // No verified actor is no caller (the wire never decodes one without the other).
    if (cmd.callerActor === null) {
      return Result.err(StreakPublishError.callerUnauthenticated());
    }
    const actor = cmd.callerActor;
    const publishedByUserId = admitted.value;
    // Read once, before the transaction: `decide` may run more than once.
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return zone;
    const nowUtcMs = ports.nowUtcMs();
    const today = shopDay(nowUtcMs, zone.value);
    const policy: StreakNoticePolicy = {
      clientsSeeRhythm: ports.flagOn(FlagName.LoyaltySelfView),
      noticeDays: StreakRule.RULE_CHANGE_NOTICE_DAYS,
    };

    const committed = await ports.commit(
      (tx) => readPublish(tx, cmd.streakId, cmd.requestId),
      (
        snapshot,
      ): Result<
        Planned<{ readonly receipt: StreakPublishCall.Receipt }>,
        StreakPublishError
      > => {
        if (snapshot.replayed !== null) {
          return Result.ok({
            receipt: StreakPublishSystem.replayReceipt(snapshot.replayed),
            writes: [],
          });
        }
        const { head } = snapshot;
        const numbered = StreakPublishSystem.admit(
          {
            baseVersion: cmd.baseVersion,
            streakTransition: cmd.streakTransition,
            previewHash: cmd.previewHash,
          },
          { head, highestVersion: snapshot.highestVersion },
        );
        if (!numbered.ok) return numbered;
        const name = StreakPublishSystem.nameOf(
          cmd.streakId,
          head === null ? null : head.name,
        );
        if (name === null) {
          return Result.err(StreakPublishError.invalid([StreakRuleField.Id]));
        }
        if (!cmd.draft.ok) return cmd.draft;
        const rule = StreakPublishSystem.proposal(
          cmd.draft.value,
          numbered.value,
          cmd.effectiveFrom,
        );
        if (!rule.ok) return rule;
        const decided = StreakPublishSystem.decide(
          rule.value,
          cmd.streakTransition,
          head,
          today,
          policy,
        );
        if (!decided.ok) return decided;
        const plan = StreakPublishSystem.publishPlan(
          {
            requestId: cmd.requestId,
            streakId: cmd.streakId,
            baseVersion: cmd.baseVersion,
            rule: rule.value,
            streakTransition: cmd.streakTransition,
            previewHash: cmd.previewHash,
          },
          name,
          decided.value,
          snapshot.stored,
          publishedByUserId,
          actor,
          nowUtcMs,
        );
        return Result.ok({
          receipt: plan.receipt,
          writes: [
            WriteOp.create(
              versionPath(cmd.streakId, plan.receipt.version),
              plan.versionBody,
            ),
            ...stamps(cmd.streakId, plan.stampVersions, nowUtcMs),
            WriteOp.set(headPath(cmd.streakId), plan.headBody),
            ...auditCreates(plan.audit, ports),
          ],
        });
      },
    );
    return committed.ok ? Result.ok(committed.value.receipt) : committed;
  };

export const withdrawStreakDefinition =
  (ports: PublishStreakDefinitionPorts) =>
  async (
    cmd: WithdrawStreakDefinitionCommand,
  ): Promise<Result<StreakWithdrawReceipt, PublishStreakDefinitionError>> => {
    const admitted = StreakPublishSystem.admitCaller(
      cmd.callerUserId,
      cmd.callerIsAdmin,
    );
    if (!admitted.ok) return admitted;
    if (cmd.callerActor === null) {
      return Result.err(StreakPublishError.callerUnauthenticated());
    }
    const actor = cmd.callerActor;
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return zone;
    const nowUtcMs = ports.nowUtcMs();
    const today = shopDay(nowUtcMs, zone.value);
    const call = StreakPublishCall.withdraw(
      cmd.requestId,
      cmd.streakId,
      cmd.version,
    );
    const rowPath = auditPath(
      ports.hash(
        AuditSystem.rowBasis(
          AuditAction.LoyaltyStreakDefinitionWithdrawn,
          AuditResourceId.forStreakDefinition(cmd.streakId),
          null,
          cmd.requestId,
        ),
      ),
    );

    const committed = await ports.commit(
      (tx) => readWithdraw(tx, cmd.streakId, cmd.version, rowPath),
      (snapshot): Result<Planned<object>, StreakPublishError> => {
        if (snapshot.replayed) return Result.ok({ writes: [] });
        const { head } = snapshot;
        const withdrawn = StreakPublishSystem.withdraw(
          cmd.version,
          head,
          today,
        );
        if (!withdrawn.ok) return withdrawn;
        // `withdraw` refuses a rule nobody published; the head is read here.
        if (head === null) {
          return Result.err(StreakPublishError.stale(cmd.version, 0));
        }
        const plan = StreakPublishSystem.withdrawPlan(
          call,
          head.name,
          withdrawn.value,
          snapshot.stored,
          actor,
          nowUtcMs,
        );
        return Result.ok({
          writes: [
            ...stamps(cmd.streakId, plan.stampVersions, nowUtcMs),
            WriteOp.set(headPath(cmd.streakId), plan.headBody),
            ...auditCreates(plan.audit, ports),
          ],
        });
      },
    );
    return committed.ok ? Result.ok({ version: cmd.version }) : committed;
  };

// ── The read halves ───────────────────────────────────────────────────────

/**
 * The head; when one exists, this intent's earlier version (a first
 * publish has no head and no version, so nothing to replay); the highest
 * version ever written; the waiting version's document, the one a publish
 * can call off. A replay reads no further.
 */
async function readPublish(
  tx: ReadTx,
  streakId: StreakDefinitionId,
  requestId: PublishRequestId,
): Promise<PublishSnapshot> {
  const head = await tx.get<StreakDefinition>(headPath(streakId));
  if (head !== null) {
    const [replayed] = await tx.query<StreakDefinitionVersion>({
      collection: versionsPath(streakId),
      where: [
        {
          field: 'requestId' satisfies keyof StreakDefinitionVersion,
          op: QueryOp.Eq,
          value: requestId,
        },
      ],
      orderBy: [],
      limit: 1,
    });
    if (replayed !== undefined) {
      return { head, replayed, highestVersion: 0, stored: [] };
    }
  }
  const [highest] = await tx.query<StreakDefinitionVersion>({
    collection: versionsPath(streakId),
    where: [],
    orderBy: [
      {
        field: 'version' satisfies keyof StreakDefinitionVersion,
        descending: true,
      },
    ],
    limit: 1,
  });
  const waiting = head === null ? null : StreakRuleSystem.scheduled(head);
  const stored =
    waiting === null ? [] : await storedVersions(tx, streakId, waiting.version);
  return {
    head,
    replayed: null,
    highestVersion: highest === undefined ? 0 : highest.version,
    stored,
  };
}

/** The head, this intent's audit row (a replay reads no further) and the named version's document. */
async function readWithdraw(
  tx: ReadTx,
  streakId: StreakDefinitionId,
  version: number,
  rowPath: DocPath,
): Promise<WithdrawSnapshot> {
  const head = await tx.get<StreakDefinition>(headPath(streakId));
  if ((await tx.get(rowPath)) !== null) {
    return { head, replayed: true, stored: [] };
  }
  return {
    head,
    replayed: false,
    stored: await storedVersions(tx, streakId, version),
  };
}

/** `[version]` when its document exists, else none. */
async function storedVersions(
  tx: ReadTx,
  streakId: StreakDefinitionId,
  version: number,
): Promise<readonly number[]> {
  const found = await tx.get<StreakDefinitionVersion>(
    versionPath(streakId, version),
  );
  return found === null ? [] : [version];
}

// ── The write half ────────────────────────────────────────────────────────

/** Each called-off version's one later field: when it was withdrawn (a root-key update). */
function stamps(
  streakId: StreakDefinitionId,
  versions: readonly number[],
  nowUtcMs: UtcEpochMs,
): readonly WriteOp[] {
  const writes: WriteOp[] = [];
  for (const version of versions) {
    writes.push(
      WriteOp.update(versionPath(streakId, version), {
        withdrawnAtUtcMs: nowUtcMs,
      }),
    );
  }
  return writes;
}

/** The act's rows, each `Create`d under `hash(idBasis)` — a replayed act derives the same id. */
function auditCreates(
  rows: readonly AuditRowPlan[],
  ports: HashPorts,
): readonly WriteOp[] {
  const writes: WriteOp[] = [];
  for (const { row, idBasis } of rows) {
    writes.push(
      WriteOp.create(
        auditPath(
          ports.hash(
            idBasis ??
              defect('a streak act’s audit row carries its change key'),
          ),
        ),
        row,
      ),
    );
  }
  return writes;
}

// ── Paths and the shop day ────────────────────────────────────────────────

function headPath(streakId: StreakDefinitionId): DocPath {
  return [Collections.StreakDefinitions, streakId];
}

function versionsPath(streakId: StreakDefinitionId): DocPath {
  return [Collections.StreakDefinitions, streakId, Subcollections.Versions];
}

function versionPath(streakId: StreakDefinitionId, version: number): DocPath {
  return [
    ...versionsPath(streakId),
    StreakDefinitionVersionId.forVersion(version),
  ];
}

function auditPath(digest: string): DocPath {
  return [Collections.AuditLog, AuditEntryId.of(digest)];
}

/** The shop day the server's clock falls on, on the default location's zone. */
function shopDay(nowUtcMs: UtcEpochMs, timeZone: TimeZone): LocalDate {
  return ZonedTimeSystem.toLocal(nowUtcMs, timeZone).localDate;
}
