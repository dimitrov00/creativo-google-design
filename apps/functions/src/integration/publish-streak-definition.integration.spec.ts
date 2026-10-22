import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  HeadRole,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
  type StreakRuleInput,
} from '@core/components';
import {
  AuditResourceId,
  PublishRequestId,
  Result,
  StreakDefinitionVersionId,
  StreakPublishError,
  UserId,
} from '@core/primitives';
import { Collections, Subcollections } from '@core/entities';
import {
  type PublishStreakDefinitionCommand,
  type PublishStreakDefinitionPorts,
  publishStreakDefinition,
  withdrawStreakDefinition,
} from '@core/pipelines';
import { AuditSystem } from '@core/systems';
import {
  FIXTURE_IDS,
  localDate,
  locationFixture,
  pinnedNowUtcMs,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  utcMs,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreCatalogPorts } from '../adapters/firestore-catalog.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * `publishStreakDefinition` / `withdrawStreakDefinition` against the REAL
 * Firestore emulator (loyalty flip (3), F3-8): a publish writes the flat
 * head, the flat version and the flat audit row in ONE transaction; a retry
 * of its `requestId` writes nothing and answers the same receipt; a
 * withdrawal stamps the waiting version and holds the rule in force alone;
 * two publishes on one `baseVersion` race and exactly one lands, the other
 * refused `STALE` — what no in-memory commit can honestly prove.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-publish-streak-definition';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!FIRESTORE_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const CADENCE = StreakRule.DEFAULT_DEFINITION_ID;
const NEXT_WEEK = localDate('2026-10-05');
const NOW = utcMs('2026-09-28T09:00:00.000+03:00');
const OWNER = UserId.of('dev-staff-ivan');

const HEAD = `${Collections.StreakDefinitions}/${CADENCE}`;
const versionDoc = (version: number): string =>
  `${HEAD}/${Subcollections.Versions}/${StreakDefinitionVersionId.forVersion(version)}`;

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** Two snapshots' update times are the same instant — the document was not rewritten. */
function sameUpdate(
  a: { readonly updateTime?: Timestamp },
  b: { readonly updateTime?: Timestamp },
): boolean {
  return (
    a.updateTime !== undefined &&
    b.updateTime !== undefined &&
    a.updateTime.isEqual(b.updateTime)
  );
}

let intents = 0;
const nextIntent = (): PublishRequestId =>
  PublishRequestId.of(
    `intent-emulator-${String((intents += 1)).padStart(6, '0')}`,
  );

function publishOf(
  patch: Partial<StreakRuleInput>,
  effectiveFrom: string,
  over: Partial<PublishStreakDefinitionCommand> = {},
): PublishStreakDefinitionCommand {
  return {
    callerUserId: OWNER,
    callerIsAdmin: true,
    callerActor: Actor.forCaller(OWNER, ['admin']),
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    draft: Result.ok({
      ...StreakRule.DEFAULT,
      version: 0,
      ...patch,
    } as StreakRuleInput),
    effectiveFrom,
    streakTransition: StreakTransition.Grandfather,
    previewHash: null,
    ...over,
  };
}

const rowDoc = (action: AuditAction, requestId: string): string =>
  `${Collections.AuditLog}/${sha256Hex(
    AuditSystem.rowBasis(
      action,
      AuditResourceId.forStreakDefinition(CADENCE),
      null,
      requestId,
    ),
  )}`;

