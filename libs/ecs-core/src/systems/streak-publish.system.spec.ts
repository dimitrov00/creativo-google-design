import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  HeadRole,
  type StreakPublishCall,
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
  type StreakHeadRule,
} from '@core/components';
import {
  AuditResourceId,
  PublishRequestId,
  StreakDefinitionId,
  StreakDefinitionVersionId,
  StreakPublishError,
  StreakRuleField,
  UserId,
  type LocalDate,
} from '@core/primitives';
import {
  deepFreeze,
  localDate,
  streakDefinitionVersionFixture,
  utcMs,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import {
  DraftAssessment,
  StreakPublishSystem,
  type StreakPublishRequest,
} from './streak-publish.system';
import { StreakRuleSystem, type StreakSchedule } from './streak-rule.system';

/*
 * The decision of the rhythm's publish (client-card revision 3 §4.4) — the
 * cases of the page's assessment (`assess`) and of the server's decision
 * (`admit`, `decide`, `withdraw`, `nameOf`), first copied from the legacy
 * use-case specs and the rules of the legacy in-memory repository they
 * shared, and since the loyalty flip (3) the ONE decision both the
 * `publishStreakDefinition` pipeline and the admin page's gateway double
 * (`memoryStreakPublishGatewayPorts`, which runs that pipeline) make.
 * The flip's decision structs — who may ask (`admitCaller`), the numbered
 * draft (`proposal`), a retry's answer (`replayReceipt`) and what an act
 * writes (`publishPlan`, `withdrawPlan`) — are pinned at the bottom. The
 * pipeline's own behaviour (the read set, the `WriteOp[]`, the replay, the
 * order of the refusals) is `publish-streak-definition.pipeline.spec.ts`'s.
 *
 * The rule is FLAT (`intervalDays`, `protectionsMaxBanked`,
 * `effectiveFromLocalDate`), the head is its `rules` list (F-9) — read
 * through `StreakRuleSystem.current`/`scheduled` — every tag is SCREAMING,
 * a field at fault is the flat field's name and an error is
 * `{ errorCode, … }`.
 */

const TODAY = localDate('2026-09-28');
const TOMORROW = localDate('2026-09-29');
const NEXT_WEEK = localDate('2026-10-05');
const NEXT_MONTH = localDate('2026-10-28');
const CADENCE = StreakDefinitionId.of('cadence');

/** Nobody sees the rhythm yet: a stricter rule may start tomorrow. */
const QUIET = { clientsSeeRhythm: false, noticeDays: 30 };
/** Clients see it: a stricter rule is owed 30 days. */
const SEEN = { clientsSeeRhythm: true, noticeDays: 30 };

/** The recommended rule with `patch` over it: a version of its own. */
function rule(patch: Partial<StreakRule> = {}): StreakRule {
  const result = StreakRule.parse({
    ...StreakRule.DEFAULT,
    ...patch,
  } as StreakRule);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** A rule as the head holds it in force. */
const asCurrent = (r: StreakRule): StreakHeadRule => ({
  ...StreakRule.of(r),
  headRole: HeadRole.Current,
  streakTransition: null,
});

/** A rule as the head holds it waiting, grandfathering the runs that exist. */
const asScheduled = (r: StreakRule): StreakHeadRule => ({
  ...StreakRule.of(r),
  headRole: HeadRole.Scheduled,
  streakTransition: StreakTransition.Grandfather,
});

/** A head: the rule in force and, if any, the one that waits. */
const headOf = (
  current: StreakRule,
  scheduled: StreakRule | null = null,
): StreakSchedule => ({
  rules:
    scheduled === null
      ? [asCurrent(current)]
      : [asCurrent(current), asScheduled(scheduled)],
});

const currentOf = (head: StreakSchedule): StreakHeadRule =>
  StreakRuleSystem.current(head);
const scheduledOf = (head: StreakSchedule): StreakHeadRule | null =>
  StreakRuleSystem.scheduled(head);

/** The head every case starts on unless it says otherwise: the recommended rule, nothing waiting. */
const RECOMMENDED: StreakSchedule = headOf(rule());

/** The recommended rule in force and version 2 (ten days of grace) waiting for next week. */
const WAITING: StreakSchedule = headOf(
  rule(),
  rule({ version: 2, effectiveFromLocalDate: NEXT_WEEK, graceDays: 10 }),
);

const request = (
  patch: Partial<StreakPublishRequest> = {},
): StreakPublishRequest => ({
  baseVersion: 1,
  streakTransition: StreakTransition.Grandfather,
  previewHash: null,
  ...patch,
});

// ── assess (the page) ────────────────────────────────────────────────────

describe('StreakPublishSystem.assess — what a draft comes to, sending nothing', () => {
  const assess = (
    head: StreakSchedule,
    patch: Partial<StreakRule>,
    effectiveFrom: string,
    more: {
      today?: LocalDate;
      policy?: typeof QUIET;
      published?: boolean;
    } = {},
  ) =>
    StreakPublishSystem.assess(
      head,
      more.published ?? true,
      { ...inForceOf(head, more.today ?? TODAY), ...patch } as StreakRule,
      effectiveFrom,
      more.today ?? TODAY,
      more.policy ?? QUIET,
    );

  it('makes the draft the next version of the rule, on the day asked', () => {
    const assessed = assess(RECOMMENDED, { intervalDays: 56 }, NEXT_MONTH);
    if (assessed.draftAssessment !== DraftAssessment.Valid) {
      throw new Error('expected a valid draft');
    }
    expect(assessed.baseVersion).toBe(1);
    expect(assessed.rule).toEqual({
      ...StreakRule.DEFAULT,
      intervalDays: 56,
      version: 2,
      effectiveFromLocalDate: NEXT_MONTH,
    });
    expect(assessed.change).toEqual({
      direction: 'LOOSER',
      changed: ['INTERVAL'],
    });
  });

  it('sets the identity of the version itself: the draft cannot number or date it', () => {
    const assessed = assess(
      RECOMMENDED,
      { version: 40, effectiveFromLocalDate: localDate('2031-01-01') },
      TOMORROW,
    );
    expect(
      assessed.draftAssessment === DraftAssessment.Valid && assessed.rule,
    ).toMatchObject({
      version: 2,
      effectiveFromLocalDate: TOMORROW,
    });
  });

  it.each([
    ['what only moves the staff’s cue', { riskLeadDays: 3 }, 'NEUTRAL', TODAY],
    ['what favours the client', { graceDays: 10 }, 'LOOSER', TOMORROW],
    ['the rule going off', { enabled: false }, 'SWITCH', TOMORROW],
    ['what takes something away', { graceDays: 3 }, 'STRICTER', TOMORROW],
    [
      'what gives and takes',
      { graceDays: 10, minGapDays: 10 },
      'MIXED',
      TOMORROW,
    ],
  ] as const)(
    'lets %s start as early as the domain does, while nobody sees the rhythm',
    (_what, patch, direction, earliest) => {
      expect(assess(RECOMMENDED, patch, NEXT_MONTH)).toMatchObject({
        draftAssessment: 'VALID',
        change: { direction },
        earliest,
      });
    },
  );

  it('owes the clients who see the rhythm their notice, of a stricter rule only', () => {
    const stricter = assess(RECOMMENDED, { graceDays: 3 }, NEXT_MONTH, {
      policy: SEEN,
    });
    const looser = assess(RECOMMENDED, { graceDays: 10 }, NEXT_MONTH, {
      policy: SEEN,
    });
    expect(stricter).toMatchObject({
      draftAssessment: 'VALID',
      earliest: NEXT_MONTH,
    });
    expect(looser).toMatchObject({
      draftAssessment: 'VALID',
      earliest: TOMORROW,
    });
  });

  it('names every fault of a draft that is no rule, at once', () => {
    const assessed = assess(
      RECOMMENDED,
      {
        intervalDays: 7,
        protectionsEnabled: true,
        protectionsMaxBanked: 9,
        protectionsEarnEvery: 0,
        protectionsStartWith: 0,
      },
      TOMORROW,
    );
    if (assessed.draftAssessment !== DraftAssessment.Invalid) {
      throw new Error('expected a refusal');
    }
    expect(assessed.fields).toEqual([
      'intervalDays',
      'protectionsMaxBanked',
      'protectionsEarnEvery',
    ]);
    expect(assessed.errors.map((error) => error.field)).toEqual(
      assessed.fields,
    );
    expect(assessed.errors.map((error) => error.errorCode)).toEqual([
      'ENGAGEMENT_STREAK_DEFINITION_INTERVAL_OUT_OF_RANGE',
      'ENGAGEMENT_STREAK_DEFINITION_PROTECTIONS_OUT_OF_RANGE',
      'ENGAGEMENT_STREAK_DEFINITION_PROTECTIONS_OUT_OF_RANGE',
    ]);
  });

  it('names a field once, however many faults it has', () => {
    const assessed = assess(
      RECOMMENDED,
      { intervalDays: 14, graceDays: 14 },
      TOMORROW,
    );
    if (assessed.draftAssessment !== DraftAssessment.Invalid) {
      throw new Error('expected a refusal');
    }
    expect(assessed.errors[0]?.errorCode).toBe(
      'ENGAGEMENT_STREAK_DEFINITION_GRACE_NOT_SHORTER_THAN_INTERVAL',
    );
    expect(assessed.fields.filter((field) => field === 'graceDays')).toEqual([
      'graceDays',
    ]);
  });

  it('refuses a day that is no day as a fault of the draft', () => {
    expect(
      // A corrupt day, as an editor or a hand-made value could carry one —
      // handed across as written: the parse is the only door to the brand.
      assess(RECOMMENDED, { graceDays: 10 }, '2026-02-30'),
    ).toMatchObject({
      draftAssessment: 'INVALID',
      fields: ['effectiveFromLocalDate'],
    });
  });

  it('bases the draft on what WAITS, and compares it with what is IN FORCE', () => {
    // Version 2 waits with 14 days of grace; clients live under 7.
    const head: StreakSchedule = headOf(
      rule(),
      rule({ version: 2, effectiveFromLocalDate: NEXT_MONTH, graceDays: 14 }),
    );
    expect(assess(head, { graceDays: 10 }, TOMORROW)).toMatchObject({
      draftAssessment: 'VALID',
      baseVersion: 2,
      rule: { version: 3, graceDays: 10 },
      change: { direction: 'LOOSER', changed: ['GRACE_DAYS'] },
    });
  });

  it('takes what waited for the rule in force once its day has come', () => {
    const head: StreakSchedule = headOf(
      rule(),
      rule({ version: 2, effectiveFromLocalDate: TOMORROW, graceDays: 14 }),
    );
    const assessed = StreakPublishSystem.assess(
      head,
      true,
      { ...StreakRule.of(currentOf(head)), graceDays: 10 },
      localDate('2026-11-15'),
      NEXT_MONTH,
      QUIET,
    );
    // Against 14 days, 10 takes something away.
    expect(assessed).toMatchObject({
      draftAssessment: 'VALID',
      baseVersion: 2,
      change: { direction: 'STRICTER', changed: ['GRACE_DAYS'] },
      earliest: '2026-10-29',
    });
  });

  it('numbers a shop’s first rule 1, on nothing', () => {
    expect(
      assess(RECOMMENDED, { graceDays: 10 }, TOMORROW, { published: false }),
    ).toMatchObject({
      draftAssessment: 'VALID',
      baseVersion: 0,
      rule: { version: 1, graceDays: 10 },
    });
  });
});

/** The rule in force on `today` — what the page's draft is made on. */
function inForceOf(head: StreakSchedule, today: LocalDate): StreakRule {
  const scheduled = scheduledOf(head);
  return StreakRule.of(
    scheduled !== null && today >= scheduled.effectiveFromLocalDate
      ? scheduled
      : currentOf(head),
  );
}

// ── admit, decide, withdraw (the callable) ───────────────────────────────

/** The server's whole publish, admit → the numbered draft → decide. */
function publish(
  patch: Partial<StreakRule>,
  effectiveFromLocalDate: LocalDate,
  head: StreakSchedule | null = RECOMMENDED,
  more: {
    highestVersion?: number;
    request?: Partial<StreakPublishRequest>;
    today?: LocalDate;
    policy?: typeof QUIET;
  } = {},
) {
  const snapshot = {
    head,
    highestVersion: more.highestVersion ?? (head === null ? 0 : 1),
  };
  const admitted = StreakPublishSystem.admit(request(more.request), snapshot);
  if (!admitted.ok) return admitted;
  const numbered = rule({
    ...patch,
    version: admitted.value,
    effectiveFromLocalDate,
  });
  const decided = StreakPublishSystem.decide(
    numbered,
    more.request?.streakTransition ?? StreakTransition.Grandfather,
    head,
    more.today ?? TODAY,
    more.policy ?? QUIET,
  );
  return decided.ok
    ? { ok: true as const, value: { rule: numbered, ...decided.value } }
    : decided;
}

describe('StreakPublishSystem — publish', () => {
  it('lets a later day WAIT: the rule in force stays, the new one is scheduled', () => {
    const result = publish({ graceDays: 10 }, NEXT_WEEK);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.rule.version).toBe(2);
    expect(result.value.change.direction).toBe('LOOSER');
    expect(currentOf(result.value.head)).toEqual(asCurrent(rule()));
    expect(scheduledOf(result.value.head)).toEqual(
      asScheduled(
        rule({ version: 2, effectiveFromLocalDate: NEXT_WEEK, graceDays: 10 }),
      ),
    );
    expect(result.value.calledOff).toEqual([]);
    expect(result.value.waits).toBe(true);
  });

  it('classes the change against the rule in force', () => {
    const result = publish({ graceDays: 10, riskLeadDays: 3 }, NEXT_WEEK);
    expect(result.ok && result.value.change).toEqual({
      direction: 'LOOSER',
      changed: ['GRACE_DAYS', 'RISK_LEAD_DAYS'],
    });
    expect(result.ok && result.value.inForceVersion).toBe(1);
  });

  it('puts a version effective today in force at once', () => {
    // The staff's cue alone moves nothing for a client: it may start today.
    const result = publish({ riskLeadDays: 3 }, TODAY);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.change.direction).toBe('NEUTRAL');
    expect(scheduledOf(result.value.head)).toBeNull();
    expect(currentOf(result.value.head).version).toBe(2);
    expect(currentOf(result.value.head).riskLeadDays).toBe(3);
    expect(result.value.waits).toBe(false);
  });

  it('replaces what waited, and calls it off', () => {
    const result = publish({ graceDays: 14 }, NEXT_MONTH, WAITING, {
      highestVersion: 2,
      request: { baseVersion: 2 },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.rule.version).toBe(3);
    expect(result.value.change.direction).toBe('LOOSER');
    expect(result.value.calledOff).toEqual([2]);
    expect(currentOf(result.value.head).version).toBe(1);
    expect(scheduledOf(result.value.head)?.version).toBe(3);
    // Compared with the rule IN FORCE, never with the one that waited.
    expect(result.value.inForceVersion).toBe(1);
  });

  it('keeps what came into force by date as the rule in force of the new head', () => {
    // Version 2 waited for next week, and next week has come.
    const result = publish({ graceDays: 14 }, NEXT_MONTH, WAITING, {
      highestVersion: 2,
      request: { baseVersion: 2 },
      today: localDate('2026-10-06'),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(currentOf(result.value.head).version).toBe(2);
    expect(currentOf(result.value.head).graceDays).toBe(10);
    expect(scheduledOf(result.value.head)?.graceDays).toBe(14);
    // It is in force: nothing waited, nothing is called off.
    expect(result.value.calledOff).toEqual([]);
    expect(result.value.inForceVersion).toBe(2);
  });

  it('publishes a shop’s first rule on nothing: base 0, version 1, in force whatever its day', () => {
    const result = publish({}, NEXT_MONTH, null, {
      request: { baseVersion: 0 },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.rule.version).toBe(1);
    expect(result.value.change).toEqual({ direction: 'NEUTRAL', changed: [] });
    expect(scheduledOf(result.value.head)).toBeNull();
    expect(currentOf(result.value.head).effectiveFromLocalDate).toBe(
      NEXT_MONTH,
    );
    expect(result.value.inForceVersion).toBe(0);
  });

  it('opens no rule but the business’s one: another id names nothing', () => {
    expect(
      StreakPublishSystem.nameOf(StreakDefinitionId.of('weekly'), null),
    ).toBeNull();
    // The name is the recommended rule's: a draft carries none.
    expect(StreakPublishSystem.nameOf(CADENCE, null)?.bg).toBe(
      'Посещения в ритъм',
    );
  });

  it('keeps the name the head holds', () => {
    expect(
      StreakPublishSystem.nameOf(CADENCE, { bg: 'Ритъмът', en: 'The rhythm' })
        ?.en,
    ).toBe('The rhythm');
  });
});

describe('StreakPublishSystem — the version’s number', () => {
  it('numbers the version itself: the draft’s number is a proposal', () => {
    const result = publish({ graceDays: 10, version: 41 }, TOMORROW);
    expect(result.ok && result.value.rule.version).toBe(2);
  });

  it('never gives a called-off version’s number away', () => {
    // Version 2 was published and called off: the head is back on 1.
    const result = publish({ graceDays: 10 }, TOMORROW, RECOMMENDED, {
      highestVersion: 2,
    });
    expect(result.ok && result.value.rule.version).toBe(3);
    expect(result.ok && scheduledOf(result.value.head)?.version).toBe(3);
  });
});

describe('StreakPublishSystem — what it refuses', () => {
  it('refuses a head that moved: stale', () => {
    // The draft was made before version 2 was scheduled.
    expect(
      publish({ graceDays: 14 }, NEXT_MONTH, WAITING, {
        highestVersion: 2,
        request: { baseVersion: 1 },
      }),
    ).toEqual({
      ok: false,
      error: {
        errorCode: 'LOYALTY_STREAK_PUBLISH_STALE',
        expected: 1,
        actual: 2,
      },
    });
  });

  it('refuses a base the shop never had', () => {
    const result = publish({}, TOMORROW, null);
    expect(!result.ok && result.error.errorCode).toBe(
      'LOYALTY_STREAK_PUBLISH_STALE',
    );
  });

  it('judges the base by the head, not by the history: after a withdrawal it is the rule in force', () => {
    const result = publish({ graceDays: 10 }, TOMORROW, RECOMMENDED, {
      highestVersion: 2,
      request: { baseVersion: 2 },
    });
    expect(!result.ok && result.error.errorCode).toBe(
      'LOYALTY_STREAK_PUBLISH_STALE',
    );
  });

  it('refuses to recompute the runs before the engine exists', () => {
    expect(
      publish({ graceDays: 10 }, TOMORROW, RECOMMENDED, {
        request: { streakTransition: StreakTransition.Recompute },
      }),
    ).toEqual({
      ok: false,
      error: { errorCode: 'LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE' },
    });
  });

  it('refuses a preview nobody can vouch for: the server holds none yet', () => {
    expect(
      publish({ graceDays: 10 }, TOMORROW, RECOMMENDED, {
        request: { previewHash: 'sha256-abc' },
      }),
    ).toEqual({
      ok: false,
      error: { errorCode: 'LOYALTY_STREAK_PUBLISH_PREVIEW_STALE' },
    });
  });

  it('refuses a day the change may not start on yet, and says the first it may', () => {
    // More grace favours the client: tomorrow, never today.
    expect(publish({ graceDays: 10 }, TODAY)).toEqual({
      ok: false,
      error: {
        errorCode: 'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
        effectiveFromLocalDate: TODAY,
        earliest: TOMORROW,
      },
    });
  });

  it('refuses a day that has passed', () => {
    const result = publish({ riskLeadDays: 3 }, localDate('2026-09-27'));
    expect(!result.ok && result.error.errorCode).toBe(
      'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
    );
  });

  it.each([
    ['LOOSER', { graceDays: 10 }],
    ['STRICTER', { graceDays: 3 }],
    ['SWITCH', { enabled: false }],
    ['MIXED', { graceDays: 10, minGapDays: 10 }],
  ] as const)(
    'lets a %s rule start tomorrow while no client sees the rhythm',
    (direction, patch) => {
      const result = publish(patch, TOMORROW);
      expect(result.ok && result.value.change.direction).toBe(direction);
    },
  );

  it('owes the clients who see the rhythm their notice of a stricter rule', () => {
    const soon = publish({ graceDays: 3 }, TOMORROW, RECOMMENDED, {
      policy: SEEN,
    });
    expect(!soon.ok && soon.error).toMatchObject({
      errorCode: 'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
      earliest: NEXT_MONTH,
    });
    const noticed = publish({ graceDays: 3 }, NEXT_MONTH, RECOMMENDED, {
      policy: SEEN,
    });
    expect(noticed.ok && noticed.value.change.direction).toBe('STRICTER');
    // What favours them owes no notice.
    expect(
      publish({ graceDays: 10 }, TOMORROW, RECOMMENDED, { policy: SEEN }).ok,
    ).toBe(true);
  });

  it('refuses a scheduled version that would not start after the rule in force', () => {
    // A first rule is in force whatever its day: this one starts next month.
    const ahead: StreakSchedule = headOf(
      rule({ effectiveFromLocalDate: NEXT_MONTH }),
    );
    expect(publish({ graceDays: 10 }, NEXT_WEEK, ahead)).toEqual({
      ok: false,
      error: {
        errorCode: 'LOYALTY_STREAK_PUBLISH_INVALID',
        fields: ['scheduledEffectiveFromLocalDate'],
      },
    });
  });
});

describe('StreakPublishSystem.withdraw', () => {
  it('calls off the version that waits: the head holds the rule in force alone', () => {
    const result = StreakPublishSystem.withdraw(2, WAITING, TODAY);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.head).toEqual({ rules: [asCurrent(rule())] });
    expect(result.value.calledOff).toEqual([2]);
    expect(result.value.waiting).toMatchObject({
      version: 2,
      effectiveFromLocalDate: NEXT_WEEK,
      headRole: 'SCHEDULED',
      streakTransition: 'GRANDFATHER',
    });
  });

  it('refuses what no longer waits: another version, nothing, a day that came, no rule', () => {
    expect(StreakPublishSystem.withdraw(3, WAITING, TODAY)).toEqual({
      ok: false,
      error: {
        errorCode: 'LOYALTY_STREAK_PUBLISH_STALE',
        expected: 3,
        actual: 2,
      },
    });
    expect(StreakPublishSystem.withdraw(2, RECOMMENDED, TODAY).ok).toBe(false);
    expect(
      StreakPublishSystem.withdraw(2, WAITING, localDate('2026-10-05')).ok,
    ).toBe(false);
    expect(StreakPublishSystem.withdraw(1, null, TODAY)).toEqual({
      ok: false,
      error: {
        errorCode: 'LOYALTY_STREAK_PUBLISH_STALE',
        expected: 1,
        actual: 0,
      },
    });
  });

  it('never calls off the rule in force', () => {
    expect(StreakPublishSystem.withdraw(1, WAITING, TODAY).ok).toBe(false);
  });
});

describe('StreakPublishSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const head = deepFreeze(WAITING);
    const draft = deepFreeze(rule({ graceDays: 14, version: 3 }));
    const run = () => [
      StreakPublishSystem.assess(head, true, draft, NEXT_MONTH, TODAY, SEEN),
      StreakPublishSystem.admit(request({ baseVersion: 2 }), {
        head,
        highestVersion: 2,
      }),
      StreakPublishSystem.decide(
        { ...draft, effectiveFromLocalDate: NEXT_MONTH },
        StreakTransition.Grandfather,
        head,
        TODAY,
        QUIET,
      ),
      StreakPublishSystem.withdraw(2, head, TODAY),
    ];
    expect(run()).toEqual(run());
  });
});

