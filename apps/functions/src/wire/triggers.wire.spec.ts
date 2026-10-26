import {
  AccountStatus,
  Actor,
  AttemptOutcome,
  BookingPolicy,
  CapacityTrigger,
  GovernedCollection,
  PreciseInstant,
  Role,
  SystemSource,
} from '@core/components';
import {
  AuditResourceId,
  BarberId,
  BusyKey,
  CustomerId,
  Result,
  TriggerEventId,
  UserId,
  WaitlistRequestId,
} from '@core/primitives';
import { GovernanceError, RepositoryError } from '@core/errors';
import {
  type Appointment,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
} from '@core/entities';
import { GovernedChangeSystem, TriggerAttemptSystem } from '@core/systems';
import {
  appointmentFixture,
  FIXTURE_IDS,
  FIXTURE_TODAY,
  localDate,
  pinnedNowUtcMs,
  recordingTelemetry,
  utcMs,
} from '@core/testing';
import { retryingTrigger } from '../edge';
import {
  attemptThrowable,
  CapacitySource,
  decodeCapacityEvent,
  decodeDispatchProjectionsEvent,
  decodeMatchWaitlistEvent,
  decodePolicyRecomputeEvent,
  decodePolicyStepEvent,
  decodeDocumentChangeEvent,
  decodePolicySweepRun,
  decodeRebuildBusyEvent,
  type DocumentWriteEvent,
  documentAuditReport,
  failOnRefusal,
  logAttempt,
  POLICY_STEP_TIMEOUT_SECONDS,
  preciseInstantOf,
  projectionReport,
  settleAttempt,
} from './triggers.wire';

/*
 * The flip-1 triggers' edge: each event decoded into its pipeline command
 * (the stored body IS the entity minus `id`; the shop's zone is the pipeline's to read),
 * and a retrying pipeline's answer turned into today's attempt line and
 * redelivery (`lib/trigger-attempts.ts`'s `reportAttempt`/`logAttempt`).
 */

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const side = (body: Record<string, unknown> | null) => ({
  exists: body !== null,
  data: () => body ?? undefined,
});

function writeEvent<P>(
  params: P,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  overrides: { readonly id?: string; readonly time?: string } = {},
): DocumentWriteEvent<P> {
  return {
    id: overrides.id ?? 'evt-1',
    time: overrides.time ?? '2026-09-28T06:00:00.000Z',
    params,
    data: { before: side(before), after: side(after) },
  };
}

const visit = appointmentFixture();
const params = { appointmentId: visit.id };

/** A command with no refused side — nothing salvaged, no refusal (edge-hardening D-3). */
const NOTHING_SALVAGED = {
  salvagedKeys: [],
  salvagedLocationId: null,
  refusal: null,
} as const;

/** A recording `onRefused`: every refusal a decoder reported, in order. */
function refusals() {
  const seen: RepositoryError[] = [];
  return { seen, onRefused: (error: RepositoryError) => seen.push(error) };
}

/** The visit, its first seat's start no minute — refused, its mirrors intact. */
function brokenSeat(entity: Appointment): Record<string, unknown> {
  return {
    ...bodyOf(entity),
    seats: [{ ...entity.seats[0], startMinutes: 'ten' }],
  };
}

const TOMORROW = localDate('2026-09-29');
const TODAY_KEY = BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY);
const TOMORROW_KEY = BusyKey.of(FIXTURE_IDS.barber, TOMORROW);
/** The fixture visit, moved to tomorrow (its mirror with it). */
const moved: Appointment = {
  ...visit,
  localDate: TOMORROW,
  busyKeys: [TOMORROW_KEY],
};
const PATH = `appointments/${visit.id}`;

