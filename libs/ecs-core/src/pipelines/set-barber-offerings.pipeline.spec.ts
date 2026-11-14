import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  type BarberOffering,
  BarberStatus,
  BlockReason,
  type DocBody,
  OfferingsEdit,
  type OfferingsRequest,
  Role,
  WriteOp,
} from '@core/components';
import {
  BarberId,
  OperationId,
  Result,
  ServiceId,
  UserId,
} from '@core/primitives';
import { AccessErrorCode, TeamErrorCode } from '@core/errors';
import {
  type Barber,
  Collections,
  type Service,
  STAFF_PERMISSIONS_DOC,
  type User,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { OfferingEditSystem } from '@core/systems';
import {
  auditRowsOf,
  barberFixture,
  bodyOf,
  contendedCommit,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  registeredUserFixture,
  serviceFixture,
  termsFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  type SetBarberOfferingsCommand,
  setBarberOfferings,
} from './set-barber-offerings.pipeline';
import { TEAM_SERVICES } from './team-caller.pipeline';

/*
 * `setBarberOfferings` (team onboarding D5, D6): the token gate, then ONE
 * commit that reads the caller, the barber, every service — and the
 * colleague for a copy — and writes only the services whose list changes,
 * stamped with the act, beside ONE `TEAM_BARBER_OFFERINGS_CHANGED` row.
 */

const ADMIN = UserId.of('u-admin');
const OP = OperationId.of('operation-offer-01234567');
const IVAN = FIXTURE_IDS.barber;
const NEW = BarberId.of('b-new');
const CUT = ServiceId.of('svc-cut');
const BEARD = ServiceId.of('svc-beard');
const SHAVE = ServiceId.of('svc-shave');

const STORED_ADMIN: User = registeredUserFixture({
  id: ADMIN,
  roles: [Role.Admin],
});
/** The newcomer: a draft with nothing to its name yet. */
const NEWCOMER: Barber = barberFixture(
  { id: NEW },
  {
    barberStatus: BarberStatus.Draft,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDraftTargetStatus: BarberStatus.Public,
  },
);
const DEPARTED: Barber = barberFixture(
  { id: NEW },
  {
    barberStatus: BarberStatus.Departed,
    barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    barberDepartedUserId: null,
    barberSessionsRevokedAtUtcMs: null,
    barberRehireStatus: BarberStatus.Public,
  },
);

const offering = (barberId: BarberId, cents: number, minutes: number) => ({
  barberId,
  overrides: [],
  ...termsFixture(cents, minutes),
});
/** Ivan cuts and trims beards; nobody is listed for the shave. */
const CATALOGUE: readonly Service[] = [
  serviceFixture({ id: CUT, offerings: [offering(IVAN, 2800, 30)] }),
  serviceFixture({ id: BEARD, offerings: [offering(IVAN, 1500, 20)] }),
  serviceFixture({ id: SHAVE, offerings: [] }),
];

/** One service at the terms an editor types. */
const entry = (
  serviceId: ServiceId,
  cents: number,
  minutes: number,
): BarberOffering.Entry => ({
  serviceId,
  overrides: [],
  priceCents: cents,
  currency: 'EUR',
  durationMinutes: minutes,
  setupMinutes: 0,
  cleanupMinutes: 0,
});
const set = (
  ...offerings: readonly BarberOffering.Entry[]
): OfferingsRequest.Set => ({ offeringsEdit: OfferingsEdit.Set, offerings });
const COPY_IVAN: OfferingsRequest.Copy = {
  offeringsEdit: OfferingsEdit.Copy,
  copyFromBarberId: IVAN,
};

const PERMISSIONS = [Collections.Settings, STAFF_PERMISSIONS_DOC];
const NOT_STAFF = { errorCode: AccessErrorCode.NotStaff };
const DENIED = {
  errorCode: AccessErrorCode.Denied,
  staffCapability: 'TEAM_OFFERINGS',
};
const OWN_ONLY = {
  errorCode: AccessErrorCode.OwnOnly,
  staffCapability: 'TEAM_OFFERINGS',
};

type RigOptions = {
  readonly caller?: User | null;
  /** The stored `settings/staffPermissions` body; none by default — no document. */
  readonly permissions?: DocBody;
  /** The barber whose list is saved (default the newcomer); `null`: no record. */
  readonly barber?: Barber | null;
  /** Whether Ivan — the colleague a copy names — has a record. */
  readonly withIvan?: boolean;
  readonly commit?: (commit: CommitPlan) => CommitPlan;
};

function rig(options: RigOptions = {}) {
  const caller = options.caller === undefined ? STORED_ADMIN : options.caller;
  const barber = options.barber === undefined ? NEWCOMER : options.barber;
  const barbers = [
    ...(barber === null ? [] : [barber]),
    ...(options.withIvan === false ? [] : [barberFixture()]),
  ];
  const store = memoryStore([
    ...(options.permissions === undefined
      ? []
      : [{ path: PERMISSIONS, body: options.permissions }]),
    ...(caller === null
      ? []
      : [{ path: [Collections.Users, caller.id], body: bodyOf(caller) }]),
    ...barbers.map((record) => ({
      path: [Collections.Barbers, record.id],
      body: bodyOf(record),
    })),
    ...CATALOGUE.map((service) => ({
      path: [Collections.Services, service.id],
      body: bodyOf(service),
    })),
  ]);
  const tx = memoryTxPorts(store);
  const commit = options.commit ? options.commit(tx.commit) : tx.commit;
  return { store, tx, run: setBarberOfferings({ ...tx, commit }) };
}

const call = (
  request: OfferingsRequest,
  extra: Partial<SetBarberOfferingsCommand> = {},
): SetBarberOfferingsCommand =>
  ({
    callerUserId: ADMIN,
    callerRoles: [Role.Admin],
    operationId: OP,
    barberId: NEW,
    ...request,
    ...extra,
  }) as SetBarberOfferingsCommand;

const stored = (store: ReturnType<typeof rig>['store'], id: ServiceId) =>
  store.get(`${Collections.Services}/${id}`);

describe('setBarberOfferings', () => {
  describe('the typed list', () => {
    it('writes only the services whose list changes, stamped with the act, beside ONE row — in one plan', async () => {
      const { store, tx, run } = rig();
      const answer = await run(call(set(entry(CUT, 2000, 45))));
      expect(answer).toEqual(Result.ok({ barberId: NEW }));
      // The callable answers this value as it is: exactly the wire's keys.
      expect(Object.keys(unwrapOk(answer))).toEqual(['barberId']);

      const changes = unwrapOk(
        OfferingEditSystem.plan(CATALOGUE, NEW, [entry(CUT, 2000, 45)]),
      );
      expect(tx.plans).toEqual([
        OfferingEditSystem.writesOf(
          {
            barberId: NEW,
            changes,
            copiedFromBarberId: null,
            actor: Actor.forCaller(ADMIN, [Role.Admin]),
            nowUtcMs: FIXTURE_NOW_UTC_MS,
            operationId: OP,
          },
          fixtureHash,
        ),
      ]);
      expect(tx.plans[0]?.[0]).toEqual(
        WriteOp.update([Collections.Services, CUT], {
          offerings: [offering(IVAN, 2800, 30), offering(NEW, 2000, 45)],
          writeOperationId: OP,
        }),
      );
      // The cut gained the newcomer beside Ivan; the others are untouched.
      expect(stored(store, CUT)).toMatchObject({
        offerings: [offering(IVAN, 2800, 30), offering(NEW, 2000, 45)],
        writeOperationId: OP,
      });
      expect(stored(store, BEARD)).toEqual(bodyOf(CATALOGUE[1] as Service));
      expect(stored(store, SHAVE)).toEqual(bodyOf(CATALOGUE[2] as Service));
    });

    it('credits the row to the caller over their STORED roles and names the services — never a price', async () => {
      const { tx, run } = rig();
      await run(call(set(entry(CUT, 2000, 45), entry(SHAVE, 7777, 20))));
      const rows = auditRowsOf(tx.plans);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        auditAction: 'TEAM_BARBER_OFFERINGS_CHANGED',
        resourceId: `barbers/${NEW}`,
        auditOperationId: OP,
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        ...Actor.forCaller(ADMIN, [Role.Admin]),
        teamOfferingServiceIds: [CUT, SHAVE],
        teamOfferingsCopiedFromBarberId: null,
      });
      expect(JSON.stringify(rows)).not.toContain('7777');
    });

    it('is the COMPLETE list: a service left out loses the barber, a new price replaces in place', async () => {
      const { store, tx, run } = rig();
      // Ivan now only cuts, for more.
      await run(call(set(entry(CUT, 3000, 30)), { barberId: IVAN }));
      expect(stored(store, CUT)?.['offerings']).toEqual([
        offering(IVAN, 3000, 30),
      ]);
      expect(stored(store, BEARD)?.['offerings']).toEqual([]);
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        resourceId: `barbers/${IVAN}`,
        // The services as the transaction read them: by document id.
        teamOfferingServiceIds: [BEARD, CUT],
      });
    });

    it('reads the caller and the owner’s cells, the barber and every service — no colleague', async () => {
      const { tx, run } = rig();
      await run(call(set(entry(CUT, 2000, 45))));
      expect(tx.transactions).toHaveLength(1);
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        PERMISSIONS,
        [Collections.Barbers, NEW],
      ]);
      expect(tx.transactions[0]?.queries).toEqual([TEAM_SERVICES]);
    });

    it('refuses terms the catalogue’s guard rejects, a service named twice and an unknown service — and writes nothing', async () => {
      const { store, tx, run } = rig();
      expect(unwrapErr(await run(call(set(entry(CUT, 2000, 0)))))).toEqual({
        errorCode: TeamErrorCode.InvalidInput,
        field: 'offerings',
      });
      expect(
        unwrapErr(
          await run(call(set(entry(CUT, 2000, 30), entry(CUT, 2100, 30)))),
        ),
      ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'offerings' });
      const gone = ServiceId.of('svc-gone');
      expect(unwrapErr(await run(call(set(entry(gone, 2000, 30)))))).toEqual({
        errorCode: TeamErrorCode.ServiceUnknown,
        serviceId: gone,
      });
      expect(tx.plans).toEqual([]);
      expect(stored(store, CUT)).toEqual(bodyOf(CATALOGUE[0] as Service));
    });
  });

  describe('«Копирай цените от»', () => {
    it('gives the barber the colleague’s terms on every service the colleague performs, the row naming whom', async () => {
      const { store, tx, run } = rig();
      expect(await run(call(COPY_IVAN))).toEqual(Result.ok({ barberId: NEW }));
      expect(stored(store, CUT)?.['offerings']).toEqual([
        offering(IVAN, 2800, 30),
        offering(NEW, 2800, 30),
      ]);
      expect(stored(store, BEARD)?.['offerings']).toEqual([
        offering(IVAN, 1500, 20),
        offering(NEW, 1500, 20),
      ]);
      expect(stored(store, SHAVE)).toEqual(bodyOf(CATALOGUE[2] as Service));
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
      expect(auditRowsOf(tx.plans)[0]).toMatchObject({
        auditAction: 'TEAM_BARBER_OFFERINGS_CHANGED',
        teamOfferingServiceIds: [BEARD, CUT],
        teamOfferingsCopiedFromBarberId: IVAN,
      });
    });

    it('reads the colleague’s record beside the barber’s', async () => {
      const { tx, run } = rig();
      await run(call(COPY_IVAN));
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Users, ADMIN],
        PERMISSIONS,
        [Collections.Barbers, NEW],
        [Collections.Barbers, IVAN],
      ]);
    });

    it('leaves what the barber performs beside the colleague’s list alone', async () => {
      const { store, run } = rig();
      await run(call(set(entry(SHAVE, 1200, 20))));
      await run(
        call(COPY_IVAN, {
          operationId: OperationId.of('operation-offer-copy0001'),
        }),
      );
      expect(stored(store, SHAVE)?.['offerings']).toEqual([
        offering(NEW, 1200, 20),
      ]);
    });

    it('answers TEAM_BARBER_NOT_FOUND naming a colleague with no record', async () => {
      const { tx, run } = rig({ withIvan: false });
      expect(unwrapErr(await run(call(COPY_IVAN)))).toEqual({
        errorCode: TeamErrorCode.BarberNotFound,
        barberId: IVAN,
      });
      expect(tx.plans).toEqual([]);
    });
  });

  describe('the caller and the record', () => {
    it('turns away no session and a token with no staff role before any read', async () => {
      const { tx, run } = rig();
      expect(
        unwrapErr(await run(call(COPY_IVAN, { callerUserId: null }))),
      ).toEqual({ errorCode: TeamErrorCode.Unauthenticated });
      for (const callerRoles of [[Role.Client], []]) {
        expect(unwrapErr(await run(call(COPY_IVAN, { callerRoles })))).toEqual(
          NOT_STAFF,
        );
      }
      expect(tx.transactions).toHaveLength(0);
    });

    it('with no document, prices are the owner’s: every other stored account is refused, and nothing is written', async () => {
      const cases: [User | null, object][] = [
        // A barber sets no price — not even their own.
        [
          registeredUserFixture({
            id: ADMIN,
            roles: [Role.Barber],
            linkedBarberId: NEW,
          }),
          DENIED,
        ],
        [
          registeredUserFixture({ id: ADMIN, roles: [Role.ContentManager] }),
          DENIED,
        ],
        [
          registeredUserFixture({ id: ADMIN, roles: [Role.Receptionist] }),
          DENIED,
        ],
        [registeredUserFixture({ id: ADMIN, roles: [Role.Sysadmin] }), DENIED],
        [
          registeredUserFixture({
            id: ADMIN,
            roles: [Role.Admin],
            ...AccountLifecycle.block(BlockReason.Manual, null),
          }),
          NOT_STAFF,
        ],
        [null, NOT_STAFF],
      ];
      for (const [caller, refusal] of cases) {
        const refused = rig({ caller });
        expect(unwrapErr(await refused.run(call(COPY_IVAN)))).toEqual(refusal);
        expect(refused.tx.plans).toEqual([]);
      }
    });

    it('a barber given their own prices sets their own list — and no colleague’s (O8)', async () => {
      const permissions = { barberTeamOfferingsScope: 'OWN' };
      const own = registeredUserFixture({
        id: ADMIN,
        roles: [Role.Barber],
        linkedBarberId: NEW,
      });
      const { store, run } = rig({ caller: own, permissions });
      expect(
        await run(
          call(set(entry(CUT, 2000, 45)), { callerRoles: [Role.Barber] }),
        ),
      ).toEqual(Result.ok({ barberId: NEW }));
      expect(
        (
          store.get(`${Collections.Services}/${CUT}`)?.['offerings'] as
            readonly BarberOffering[] | undefined
        )?.some((offering) => offering.barberId === NEW),
      ).toBe(true);

      // The same grant on a colleague's record, and with no link at all.
      for (const caller of [
        registeredUserFixture({
          id: ADMIN,
          roles: [Role.Barber],
          linkedBarberId: IVAN,
        }),
        registeredUserFixture({ id: ADMIN, roles: [Role.Barber] }),
      ]) {
        const refused = rig({ caller, permissions });
        expect(
          unwrapErr(
            await refused.run(
              call(set(entry(CUT, 2000, 45)), { callerRoles: [Role.Barber] }),
            ),
          ),
        ).toEqual(OWN_ONLY);
        expect(refused.tx.plans).toEqual([]);
      }
    });

    it('a level given everyone’s prices sets any barber’s', async () => {
      const { run } = rig({
        caller: registeredUserFixture({
          id: ADMIN,
          roles: [Role.Receptionist],
        }),
        permissions: { receptionistTeamOfferingsScope: 'ALL' },
      });
      expect(
        await run(
          call(set(entry(CUT, 2000, 45)), { callerRoles: [Role.Receptionist] }),
        ),
      ).toEqual(Result.ok({ barberId: NEW }));
    });

    it('answers TEAM_BARBER_NOT_FOUND for an id with no record, and never edits one that has left', async () => {
      const missing = rig({ barber: null });
      expect(unwrapErr(await missing.run(call(COPY_IVAN)))).toEqual({
        errorCode: TeamErrorCode.BarberNotFound,
        barberId: NEW,
      });
      const left = rig({ barber: DEPARTED });
      expect(unwrapErr(await left.run(call(COPY_IVAN)))).toEqual({
        errorCode: TeamErrorCode.BarberDeparted,
        barberId: NEW,
      });
      expect([...missing.tx.plans, ...left.tx.plans]).toEqual([]);
    });

    it('writes nothing for a save of what is already there — and so for the replay of one that landed', async () => {
      const { store, tx, run } = rig();
      await run(call(COPY_IVAN));
      const cut = stored(store, CUT);
      // The replay, then another act asking for the same list.
      expect(await run(call(COPY_IVAN))).toEqual(Result.ok({ barberId: NEW }));
      expect(
        await run(
          call(set(entry(CUT, 2800, 30), entry(BEARD, 1500, 20)), {
            operationId: OperationId.of('operation-offer-again001'),
          }),
        ),
      ).toEqual(Result.ok({ barberId: NEW }));
      expect(tx.plans.slice(1)).toEqual([[], []]);
      expect(stored(store, CUT)).toEqual(cut);
      expect(auditRowsOf(tx.plans)).toHaveLength(1);
    });

    it('derives the same plan when the transaction re-runs (contention)', async () => {
      let decisions: readonly (readonly WriteOp[])[] = [];
      const { tx, run } = rig({
        commit: (commit) => {
          const contended = contendedCommit(commit);
          decisions = contended.decisions;
          return contended.commit;
        },
      });
      await run(call(COPY_IVAN));
      expect(decisions).toHaveLength(2);
      expect(decisions[0]).toEqual(decisions[1]);
      expect(tx.plans).toEqual([decisions[1]]);
    });
  });
});
