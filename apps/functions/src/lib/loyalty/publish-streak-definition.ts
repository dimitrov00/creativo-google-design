import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import {
  type IsoDate,
  STREAK_TRANSITIONS,
  type StreakRuleDirection,
  type StreakTransition,
  isOneOf,
} from '@creativo/domain/engagement';
import type { StreakPublishRefusal } from '@creativo/application/engagement';
import { isClientOperationId } from '@creativo/application/booking';
import { FirestoreStreakDefinitionStore } from '../../adapters/firestore-streak-definition-store';
import { SystemClock } from '../../adapters/system-clock';
import {
  type PublishStreakDefinitionFailure,
  type PublishStreakDefinitionFault,
  PublishStreakDefinitionMalformedRequestError,
  PublishStreakDefinitionRefusal,
  PublishStreakDefinitionStoreError,
  PublishStreakDefinitionTooEarlyError,
} from '../../use-cases/publish-streak-definition.errors';
import {
  PublishStreakDefinitionUseCase,
  RULE_CHANGE_NOTICE_DAYS,
  type StreakDefinitionCaller,
  type StreakDefinitionReceipt,
} from '../../use-cases/publish-streak-definition.use-case';
import { callerActor, callerIsAdmin } from '../booking/caller-roles';
import { adminFirestore } from '../firebase-admin';
import { flagOn } from '../flags';

/**
 * What the callable answers (client-card-revision-3 §4.4). `published` and
 * `withdrawn` are the two acts; `refused` is the server's no, in one of the
 * six words the page knows, with the fields it is about. A `tooEarly` also
 * says the first day the change MAY start, so the page can move the day
 * there.
 */
export type PublishStreakDefinitionResult =
  | {
      readonly kind: 'published';
      readonly version: number;
      readonly effectiveFrom: IsoDate;
      readonly direction: StreakRuleDirection;
    }
  | { readonly kind: 'withdrawn'; readonly version: number }
  | {
      readonly kind: 'refused';
      readonly code: StreakPublishRefusal;
      readonly fields: readonly string[];
      readonly earliest?: IsoDate;
    };

/**
 * The request, its envelope read: §4.4's publish, or the withdrawal of the
 * version that waits. ONE callable carries both, told apart by `op`; a
 * request that names none is a publish, so §4.4's request stands as
 * written.
 */
export type StreakDefinitionRequest =
  | {
      readonly op: 'publish';
      readonly requestId: string;
      readonly streakId: string;
      readonly baseVersion: number;
      readonly draft: Readonly<Record<string, unknown>>;
      readonly effectiveFrom: string;
      readonly transition: StreakTransition;
      readonly previewHash: string | null;
    }
  | {
      readonly op: 'withdraw';
      readonly requestId: string;
      readonly streakId: string;
      readonly version: number;
    };

/** A rule's id is a document id: a bounded, path-safe name. */
const STREAK_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A rule is some six hundred bytes; a list of a shop's every service adds a few thousand. */
const DRAFT_MAX_BYTES = 16_384;
const PREVIEW_HASH_MAX = 128;

function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}

const isWhole = (raw: unknown, min: number): raw is number =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= min;

const malformed = (
  field: string,
): Result<never, PublishStreakDefinitionMalformedRequestError> =>
  fail(new PublishStreakDefinitionMalformedRequestError(field));

/**
 * Shape the payload without trusting it.
 *
 * The ENVELOPE is read here and refused by name: an id that could not name
 * a document, a version that is no number, a verb nobody knows. The RULE
 * is not: the draft goes on as it was sent, bounded in size and nothing
 * else, because what is wrong with a rule is the use case's to say, field
 * by field, in the answer the page words. The day is the rule's too: one
 * that is no text reads as none, which no calendar holds.
 */
export function toRequest(
  raw: unknown,
): Result<
  StreakDefinitionRequest,
  PublishStreakDefinitionMalformedRequestError
> {
  if (!isRecord(raw)) return malformed('request');
  const data = new Map(Object.entries(raw));

  const op = data.get('op') ?? 'publish';
  if (op !== 'publish' && op !== 'withdraw') return malformed('op');
  const requestId = data.get('requestId');
  if (!isClientOperationId(requestId)) return malformed('requestId');
  const streakId = data.get('streakId');
  if (typeof streakId !== 'string' || !STREAK_ID.test(streakId)) {
    return malformed('streakId');
  }

  if (op === 'withdraw') {
    const version = data.get('version');
    return isWhole(version, 1)
      ? ok({ op, requestId, streakId, version })
      : malformed('version');
  }

  const baseVersion = data.get('baseVersion');
  if (!isWhole(baseVersion, 0)) return malformed('baseVersion');
  const draft = data.get('draft');
  if (!isRecord(draft) || JSON.stringify(draft).length > DRAFT_MAX_BYTES) {
    return malformed('draft');
  }
  const transition = data.get('transition');
  if (!isOneOf(STREAK_TRANSITIONS, transition)) return malformed('transition');
  const previewHash = data.get('previewHash') ?? null;
  if (
    previewHash !== null &&
    (typeof previewHash !== 'string' ||
      previewHash.length === 0 ||
      previewHash.length > PREVIEW_HASH_MAX)
  ) {
    return malformed('previewHash');
  }
  const effectiveFrom = data.get('effectiveFrom');

  return ok({
    op,
    requestId,
    streakId,
    baseVersion,
    draft,
    effectiveFrom: typeof effectiveFrom === 'string' ? effectiveFrom : '',
    transition,
    previewHash,
  });
}