describe('decodeRebuildBusyEvent', () => {
  it('reads both sides of an appointment write as the stored entities — no zone, the pipeline reads the shop’s (4A-11)', () => {
    expect(
      decodeRebuildBusyEvent(writeEvent(params, null, bodyOf(visit))),
    ).toEqual({ before: null, after: visit, ...NOTHING_SALVAGED });
    expect(
      decodeRebuildBusyEvent(writeEvent(params, bodyOf(visit), null)),
    ).toEqual({ before: visit, after: null, ...NOTHING_SALVAGED });
  });

  it('guards each side on its own: a malformed before beside a good after is null, reported once, and forwards its salvage and refusal', () => {
    const { seen, onRefused } = refusals();
    expect(
      decodeRebuildBusyEvent(
        writeEvent(params, brokenSeat(visit), bodyOf(moved)),
        onRefused,
      ),
    ).toEqual({
      before: null,
      after: moved,
      salvagedKeys: [TODAY_KEY],
      salvagedLocationId: visit.locationId,
      refusal: RepositoryError.malformed(PATH, 'seats[0].startMinutes'),
    });
    expect(seen).toEqual([
      RepositoryError.malformed(PATH, 'seats[0].startMinutes'),
    ]);
  });

  it('forwards a deleted malformed visit’s salvaged keys and location — the pipeline frees its old day', () => {
    const { seen, onRefused } = refusals();
    expect(
      decodeRebuildBusyEvent(
        writeEvent(params, brokenSeat(visit), null),
        onRefused,
      ),
    ).toEqual({
      before: null,
      after: null,
      salvagedKeys: [TODAY_KEY],
      salvagedLocationId: visit.locationId,
      refusal: RepositoryError.malformed(PATH, 'seats[0].startMinutes'),
    });
    expect(seen).toHaveLength(1);
  });

  it('keeps a good before beside a malformed after, and forwards the after’s salvage', () => {
    const { seen, onRefused } = refusals();
    expect(
      decodeRebuildBusyEvent(
        writeEvent(params, bodyOf(visit), brokenSeat(moved)),
        onRefused,
      ),
    ).toEqual({
      before: visit,
      after: null,
      salvagedKeys: [TOMORROW_KEY],
      salvagedLocationId: visit.locationId,
      refusal: RepositoryError.malformed(PATH, 'seats[0].startMinutes'),
    });
    expect(seen).toEqual([
      RepositoryError.malformed(PATH, 'seats[0].startMinutes'),
    ]);
  });

  it('decides nothing: a malformed side whose keys are garbage, the other absent, is forwarded with its refusal and no key — the pipeline answers it', () => {
    const { seen, onRefused } = refusals();
    const garbage = { ...bodyOf(visit), busyKeys: 'garbage' };
    expect(
      decodeRebuildBusyEvent(writeEvent(params, null, garbage), onRefused),
    ).toEqual({
      before: null,
      after: null,
      salvagedKeys: [],
      salvagedLocationId: visit.locationId,
      refusal: RepositoryError.malformed(PATH, 'busyKeys'),
    });
    expect(seen).toEqual([RepositoryError.malformed(PATH, 'busyKeys')]);
    // The default reporter swallows: a decoder never throws on a refusal.
    expect(
      decodeRebuildBusyEvent(writeEvent(params, garbage, null)).refusal,
    ).toEqual(RepositoryError.malformed(PATH, 'busyKeys'));
  });

  it('reports nothing when both sides are admitted', () => {
    const { seen, onRefused } = refusals();
    decodeRebuildBusyEvent(
      writeEvent(params, bodyOf(visit), bodyOf(moved)),
      onRefused,
    );
    expect(seen).toEqual([]);
  });
});

describe('decodeCapacityEvent', () => {
  it.each([CapacitySource.BusyDay, CapacitySource.Exception])(
    'reads a %s write as its (barber, day) — and an id that is no busy key as nothing',
    (source) => {
      expect(
        decodeCapacityEvent(source, { docId: `b-ivan__${FIXTURE_TODAY}` }),
      ).toEqual({
        capacityTrigger: CapacityTrigger.Day,
        barberId: BarberId.of('b-ivan'),
        localDate: FIXTURE_TODAY,
      });
      expect(decodeCapacityEvent(source, { docId: 'not-a-key' })).toBeNull();
    },
  );

  it('reads a roster write as that barber’s horizon', () => {
    expect(
      decodeCapacityEvent(CapacitySource.Roster, { barberId: 'b-ivan' }),
    ).toEqual({
      capacityTrigger: CapacityTrigger.Roster,
      barberId: BarberId.of('b-ivan'),
    });
  });

  it.each([
    CapacitySource.Location,
    CapacitySource.Settings,
    CapacitySource.Sweep,
  ])('reads a %s write as a sweep of every rostered barber', (source) => {
    expect(decodeCapacityEvent(source)).toEqual({
      capacityTrigger: CapacityTrigger.Sweep,
    });
  });
});