// ── The flip-3 decision structs (the pipeline's) ─────────────────────────

const NOW = utcMs('2026-09-28T09:00:00.000+03:00');
const OWNER = UserId.of('dev-staff-ivan');
const OWNER_ACTOR = Actor.forCaller(OWNER, ['admin']);
const REQUEST = PublishRequestId.of('request-000000000001');

/** The row the audit planner makes of a streak act — what a plan must carry. */
const rowsOf = (
  context: Parameters<typeof AuditSystem.plan>[0][number]['context'],
) => {
  const planned = AuditSystem.plan(
    [
      {
        resourceId: AuditResourceId.forStreakDefinition(CADENCE),
        subjects: [],
        changeKey: REQUEST,
        context,
      },
    ],
    OWNER_ACTOR,
    NOW,
  );
  if (!planned.ok) throw new Error('a broken fixture row');
  return planned.value;
};

describe('StreakPublishSystem.admitCaller — who may ask', () => {
  it('admits the admin pair, answering the account that signs the version', () => {
    expect(StreakPublishSystem.admitCaller(OWNER, true)).toEqual({
      ok: true,
      value: OWNER,
    });
  });

  it('refuses nobody, and a blank uid, as CALLER_UNAUTHENTICATED — whatever the claim says', () => {
    for (const uid of [null, UserId.of(''), UserId.of('   ')]) {
      expect(StreakPublishSystem.admitCaller(uid, true)).toEqual({
        ok: false,
        error: StreakPublishError.callerUnauthenticated(),
      });
    }
  });

  it('refuses anyone else as CALLER_NOT_ADMIN', () => {
    expect(StreakPublishSystem.admitCaller(OWNER, false)).toEqual({
      ok: false,
      error: StreakPublishError.callerNotAdmin(),
    });
  });
});

