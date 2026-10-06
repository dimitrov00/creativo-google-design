import { describe, expect, it } from 'vitest';
import { UserId } from '@creativo/domain/accounts';
import {
  StreakDefinition,
  type StreakDefinitionProps,
  StreakDefinitionSchedule,
  type StreakNoticePolicy,
  type StreakTransition,
} from '@creativo/domain/engagement';
import { actorForCaller } from '@creativo/domain/governance';
import { type Result, fail, ok } from '@creativo/domain/kernel';
import {
  STREAK_PUBLISH_REFUSALS,
  streakDefinitionToDocument,
} from '@creativo/application/engagement';
import type { ClockPort } from '@creativo/application/shared';
import { FixedClock } from '../test-support/fixed-clock';
import {
  type PublishStreakDefinitionFailure,
  PublishStreakDefinitionInvalidError,
  PublishStreakDefinitionMalformedRequestError,
  PublishStreakDefinitionNotAdminError,
  PublishStreakDefinitionPreviewStaleError,
  PublishStreakDefinitionRecomputeNeedsEngineError,
  PublishStreakDefinitionRefusal,
  PublishStreakDefinitionStaleError,
  PublishStreakDefinitionStoreError,
  PublishStreakDefinitionTooEarlyError,
  PublishStreakDefinitionUnauthenticatedError,
} from './publish-streak-definition.errors';
import {
  type PublishStreakDefinitionInput,
  PublishStreakDefinitionUseCase,
  RULE_CHANGE_NOTICE_DAYS,
  STREAK_DEFINITION_PUBLISHED,
  STREAK_DEFINITION_WITHDRAWN,
  type StreakDefinitionCaller,
  type StreakDefinitionDecision,
  type StreakDefinitionIntent,
  type StreakDefinitionOutcome,
  type StreakDefinitionReceipt,
  type StreakDefinitionSnapshot,
  type StreakDefinitionStore,
  streakDefinitionResourceId,
} from './publish-streak-definition.use-case';

/**
 * THE DECISION, over a store that holds a head in memory. What is written
 * where is the adapter's spec; that the whole agrees with the page's
 * reference is the callable's.
 */

/** 09:00 in Sofia on the fixtures' day. */
const NOW = '2026-09-28T06:00:00.000Z';
const TODAY = '2026-09-28';
const TOMORROW = '2026-09-29';
const NEXT_WEEK = '2026-10-05';
const NEXT_MONTH = '2026-10-28';
const CADENCE = 'cadence';

function must<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw result.error;
  return result.value;
}

function callerOf(
  roles: readonly string[],
  uid = 'dev-staff-ivan',
): StreakDefinitionCaller {
  return {
    uid,
    actor: actorForCaller(must(UserId.create(uid)), roles),
    isAdmin: roles.includes('admin') || roles.includes('sysadmin'),
  };
}

const OWNER = callerOf(['barber', 'admin']);

/** The recommended rule with `patch` over it: a version of its own. */
function rule(patch: Partial<StreakDefinitionProps> = {}): StreakDefinition {
  return must(
    StreakDefinition.create({
      ...StreakDefinition.default().toProps(),
      ...patch,
    }),
  );
}

function headOf(
  current: StreakDefinition,
  scheduled: {
    definition: StreakDefinition;
    transition: StreakTransition;
  } | null = null,
): StreakDefinitionSchedule {
  return must(StreakDefinitionSchedule.create({ current, scheduled }));
}

/** The head every case starts on unless it says otherwise: the recommended rule, nothing waiting. */
const RECOMMENDED = headOf(rule());

/** The recommended rule in force and version 2 (ten days of grace) waiting for next week. */
const WAITING = headOf(rule(), {
  definition: rule({ version: 2, effectiveFrom: NEXT_WEEK, graceDays: 10 }),
  transition: 'grandfather',
});

/**
 * The store's contract, in memory: an intent it wrote answers as it did
 * and decides nothing; anything else is decided over the head it holds,
 * and what is decided is the head from then on.
 */
class MemoryStore implements StreakDefinitionStore {
  readonly intents: StreakDefinitionIntent[] = [];
  readonly snapshots: StreakDefinitionSnapshot[] = [];
  readonly written: StreakDefinitionDecision[] = [];
  private readonly receipts = new Map<string, StreakDefinitionReceipt>();
  failure: PublishStreakDefinitionFailure | null = null;