describe('decodeMatchWaitlistEvent', () => {
  it('reads the busy day a write touched — a deletion too — and nothing for an id that is no busy key', () => {
    expect(
      decodeMatchWaitlistEvent(
        writeEvent({ docId: `b-ivan__${FIXTURE_TODAY}` }, { blocks: [] }, null),
      ),
    ).toEqual({ localDate: FIXTURE_TODAY });
    expect(
      decodeMatchWaitlistEvent(writeEvent({ docId: 'b-ivan' }, null, null)),
    ).toBeNull();
  });
});

describe('decodeDispatchProjectionsEvent', () => {
  const ana = CustomerId.of('cus_ana');
  const bob = CustomerId.of('cus_bob');

  it('decodes nobody for a write that changed nothing a stat reads — a tip, an arrival', () => {
    const arrived: Appointment = {
      ...visit,
      arrivedAtUtcMs: utcMs('2026-09-28T10:01:00+03:00'),
    };
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, bodyOf(visit), bodyOf(arrived)),
      ),
    ).toEqual(Result.ok({ customerIds: [] }));
  });

  it('decodes everyone on the visit before AND after a write that moved stats — once, sorted', () => {
    const before = { ...visit, subjectCustomerIds: [bob] };
    const after = {
      ...visit,
      subjectCustomerIds: [ana],
      localDate: localDate('2026-09-29'),
    };
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, bodyOf(before), bodyOf(after)),
      ),
    ).toEqual(Result.ok({ customerIds: [ana, bob] }));
  });

  it('decodes the visit’s people on a create and on a delete', () => {
    expect(
      decodeDispatchProjectionsEvent(writeEvent(params, null, bodyOf(visit))),
    ).toEqual(Result.ok({ customerIds: visit.subjectCustomerIds }));
    expect(
      decodeDispatchProjectionsEvent(writeEvent(params, bodyOf(visit), null)),
    ).toEqual(Result.ok({ customerIds: visit.subjectCustomerIds }));
  });

  it('re-projects both sides’ people when a side is refused — no change test — and reports the refusal once', () => {
    const { seen, onRefused } = refusals();
    const before = { ...visit, subjectCustomerIds: [bob] };
    const after = { ...visit, subjectCustomerIds: [ana] };
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, brokenSeat(before), bodyOf(after)),
        onRefused,
      ),
    ).toEqual(Result.ok({ customerIds: [ana, bob] }));
    expect(seen).toEqual([
      RepositoryError.malformed(PATH, 'seats[0].startMinutes'),
    ]);
    // Even when nothing a stat reads differs: a refused side cannot be compared.
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, brokenSeat(visit), bodyOf(visit)),
      ),
    ).toEqual(Result.ok({ customerIds: visit.subjectCustomerIds }));
  });

  it('reads a legacy side with no subject mirror as nobody — never a TypeError (D-1)', () => {
    const legacy = Object.fromEntries(
      Object.entries(bodyOf(visit)).filter(
        ([key]) => key !== 'subjectCustomerIds',
      ),
    );
    const before = { ...visit, subjectCustomerIds: [bob] };
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, bodyOf(before), {
          ...legacy,
          localDate: localDate('2026-09-29'),
        }),
      ),
    ).toEqual(Result.ok({ customerIds: [bob] }));
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, null, { ...legacy, subjectCustomerIds: null }),
      ),
    ).toEqual(Result.ok({ customerIds: [] }));
  });

  it('answers the refusal only when no side names anybody', () => {
    const { seen, onRefused } = refusals();
    const nobody = { ...bodyOf(visit), subjectCustomerIds: 'nope' };
    expect(
      decodeDispatchProjectionsEvent(
        writeEvent(params, nobody, nobody),
        onRefused,
      ),
    ).toEqual(
      Result.err(RepositoryError.malformed(PATH, 'subjectCustomerIds')),
    );
    expect(seen).toHaveLength(2);
  });
});

describe('decodePolicyRecomputeEvent', () => {
  it('reads both policies through the defaults, the event id as the generation and its time to the microsecond', () => {
    const command = decodePolicyRecomputeEvent(
      writeEvent(
        { docId: 'bookingPolicy' },
        null,
        { cancellationWindowHours: 48 },
        { id: 'evt-a', time: '2026-09-28T06:00:00.123456Z' },
      ),
    );
    expect(command).toEqual({
      settingsDocId: 'bookingPolicy',
      before: BookingPolicy.DEFAULT,
      after: { ...BookingPolicy.DEFAULT, cancellationWindowHours: 48 },
      generation: 'evt-a',
      changedAt: PreciseInstant.of(1_790_575_200, 123_456_000),
    });
  });
});