describe('StreakPublishSystem.proposal — the draft as the version it proposes', () => {
  it('numbers the draft and dates it on the day asked, whatever the draft says', () => {
    const proposed = StreakPublishSystem.proposal(
      { ...StreakRule.DEFAULT, version: 41, graceDays: 10 },
      3,
      '2026-10-05',
    );
    expect(proposed).toEqual({
      ok: true,
      value: rule({
        version: 3,
        effectiveFromLocalDate: NEXT_WEEK,
        graceDays: 10,
      }),
    });
  });

  it('names every flat field at fault, each once, in the rule’s order', () => {
    expect(
      StreakPublishSystem.proposal(
        {
          ...StreakRule.DEFAULT,
          graceDays: 60,
          protectionsStartWith: 4,
          repairWindowDays: 0,
          repairPerYear: 9,
        },
        2,
        'next week',
      ),
    ).toEqual({
      ok: false,
      error: StreakPublishError.invalid([
        StreakRuleField.EffectiveFromLocalDate,
        StreakRuleField.GraceDays,
        StreakRuleField.ProtectionsStartWith,
        StreakRuleField.RepairWindowDays,
        StreakRuleField.RepairPerYear,
      ]),
    });
  });
});

describe('StreakPublishSystem.replayReceipt — a retry’s answer', () => {
  it('answers the ORIGINAL receipt off the version the first attempt wrote', () => {
    const stored = streakDefinitionVersionFixture({
      ...rule({ version: 2, effectiveFromLocalDate: NEXT_WEEK, graceDays: 10 }),
      id: StreakDefinitionVersionId.forVersion(2),
      streakRuleDirection: StreakRuleDirection.Looser,
    });
    expect(StreakPublishSystem.replayReceipt(stored)).toEqual({
      version: 2,
      effectiveFromLocalDate: NEXT_WEEK,
      streakRuleDirection: StreakRuleDirection.Looser,
    });
  });
});