  constructor(
    public schedule: StreakDefinitionSchedule | null = RECOMMENDED,
    public highestVersion = schedule === null ? 0 : 1,
  ) {}

  async commit(
    intent: StreakDefinitionIntent,
    decide: (
      snapshot: StreakDefinitionSnapshot,
    ) => Result<StreakDefinitionDecision, PublishStreakDefinitionFailure>,
  ): Promise<Result<StreakDefinitionOutcome, PublishStreakDefinitionFailure>> {
    this.intents.push(intent);
    if (this.failure !== null) return fail(this.failure);
    const key = `${intent.act}:${intent.requestId}`;
    const receipt = this.receipts.get(key);
    if (receipt !== undefined) return ok({ kind: 'replayed', receipt });

    const snapshot = {
      schedule: this.schedule,
      highestVersion: this.highestVersion,
    };
    this.snapshots.push(snapshot);
    const decision = decide(snapshot);
    if (decision.isFailure()) return fail(decision.error);

    this.schedule = decision.value.head;
    this.highestVersion = Math.max(
      this.highestVersion,
      decision.value.version?.definition.version ?? 0,
    );
    this.written.push(decision.value);
    this.receipts.set(key, decision.value.receipt);
    return ok({ kind: 'written', decision: decision.value });
  }
}

interface Setup {
  readonly store?: MemoryStore;
  readonly clock?: ClockPort;
  readonly policy?: StreakNoticePolicy;
}

function useCaseOver({ store, clock, policy }: Setup = {}) {
  const held = store ?? new MemoryStore();
  return {
    store: held,
    useCase: new PublishStreakDefinitionUseCase(
      held,
      clock ?? new FixedClock(NOW),
      policy,
    ),
  };
}

let intents = 0;
const nextIntent = (): string =>
  `request-${String((intents += 1)).padStart(12, '0')}`;

/**
 * «Запази» as the browser sends it: the rule in force with `patch` over
 * it, as the draft the wire carries (`streakDefinitionToDocument`).
 */
function publishOf(
  patch: Partial<StreakDefinitionProps>,
  effectiveFrom: string,
  over: Partial<PublishStreakDefinitionInput> = {},
): PublishStreakDefinitionInput {
  const draft = streakDefinitionToDocument(
    rule({ ...patch, version: 2, effectiveFrom: TOMORROW }),
  );
  return {
    caller: OWNER,
    requestId: nextIntent(),
    streakId: CADENCE,
    baseVersion: 1,
    draft: { ...draft },
    effectiveFrom,
    transition: 'grandfather',
    previewHash: null,
    ...over,
  };
}

/** A refusal as the wire will carry it, or `null` for anything else. */
function refusalOf(
  result: Result<unknown, PublishStreakDefinitionFailure>,
): { refusal: string; fields: readonly string[] } | null {
  return result.isFailure() &&
    result.error instanceof PublishStreakDefinitionRefusal
    ? { refusal: result.error.refusal, fields: result.error.fields }
    : null;
}