describe('preciseInstantOf — RFC 3339 at full precision (§9 D17)', () => {
  it('reads the microseconds epoch ms drops, and normalises an offset through the whole seconds', () => {
    expect(preciseInstantOf('2026-09-28T06:00:00.000001Z')).toEqual(
      PreciseInstant.of(1_790_575_200, 1_000),
    );
    expect(preciseInstantOf('2026-09-28T09:00:00.5+03:00')).toEqual(
      PreciseInstant.of(1_790_575_200, 500_000_000),
    );
    expect(preciseInstantOf('2026-09-28T06:00:00Z')).toEqual(
      PreciseInstant.of(1_790_575_200, 0),
    );
  });

  it('orders two writes inside one millisecond as their microseconds do', () => {
    const a = preciseInstantOf('2026-09-28T06:00:00.000100Z');
    const b = preciseInstantOf('2026-09-28T06:00:00.000900Z');
    expect(PreciseInstant.compare(a, b)).toBe(-1);
  });

  it('reads a time that is no instant as the latest — a delivered change never skips', () => {
    expect(preciseInstantOf('yesterday')).toEqual(
      PreciseInstant.of(Number.MAX_SAFE_INTEGER, 999_999_999),
    );
  });
});

describe('decodePolicyStepEvent / decodePolicySweepRun', () => {
  it('reads the job a write left as the step it fires — a deleted one as none', () => {
    const job = { generation: 'evt-a', cursor: null };
    expect(decodePolicyStepEvent(writeEvent({}, null, job))).toEqual({
      fired: {
        id: POLICY_RECOMPUTE_DOC,
        ...job,
      } as unknown as PolicyRecomputeJob,
    });
    expect(decodePolicyStepEvent(writeEvent({}, job, null))).toEqual({
      fired: null,
    });
  });

  it('names a scheduled tick by its job and time, as today’s attempt line does', () => {
    expect(
      decodePolicySweepRun(
        { jobName: 'job-x', scheduleTime: '2026-09-28T00:30:00Z' },
        'sweepClientStatsPolicyDaily',
      ),
    ).toEqual({
      id: 'job-x@2026-09-28T00:30:00Z',
      time: '2026-09-28T00:30:00Z',
    });
    expect(
      decodePolicySweepRun(
        { scheduleTime: '2026-09-28T00:30:00Z' },
        'sweepClientStatsPolicyDaily',
      ).id,
    ).toBe('sweepClientStatsPolicyDaily@2026-09-28T00:30:00Z');
  });
});

