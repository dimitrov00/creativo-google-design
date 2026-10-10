import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  StreakDefinition,
  type StreakDefinitionProps,
} from '@creativo/domain/engagement';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import {
  type PublishStreakDefinition,
  StreakPublishRefusedError,
  streakDefinitionToDocument,
} from '@creativo/application/engagement';
import { InMemoryStreakDefinitionRepository } from '@creativo/application/engagement/testing';
import { FIXTURE_TODAY } from '@creativo/ecs-core/testing';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import {
  PublishStreakDefinitionInvalidError,
  PublishStreakDefinitionMalformedRequestError,
  PublishStreakDefinitionNotAdminError,
  PublishStreakDefinitionStaleError,
  PublishStreakDefinitionStoreError,
  PublishStreakDefinitionTooEarlyError,
  PublishStreakDefinitionUnauthenticatedError,
} from '../../use-cases/publish-streak-definition.errors';
import {
  type PublishStreakDefinitionResult,
  publishStreakDefinition,
  toCaller,
  toHttpsError,
  toRequest,
  toResult,
} from './publish-streak-definition';

/**
 * THE WIRE, and the whole behind it: the callable over the real use case
 * and the real store, on the in-memory Firestore. Its last block holds the
 * whole to the page's reference, `InMemoryStreakDefinitionRepository`: the
 * same requests, the same answers, the same documents.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown,
  now: '',
  flags: new Map<string, boolean>(),
}));

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../firebase-admin', () => ({ adminFirestore: () => fake.db }));
vi.mock('../flags', () => ({
  flagOn: (key: string) => fake.flags.get(key) === true,
}));
vi.mock('../../adapters/system-clock', async () => {
  const { FixedClock: Clock } = await import('../../test-support/fixed-clock');
  return {
    SystemClock: class {
      now(zone: string) {
        return new Clock(fake.now).now(zone);
      }
    },
  };
});

/** The fixtures' one day pin (`@creativo/ecs-core/testing`), the day the seeded rule is read on. */
const TODAY: string = FIXTURE_TODAY; // 2026-09-28
const TOMORROW = '2026-09-29';
const NEXT_WEEK = '2026-10-05';
const NEXT_MONTH = '2026-10-28';
/** Noon in Sofia on the fixtures' day: the instant the reference writes at. */
const NOW = `${TODAY}T09:00:00.000Z`;
const CADENCE = 'cadence';
const HEAD = `streakDefinitions/${CADENCE}`;

const owner = { uid: 'dev-staff-ivan', token: { roles: ['barber', 'admin'] } };
const vendor = { uid: 'vendor-1', token: { roles: ['sysadmin'] } };
const barber = { uid: 'dev-staff-petar', token: { roles: ['barber'] } };

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw result.error;
  return result.value;
}

/** The documents a repository holds, as paths: what the Firestore double is seeded with and held to. */
function documentsOf(
  reference: InMemoryStreakDefinitionRepository,
): Record<string, Record<string, unknown>> {
  const rule = reference.documentsOf(CADENCE);
  if (rule === null) return {};
  return {
    [HEAD]: { ...rule.head },
    ...Object.fromEntries(
      Object.entries(rule.versions).map(([id, version]) => [
        `${HEAD}/versions/${id}`,
        { ...version },
      ]),
    ),
  };
}

/** The in-memory Firestore with the transaction's `create`, which refuses a path that is taken. */
function firestore(seed: Record<string, Record<string, unknown>>) {
  const double = createProjectionFirestore(seed);
  const db = {
    ...double.db,
    runTransaction: <T>(run: (tx: unknown) => Promise<T>): Promise<T> =>
      double.db.runTransaction((tx) =>
        run({
          ...tx,
          create(ref: { path: string }, data: Record<string, unknown>) {
            if (double.docs.has(ref.path)) {
              throw Object.assign(new Error(`6 ALREADY_EXISTS: ${ref.path}`), {
                code: 6,
              });
            }
            tx.set(ref as Parameters<typeof tx.set>[0], data);
          },
        }),
      ),
  };
  return { db, docs: double.docs };
}