describe('PublishStreakDefinitionUseCase — who may ask', () => {
  it('refuses nobody: a fault, since there is no caller to answer', async () => {
    const { useCase, store } = useCaseOver();
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW, { caller: null }),
    );
    expect(result.isFailure() && result.error).toBeInstanceOf(
      PublishStreakDefinitionUnauthenticatedError,
    );
    expect(store.intents).toEqual([]);
  });

  it.each([
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['a content manager', ['content_manager']],
    ['a client', ['client']],
    ['a caller with no role', []],
  ])(
    'refuses %s as notAdmin, and never reaches the store',
    async (_who, roles) => {
      const { useCase, store } = useCaseOver();
      const result = await useCase.execute(
        publishOf({ graceDays: 10 }, TOMORROW, { caller: callerOf(roles) }),
      );
      expect(refusalOf(result)).toEqual({ refusal: 'notAdmin', fields: [] });
      expect(store.intents).toEqual([]);
    },
  );

  it.each([
    ['the owner', ['admin']],
    ['the vendor', ['sysadmin']],
    ['an owner who cuts hair', ['barber', 'admin']],
  ])('admits %s', async (_who, roles) => {
    const { useCase } = useCaseOver();
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW, { caller: callerOf(roles) }),
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('judges a withdrawal by the same gate', async () => {
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(WAITING, 2),
    });
    const asked = { requestId: nextIntent(), streakId: CADENCE, version: 2 };
    expect(
      refusalOf(
        await useCase.withdraw({ ...asked, caller: callerOf(['barber']) }),
      ),
    ).toEqual({ refusal: 'notAdmin', fields: [] });
    const nobody = await useCase.withdraw({ ...asked, caller: null });
    expect(nobody.isFailure() && nobody.error).toBeInstanceOf(
      PublishStreakDefinitionUnauthenticatedError,
    );
    expect(store.intents).toEqual([]);
  });

  it('answers admit() alone the same way: what the callable asks before it reads the request', () => {
    const { useCase } = useCaseOver();
    expect(must(useCase.admit(OWNER))).toBe(OWNER);
    expect(useCase.admit(null).isFailure()).toBe(true);
    const barber = useCase.admit(callerOf(['barber']));
    expect(barber.isFailure() && barber.error).toBeInstanceOf(
      PublishStreakDefinitionNotAdminError,
    );
    const blank = useCase.admit({ ...OWNER, uid: ' ' });
    expect(blank.isFailure() && blank.error).toBeInstanceOf(
      PublishStreakDefinitionUnauthenticatedError,
    );
  });
});