describe('StreakPublishSystem.publishPlan — what one publish writes', () => {
  const v2 = rule({
    version: 2,
    effectiveFromLocalDate: NEXT_WEEK,
    graceDays: 10,
  });
  const v3 = rule({
    version: 3,
    effectiveFromLocalDate: NEXT_MONTH,
    graceDays: 14,
  });
  const callOf = (r: StreakRule): StreakPublishCall => ({
    requestId: REQUEST,
    streakId: CADENCE,
    baseVersion: r.version - 1,
    rule: r,
    streakTransition: StreakTransition.Grandfather,
    previewHash: null,
  });
  const decided = (r: StreakRule, head: StreakSchedule) => {
    const decision = StreakPublishSystem.decide(
      r,
      StreakTransition.Grandfather,
      head,
      TODAY,
      QUIET,
    );
    if (!decision.ok) throw new Error('a broken fixture decision');
    return decision.value;
  };

  it('makes the version (the flat rule, signed and stamped, never withdrawn), the head whole and ONE row', () => {
    const plan = StreakPublishSystem.publishPlan(
      callOf(v2),
      StreakRule.DEFAULT_NAME,
      decided(v2, RECOMMENDED),
      [],
      OWNER,
      OWNER_ACTOR,
      NOW,
    );
    expect(plan).toEqual({
      receipt: {
        version: 2,
        effectiveFromLocalDate: NEXT_WEEK,
        streakRuleDirection: StreakRuleDirection.Looser,
      },
      versionBody: {
        ...StreakRule.of(v2),
        publishedAtUtcMs: NOW,
        publishedByUserId: OWNER,
        streakTransition: StreakTransition.Grandfather,
        streakRuleDirection: StreakRuleDirection.Looser,
        changed: [StreakRuleParameter.GraceDays],
        requestId: REQUEST,
        withdrawnAtUtcMs: null,
      },
      stampVersions: [],
      headBody: {
        name: StreakRule.DEFAULT_NAME,
        rules: [asCurrent(rule()), asScheduled(v2)],
        updatedAtUtcMs: NOW,
      },
      audit: rowsOf({
        auditAction: AuditAction.LoyaltyStreakDefinitionPublished,
        streakFromVersion: 1,
        streakToVersion: 2,
        streakEffectiveFrom: NEXT_WEEK,
        streakTransition: StreakTransition.Grandfather,
        streakRuleDirection: StreakRuleDirection.Looser,
        streakChanged: [StreakRuleParameter.GraceDays],
        streakReplacedVersion: null,
      }),
    });
    expect(plan.audit).toHaveLength(1);
    expect(plan.audit[0]?.row).toMatchObject({ auditTarget: 'NONE' });
  });

  it('stamps a called-off version only when the read found its document, and names it replaced either way', () => {
    const decision = decided(v3, WAITING);
    expect(decision.calledOff).toEqual([2]);
    const found = StreakPublishSystem.publishPlan(
      callOf(v3),
      StreakRule.DEFAULT_NAME,
      decision,
      [2],
      OWNER,
      OWNER_ACTOR,
      NOW,
    );
    const absent = StreakPublishSystem.publishPlan(
      callOf(v3),
      StreakRule.DEFAULT_NAME,
      decision,
      [],
      OWNER,
      OWNER_ACTOR,
      NOW,
    );
    expect(found.stampVersions).toEqual([2]);
    expect(absent.stampVersions).toEqual([]);
    for (const plan of [found, absent]) {
      expect(plan.audit[0]?.row).toMatchObject({
        streakFromVersion: 1,
        streakToVersion: 3,
        streakReplacedVersion: 2,
      });
    }
  });

  it('never stamps a document no decision called off', () => {
    const plan = StreakPublishSystem.publishPlan(
      callOf(v2),
      StreakRule.DEFAULT_NAME,
      decided(v2, RECOMMENDED),
      [1, 2],
      OWNER,
      OWNER_ACTOR,
      NOW,
    );
    expect(plan.stampVersions).toEqual([]);
  });
});