/** The rule's documents in the double, the audit rows left out. */
function ruleDocuments(
  docs: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    [...docs].filter(([path]) => path.startsWith('streakDefinitions/')),
  );
}

const auditRows = (
  docs: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown>[] =>
  [...docs]
    .filter(([path]) => path.startsWith('auditLog/'))
    .map(([, row]) => row);

let docs: Map<string, Record<string, unknown>>;

beforeEach(() => {
  vi.mocked(logger.error).mockClear();
  fake.now = NOW;
  fake.flags.clear();
  const seeded = firestore(
    documentsOf(InMemoryStreakDefinitionRepository.seeded()),
  );
  fake.db = seeded.db;
  docs = seeded.docs;
});

let intents = 0;
const nextIntent = (): string =>
  `intent-${String((intents += 1)).padStart(12, '0')}`;

/** The recommended rule with `patch` over it, as version 2 from `effectiveFrom`. */
function revised(
  patch: Partial<StreakDefinitionProps>,
  effectiveFrom: string,
  version = 2,
): StreakDefinition {
  return must(
    StreakDefinition.create({
      ...StreakDefinition.default().toProps(),
      ...patch,
      version,
      effectiveFrom,
    }),
  );
}

/** §4.4's request, as the browser's adapter makes it of the port's. */
function publishRequest(
  patch: Partial<StreakDefinitionProps>,
  effectiveFrom: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const definition = revised(patch, effectiveFrom);
  return {
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    draft: streakDefinitionToDocument(definition),
    effectiveFrom,
    transition: 'grandfather',
    previewHash: null,
    ...over,
  };
}

/** Nobody signed in: a request with no `auth` at all. */
const NOBODY = null;

function call(
  data: unknown,
  auth: { uid: string; token: object } | typeof NOBODY = owner,
): Promise<PublishStreakDefinitionResult> {
  return publishStreakDefinition.run({
    data,
    ...(auth === NOBODY ? {} : { auth }),
  } as unknown as CallableRequest);
}

/** The error a call was refused with, or `null` when it answered. */
async function thrownBy(run: Promise<unknown>): Promise<HttpsError | null> {
  return run.then(
    () => null,
    (error: unknown) => {
      if (error instanceof HttpsError) return error;
      throw error;
    },
  );
}

describe('publishStreakDefinition — who may ask', () => {
  it('throws unauthenticated at nobody', async () => {
    const before = new Map(docs);
    const refusal = await thrownBy(
      call(publishRequest({ graceDays: 10 }, TOMORROW), NOBODY),
    );

    expect(refusal?.code).toBe('unauthenticated');
    expect(refusal?.details).toMatchObject({
      code: 'loyalty.streak_publish.unauthenticated',
    });
    expect(docs).toEqual(before);
  });

  it.each([
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['a content manager', ['content_manager']],
    ['a client', ['client']],
    ['a caller with no role', []],
  ])('ANSWERS %s notAdmin, and writes nothing', async (_who, roles) => {
    const before = new Map(docs);
    const answer = await call(publishRequest({ graceDays: 10 }, TOMORROW), {
      uid: 'somebody',
      token: { roles },
    });

    expect(answer).toEqual({ kind: 'refused', code: 'notAdmin', fields: [] });
    expect(docs).toEqual(before);
  });

  it('judges the caller before it reads the request: a stranger never learns what was wrong with the asking', async () => {
    expect(await call({ nonsense: true }, barber)).toEqual({
      kind: 'refused',
      code: 'notAdmin',
      fields: [],
    });
    expect(await call(null, barber)).toMatchObject({ code: 'notAdmin' });
    expect((await thrownBy(call(null, NOBODY)))?.code).toBe('unauthenticated');
  });

  it('reads the role off the token, never off the payload', async () => {
    const answer = await call(
      {
        ...publishRequest({ graceDays: 10 }, TOMORROW),
        roles: ['admin'],
        caller: { uid: 'dev-staff-ivan', isAdmin: true },
      },
      barber,
    );
    expect(answer).toMatchObject({ kind: 'refused', code: 'notAdmin' });
  });

  it.each([
    ['the owner', owner, { kind: 'admin', adminUserId: 'dev-staff-ivan' }],
    [
      'the vendor',
      vendor,
      { kind: 'staff', userId: 'vendor-1', roles: ['sysadmin'] },
    ],
  ])('admits %s, and the row names them', async (_who, auth, actor) => {
    const answer = await call(
      publishRequest({ graceDays: 10 }, TOMORROW),
      auth,
    );

    expect(answer).toMatchObject({ kind: 'published', version: 2 });
    expect(auditRows(docs).map((row) => row['actor'])).toEqual([actor]);
    expect(docs.get(`${HEAD}/versions/000002`)?.['publishedBy']).toBe(auth.uid);
  });
});

describe('publishStreakDefinition — the answers', () => {
  it('publishes: the receipt, the documents and the row', async () => {
    const request = publishRequest({ graceDays: 10 }, NEXT_WEEK);

    expect(await call(request)).toEqual({
      kind: 'published',
      version: 2,
      effectiveFrom: NEXT_WEEK,
      direction: 'looser',
    });
    expect(docs.get(HEAD)).toMatchObject({
      current: { version: 1 },
      scheduled: { version: 2, graceDays: 10, transition: 'grandfather' },
      updatedAt: NOW,
    });
    expect(auditRows(docs)).toEqual([
      expect.objectContaining({
        action: 'loyalty.streak_definition_published',
        resourceId: 'streakDefinitions/cadence',
        targetUserId: null,
        context: {
          from: '1',
          to: '2',
          effectiveFrom: NEXT_WEEK,
          transition: 'grandfather',
          direction: 'looser',
          changed: 'graceDays',
        },
      }),
    ]);
  });

  it('takes a request that names no op for a publish, as §4.4 draws it', async () => {
    const request = publishRequest({ graceDays: 10 }, TOMORROW);
    expect(request).not.toHaveProperty('op');
    expect(await call(request)).toMatchObject({ kind: 'published' });
    expect(
      await call({
        ...publishRequest({ graceDays: 14 }, NEXT_WEEK),
        op: 'publish',
        baseVersion: 2,
      }),
    ).toMatchObject({ kind: 'published', version: 3 });
  });

  it('withdraws: the version that waits is called off by its number', async () => {
    await call(publishRequest({ graceDays: 10 }, NEXT_WEEK));

    const answer = await call({
      op: 'withdraw',
      requestId: nextIntent(),
      streakId: CADENCE,
      version: 2,
    });

    expect(answer).toEqual({ kind: 'withdrawn', version: 2 });
    expect(docs.get(HEAD)).toMatchObject({ scheduled: null });
    expect(docs.get(`${HEAD}/versions/000002`)).toMatchObject({
      withdrawnAt: NOW,
    });
    expect(auditRows(docs).map((row) => row['action'])).toEqual([
      'loyalty.streak_definition_published',
      'loyalty.streak_definition_withdrawn',
    ]);
  });

  it('answers a draft that is no rule with its fields', async () => {
    const request = publishRequest({}, TOMORROW);
    const answer = await call({
      ...request,
      draft: {
        ...(request['draft'] as object),
        graceDays: 60,
        repair: { enabled: true, windowDays: 0, perYear: 1 },
      },
    });
    expect(answer).toEqual({
      kind: 'refused',
      code: 'invalid',
      fields: ['graceDays', 'repair.windowDays'],
    });
  });

  it('answers a day too early with the first day the change may start', async () => {
    expect(await call(publishRequest({ graceDays: 10 }, TODAY))).toEqual({
      kind: 'refused',
      code: 'tooEarly',
      fields: ['effectiveFrom'],
      earliest: TOMORROW,
    });
  });

  it('holds a stricter rule to thirty days of notice once clients see their rhythm', async () => {
    const stricter = publishRequest({ graceDays: 3 }, TOMORROW);
    // Nobody sees it yet: tomorrow will do.
    expect(await call(stricter)).toMatchObject({
      kind: 'published',
      direction: 'stricter',
    });

    fake.flags.set('loyalty.selfView', true);
    expect(
      await call({
        ...publishRequest({ graceDays: 2 }, TOMORROW),
        baseVersion: 2,
      }),
    ).toEqual({
      kind: 'refused',
      code: 'tooEarly',
      fields: ['effectiveFrom'],
      earliest: NEXT_MONTH,
    });
  });

  it('answers the other refusals in the port’s words, with no field', async () => {
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, { baseVersion: 4 }),
      ),
    ).toEqual({ kind: 'refused', code: 'stale', fields: [] });
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, {
          transition: 'recompute',
        }),
      ),
    ).toEqual({ kind: 'refused', code: 'recomputeNeedsEngine', fields: [] });
    expect(
      await call(
        publishRequest({ graceDays: 10 }, TOMORROW, { previewHash: 'abc' }),
      ),
    ).toEqual({ kind: 'refused', code: 'previewStale', fields: [] });
    expect(
      await call({
        op: 'withdraw',
        requestId: nextIntent(),
        streakId: CADENCE,
        version: 2,
      }),
    ).toEqual({ kind: 'refused', code: 'stale', fields: [] });
    expect(auditRows(docs)).toEqual([]);
  });

  it('writes nothing twice for a retry, and answers as it did', async () => {
    const request = publishRequest({ graceDays: 10 }, NEXT_WEEK);
    const first = await call(request);
    const written = new Map(docs);

    expect(await call(request)).toEqual(first);
    expect(docs).toEqual(written);
    expect(auditRows(docs)).toHaveLength(1);
  });

  it('throws internal when the write falls over, and says why where alerting can find it', async () => {
    fake.db = {
      runTransaction: async () => {
        throw new Error('deadline exceeded');
      },
    };

    const refusal = await thrownBy(
      call(publishRequest({ graceDays: 10 }, TOMORROW)),
    );

    expect(refusal?.code).toBe('internal');
    expect(refusal?.details).toMatchObject({
      code: 'loyalty.streak_publish.store_failed',
    });
    // The cause stays on the server.
    expect(JSON.stringify(refusal?.details)).not.toContain('deadline');
    expect(logger.error).toHaveBeenCalledWith('rhythm rule write failed', {
      error: 'Error: deadline exceeded',
    });
  });
});