describe('decodeDocumentChangeEvent — a users write (RU-40: the profile decoder, re-pointed)', () => {
  const users = (
    event: DocumentWriteEvent<{ readonly docId: string }>,
    auth: { readonly authType: string; readonly authId?: string },
  ) =>
    decodeDocumentChangeEvent(GovernedCollection.Users, { ...event, ...auth });
  /** A users write decodes to a profile change — narrowed on the discriminator. */
  const profileOf = (change: ReturnType<typeof users>) => {
    if (change.governedCollection !== GovernedCollection.Users) {
      throw new Error('a users write decodes to a profile change');
    }
    return change;
  };

  it('reads the field NAMES that changed, the writer the auth context names and the event’s own instant', () => {
    const change = users(
      writeEvent(
        { docId: 'u-maria' },
        { firstName: 'Maria', phone: '+359888000001', roles: ['client'] },
        { firstName: 'Maria', phone: '+359888000002', roles: ['staff'] },
        { id: 'evt-9', time: '2026-09-28T06:00:00.000Z' },
      ),
      { authType: 'service_account' },
    );
    expect(change).toEqual({
      governedCollection: GovernedCollection.Users,
      eventId: TriggerEventId.of('evt-9'),
      eventAtUtcMs: utcMs('2026-09-28T06:00:00.000Z'),
      ownerUserId: UserId.of('u-maria'),
      writer: Actor.system(SystemSource.AdminSdk),
      beforeExists: true,
      afterExists: true,
      // DEP-13: `roles` is audited now (appended after the registration five);
      // its tags hold each side's KNOWN roles — 'staff' is none.
      fields: ['phone', 'roles'],
      profileRolesFrom: [Role.Client],
      profileRolesTo: [],
      profileAccountStatusFrom: null,
      profileAccountStatusTo: null,
      beforeProfileEditedAtUtcMs: null,
      afterProfileEditedAtUtcMs: null,
    });
  });

  it('carries each side’s raw profileEditedAtUtcMs stamp — an absent side or key reads null (4A-16)', () => {
    const stamped = profileOf(
      users(
        writeEvent(
          { docId: 'u-maria' },
          { firstName: 'Maria' },
          { firstName: 'Mila', profileEditedAtUtcMs: 1_790_575_200_000 },
          { id: 'evt-10', time: '2026-09-28T06:00:00.000Z' },
        ),
        { authType: 'service_account' },
      ),
    );
    expect(stamped.beforeProfileEditedAtUtcMs).toBeNull();
    expect(stamped.afterProfileEditedAtUtcMs).toBe(1_790_575_200_000);
    const created = profileOf(
      users(
        writeEvent({ docId: 'u-maria' }, null, { firstName: 'Maria' }, {}),
        { authType: 'service_account' },
      ),
    );
    expect(created.beforeProfileEditedAtUtcMs).toBeNull();
    expect(created.afterProfileEditedAtUtcMs).toBeNull();
  });

  it('credits a uid-shaped writer, and leaves an unreadable time to the pipeline’s clock', () => {
    const change = users(
      writeEvent(
        { docId: 'u-maria' },
        null,
        { firstName: 'Maria' },
        { time: 'nope' },
      ),
      { authType: 'unknown', authId: 'u-desk' },
    );
    expect(change.writer).toEqual(Actor.user(UserId.of('u-desk')));
    expect(change.beforeExists).toBe(false);
    expect(change.eventAtUtcMs).toBeNull();
  });

  it('sets the role / status tags iff their field changed — an account blocked by the console', () => {
    const change = users(
      writeEvent(
        { docId: 'u-maria' },
        {
          firstName: 'Maria',
          roles: [Role.Client],
          accountStatus: AccountStatus.Active,
        },
        {
          firstName: 'Maria',
          roles: [Role.Client],
          accountStatus: AccountStatus.Blocked,
        },
      ),
      { authType: 'service_account' },
    );
    expect(change).toMatchObject({
      fields: ['accountStatus'],
      profileRolesFrom: null,
      profileRolesTo: null,
      profileAccountStatusFrom: AccountStatus.Active,
      profileAccountStatusTo: AccountStatus.Blocked,
    });
  });
});

/** The thirteen governed collections — every `GovernedCollection` member but `USERS`. */
const GOVERNED = Object.values(GovernedCollection).filter(
  (member) => member !== GovernedCollection.Users,
);