describe('publishStreakDefinition (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    // The shop as the seed leaves it: the recommended rule in force, its one
    // version — and the default location whose zone names the shop's day
    // (4A-11, no tenant zone).
    await db
      .doc(`${Collections.Locations}/${FIXTURE_IDS.location}`)
      .set(bodyOf(locationFixture()));
    await db.doc(HEAD).set(bodyOf(streakDefinitionFixture()));
    await db.doc(versionDoc(1)).set(bodyOf(streakDefinitionVersionFixture()));
  });

  const ports = (): PublishStreakDefinitionPorts => ({
    commit: firestoreCommitPlan(db),
    nowUtcMs: pinnedNowUtcMs(NOW),
    hash: sha256Hex,
    flagOn: () => false,
    ...firestoreCatalogPorts(db),
    defaultLocationId: FIXTURE_IDS.location,
  });

  it('writes the flat head, the flat version and the flat row in one transaction', async () => {
    const cmd = publishOf({ graceDays: 10 }, NEXT_WEEK);
    expect(await publishStreakDefinition(ports())(cmd)).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: NEXT_WEEK,
        streakRuleDirection: StreakRuleDirection.Looser,
      }),
    );
    expect((await db.doc(HEAD).get()).data()).toMatchObject({
      name: StreakRule.DEFAULT_NAME,
      rules: [
        { version: 1, headRole: HeadRole.Current, streakTransition: null },
        {
          version: 2,
          graceDays: 10,
          effectiveFromLocalDate: NEXT_WEEK,
          headRole: HeadRole.Scheduled,
          streakTransition: StreakTransition.Grandfather,
        },
      ],
      updatedAtUtcMs: NOW,
    });
    expect((await db.doc(versionDoc(2)).get()).data()).toMatchObject({
      version: 2,
      graceDays: 10,
      publishedAtUtcMs: NOW,
      publishedByUserId: OWNER,
      streakRuleDirection: StreakRuleDirection.Looser,
      requestId: cmd.requestId,
      withdrawnAtUtcMs: null,
    });
    expect(
      (
        await db
          .doc(
            rowDoc(AuditAction.LoyaltyStreakDefinitionPublished, cmd.requestId),
          )
          .get()
      ).data(),
    ).toMatchObject({
      auditAction: AuditAction.LoyaltyStreakDefinitionPublished,
      actorRole: 'ADMIN',
      streakToVersion: 2,
      auditTarget: 'NONE',
    });
  });

  it('writes nothing for a retry of the same requestId, and answers the same receipt', async () => {
    const cmd = publishOf({ graceDays: 10 }, NEXT_WEEK);
    const first = await publishStreakDefinition(ports())(cmd);
    const head = await db.doc(HEAD).get();
    const version = await db.doc(versionDoc(2)).get();
    expect(await publishStreakDefinition(ports())(cmd)).toEqual(first);
    expect(sameUpdate(await db.doc(HEAD).get(), head)).toBe(true);
    expect(sameUpdate(await db.doc(versionDoc(2)).get(), version)).toBe(true);
    expect((await db.doc(versionDoc(3)).get()).exists).toBe(false);
  });

  it('stamps the waiting version on a withdrawal and holds the rule in force alone', async () => {
    await publishStreakDefinition(ports())(
      publishOf({ graceDays: 10 }, NEXT_WEEK),
    );
    const requestId = nextIntent();
    expect(
      await withdrawStreakDefinition(ports())({
        callerUserId: OWNER,
        callerIsAdmin: true,
        callerActor: Actor.forCaller(OWNER, ['admin']),
        requestId,
        streakId: CADENCE,
        version: 2,
      }),
    ).toEqual(Result.ok({ version: 2 }));
    expect((await db.doc(versionDoc(2)).get()).data()).toMatchObject({
      withdrawnAtUtcMs: NOW,
    });
    expect((await db.doc(HEAD).get()).data()).toMatchObject({
      rules: [{ version: 1, headRole: HeadRole.Current }],
    });
    expect((await db.doc(HEAD).get()).data()?.['rules']).toHaveLength(1);
    expect(
      (
        await db
          .doc(rowDoc(AuditAction.LoyaltyStreakDefinitionWithdrawn, requestId))
          .get()
      ).exists,
    ).toBe(true);
  });

  it('lets one of two publishes on the same baseVersion land; the other is refused stale', async () => {
    const [a, b] = await Promise.all([
      publishStreakDefinition(ports())(publishOf({ graceDays: 10 }, NEXT_WEEK)),
      publishStreakDefinition(ports())(publishOf({ graceDays: 12 }, NEXT_WEEK)),
    ]);
    const answers = [a, b];
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toEqual([
      Result.err(StreakPublishError.stale(1, 2)),
    ]);
    expect((await db.doc(versionDoc(2)).get()).exists).toBe(true);
    expect((await db.doc(versionDoc(3)).get()).exists).toBe(false);
  });
});