describe('PublishStreakDefinitionUseCase — publish', () => {
  it('lets a later day WAIT: the rule in force stays, the new one is scheduled', async () => {
    const { useCase, store } = useCaseOver();
    const input = publishOf({ graceDays: 10 }, NEXT_WEEK);

    expect(must(await useCase.execute(input))).toEqual({
      kind: 'published',
      version: 2,
      effectiveFrom: NEXT_WEEK,
      direction: 'looser',
    });

    const [decision] = store.written;
    expect(decision?.head.current.equals(rule())).toBe(true);
    expect(decision?.head.scheduled?.transition).toBe('grandfather');
    expect(decision?.head.scheduled?.definition.toProps()).toEqual(
      rule({ version: 2, effectiveFrom: NEXT_WEEK, graceDays: 10 }).toProps(),
    );
    expect(decision?.calledOff).toEqual([]);
    expect(decision?.at).toEqual(new Date(NOW));
  });

  it('signs the version with the caller, the intent and the change', async () => {
    const { useCase, store } = useCaseOver();
    const input = publishOf({ graceDays: 10, riskLeadDays: 3 }, NEXT_WEEK);
    await useCase.execute(input);

    const version = store.written[0]?.version;
    expect(version).toMatchObject({
      publishedAt: new Date(NOW),
      publishedBy: 'dev-staff-ivan',
      transition: 'grandfather',
      direction: 'looser',
      changed: ['graceDays', 'riskLeadDays'],
      requestId: input.requestId,
      withdrawnAt: null,
    });
    expect(version?.definition.version).toBe(2);
  });

  it('writes ONE audit row: who, what, from which version to which, in codes', async () => {
    const { useCase, store } = useCaseOver();
    const input = publishOf({ graceDays: 10, riskLeadDays: 3 }, NEXT_WEEK);
    await useCase.execute(input);

    expect(store.written[0]?.audit).toEqual({
      actor: OWNER.actor,
      action: 'loyalty.streak_definition_published',
      resourceId: 'streakDefinitions/cadence',
      atIso: NOW,
      context: {
        from: '1',
        to: '2',
        effectiveFrom: NEXT_WEEK,
        transition: 'grandfather',
        direction: 'looser',
        changed: 'graceDays,riskLeadDays',
      },
      changeKey: input.requestId,
    });
    expect(STREAK_DEFINITION_PUBLISHED).toBe(
      'loyalty.streak_definition_published',
    );
    expect(streakDefinitionResourceId(CADENCE)).toBe(
      'streakDefinitions/cadence',
    );
  });

  it('puts a version effective today in force at once', async () => {
    const { useCase, store } = useCaseOver();
    // The staff's cue alone moves nothing for a client: it may start today.
    const result = await useCase.execute(publishOf({ riskLeadDays: 3 }, TODAY));

    expect(must(result)).toMatchObject({ version: 2, direction: 'neutral' });
    const head = store.written[0]?.head;
    expect(head?.scheduled).toBeNull();
    expect(head?.current.version).toBe(2);
    expect(head?.current.riskLeadDays).toBe(3);
  });

  it('replaces what waited, and calls it off', async () => {
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(WAITING, 2),
    });
    const result = await useCase.execute(
      publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 }),
    );

    expect(must(result)).toMatchObject({ version: 3, direction: 'looser' });
    const [decision] = store.written;
    expect(decision?.calledOff).toEqual([2]);
    expect(decision?.head.current.version).toBe(1);
    expect(decision?.head.scheduled?.definition.version).toBe(3);
    // Compared with the rule IN FORCE, never with the one that waited.
    expect(decision?.audit.context).toMatchObject({
      from: '1',
      to: '3',
      replaced: '2',
    });
  });

  it('keeps what came into force by date as the rule in force of the new head', async () => {
    // Version 2 waited for next week, and next week has come.
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(WAITING, 2),
      clock: new FixedClock('2026-10-06T06:00:00.000Z'),
    });
    const result = await useCase.execute(
      publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 2 }),
    );

    expect(must(result)).toMatchObject({ version: 3, direction: 'looser' });
    const [decision] = store.written;
    expect(decision?.head.current.version).toBe(2);
    expect(decision?.head.current.graceDays).toBe(10);
    expect(decision?.head.scheduled?.definition.graceDays).toBe(14);
    // It is in force: nothing waited, nothing is called off.
    expect(decision?.calledOff).toEqual([]);
    expect(decision?.audit.context['from']).toBe('2');
  });

  it('publishes a shop’s first rule on nothing: base 0, version 1, in force whatever its day', async () => {
    const { useCase, store } = useCaseOver({ store: new MemoryStore(null) });
    const result = await useCase.execute(
      publishOf({}, NEXT_MONTH, { baseVersion: 0 }),
    );

    expect(must(result)).toEqual({
      kind: 'published',
      version: 1,
      effectiveFrom: NEXT_MONTH,
      direction: 'neutral',
    });
    const [decision] = store.written;
    expect(decision?.head.scheduled).toBeNull();
    expect(decision?.head.current.effectiveFrom).toBe(NEXT_MONTH);
    // The name is the recommended rule's: a draft carries none.
    expect(decision?.head.current.name.bg).toBe('Посещения в ритъм');
    expect(decision?.version?.changed).toEqual([]);
    expect(decision?.audit.context).toMatchObject({ from: '0', to: '1' });
  });

  it('opens no rule but the business’s one: another id names nothing', async () => {
    const { useCase, store } = useCaseOver({ store: new MemoryStore(null) });
    const result = await useCase.execute(
      publishOf({}, TOMORROW, { baseVersion: 0, streakId: 'weekly' }),
    );
    expect(refusalOf(result)).toEqual({ refusal: 'invalid', fields: ['id'] });
    expect(store.written).toEqual([]);
  });

  it('keeps the name the head holds', async () => {
    const named = headOf(rule({ name: { bg: 'Ритъмът', en: 'The rhythm' } }));
    const { useCase, store } = useCaseOver({ store: new MemoryStore(named) });
    await useCase.execute(publishOf({ graceDays: 10 }, TOMORROW));
    expect(store.written[0]?.version?.definition.name.en).toBe('The rhythm');
    expect(store.written[0]?.version?.changed).toEqual(['graceDays']);
  });
});

describe('PublishStreakDefinitionUseCase — the version’s number', () => {
  it('numbers the version itself: the draft’s number is a proposal', async () => {
    const { useCase } = useCaseOver();
    const input = publishOf({ graceDays: 10 }, TOMORROW);
    const result = await useCase.execute({
      ...input,
      draft: { ...input.draft, version: 41 },
    });
    expect(must(result)).toMatchObject({ version: 2 });
  });

  it('never gives a called-off version’s number away', async () => {
    // Version 2 was published and called off: the head is back on 1, and
    // `versions/000002` is still there.
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(RECOMMENDED, 2),
    });
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW),
    );

    expect(must(result)).toMatchObject({ version: 3 });
    expect(store.written[0]?.head.scheduled?.definition.version).toBe(3);
  });

  it('takes the day from the request, never from the draft', async () => {
    const { useCase } = useCaseOver();
    const input = publishOf({ graceDays: 10 }, NEXT_WEEK);
    const result = await useCase.execute({
      ...input,
      draft: { ...input.draft, effectiveFrom: '2020-01-01' },
    });
    expect(must(result)).toMatchObject({ effectiveFrom: NEXT_WEEK });
  });
});