describe('StreakPublishSystem.withdrawPlan — what one withdrawal writes', () => {
  const withdrawal = () => {
    const decided = StreakPublishSystem.withdraw(2, WAITING, TODAY);
    if (!decided.ok) throw new Error('a broken fixture withdrawal');
    return decided.value;
  };

  it('stamps what waited, holds the rule in force alone (its role re-stated) and writes ONE row', () => {
    expect(
      StreakPublishSystem.withdrawPlan(
        { requestId: REQUEST, streakId: CADENCE, version: 2 },
        StreakRule.DEFAULT_NAME,
        withdrawal(),
        [2],
        OWNER_ACTOR,
        NOW,
      ),
    ).toEqual({
      stampVersions: [2],
      headBody: {
        name: StreakRule.DEFAULT_NAME,
        rules: [asCurrent(rule())],
        updatedAtUtcMs: NOW,
      },
      audit: rowsOf({
        auditAction: AuditAction.LoyaltyStreakDefinitionWithdrawn,
        streakFromVersion: 2,
        streakToVersion: 1,
        streakEffectiveFrom: NEXT_WEEK,
        streakTransition: StreakTransition.Grandfather,
      }),
    });
  });

  it('has nothing to stamp when what waited has no document', () => {
    expect(
      StreakPublishSystem.withdrawPlan(
        { requestId: REQUEST, streakId: CADENCE, version: 2 },
        StreakRule.DEFAULT_NAME,
        withdrawal(),
        [],
        OWNER_ACTOR,
        NOW,
      ).stampVersions,
    ).toEqual([]);
  });
});