/**
 * Who asks, off the VERIFIED token. `null` when nobody is signed in, or
 * when the uid is one the log could not name.
 */
export function toCaller(request: {
  auth?: { uid?: string; token?: object };
}): StreakDefinitionCaller | null {
  const uid = request.auth?.uid ?? '';
  const actor = callerActor(request);
  return uid.length === 0 || actor === null
    ? null
    : { uid, actor, isAdmin: callerIsAdmin(request) };
}

/**
 * A fault → wire error. The `code` rides in `details`, as on every
 * callable here. A refusal never comes this way: it is answered.
 */
export function toHttpsError(error: PublishStreakDefinitionFault): HttpsError {
  const details = { code: error.code, params: error.params };
  switch (error.code) {
    case 'loyalty.streak_publish.unauthenticated':
      return new HttpsError('unauthenticated', error.message, details);
    case 'loyalty.streak_publish.invalid_input':
      return new HttpsError('invalid-argument', error.message, details);
    default:
      return new HttpsError('internal', error.message, details);
  }
}

/**
 * The use case's answer, as the wire carries it: a receipt as it is, a
 * refusal RETURNED in the page's words, a fault thrown.
 */
export function toResult(
  answer: Result<StreakDefinitionReceipt, PublishStreakDefinitionFailure>,
): PublishStreakDefinitionResult {
  if (answer.isSuccess()) return answer.value;
  const { error } = answer;
  if (error instanceof PublishStreakDefinitionRefusal) {
    return {
      kind: 'refused',
      code: error.refusal,
      fields: [...error.fields],
      ...(error instanceof PublishStreakDefinitionTooEarlyError
        ? { earliest: error.earliest }
        : {}),
    };
  }
  if (error instanceof PublishStreakDefinitionStoreError) {
    // `internal` tells the caller nothing, on purpose. The cause is said
    // here, where alerting can find it.
    logger.error('rhythm rule write failed', {
      error: String(error.storeFailure),
    });
  }
  throw toHttpsError(error);
}

/**
 * `publishStreakDefinition`: the rhythm's rule, published or called off.
 * THIN: it reads the caller and the request, and answers. What is decided
 * is `PublishStreakDefinitionUseCase`'s; what is written,
 * `FirestoreStreakDefinitionStore`'s.
 *
 * The caller is judged BEFORE the request is read: somebody who may not
 * change the rule is told so, never what was wrong with their asking.
 *
 * Behind no feature flag of its own. The rule is the shop's whether or not
 * a card shows the rhythm yet, and `loyalty.selfView` decides one thing
 * here: once clients can see their rhythm, a rule that takes something
 * away owes them notice (`RULE_CHANGE_NOTICE_DAYS`); until then it may
 * start tomorrow.
 */
export const publishStreakDefinition = onCall(
  async (request): Promise<PublishStreakDefinitionResult> => {
    const useCase = new PublishStreakDefinitionUseCase(
      new FirestoreStreakDefinitionStore(adminFirestore()),
      new SystemClock(),
      {
        clientsSeeRhythm: flagOn('loyalty.selfView'),
        noticeDays: RULE_CHANGE_NOTICE_DAYS,
      },
    );

    const caller = useCase.admit(toCaller(request));
    if (caller.isFailure()) return toResult(fail(caller.error));
    const asked = toRequest(request.data);
    if (asked.isFailure()) throw toHttpsError(asked.error);

    const ask = asked.value;
    return toResult(
      ask.op === 'withdraw'
        ? await useCase.withdraw({
            caller: caller.value,
            requestId: ask.requestId,
            streakId: ask.streakId,
            version: ask.version,
          })
        : await useCase.execute({
            caller: caller.value,
            requestId: ask.requestId,
            streakId: ask.streakId,
            baseVersion: ask.baseVersion,
            draft: ask.draft,
            effectiveFrom: ask.effectiveFrom,
            transition: ask.transition,
            previewHash: ask.previewHash,
          }),
    );
  },
);