describe('PublishStreakDefinitionUseCase — what it refuses', () => {
  it('refuses a head that moved: stale, and nothing is written', async () => {
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(WAITING, 2),
    });
    // The draft was made before version 2 was scheduled.
    const result = await useCase.execute(
      publishOf({ graceDays: 14 }, NEXT_MONTH, { baseVersion: 1 }),
    );

    expect(refusalOf(result)).toEqual({ refusal: 'stale', fields: [] });
    expect(result.isFailure() && result.error.params).toMatchObject({
      expected: '1',
      actual: '2',
    });
    expect(store.written).toEqual([]);
  });

  it('refuses a base the shop never had', async () => {
    const { useCase } = useCaseOver({ store: new MemoryStore(null) });
    const result = await useCase.execute(publishOf({}, TOMORROW));
    expect(refusalOf(result)?.refusal).toBe('stale');
  });

  it('judges the base by the head, not by the history: after a withdrawal it is the rule in force', async () => {
    const { useCase } = useCaseOver({ store: new MemoryStore(RECOMMENDED, 2) });
    const stale = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW, { baseVersion: 2 }),
    );
    expect(refusalOf(stale)?.refusal).toBe('stale');
  });

  it('refuses to recompute the runs before the engine exists', async () => {
    const { useCase, store } = useCaseOver();
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW, { transition: 'recompute' }),
    );
    expect(refusalOf(result)).toEqual({
      refusal: 'recomputeNeedsEngine',
      fields: [],
    });
    expect(store.written).toEqual([]);
  });

  it('refuses a preview nobody can vouch for: the server holds none yet', async () => {
    const { useCase, store } = useCaseOver();
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW, { previewHash: 'sha256-abc' }),
    );
    expect(refusalOf(result)).toEqual({ refusal: 'previewStale', fields: [] });
    expect(store.written).toEqual([]);
  });

  it('refuses a day the change may not start on yet, and says the first it may', async () => {
    const { useCase, store } = useCaseOver();
    // More grace favours the client: tomorrow, never today.
    const result = await useCase.execute(publishOf({ graceDays: 10 }, TODAY));

    expect(refusalOf(result)).toEqual({
      refusal: 'tooEarly',
      fields: ['effectiveFrom'],
    });
    expect(result.isFailure() && result.error).toBeInstanceOf(
      PublishStreakDefinitionTooEarlyError,
    );
    expect(
      result.isFailure() &&
        result.error instanceof PublishStreakDefinitionTooEarlyError &&
        result.error.earliest,
    ).toBe(TOMORROW);
    expect(store.written).toEqual([]);
  });

  it('refuses a day that has passed', async () => {
    const { useCase } = useCaseOver();
    const result = await useCase.execute(
      publishOf({ riskLeadDays: 3 }, '2026-09-27'),
    );
    expect(refusalOf(result)?.refusal).toBe('tooEarly');
  });

  it.each([
    ['looser', { graceDays: 10 }],
    ['stricter', { graceDays: 3 }],
    ['switch', { enabled: false }],
    ['mixed', { graceDays: 10, minGapDays: 10 }],
  ] as const)(
    'lets a %s rule start tomorrow while no client sees the rhythm',
    async (direction, patch) => {
      const { useCase } = useCaseOver();
      const result = await useCase.execute(publishOf(patch, TOMORROW));
      expect(must(result)).toMatchObject({ direction });
    },
  );

  it('owes the clients who see the rhythm their notice of a stricter rule', async () => {
    const policy = {
      clientsSeeRhythm: true,
      noticeDays: RULE_CHANGE_NOTICE_DAYS,
    };
    const { useCase } = useCaseOver({ policy });

    const soon = await useCase.execute(publishOf({ graceDays: 3 }, TOMORROW));
    expect(refusalOf(soon)?.refusal).toBe('tooEarly');
    expect(
      soon.isFailure() &&
        soon.error instanceof PublishStreakDefinitionTooEarlyError &&
        soon.error.earliest,
    ).toBe(NEXT_MONTH);

    const noticed = await useCase.execute(
      publishOf({ graceDays: 3 }, NEXT_MONTH),
    );
    expect(must(noticed)).toMatchObject({ direction: 'stricter' });
    // What favours them owes no notice.
    const looser = await useCaseOver({ policy }).useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW),
    );
    expect(looser.isSuccess()).toBe(true);
  });

  it('holds the notice to thirty days unless told otherwise', () => {
    expect(RULE_CHANGE_NOTICE_DAYS).toBe(30);
  });

  it('refuses a scheduled version that would not start after the rule in force', async () => {
    // A first rule is in force whatever its day: this one starts next month.
    const ahead = headOf(rule({ effectiveFrom: NEXT_MONTH }));
    const { useCase } = useCaseOver({ store: new MemoryStore(ahead) });
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, NEXT_WEEK),
    );
    expect(refusalOf(result)).toEqual({
      refusal: 'invalid',
      fields: ['scheduled.effectiveFrom'],
    });
  });
});