describe('toRequest — the envelope', () => {
  const sound = (): Record<string, unknown> =>
    publishRequest({ graceDays: 10 }, TOMORROW);

  const fieldOf = (raw: unknown): string | null => {
    const read = toRequest(raw);
    return read.isFailure() ? read.error.field : null;
  };

  it('reads §4.4’s request', () => {
    const raw = sound();
    expect(must(toRequest(raw))).toEqual({ op: 'publish', ...raw });
  });

  it('reads a withdrawal', () => {
    expect(
      must(
        toRequest({
          op: 'withdraw',
          requestId: 'intent-000000000001',
          streakId: CADENCE,
          version: 2,
          // Nothing of a publish is read off a withdrawal.
          draft: 'ignored',
        }),
      ),
    ).toEqual({
      op: 'withdraw',
      requestId: 'intent-000000000001',
      streakId: CADENCE,
      version: 2,
    });
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a text', 'publish'],
    ['a list', [sound()]],
  ])('refuses %s as no request', (_what, raw) => {
    expect(fieldOf(raw)).toBe('request');
  });

  it.each([
    ['an op nobody knows', { op: 'delete' }, 'op'],
    ['an op that is no text', { op: 1 }, 'op'],
    ['no intent', { requestId: undefined }, 'requestId'],
    ['an intent too short to be one', { requestId: 'abc' }, 'requestId'],
    [
      'an intent that could not be an id',
      { requestId: 'a/b'.repeat(8) },
      'requestId',
    ],
    ['no rule named', { streakId: undefined }, 'streakId'],
    ['a rule named by a path', { streakId: 'cadence/versions' }, 'streakId'],
    ['a blank rule', { streakId: '' }, 'streakId'],
    ['a base that is text', { baseVersion: '1' }, 'baseVersion'],
    ['a base below nothing', { baseVersion: -1 }, 'baseVersion'],
    ['a base that is a fraction', { baseVersion: 1.5 }, 'baseVersion'],
    ['no base', { baseVersion: undefined }, 'baseVersion'],
    ['no draft', { draft: undefined }, 'draft'],
    ['a draft that is a list', { draft: [] }, 'draft'],
    ['a draft that is text', { draft: '{}' }, 'draft'],
    [
      'a draft nobody could call a rule for its size',
      {
        draft: {
          qualifier: {
            kind: 'services',
            serviceIds: Array.from({ length: 2000 }, (_, i) => `svc-${i}`),
          },
        },
      },
      'draft',
    ],
    ['a transition nobody knows', { transition: 'forget' }, 'transition'],
    ['no transition', { transition: undefined }, 'transition'],
    ['a preview that is no text', { previewHash: 7 }, 'previewHash'],
    ['a blank preview', { previewHash: '' }, 'previewHash'],
    [
      'a preview too long to be a hash',
      { previewHash: 'a'.repeat(129) },
      'previewHash',
    ],
  ])('refuses %s, by name', (_what, over, field) => {
    expect(fieldOf({ ...sound(), ...over })).toBe(field);
  });

  it.each([
    ['text', '2'],
    ['nothing', undefined],
    ['none', 0],
    ['a fraction', 2.5],
  ])('refuses a withdrawal whose version is %s', (_what, version) => {
    expect(
      fieldOf({
        op: 'withdraw',
        requestId: 'intent-000000000001',
        streakId: CADENCE,
        version,
      }),
    ).toBe('version');
  });

  it('reads an absent preview as none', () => {
    const raw = Object.fromEntries(
      Object.entries(sound()).filter(([key]) => key !== 'previewHash'),
    );
    expect(raw).not.toHaveProperty('previewHash');
    expect(must(toRequest(raw))).toMatchObject({ previewHash: null });
  });

  it('leaves the RULE to the use case: a draft goes on as sent, a day that is no text as none', () => {
    const raw = {
      ...sound(),
      draft: { graceDays: '7', anything: ['at', 'all'] },
      effectiveFrom: 20261001,
    };
    const read = must(toRequest(raw));
    expect(read).toMatchObject({
      draft: { graceDays: '7', anything: ['at', 'all'] },
      effectiveFrom: '',
    });
  });

  it('answers a rule that is wrong, and throws at an envelope that is: the page words one and not the other', async () => {
    const wrongRule = await call({ ...sound(), effectiveFrom: 20261001 });
    expect(wrongRule).toEqual({
      kind: 'refused',
      code: 'invalid',
      fields: ['effectiveFrom'],
    });

    const wrongEnvelope = await thrownBy(
      call({ ...sound(), baseVersion: '1' }),
    );
    expect(wrongEnvelope?.code).toBe('invalid-argument');
    expect(wrongEnvelope?.details).toEqual({
      code: 'loyalty.streak_publish.invalid_input',
      params: { field: 'baseVersion' },
    });
  });
});

