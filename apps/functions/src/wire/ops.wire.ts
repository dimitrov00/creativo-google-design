import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import {
  type RepositoryError,
  Result,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { Actor, BackfillJobName } from '@core/components';
import { BackfillPlanSystem, ZonedTimeSystem } from '@core/systems';
import {
  type BackfillPageResult,
  type RunBackfillCommand,
  type RunBackfillRefusal,
  RunBackfillRefusalCode,
} from '@core/pipelines';
import { type EdgeError, LegacyWireCode } from '../edge';
import { callerRoles } from '../lib/booking/caller-roles';
import { storeFailure } from './waitlist.wire';

/**
 * The `runBackfill` callable's FROZEN wire (flip 1, F1-3): today's
 * `{ job, cursor? }` in, today's page JSON out, byte for byte — the runners
 * that loop it (`verify:p0`) keep reading `cursor`, `done`, `total`,
 * `budgetSpent` and the rest until Phase 4.
 *
 * - The job is today's name (`subjectMirror`, `clientStats`); the cursor is
 *   absent (resume), `null` (from the top) or a cursor a previous call
 *   returned (`BackfillPlanSystem.requestOf` validates it). A payload that
 *   names no job decodes to `request: null`, which the pipeline refuses —
 *   AFTER the stored-roles check, as today.
 * - No caller, and a token without `sysadmin`, are answered HERE as today's
 *   `{ code }`-only `HttpsError`s, message and all (thrown for `callableEdge`
 *   to pass through untouched); the stored-roles refusal and a bad job leave
 *   as the table's legacy `{ code }` rows.
 *
 * A store failure is no refusal: it leaves as today's unexpected INTERNAL.
 */

/**
 * The definition's platform timeout — the reserve the chunk in hand, the
 * closing sample and the audit row are never killed inside. The call's own
 * work budget (a share of the client's 70 s wait) is the edge's
 * (`callableEdge` with this as `timeoutSeconds`).
 */
export const RUN_BACKFILL_TIMEOUT_SECONDS = 540;

/** Today's job names ↔ `BackfillJobName` — the ONE wire table. */
const WIRE_JOB = {
  [BackfillJobName.SubjectMirror]: 'subjectMirror',
  [BackfillJobName.ClientStats]: 'clientStats',
} as const satisfies Record<BackfillJobName, string>;

const JOB_OF_WIRE: ReadonlyMap<unknown, BackfillJobName> = new Map([
  [WIRE_JOB[BackfillJobName.SubjectMirror], BackfillJobName.SubjectMirror],
  [WIRE_JOB[BackfillJobName.ClientStats], BackfillJobName.ClientStats],
]);

/** UTC, the zone today's `runStartedAt` was spelt in (`toISOString`). */
const UTC = (() => {
  const zone = ZonedTimeSystem.checkZone('UTC');
  if (!zone.ok) throw new Error('the runtime has no UTC zone');
  return zone.value;
})();

/** An instant as today's `toISOString()` text — milliseconds, `Z`. */
function utcIso(utcEpochMs: UtcEpochMs): string {
  return ZonedTimeSystem.toIso(utcEpochMs, UTC).replace(/\+00:00$/, 'Z');
}

/** Today's `{ job, cursor? }` as the payload the system parses, `{ backfillJobName, cursor? }`. */
function requestStruct(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const payload = new Map<string, unknown>(Object.entries(raw));
  return {
    backfillJobName: JOB_OF_WIRE.get(payload.get('job')),
    ...(payload.has('cursor') ? { cursor: payload.get('cursor') } : {}),
  };
}

export function decodeRunBackfill(
  request: CallableRequest<unknown>,
): RunBackfillCommand {
  const uid = UserId.parse(request.auth?.uid ?? '');
  if (!uid.ok) {
    throw new HttpsError('unauthenticated', 'Sign in first', {
      code: 'ops.backfill.unauthenticated',
    });
  }
  const roles = callerRoles(request);
  if (!roles.includes('sysadmin')) {
    throw new HttpsError('permission-denied', 'Sysadmin only', {
      code: 'ops.backfill.forbidden',
    });
  }
  return {
    callerUserId: uid.value,
    actor: Actor.forCaller(uid.value, roles),
    request: BackfillPlanSystem.requestOf(requestStruct(request.data)),
  };
}

/** Today's page answer, key for key. */
export type BackfillPageAnswer = {
  readonly job: string;
  readonly cursor: string | null;
  readonly done: boolean;
  readonly processed: number;
  readonly storedClients: number;
  readonly stamped: number;
  readonly recomputed: number;
  readonly total: number;
  readonly runStartedAt: string;
  readonly startedFrom: string | null;
  readonly sample: {
    readonly checked: number;
    readonly mismatched: readonly string[];
  } | null;
  readonly budgetSpent: boolean;
};

export function encodeRunBackfillAnswer(
  result: Result<BackfillPageResult, RunBackfillRefusal | RepositoryError>,
): Result<BackfillPageAnswer, EdgeError> {
  if (!result.ok) {
    const error = result.error;
    if ('path' in error) throw storeFailure(error);
    return Result.err({
      code:
        error.errorCode === RunBackfillRefusalCode.Forbidden
          ? LegacyWireCode.BackfillForbidden
          : LegacyWireCode.BackfillInvalidInput,
    });
  }
  const page = result.value;
  return Result.ok({
    job: WIRE_JOB[page.backfillJobName],
    cursor: page.cursor,
    done: page.done,
    processed: page.processed,
    storedClients: page.storedClients,
    stamped: page.stamped,
    recomputed: page.recomputed,
    total: page.total,
    runStartedAt: utcIso(page.runStartedAtUtcMs),
    startedFrom: page.startedFrom,
    sample:
      page.sampleChecked === null
        ? null
        : { checked: page.sampleChecked, mismatched: page.sampleMismatched },
    budgetSpent: page.budgetSpent,
  });
}