describe('PublishStreakDefinitionUseCase — a draft that is no rule', () => {
  async function refusedFor(
    draft: Record<string, unknown>,
    effectiveFrom = TOMORROW,
  ) {
    const { useCase, store } = useCaseOver();
    const input = publishOf({}, effectiveFrom);
    const result = await useCase.execute({
      ...input,
      draft: { ...input.draft, ...draft },
    });
    expect(store.written).toEqual([]);
    return refusalOf(result);
  }

  it('names every field the domain refuses, at once', async () => {
    expect(
      await refusedFor({
        graceDays: 60,
        protections: {
          enabled: true,
          maxBanked: 2,
          earnEvery: 5,
          startWith: 4,
        },
        repair: { enabled: true, windowDays: 0, perYear: 9 },
      }),
    ).toEqual({
      refusal: 'invalid',
      fields: [
        'graceDays',
        'protections.startWith',
        'repair.windowDays',
        'repair.perYear',
      ],
    });
  });

  it('holds grace under the interval, by the domain’s own rule', async () => {
    expect(
      await refusedFor({
        interval: { kind: 'fixed', days: 14 },
        graceDays: 14,
      }),
    ).toEqual({ refusal: 'invalid', fields: ['graceDays'] });
  });

  it.each([
    ['a figure sent as text', { graceDays: '7' }, 'graceDays'],
    ['a fraction of a day', { minGapDays: 1.5 }, 'minGapDays'],
    ['a switch that is no boolean', { enabled: 'yes' }, 'enabled'],
    [
      'an interval with no days',
      { interval: { kind: 'fixed' } },
      'interval.days',
    ],
    ['an interval of no kind', { interval: { days: 42 } }, 'interval.kind'],
    ['a part that is no object', { bookingHold: 14 }, 'bookingHold'],
    [
      'a part with no switch',
      { clientPause: { maxDaysPerYear: 90 } },
      'clientPause.enabled',
    ],
    ['an excuse nobody knows', { excuses: ['shopClosure', 'rain'] }, 'excuses'],
    ['excuses that are no list', { excuses: 'shopClosure' }, 'excuses'],
    [
      'a list of services with a blank in it',
      { qualifier: { kind: 'services', serviceIds: ['svc-fade', ' '] } },
      'qualifier.serviceIds',
    ],
    [
      'a list of no services',
      { qualifier: { kind: 'services', serviceIds: [] } },
      'qualifier.serviceIds',
    ],
    ['a miss that does something unknown', { onBreak: 'forgive' }, 'onBreak'],
    ['a part left out', { repair: undefined }, 'repair'],
  ])('names the field of %s', async (_what, draft, field) => {
    expect(await refusedFor(draft)).toEqual({
      refusal: 'invalid',
      fields: [field],
    });
  });

  it.each([['next week'], ['2026-02-30'], ['2026-9-29'], ['']])(
    'refuses a day that is none: %j',
    async (day) => {
      expect(await refusedFor({}, day)).toEqual({
        refusal: 'invalid',
        fields: ['effectiveFrom'],
      });
    },
  );

  it('refuses a draft that holds nothing', async () => {
    const { useCase } = useCaseOver();
    const result = await useCase.execute({
      ...publishOf({}, TOMORROW),
      draft: {},
    });
    expect(refusalOf(result)).toEqual({
      refusal: 'invalid',
      fields: ['enabled'],
    });
  });

  it('reads nothing a draft has no business saying: an id and a name of its own are not the rule’s', async () => {
    const { useCase, store } = useCaseOver();
    const input = publishOf({ graceDays: 10 }, TOMORROW);
    const result = await useCase.execute({
      ...input,
      draft: {
        ...input.draft,
        id: 'other',
        name: { bg: 'Друго', en: 'Other' },
      },
    });
    expect(result.isSuccess()).toBe(true);
    const written = store.written[0]?.version?.definition;
    expect(written?.id).toBe(CADENCE);
    expect(written?.name.en).toBe('Visits in rhythm');
  });
});