describe('decodeDocumentChangeEvent — the thirteen governed collections (WS-3, RU-40)', () => {
  it('covers thirteen collections', () => {
    expect(GOVERNED).toHaveLength(13);
  });

  describe.each(GOVERNED)('%s', (governedCollection) => {
    const DOC = 'doc-7';
    const decode = (
      before: Record<string, unknown> | null,
      after: Record<string, unknown> | null,
      auth: { readonly authType: string; readonly authId?: string } = {
        authType: 'service_account',
      },
      overrides: { readonly id?: string; readonly time?: string } = {},
    ) =>
      decodeDocumentChangeEvent(governedCollection, {
        ...writeEvent({ docId: DOC }, before, after, overrides),
        ...auth,
      });

    const resource = AuditResourceId.parse(
      `${GovernedChangeSystem.pathOf(governedCollection)}/${DOC}`,
    );
    /** A `customers` write targets the record it is — every other none. */
    const target =
      governedCollection === GovernedCollection.Customers
        ? CustomerId.of(DOC)
        : null;

    it('decodes a create: the after-image’s keys, ascending, the resource `<path>/<docId>` and the event’s own id and instant', () => {
      expect(resource.ok).toBe(true);
      expect(
        decode(null, { zeta: 1, alpha: 'a' }, undefined, {
          id: 'evt-gov',
          time: '2026-09-28T06:00:00.000Z',
        }),
      ).toEqual({
        governedCollection,
        eventId: TriggerEventId.of('evt-gov'),
        eventAtUtcMs: utcMs('2026-09-28T06:00:00.000Z'),
        writer: Actor.system(SystemSource.AdminSdk),
        beforeExists: false,
        afterExists: true,
        resourceId: resource.ok ? resource.value : null,
        targetCustomerId: target,
        fields: ['alpha', 'zeta'],
      });
    });

    it('decodes an update as the names whose value changed — never a value', () => {
      const change = decode(
        { name: 'Old', sortOrder: 1, tags: ['a'] },
        { name: 'New', sortOrder: 1, tags: [] },
      );
      expect(change).toMatchObject({
        beforeExists: true,
        afterExists: true,
        fields: ['name', 'tags'],
      });
      expect(JSON.stringify(change)).not.toContain('Old');
      expect(JSON.stringify(change)).not.toContain('New');
    });

    it('decodes a delete as the before-image’s keys', () => {
      expect(decode({ b: 2, a: 1 }, null)).toMatchObject({
        beforeExists: true,
        afterExists: false,
        fields: ['a', 'b'],
      });
    });

    it('names the resource `<path>/<docId>` as a brand, and the client record for CUSTOMERS only', () => {
      const change = decode(null, { a: 1 });
      expect(change).toMatchObject({
        resourceId: `${GovernedChangeSystem.pathOf(governedCollection)}/${DOC}`,
        targetCustomerId: target,
      });
    });

    it.each([
      ['service_account', undefined, Actor.system(SystemSource.AdminSdk)],
      ['system', undefined, Actor.system(SystemSource.FirestoreSystem)],
      ['api_key', undefined, Actor.system(SystemSource.UnattributedApiKey)],
      [
        'unauthenticated',
        undefined,
        Actor.system(SystemSource.UnattributedUnauthenticated),
      ],
      ['unknown', undefined, Actor.system(SystemSource.UnattributedUnknown)],
      ['unknown', 'u-desk', Actor.user(UserId.of('u-desk'))],
    ] as const)(
      'credits the writer the auth context names: authType %s, authId %s',
      (authType, authId, writer) => {
        const auth = authId === undefined ? { authType } : { authType, authId };
        expect(decode(null, { a: 1 }, auth).writer).toEqual(writer);
      },
    );

    it('leaves an unreadable time to the pipeline’s clock', () => {
      expect(
        decode(null, { a: 1 }, undefined, { time: 'nope' }).eventAtUtcMs,
      ).toBeNull();
    });
  });

  it('throws a path that is no resource as a defect — the edge judges it PERMANENT, never redelivered', async () => {
    const event = {
      // Unreachable from Firestore (a path segment holds no `/`).
      ...writeEvent({ docId: 'a/b' }, null, { a: 1 }),
      authType: 'service_account',
    };
    expect(() =>
      decodeDocumentChangeEvent(GovernedCollection.Coupons, event),
    ).toThrow(/defect/);
    const telemetry = { ...recordingTelemetry(), nowUtcMs: pinnedNowUtcMs() };
    const handler = retryingTrigger(
      { fn: 'auditCouponsChanges', timeoutSeconds: null },
      telemetry,
      async (delivered: typeof event) => {
        decodeDocumentChangeEvent(GovernedCollection.Coupons, delivered);
      },
    );
    await expect(handler(event)).resolves.toBeUndefined();
    expect(telemetry.lines[0]?.fields).toMatchObject({
      outcome: AttemptOutcome.Permanent,
    });
  });
});

