import { describe, expect, it } from 'vitest';
import { Actor, type BarberOffering, WriteOp } from '@core/components';
import {
  AuditEntryId,
  BarberId,
  Currency,
  OperationId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import {
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  serviceFixture,
  termsFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import { OfferingEditSystem } from './offering-edit.system';

const IVAN = FIXTURE_IDS.barber;
const NEW = BarberId.of('b-new');
const CUT = ServiceId.of('svc-cut');
const BEARD = ServiceId.of('svc-beard');
const SHAVE = ServiceId.of('svc-shave');

const offering = (barberId: BarberId, cents: number, minutes: number) => ({
  barberId,
  overrides: [],
  ...termsFixture(cents, minutes),
});
/** One service at the terms an editor types — the barber is the call's. */
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

/** Ivan cuts and trims beards; nobody is listed for the shave. */
const catalogue = () => [
  serviceFixture({ id: CUT, offerings: [offering(IVAN, 2800, 30)] }),
  serviceFixture({ id: BEARD, offerings: [offering(IVAN, 1500, 20)] }),
  serviceFixture({ id: SHAVE, offerings: [] }),
];

describe('OfferingEditSystem.plan — a barber’s whole list', () => {
  it('adds the newcomer beside the others, on the services named', () => {
    const changes = unwrapOk(
      OfferingEditSystem.plan(catalogue(), NEW, [entry(CUT, 2000, 45)]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.serviceId).toBe(CUT);
    expect(changes[0]?.offerings.map((entry) => entry.barberId)).toEqual([
      IVAN,
      NEW,
    ]);
    expect(changes[0]?.offerings[1]).toMatchObject({
      priceCents: 2000,
      durationMinutes: 45,
    });
  });

  it('writes only what changes: a new price replaces in place, an unnamed service loses the barber, the same terms write nothing', () => {
    const changes = unwrapOk(
      OfferingEditSystem.plan(catalogue(), IVAN, [entry(CUT, 3000, 30)]),
    );
    expect(changes.map((change) => change.serviceId)).toEqual([CUT, BEARD]);
    expect(changes[0]?.offerings).toMatchObject([{ priceCents: 3000 }]);
    expect(changes[1]?.offerings).toEqual([]);

    expect(
      unwrapOk(
        OfferingEditSystem.plan(catalogue(), IVAN, [
          entry(CUT, 2800, 30),
          entry(BEARD, 1500, 20),
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a service named twice, terms the catalogue’s guard rejects, a foreign currency and an unknown service', () => {
    const refusal = (entries: Parameters<typeof OfferingEditSystem.plan>[2]) =>
      unwrapErr(OfferingEditSystem.plan(catalogue(), NEW, entries));
    expect(refusal([entry(CUT, 2000, 30), entry(CUT, 2100, 30)])).toEqual({
      errorCode: TeamErrorCode.InvalidInput,
      field: 'offerings',
    });
    expect(refusal([entry(CUT, 2000, 0)])).toEqual({
      errorCode: TeamErrorCode.InvalidInput,
      field: 'offerings',
    });
    // Only EUR is priced today: another currency is the guard's refusal.
    expect(refusal([{ ...entry(CUT, 2000, 30), currency: 'USD' }])).toEqual({
      errorCode: TeamErrorCode.InvalidInput,
      field: 'offerings',
    });
    // A service stored in another currency never takes a EUR offering.
    const inLeva = [
      serviceFixture({ id: CUT, currency: Currency.BGN, offerings: [] }),
    ];
    expect(
      unwrapErr(OfferingEditSystem.plan(inLeva, NEW, [entry(CUT, 2000, 30)])),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'currency' });
    const gone = ServiceId.of('svc-gone');
    expect(refusal([entry(gone, 2000, 30)])).toEqual({
      errorCode: TeamErrorCode.ServiceUnknown,
      serviceId: gone,
    });
  });
});

describe('OfferingEditSystem.writesOf — the changed services and their ONE row', () => {
  const OP = OperationId.of('operation-0123456789ab');
  const actor = Actor.admin(UserId.of('u-admin'));
  const write = {
    barberId: NEW,
    copiedFromBarberId: null,
    actor,
    nowUtcMs: FIXTURE_NOW_UTC_MS,
    operationId: OP,
  } as const;

  it('updates each changed service’s offerings at the root, stamped with the act, beside one row on the barber', () => {
    const changes = OfferingEditSystem.copied(catalogue(), IVAN, NEW);
    const row = AuditSystem.planTeamOfferings(
      NEW,
      [CUT, BEARD],
      IVAN,
      actor,
      FIXTURE_NOW_UTC_MS,
      OP,
    );
    expect(
      OfferingEditSystem.writesOf(
        { ...write, changes, copiedFromBarberId: IVAN },
        fixtureHash,
      ),
    ).toEqual([
      WriteOp.update([Collections.Services, CUT], {
        offerings: changes[0]?.offerings,
        writeOperationId: OP,
      }),
      WriteOp.update([Collections.Services, BEARD], {
        offerings: changes[1]?.offerings,
        writeOperationId: OP,
      }),
      WriteOp.create(
        [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
        row.row,
      ),
    ]);
    expect(row.row).toMatchObject({
      auditAction: 'TEAM_BARBER_OFFERINGS_CHANGED',
      resourceId: `barbers/${NEW}`,
      auditOperationId: OP,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      teamOfferingServiceIds: [CUT, BEARD],
      teamOfferingsCopiedFromBarberId: IVAN,
    });
    // Ids only: no price reaches the row.
    expect(JSON.stringify(row.row)).not.toContain('2800');
  });

  it('plans NOTHING when no service changes — a save of what is there, a replay', () => {
    expect(
      OfferingEditSystem.writesOf({ ...write, changes: [] }, fixtureHash),
    ).toEqual([]);
  });

  it('keys the row by the act: the same act the same row, another act another', () => {
    const changes = OfferingEditSystem.copied(catalogue(), IVAN, NEW);
    const rowPath = (operationId: OperationId) =>
      OfferingEditSystem.writesOf(
        { ...write, changes, operationId },
        fixtureHash,
      ).at(-1)?.path;
    expect(rowPath(OP)).toEqual(rowPath(OP));
    expect(rowPath(OperationId.of('operation-another-0001'))).not.toEqual(
      rowPath(OP),
    );
  });
});

describe('OfferingEditSystem.copied — «Копирай цените от»', () => {
  it('gives the newcomer the source’s terms on every service the source performs, and nothing else', () => {
    const changes = OfferingEditSystem.copied(catalogue(), IVAN, NEW);
    expect(changes.map((change) => change.serviceId)).toEqual([CUT, BEARD]);
    expect(changes[0]?.offerings).toEqual([
      offering(IVAN, 2800, 30),
      offering(NEW, 2800, 30),
    ]);
  });

  it('is a no-op the second time, and for a barber copying from themselves', () => {
    const copied = catalogue().map((service) => {
      const change = OfferingEditSystem.copied(catalogue(), IVAN, NEW).find(
        (entry) => entry.serviceId === service.id,
      );
      return change === undefined
        ? service
        : { ...service, offerings: change.offerings };
    });
    expect(OfferingEditSystem.copied(copied, IVAN, NEW)).toEqual([]);
    expect(OfferingEditSystem.copied(catalogue(), IVAN, IVAN)).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const services = deepFreeze(catalogue());
    expect(OfferingEditSystem.copied(services, IVAN, NEW)).toEqual(
      OfferingEditSystem.copied(services, IVAN, NEW),
    );
    expect(
      OfferingEditSystem.plan(services, NEW, [entry(CUT, 2000, 45)]),
    ).toEqual(OfferingEditSystem.plan(services, NEW, [entry(CUT, 2000, 45)]));
  });
});