describe('PublishStreakDefinitionUseCase — withdraw', () => {
  const asked = (version: number) => ({
    caller: OWNER,
    requestId: nextIntent(),
    streakId: CADENCE,
    version,
  });

  it('calls off the version that waits: the head holds the rule in force alone', async () => {
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(WAITING, 2),
    });
    const input = asked(2);

    expect(must(await useCase.withdraw(input))).toEqual({
      kind: 'withdrawn',
      version: 2,
    });
    const [decision] = store.written;
    expect(decision?.head.scheduled).toBeNull();
    expect(decision?.head.current.version).toBe(1);
    expect(decision?.version).toBeNull();
    expect(decision?.calledOff).toEqual([2]);
    expect(decision?.audit).toEqual({
      actor: OWNER.actor,
      action: 'loyalty.streak_definition_withdrawn',
      resourceId: 'streakDefinitions/cadence',
      atIso: NOW,
      context: {
        from: '2',
        to: '1',
        effectiveFrom: NEXT_WEEK,
        transition: 'grandfather',
      },
      changeKey: input.requestId,
    });
    expect(STREAK_DEFINITION_WITHDRAWN).toBe(
      'loyalty.streak_definition_withdrawn',
    );
  });

  it('refuses what no longer waits: another version, nothing, a day that came, no rule', async () => {
    const other = useCaseOver({ store: new MemoryStore(WAITING, 2) });
    expect(refusalOf(await other.useCase.withdraw(asked(3)))?.refusal).toBe(
      'stale',
    );

    const nothing = useCaseOver();
    expect(refusalOf(await nothing.useCase.withdraw(asked(2)))?.refusal).toBe(
      'stale',
    );

    const came = useCaseOver({
      store: new MemoryStore(WAITING, 2),
      clock: new FixedClock('2026-10-05T06:00:00.000Z'),
    });
    expect(refusalOf(await came.useCase.withdraw(asked(2)))?.refusal).toBe(
      'stale',
    );

    const none = useCaseOver({ store: new MemoryStore(null) });
    expect(refusalOf(await none.useCase.withdraw(asked(1)))?.refusal).toBe(
      'stale',
    );

    for (const { store } of [other, nothing, came, none]) {
      expect(store.written).toEqual([]);
    }
  });

  it('never calls off the rule in force', async () => {
    const { useCase } = useCaseOver({ store: new MemoryStore(WAITING, 2) });
    expect(refusalOf(await useCase.withdraw(asked(1)))?.refusal).toBe('stale');
  });
});

