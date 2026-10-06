import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import {
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  FIREBASE_FIRESTORE,
  FIREBASE_FUNCTIONS,
} from '@creativo/infrastructure/firebase-app';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type IsoDate,
  type StreakDefinitionSchedule,
  type StreakRuleDirection,
  type StreakTransition,
  isIsoDate,
} from '@creativo/domain/engagement';
import {
  type PublishStreakDefinition,
  type PublishStreakDefinitionError,
  type PublishedStreakDefinition,
  STREAK_DEFINITIONS_COLLECTION,
  STREAK_DEFINITION_VERSIONS_COLLECTION,
  STREAK_PUBLISH_REFUSALS,
  type StreakDefinitionBodyDocument,
  type StreakDefinitionRepository,
  type StreakDefinitionVersion,
  StreakPublishFailedError,
  type StreakPublishRefusal,
  StreakPublishRefusedError,
  streakDefinitionToDocument,
  streakDefinitionVersionFromDocument,
  streakScheduleFromDocument,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import { LoyaltyCatalogSession } from './loyalty-catalog-reader.adapter';
import { subscribeWithRetry } from './subscribe-with-retry';

/** The one server door the rule is written through (client-card-revision-3.md §4.4). */
export const PUBLISH_STREAK_DEFINITION_CALLABLE = 'publishStreakDefinition';

/**
 * What the callable is sent. A publish is §4.4's request, word for word,
 * said to be one (`op`); a withdrawal names the version it calls off, so
 * an undo that arrives after the head moved on is refused rather than
 * calling off something else.
 */
export type StreakDefinitionCall =
  | {
      readonly op: 'publish';
      readonly requestId: string;
      readonly streakId: string;
      readonly baseVersion: number;
      readonly draft: StreakDefinitionBodyDocument;
      readonly effectiveFrom: IsoDate;
      readonly transition: StreakTransition;
      readonly previewHash: string | null;
    }
  | {
      readonly op: 'withdraw';
      readonly requestId: string;
      readonly streakId: string;
      readonly version: number;
    };

/** What the callable answers, once it has been read and found whole. */
type StreakDefinitionAnswer =
  | ({ readonly kind: 'published' } & PublishedStreakDefinition)
  | { readonly kind: 'withdrawn'; readonly version: number }
  | {
      readonly kind: 'refused';
      readonly refusal: StreakPublishRefusal;
      readonly fields: readonly string[];
    };

const DIRECTIONS = [
  'looser',
  'stricter',
  'mixed',
  'neutral',
  'switch',
] as const satisfies readonly StreakRuleDirection[];

/**
 * The SDK's codes for "you may not". The callable throws the first when
 * nobody is signed in (a session that ended while the draft was open),
 * and the platform the second before the callable is reached. Both are
 * read as `notAdmin`: whoever asks is not the admin pair, and the other
 * failure would tell them to try again, which cannot help.
 */
const NOT_ALLOWED_CODES: ReadonlySet<string> = new Set([
  'functions/permission-denied',
  'functions/unauthenticated',
  'permission-denied',
  'unauthenticated',
]);

/**
 * THE RHYTHM'S RULE over Firestore and its callable
 * (client-card-revision-3.md §4.3, §4.4).
 *
 * READS are documents. The head, `streakDefinitions/{id}`, is watched:
 * any signed-in person may read it, and the page that edits it sees a
 * publish from another tab as it lands. The history,
 * `streakDefinitions/{id}/versions/*`, is read once and is the admin
 * pair's alone: for anyone else the rules refuse it, which is a failed
 * `Result`. Both go through the wire's mappers, so a rule on screen is
 * always one the domain built.
 *
 * WRITES are the server's: `firestore.rules` refuses every client write
 * to either path, the admin's included. A publish and a withdrawal are
 * two operations of one callable, which answers in words
 * (`published` / `withdrawn` / `refused`). A refusal is an ordinary
 * answer and a failed `Result`, never a throw; a request that got no
 * answer (offline, a timeout, a request the server could not read, a
 * write that fell over, a payload that is none of the three) is the
 * OTHER failure, the one trying again fixes.
 *
 * A `tooEarly` refusal also names the first day the change may start
 * (`earliest`). The port's refusal has no place for it yet, so it is not
 * handed on: the use case works the day out from the domain.
 *
 * After a write that landed, the session's copy of the catalogue is
 * dropped, so the next card opened in this session reads the rule that
 * was just published instead of the one memoised an hour ago.
 */
@Injectable()
export class FirestoreStreakDefinitionRepository implements StreakDefinitionRepository {
  private readonly db = inject(FIREBASE_FIRESTORE);
  private readonly functions = inject(FIREBASE_FUNCTIONS);
  private readonly catalogue = inject(LoyaltyCatalogSession);

  observe(
    streakId: string,
  ): Observable<Result<StreakDefinitionSchedule | null, RepositoryError>> {
    // A rule with no name is nobody's rule: there is no document to watch.
    if (isBlank(streakId)) return of(ok(null));
    return subscribeWithRetry<StreakDefinitionSchedule | null>(
      (onNext, onError) =>
        onSnapshot(
          this.head(streakId),
          (snapshot) => {
            // No head = the shop has published no rule yet: an answer.
            if (!snapshot.exists()) {
              onNext(null);
              return;
            }
            const schedule = streakScheduleFromDocument(
              streakId,
              snapshot.data(),
            );
            // A head that is no rule is said once; the listener stays, so
            // the publish that mends it is heard.
            if (schedule.isFailure()) onError(schedule.error);
            else onNext(schedule.value);
          },
          onError,
        ),
    );
  }

  async listVersions(
    streakId: string,
    max: number,
  ): Promise<Result<readonly StreakDefinitionVersion[], RepositoryError>> {
    if (isBlank(streakId)) return ok([]);
    try {
      // A version document holds no name: the head holds it once, for
      // every version. No head, no rule, no history.
      const head = await getDoc(this.head(streakId));
      if (!head.exists()) return ok([]);
      const schedule = streakScheduleFromDocument(streakId, head.data());
      if (schedule.isFailure()) return fail(schedule.error);
      const { bg, en } = schedule.value.current.name;

      // Newest first by the body's own `version`, which the document id
      // spells padded: the order is the same, and a descending read of a
      // plain field is served by the index Firestore keeps by itself,
      // where a descending read of document ids would need one declared.
      const snapshot = await getDocs(
        query(
          this.versions(streakId),
          orderBy('version', 'desc'),
          limit(atLeastOne(max)),
        ),
      );
      const versions: StreakDefinitionVersion[] = [];
      for (const entry of snapshot.docs) {
        const version = streakDefinitionVersionFromDocument(
          streakId,
          entry.id,
          entry.data(),
          { bg, en },
        );
        // A history with a hole in it is no history: the read fails
        // rather than list the publishes around the one it cannot read.
        if (version.isFailure()) return fail(version.error);
        versions.push(version.value);
      }
      return ok(versions);
    } catch (error) {
      return fail(
        new RepositoryError('Failed to read the rhythm rule’s history', error),
      );
    }
  }

  async publish(
    request: PublishStreakDefinition,
  ): Promise<Result<PublishedStreakDefinition, PublishStreakDefinitionError>> {
    const { definition } = request;
    const answer = await this.call({
      op: 'publish',
      requestId: request.requestId,
      streakId: definition.id,
      baseVersion: request.baseVersion,
      draft: streakDefinitionToDocument(definition),
      effectiveFrom: definition.effectiveFrom,
      transition: request.transition,
      previewHash: request.previewHash,
    });
    if (answer.isFailure()) return fail(answer.error);
    if (answer.value.kind !== 'published') {
      return fail(unusable('a publish was answered as a withdrawal'));
    }
    this.catalogue.invalidate();
    const { version, effectiveFrom, direction } = answer.value;
    return ok({ version, effectiveFrom, direction });
  }

  async withdraw(
    streakId: string,
    version: number,
    requestId: string,
  ): Promise<Result<void, PublishStreakDefinitionError>> {
    const answer = await this.call({
      op: 'withdraw',
      requestId,
      streakId,
      version,
    });
    if (answer.isFailure()) return fail(answer.error);
    if (answer.value.kind !== 'withdrawn' || answer.value.version !== version) {
      return fail(unusable('a withdrawal was answered for another version'));
    }
    this.catalogue.invalidate();
    return ok(undefined);
  }

  /** One round trip: what was written, or which of the two failures it was. */
  private async call(
    request: StreakDefinitionCall,
  ): Promise<
    Result<
      Exclude<StreakDefinitionAnswer, { kind: 'refused' }>,
      PublishStreakDefinitionError
    >
  > {
    const callable = httpsCallable<StreakDefinitionCall, unknown>(
      this.functions,
      PUBLISH_STREAK_DEFINITION_CALLABLE,
    );
    let answer: StreakDefinitionAnswer | null;
    try {
      answer = answerOf((await callable(request)).data);
    } catch (error) {
      const refusal = thrownRefusalOf(error);
      return fail(
        refusal ??
          new StreakPublishFailedError(
            new RepositoryError('The rhythm rule could not be sent', error),
          ),
      );
    }
    if (answer === null) return fail(unusable('the answer is none it knows'));
    if (answer.kind === 'refused') {
      return fail(new StreakPublishRefusedError(answer.refusal, answer.fields));
    }
    return ok(answer);
  }

  private head(streakId: string): DocumentReference<DocumentData> {
    return doc(this.db, STREAK_DEFINITIONS_COLLECTION, streakId);
  }

  private versions(streakId: string): CollectionReference<DocumentData> {
    return collection(
      this.db,
      STREAK_DEFINITIONS_COLLECTION,
      streakId,
      STREAK_DEFINITION_VERSIONS_COLLECTION,
    );
  }
}

// ── Reading the callable's answer ───────────────────────────────────────

/**
 * The payload, held to its shape. A `published` without a version, a day
 * that is no day, a direction nobody knows: `null`, which the caller
 * reports as no answer at all. Reporting a publish that may not have
 * happened is the one failure worse than reporting none.
 */
function answerOf(data: unknown): StreakDefinitionAnswer | null {
  const answer = recordOf(data);
  if (answer === null) return null;
  switch (answer['kind']) {
    case 'published': {
      const version = versionOf(answer['version']);
      const effectiveFrom = answer['effectiveFrom'];
      const direction = DIRECTIONS.find(
        (known) => known === answer['direction'],
      );
      return version === null ||
        !isIsoDate(effectiveFrom) ||
        direction === undefined
        ? null
        : { kind: 'published', version, effectiveFrom, direction };
    }
    case 'withdrawn': {
      const version = versionOf(answer['version']);
      return version === null ? null : { kind: 'withdrawn', version };
    }
    case 'refused': {
      const refusal = refusalOf(answer['code']);
      return refusal === null
        ? null
        : { kind: 'refused', refusal, fields: fieldsOf(answer['fields']) };
    }
    default:
      return null;
  }
}

/**
 * A refusal that arrived THROWN. The callable ANSWERS its refusals and
 * throws its faults, so this reads two things only: the SDK's own "you
 * may not" (`NOT_ALLOWED_CODES`), and, should a refusal ever be thrown,
 * details that spell one of the six words. Every other thrown error is a
 * fault: `null`. Duck-typed off the error, as the booking gateway reads
 * its own: the shape is stable across SDK versions and the class buys
 * nothing.
 */
function thrownRefusalOf(error: unknown): StreakPublishRefusedError | null {
  const thrown = recordOf(error);
  if (thrown === null) return null;
  const details = recordOf(thrown['details']);
  if (details !== null) {
    const refusal = refusalOf(details['refusal']) ?? refusalOf(details['code']);
    if (refusal !== null) {
      return new StreakPublishRefusedError(
        refusal,
        fieldsOf(details['fields']),
      );
    }
  }
  const code = thrown['code'];
  return typeof code === 'string' && NOT_ALLOWED_CODES.has(code)
    ? new StreakPublishRefusedError('notAdmin')
    : null;
}

function unusable(why: string): StreakPublishFailedError {
  return new StreakPublishFailedError(
    new RepositoryError(
      `${PUBLISH_STREAK_DEFINITION_CALLABLE} answered nothing usable: ${why}`,
    ),
  );
}

function refusalOf(raw: unknown): StreakPublishRefusal | null {
  return STREAK_PUBLISH_REFUSALS.find((known) => known === raw) ?? null;
}

/** The fields a refusal names; what is no text is no field. */
function fieldsOf(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((field): field is string => typeof field === 'string')
    : [];
}

function versionOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1
    ? raw
    : null;
}

function recordOf(raw: unknown): Readonly<Record<string, unknown>> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Readonly<Record<string, unknown>>)
    : null;
}

function isBlank(raw: string): boolean {
  return typeof raw !== 'string' || raw.trim().length === 0;
}

/** A whole count of at least one, whatever was asked. */
function atLeastOne(raw: number): number {
  return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
}