describe('toCaller / toResult / toHttpsError — the pure halves', () => {
  it('reads the caller off the verified token', () => {
    expect(toCaller({ auth: owner })).toEqual({
      uid: 'dev-staff-ivan',
      actor: { kind: 'admin', adminUserId: expect.anything() },
      isAdmin: true,
    });
    expect(toCaller({ auth: barber })).toMatchObject({ isAdmin: false });
    expect(toCaller({})).toBeNull();
    expect(
      toCaller({ auth: { uid: '', token: { roles: ['admin'] } } }),
    ).toBeNull();
  });

  it('hands a receipt on as it is', () => {
    const published = {
      kind: 'published',
      version: 2,
      effectiveFrom: TOMORROW,
      direction: 'looser',
    } as const;
    expect(toResult(ok(published))).toBe(published);
    expect(toResult(ok({ kind: 'withdrawn', version: 2 }))).toEqual({
      kind: 'withdrawn',
      version: 2,
    });
  });

  it('RETURNS a refusal: an answer the page words', () => {
    expect(
      toResult(fail(new PublishStreakDefinitionInvalidError(['graceDays']))),
    ).toEqual({ kind: 'refused', code: 'invalid', fields: ['graceDays'] });
    expect(toResult(fail(new PublishStreakDefinitionStaleError(1, 2)))).toEqual(
      { kind: 'refused', code: 'stale', fields: [] },
    );
    expect(toResult(fail(new PublishStreakDefinitionNotAdminError()))).toEqual({
      kind: 'refused',
      code: 'notAdmin',
      fields: [],
    });
    // Only a day too early names a day.
    expect(
      toResult(fail(new PublishStreakDefinitionTooEarlyError(TODAY, TOMORROW))),
    ).toEqual({
      kind: 'refused',
      code: 'tooEarly',
      fields: ['effectiveFrom'],
      earliest: TOMORROW,
    });
  });

  it('THROWS a fault, each by its status', () => {
    expect(
      toHttpsError(new PublishStreakDefinitionUnauthenticatedError()).code,
    ).toBe('unauthenticated');
    expect(
      toHttpsError(new PublishStreakDefinitionMalformedRequestError('draft'))
        .code,
    ).toBe('invalid-argument');
    expect(
      toHttpsError(new PublishStreakDefinitionStoreError(new Error('down')))
        .code,
    ).toBe('internal');
    expect(() =>
      toResult(fail(new PublishStreakDefinitionUnauthenticatedError())),
    ).toThrow(HttpsError);
  });
});