describe('PublishStreakDefinitionUseCase — a retry, the clock, the store', () => {
  it('writes nothing for a retry of an intent it wrote, and answers as it did', async () => {
    const { useCase, store } = useCaseOver();
    const input = publishOf({ graceDays: 10 }, NEXT_WEEK);

    const first = must(await useCase.execute(input));
    // The head moved on with the first attempt; the retry is no stale draft.
    const again = must(await useCase.execute(input));

    expect(again).toEqual(first);
    expect(store.written).toHaveLength(1);
  });

  it('answers the retry of a withdrawal as it did', async () => {
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(WAITING, 2),
    });
    const input = {
      caller: OWNER,
      requestId: nextIntent(),
      streakId: CADENCE,
      version: 2,
    };
    const first = must(await useCase.withdraw(input));
    expect(must(await useCase.withdraw(input))).toEqual(first);
    expect(store.written).toHaveLength(1);
  });

  it('tells the store which intent it is, so the store can find its earlier write', async () => {
    const { useCase, store } = useCaseOver({
      store: new MemoryStore(WAITING, 2),
    });
    const publish = publishOf({ graceDays: 14 }, NEXT_MONTH, {
      baseVersion: 2,
    });
    await useCase.execute(publish);
    await useCase.withdraw({
      caller: OWNER,
      requestId: 'request-withdraw-0001',
      streakId: CADENCE,
      version: 3,
    });
    expect(store.intents).toEqual([
      { act: 'publish', streakId: CADENCE, requestId: publish.requestId },
      {
        act: 'withdraw',
        streakId: CADENCE,
        requestId: 'request-withdraw-0001',
        version: 3,
      },
    ]);
  });

  it('reads the day off the SHOP’s calendar: half past one at night in Sofia is already tomorrow', async () => {
    // 22:30 UTC on the 28th is 01:30 on the 29th in Sofia.
    const { useCase, store } = useCaseOver({
      clock: new FixedClock('2026-09-28T22:30:00.000Z'),
    });
    // The cue alone may start today, and today is the 29th.
    const result = await useCase.execute(
      publishOf({ riskLeadDays: 3 }, TOMORROW),
    );

    expect(result.isSuccess()).toBe(true);
    expect(store.written[0]?.head.scheduled).toBeNull();
    expect(store.written[0]?.audit.atIso).toBe('2026-09-28T22:30:00.000Z');
  });

  it('hands a store that could not write on as it is', async () => {
    const store = new MemoryStore();
    store.failure = new PublishStreakDefinitionStoreError(new Error('down'));
    const { useCase } = useCaseOver({ store });
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW),
    );
    expect(result.isFailure() && result.error).toBe(store.failure);
  });

  it('fails, never throws, on a clock that cannot tell the time', async () => {
    const broken: ClockPort = {
      now: () => new FixedClock(NOW).now('Nowhere/Land'),
    };
    const { useCase, store } = useCaseOver({ clock: broken });
    const result = await useCase.execute(
      publishOf({ graceDays: 10 }, TOMORROW),
    );
    expect(result.isFailure() && result.error).toBeInstanceOf(
      PublishStreakDefinitionStoreError,
    );
    expect(store.intents).toEqual([]);
  });
});

describe('the refusals and the faults', () => {
  const refusals: readonly PublishStreakDefinitionRefusal[] = [
    new PublishStreakDefinitionNotAdminError(),
    new PublishStreakDefinitionInvalidError(['graceDays']),
    new PublishStreakDefinitionStaleError(1, 2),
    new PublishStreakDefinitionTooEarlyError(TODAY, TOMORROW),
    new PublishStreakDefinitionRecomputeNeedsEngineError(),
    new PublishStreakDefinitionPreviewStaleError(),
  ];

  it('are the server’s six words, one class each, in the port’s own order', () => {
    expect(refusals.map((refusal) => refusal.refusal)).toEqual([
      ...STREAK_PUBLISH_REFUSALS,
    ]);
  });

  it('carry a code of their own each', () => {
    const codes = [
      ...refusals,
      new PublishStreakDefinitionUnauthenticatedError(),
      new PublishStreakDefinitionMalformedRequestError('requestId'),
      new PublishStreakDefinitionStoreError(new Error('down')),
    ].map((error) => error.code);
    expect(codes).toEqual([
      'loyalty.streak_publish.not_admin',
      'loyalty.streak_publish.invalid',
      'loyalty.streak_publish.stale',
      'loyalty.streak_publish.too_early',
      'loyalty.streak_publish.recompute_needs_engine',
      'loyalty.streak_publish.preview_stale',
      'loyalty.streak_publish.unauthenticated',
      'loyalty.streak_publish.invalid_input',
      'loyalty.streak_publish.store_failed',
    ]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('name their fields: the rule’s for a draft, the day for a day too early, none otherwise', () => {
    expect(refusals.map((refusal) => refusal.fields)).toEqual([
      [],
      ['graceDays'],
      [],
      ['effectiveFrom'],
      [],
      [],
    ]);
  });

  it('keep a fault from passing for a refusal', () => {
    for (const fault of [
      new PublishStreakDefinitionUnauthenticatedError(),
      new PublishStreakDefinitionMalformedRequestError('draft'),
      new PublishStreakDefinitionStoreError(null),
    ]) {
      expect(fault).not.toBeInstanceOf(PublishStreakDefinitionRefusal);
    }
  });
});