describe('attempts — today’s line and redelivery', () => {
  const event = { id: 'evt-job', time: '2026-09-28T05:59:59.000Z' };
  const transient = TriggerAttemptSystem.attemptFailure(
    Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
  );
  const permanent = TriggerAttemptSystem.attemptFailure(
    RepositoryError.readFailed('settings/bookingPolicy', 'internal'),
    'internal',
  );
  const ports = () => ({ ...recordingTelemetry(), nowUtcMs: pinnedNowUtcMs() });

  it('keeps one step’s platform timeout', () => {
    expect(POLICY_STEP_TIMEOUT_SECONDS).toBe(540);
  });

  it('logs a survived failure as ONE line — ids, the SCREAMING outcome and the failure’s code as `errorCode`, and how deep into the retry window (4A-2 (c))', () => {
    const telemetry = ports();
    logAttempt(
      'continueClientStatsPolicyRecompute',
      event,
      permanent,
      telemetry,
    );
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'trigger attempt failed',
        fields: {
          fn: 'continueClientStatsPolicyRecompute',
          eventId: 'evt-job',
          outcome: 'PERMANENT',
          errorCode: 'internal',
          ageMs: 1_000,
        },
      },
    ]);
  });

  it('throws a failure as a value the edge judges the same way — a port refusal by the code in its reason', () => {
    expect(attemptThrowable(transient)).toBe(transient.error);
    const thrown = attemptThrowable(permanent);
    expect(TriggerAttemptSystem.failureCode(thrown)).toBe('internal');
  });

  it('redelivers a transient answer and drops a permanent one, after its line, through `retryingTrigger`', async () => {
    const run = (failure: typeof transient) => {
      const telemetry = ports();
      const handler = retryingTrigger(
        { fn: 'dispatchClientProjections', timeoutSeconds: null },
        telemetry,
        async (delivered: typeof event) =>
          settleAttempt(
            'dispatchClientProjections',
            delivered,
            { attemptFailure: failure, survivedFailure: null },
            telemetry,
          ),
      );
      return { telemetry, done: handler(event) };
    };
    const redelivered = run(transient);
    await expect(redelivered.done).rejects.toBe(transient.error);
    expect(redelivered.telemetry.lines[0]?.fields).toMatchObject({
      outcome: 'TRANSIENT',
      errorCode: 'unavailable',
    });
    const dropped = run(permanent);
    await expect(dropped.done).resolves.toBeUndefined();
    expect(dropped.telemetry.lines[0]?.fields).toMatchObject({
      outcome: 'PERMANENT',
      errorCode: 'internal',
    });
  });

  it('logs the survived failure and settles quietly when nothing answers', () => {
    const telemetry = ports();
    settleAttempt(
      'continueClientStatsPolicyRecompute',
      event,
      { attemptFailure: null, survivedFailure: permanent },
      telemetry,
    );
    expect(telemetry.lines).toHaveLength(1);
  });

  it('reads the projection’s answer — the policy read is every client’s failure', () => {
    expect(
      projectionReport(
        Result.err(
          RepositoryError.readFailed('settings/bookingPolicy', 'unavailable'),
        ),
      ).attemptFailure,
    ).toMatchObject({ attemptOutcome: AttemptOutcome.Transient });
    expect(
      projectionReport(
        Result.ok({ written: 1, failures: [], attemptFailure: null }),
      ),
    ).toEqual({ attemptFailure: null, survivedFailure: null });
  });

  it('reads the busy rebuild’s and the waitlist match’s verdicts the same way (edge-hardening D-5)', () => {
    const aborted = TriggerAttemptSystem.attemptFailure({ code: 10 });
    expect(
      projectionReport(
        Result.ok({
          rebuiltKeys: [BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY)],
          failures: [aborted.error],
          attemptFailure: aborted,
        }),
      ),
    ).toEqual({ attemptFailure: aborted, survivedFailure: null });
    const malformed = TriggerAttemptSystem.repositoryFailure(
      RepositoryError.malformed('waitlistRequests/wl_1', 'waitlistStatus'),
    );
    expect(
      projectionReport(
        Result.ok({
          notifiedRequestIds: [WaitlistRequestId.of('wl_2')],
          expiredRequestIds: [],
          failures: [malformed.error],
          attemptFailure: malformed,
        }),
      ).attemptFailure,
    ).toMatchObject({
      failureCode: 'data-loss',
      attemptOutcome: AttemptOutcome.Permanent,
    });
    // A decoder's refusal of a malformed event: permanent, data-loss.
    expect(
      projectionReport(
        Result.err(RepositoryError.malformed('appointments/a1', 'busyKeys')),
      ).attemptFailure,
    ).toMatchObject({
      failureCode: 'data-loss',
      attemptOutcome: AttemptOutcome.Permanent,
    });
  });

  it('reads the document audit’s refusal as permanent, a failed write by its reason', () => {
    expect(
      documentAuditReport(Result.err(GovernanceError.auditEntryEmptyAction()))
        .attemptFailure,
    ).toMatchObject({ attemptOutcome: AttemptOutcome.Permanent });
    expect(
      documentAuditReport(
        Result.err(RepositoryError.writeFailed('auditLog/x', 'aborted')),
      ).attemptFailure,
    ).toMatchObject({ attemptOutcome: AttemptOutcome.Transient });
    expect(documentAuditReport(Result.ok({ rows: 1 }))).toEqual({
      attemptFailure: null,
      survivedFailure: null,
    });
  });

  it('fails a non-retrying trigger on a refusal, as today’s throw did', () => {
    expect(failOnRefusal(Result.ok(3))).toBe(3);
    expect(() =>
      failOnRefusal(Result.err(RepositoryError.readFailed('x', 'unavailable'))),
    ).toThrow('unavailable');
  });
});