/**
 * THE REFERENCE. The page and its store are specified against
 * `InMemoryStreakDefinitionRepository`; the browser's adapter turns the
 * port's request into this callable's. So the two are walked through one
 * story, step by step, and must agree on every answer and every document.
 */
describe('publishStreakDefinition — agrees with the page’s reference', () => {
  type Step =
    | {
        readonly name: string;
        readonly act: 'publish';
        readonly request: PublishStreakDefinition;
      }
    | {
        readonly name: string;
        readonly act: 'withdraw';
        readonly version: number;
        readonly requestId: string;
      };

  const publish = (
    name: string,
    baseVersion: number,
    definition: StreakDefinition,
    over: Partial<PublishStreakDefinition> = {},
  ): Step => ({
    name,
    act: 'publish',
    request: {
      requestId: nextIntent(),
      baseVersion,
      definition,
      transition: 'grandfather',
      previewHash: null,
      ...over,
    },
  });

  const again = 'intent-asked-twice-0001';

  const STORY: readonly Step[] = [
    publish(
      'more grace from next week: it waits',
      1,
      revised({ graceDays: 10 }, NEXT_WEEK),
    ),
    publish(
      'a draft made before that: stale',
      1,
      revised({ graceDays: 12 }, NEXT_WEEK),
    ),
    publish(
      'a longer interval from next month: it replaces what waited',
      2,
      revised({ interval: { kind: 'fixed', days: 49 } }, NEXT_MONTH, 3),
    ),
    {
      name: 'the undo: what waits is called off',
      act: 'withdraw',
      version: 3,
      requestId: again,
    },
    {
      name: 'the undo, asked again: answered as it was',
      act: 'withdraw',
      version: 3,
      requestId: again,
    },
    {
      name: 'an undo of what no longer waits: stale',
      act: 'withdraw',
      version: 3,
      requestId: nextIntent(),
    },
    publish(
      'the next draft proposes 2, which is taken: it is numbered 4',
      1,
      revised(
        {
          protections: {
            enabled: true,
            maxBanked: 3,
            earnEvery: 4,
            startWith: 1,
          },
        },
        TOMORROW,
      ),
    ),
    publish(
      'more grace from today: too early',
      4,
      revised({ graceDays: 14 }, TODAY, 5),
    ),
    publish(
      'a recompute: it needs the engine',
      4,
      revised({ graceDays: 14 }, NEXT_WEEK, 5),
      { transition: 'recompute' },
    ),
    publish(
      'the cue alone, from today: in force at once, and what waited is called off',
      4,
      revised({ riskLeadDays: 3 }, TODAY, 5),
      { requestId: 'intent-asked-twice-0002' },
    ),
    publish(
      'the same intent again: answered as it was',
      4,
      revised({ riskLeadDays: 3 }, TODAY, 5),
      { requestId: 'intent-asked-twice-0002' },
    ),
    publish(
      'the rhythm switched off, from tomorrow',
      5,
      revised({ riskLeadDays: 3, enabled: false }, TOMORROW, 6),
    ),
  ];

  /** The reference's answer, in the callable's shape. */
  async function referenceAnswer(
    reference: InMemoryStreakDefinitionRepository,
    step: Step,
  ): Promise<PublishStreakDefinitionResult> {
    if (step.act === 'publish') {
      const published = await reference.publish(step.request);
      return published.isSuccess()
        ? { kind: 'published', ...published.value }
        : refusedAs(published.error);
    }
    const withdrawn = await reference.withdraw(
      CADENCE,
      step.version,
      step.requestId,
    );
    return withdrawn.isSuccess()
      ? { kind: 'withdrawn', version: step.version }
      : refusedAs(withdrawn.error);
  }

  /** An answer less the day a `tooEarly` names: the one thing the wire says and the port does not. */
  function withoutDay(
    answer: PublishStreakDefinitionResult,
  ): PublishStreakDefinitionResult {
    return answer.kind === 'refused'
      ? { kind: answer.kind, code: answer.code, fields: answer.fields }
      : answer;
  }

  /** The port's refusal, as the wire carries it; anything else is no answer, and no part of the story. */
  function refusedAs(error: unknown): PublishStreakDefinitionResult {
    if (!(error instanceof StreakPublishRefusedError)) throw error;
    return {
      kind: 'refused',
      code: error.refusal,
      fields: [...error.fields],
    };
  }

  /** The step as the browser's adapter sends it (contract deltas R2b-3, R3-1). */
  function wireOf(step: Step): Record<string, unknown> {
    return step.act === 'publish'
      ? {
          op: 'publish',
          requestId: step.request.requestId,
          streakId: step.request.definition.id,
          baseVersion: step.request.baseVersion,
          draft: streakDefinitionToDocument(step.request.definition),
          effectiveFrom: step.request.definition.effectiveFrom,
          transition: step.request.transition,
          previewHash: step.request.previewHash,
        }
      : {
          op: 'withdraw',
          requestId: step.requestId,
          streakId: CADENCE,
          version: step.version,
        };
  }

  it('answers every step as the reference does, and holds the same documents after each', async () => {
    const reference = InMemoryStreakDefinitionRepository.seeded();
    const told: string[] = [];

    for (const step of STORY) {
      const expected = await referenceAnswer(reference, step);
      const answered = await call(wireOf(step));

      // The port's refusal names no day; the wire's may (`earliest`).
      expect(withoutDay(answered), step.name).toEqual(expected);
      expect(ruleDocuments(docs), step.name).toEqual(documentsOf(reference));
      told.push(`${step.name} → ${expected.kind}`);
    }

    // The story is the one it says it is.
    expect(told.map((line) => line.split(' → ')[1])).toEqual([
      'published',
      'refused',
      'published',
      'withdrawn',
      'withdrawn',
      'refused',
      'published',
      'refused',
      'refused',
      'published',
      'published',
      'published',
    ]);
    // One row per act that was written: five publishes, one withdrawal.
    expect(
      auditRows(docs)
        .map((row) => row['action'])
        .sort(),
    ).toEqual([
      ...Array.from({ length: 5 }, () => 'loyalty.streak_definition_published'),
      'loyalty.streak_definition_withdrawn',
    ]);
  });

  it('opens a shop’s first rule as the reference does', async () => {
    const reference = new InMemoryStreakDefinitionRepository();
    const empty = firestore({});
    fake.db = empty.db;
    const step = publish(
      'the recommended rule, from next month',
      0,
      revised({}, NEXT_MONTH, 1),
    );

    expect(await call(wireOf(step))).toEqual(
      await referenceAnswer(reference, step),
    );
    expect(ruleDocuments(empty.docs)).toEqual(documentsOf(reference));
  });
});