describe('StreakPublishSystem — the flip-3 structs are pure', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const head = deepFreeze(WAITING);
    const draft = deepFreeze(rule({ graceDays: 14, version: 3 }));
    const withdrawn = StreakPublishSystem.withdraw(2, head, TODAY);
    const decision = StreakPublishSystem.decide(
      { ...draft, effectiveFromLocalDate: NEXT_MONTH },
      StreakTransition.Grandfather,
      head,
      TODAY,
      QUIET,
    );
    if (!withdrawn.ok || !decision.ok) throw new Error('a broken fixture');
    const frozenDecision = deepFreeze(decision.value);
    const frozenWithdrawal = deepFreeze(withdrawn.value);
    const call = deepFreeze({
      requestId: REQUEST,
      streakId: CADENCE,
      baseVersion: 2,
      rule: { ...draft, effectiveFromLocalDate: NEXT_MONTH },
      streakTransition: StreakTransition.Grandfather,
      previewHash: null,
    });
    const run = () => [
      StreakPublishSystem.admitCaller(OWNER, true),
      StreakPublishSystem.proposal(draft, 3, NEXT_MONTH),
      StreakPublishSystem.publishPlan(
        call,
        StreakRule.DEFAULT_NAME,
        frozenDecision,
        [2],
        OWNER,
        OWNER_ACTOR,
        NOW,
      ),
      StreakPublishSystem.withdrawPlan(
        { requestId: REQUEST, streakId: CADENCE, version: 2 },
        StreakRule.DEFAULT_NAME,
        frozenWithdrawal,
        [2],
        OWNER_ACTOR,
        NOW,
      ),
    ];
    expect(run()).toEqual(run());
  });
});
