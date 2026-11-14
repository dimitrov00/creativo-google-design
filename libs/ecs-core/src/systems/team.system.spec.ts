import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  BarberActivation,
  BarberStatus,
  StaffSetupItem,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
  LocationId,
  OperationId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import {
  barberFixture,
  barberScheduleFixture,
  bodyOf,
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  fixtureHash,
  localDate,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import type { StaffSetupChecklist } from './staff-setup.system';
import {
  type AddBarberInput,
  type BarberProfileInput,
  TeamSystem,
} from './team.system';

const NOW = FIXTURE_NOW_UTC_MS;
const OP = OperationId.of('operation-0123456789ab');
const CENTER = FIXTURE_IDS.location;
const MLADOST = LocationId.of('loc-mladost');
const NEW = BarberId.of('b-new');

const draft = barberFixture(
  { id: NEW },
  {
    barberStatus: BarberStatus.Draft,
    barberStatusChangedAtUtcMs: NOW,
    barberDraftTargetStatus: BarberStatus.Public,
  },
);
const departed = barberFixture(
  {},
  {
    barberStatus: BarberStatus.Departed,
    barberStatusChangedAtUtcMs: NOW,
    barberDepartedUserId: null,
    barberSessionsRevokedAtUtcMs: null,
    barberRehireStatus: BarberStatus.Public,
  },
);

/*
 * WHO may make a team act is `StaffAccessSystem`'s question since staff
 * permissions stage A (`staff-access.system.spec.ts`, and the table that
 * pins the defaults to what `admit`, `admitProfileEdit` and
 * `admitActivation` answered here). What follows are the record decisions,
 * asked after the caller is admitted.
 */

describe('TeamSystem.add — a new barber record', () => {
  const input: AddBarberInput = {
    name: { bg: '  Петър Петров ', en: null },
    locationIds: [CENTER, CENTER],
    barberStartsLocalDate: localDate('2026-12-01'),
    barberLastWorkingLocalDate: null,
    barberDraftTargetStatus: BarberStatus.Public,
    barberJoinsAnyPool: true,
  };
  const context = {
    barberId: NEW,
    listedShops: [{ id: CENTER }, { id: MLADOST }],
    barberCount: 3,
    nowUtcMs: NOW,
    operationId: OP,
  };

  it('is a DRAFT with the name in both languages, its shops once each, sorted last, stamped with the call', () => {
    const barber = unwrapOk(TeamSystem.add(input, context));
    expect(barber).toMatchObject({
      id: NEW,
      name: { bg: 'Петър Петров', en: 'Петър Петров' },
      title: null,
      bio: null,
      locationIds: [CENTER],
      sortOrder: 4,
      barberStatus: BarberStatus.Draft,
      barberStatusChangedAtUtcMs: NOW,
      barberDraftTargetStatus: BarberStatus.Public,
      barberStartsLocalDate: '2026-12-01',
      barberLastWorkingLocalDate: null,
      barberJoinsAnyPool: true,
      avatarMediaId: null,
      writeOperationId: OP,
    });
  });

  it('keeps an English name the author gave', () => {
    const barber = unwrapOk(
      TeamSystem.add(
        { ...input, name: { bg: 'Петър', en: ' Petar ' } },
        context,
      ),
    );
    expect(barber.name).toEqual({ bg: 'Петър', en: 'Petar' });
  });

  it('refuses a blank name, a shop that is not listed, and a last day before the start', () => {
    expect(
      unwrapErr(
        TeamSystem.add({ ...input, name: { bg: ' ', en: 'P' } }, context),
      ),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'name' });
    const elsewhere = LocationId.of('loc-elsewhere');
    expect(
      unwrapErr(
        TeamSystem.add({ ...input, locationIds: [elsewhere] }, context),
      ),
    ).toEqual({ errorCode: TeamErrorCode.ShopUnknown, locationId: elsewhere });
    expect(
      unwrapErr(
        TeamSystem.add(
          { ...input, barberLastWorkingLocalDate: localDate('2026-11-30') },
          context,
        ),
      ),
    ).toEqual({ errorCode: TeamErrorCode.PeriodInvalid });
  });
});

describe('TeamSystem.editProfile', () => {
  const profile: BarberProfileInput = {
    name: { bg: 'Иван Колев', en: 'Ivan Kolev' },
    title: { bg: ' Главен бръснар ', en: null },
    bio: { bg: '  ', en: null },
    instagramHandle: ' @ivan.cuts ',
    yearsExperience: 12,
  };

  it('replaces the profile: text trimmed, a blank bio none, the handle without its @', () => {
    const next = unwrapOk(TeamSystem.editProfile(barberFixture(), profile, OP));
    expect(next).toMatchObject({
      name: { bg: 'Иван Колев', en: 'Ivan Kolev' },
      title: { bg: 'Главен бръснар', en: 'Главен бръснар' },
      bio: null,
      instagramHandle: 'ivan.cuts',
      yearsExperience: 12,
      writeOperationId: OP,
      barberStatus: BarberStatus.Public,
    });
  });

  it('names the first field at fault', () => {
    const fieldOf = (change: Partial<BarberProfileInput>) => {
      const error = unwrapErr(
        TeamSystem.editProfile(barberFixture(), { ...profile, ...change }, OP),
      );
      return error.errorCode === TeamErrorCode.InvalidInput
        ? error.field
        : error.errorCode;
    };
    expect(fieldOf({ name: { bg: '', en: null } })).toBe('name');
    expect(fieldOf({ instagramHandle: 'ivan cuts!' })).toBe('instagramHandle');
    expect(fieldOf({ yearsExperience: -1 })).toBe('yearsExperience');
    expect(fieldOf({ yearsExperience: 2.5 })).toBe('yearsExperience');
    expect(fieldOf({ bio: { bg: 'я'.repeat(601), en: null } })).toBe('bio');
  });

  it('refuses a record that has left', () => {
    expect(unwrapErr(TeamSystem.editProfile(departed, profile, OP))).toEqual({
      errorCode: TeamErrorCode.BarberDeparted,
      barberId: departed.id,
    });
  });
});

describe('TeamSystem.setShops', () => {
  const facts = {
    listedShops: [{ id: CENTER }, { id: MLADOST }],
    // Ivan's roster: open-ended hours at the centre shop.
    schedule: barberScheduleFixture(),
    today: FIXTURE_TODAY,
  };

  it('refuses removing a shop the current or coming hours still name', () => {
    expect(
      unwrapErr(TeamSystem.setShops(barberFixture(), [MLADOST], facts, OP)),
    ).toEqual({ errorCode: TeamErrorCode.ShopHasHours, locationId: CENTER });
  });

  it('lets a shop go once its hours ended before today, and takes "every shop" as it is', () => {
    const ended = barberScheduleFixture({
      versions: barberScheduleFixture().versions.map((version) => ({
        ...version,
        effectiveToLocalDate: localDate('2026-09-27'),
      })),
    });
    expect(
      unwrapOk(
        TeamSystem.setShops(
          barberFixture(),
          [MLADOST],
          { ...facts, schedule: ended },
          OP,
        ),
      ).locationIds,
    ).toEqual([MLADOST]);
    expect(
      unwrapOk(TeamSystem.setShops(barberFixture(), [], facts, OP)).locationIds,
    ).toEqual([]);
    expect(
      unwrapOk(
        TeamSystem.setShops(
          barberFixture(),
          [MLADOST, CENTER],
          { ...facts, schedule: null },
          OP,
        ),
      ).locationIds,
    ).toEqual([MLADOST, CENTER]);
  });
});

describe('TeamSystem.setPeriod / setPool', () => {
  it('sets the working period, refusing a last day before the start', () => {
    const next = unwrapOk(
      TeamSystem.setPeriod(
        barberFixture(),
        localDate('2026-12-01'),
        localDate('2026-12-31'),
        OP,
      ),
    );
    expect(next.barberStartsLocalDate).toBe('2026-12-01');
    expect(next.barberLastWorkingLocalDate).toBe('2026-12-31');
    expect(
      unwrapErr(
        TeamSystem.setPeriod(
          barberFixture(),
          localDate('2026-12-01'),
          localDate('2026-11-30'),
          OP,
        ),
      ),
    ).toEqual({ errorCode: TeamErrorCode.PeriodInvalid });
  });

  it('takes a barber out of the «Който и да е» pool, and never edits a leaver', () => {
    expect(
      unwrapOk(TeamSystem.setPool(barberFixture(), false, OP))
        .barberJoinsAnyPool,
    ).toBe(false);
    expect(TeamSystem.setPool(departed, false, OP).ok).toBe(false);
  });
});

describe('TeamSystem.setAccess — who may book the record', () => {
  /** One hour on, so a new stamp is visibly a new one. */
  const LATER = UtcEpochMs.plusHours(NOW, 1);

  it('changes where a DRAFT will go live, keeping it a draft and its stamp', () => {
    const next = unwrapOk(
      TeamSystem.setAccess(draft, BarberStatus.StaffOnly, LATER, OP),
    );
    expect(next).toMatchObject({
      barberStatus: BarberStatus.Draft,
      barberDraftTargetStatus: BarberStatus.StaffOnly,
      barberStatusChangedAtUtcMs: NOW,
    });
  });

  it('moves a live record between staff-only and public, stamping the change', () => {
    const next = unwrapOk(
      TeamSystem.setAccess(barberFixture(), BarberStatus.StaffOnly, LATER, OP),
    );
    expect(next.barberStatus).toBe(BarberStatus.StaffOnly);
    expect(next.barberStatusChangedAtUtcMs).toBe(LATER);
    expect(Object.keys(next)).not.toContain('barberDraftTargetStatus');
  });

  it('answers the same record when nothing changes', () => {
    const barber = barberFixture();
    expect(
      unwrapOk(TeamSystem.setAccess(barber, BarberStatus.Public, LATER, OP)),
    ).toBe(barber);
  });
});

describe('TeamSystem.activate — the go-live step', () => {
  const ready: StaffSetupChecklist = {
    needed: [],
    optional: [],
    ready: true,
    firstMissing: null,
  };
  const missingHours: StaffSetupChecklist = {
    ...ready,
    ready: false,
    firstMissing: StaffSetupItem.Hours,
  };

  it('takes a ready DRAFT live at its target status — exactly that variant, no draft field left', () => {
    const step = TeamSystem.activate(draft, ready, NOW, OP);
    expect(step.answer).toEqual({
      barberActivation: BarberActivation.Activated,
    });
    expect(step.barber).toMatchObject({
      id: NEW,
      barberStatus: BarberStatus.Public,
      barberStatusChangedAtUtcMs: NOW,
      writeOperationId: OP,
    });
    expect(Object.keys(step.barber ?? {})).not.toContain(
      'barberDraftTargetStatus',
    );
  });

  it('names the first needed item a DRAFT still misses, and writes nothing', () => {
    expect(TeamSystem.activate(draft, missingHours, NOW, OP)).toEqual({
      answer: {
        barberActivation: BarberActivation.NotReady,
        staffSetupItem: StaffSetupItem.Hours,
      },
      barber: null,
    });
  });

  it('leaves a live record and a leaver unchanged, whatever the checklist says', () => {
    for (const barber of [barberFixture(), departed]) {
      expect(TeamSystem.activate(barber, missingHours, NOW, OP)).toEqual({
        answer: { barberActivation: BarberActivation.Unchanged },
        barber: null,
      });
    }
  });
});

describe('TeamSystem.editable', () => {
  it('lets a draft and a live record be edited, never one that has left', () => {
    expect(unwrapOk(TeamSystem.editable(draft))).toBe(draft);
    expect(TeamSystem.editable(barberFixture()).ok).toBe(true);
    expect(unwrapErr(TeamSystem.editable(departed))).toEqual({
      errorCode: TeamErrorCode.BarberDeparted,
      barberId: FIXTURE_IDS.barber,
    });
  });
});

describe('TeamSystem.removable', () => {
  it('lets only a record that never went live be deleted', () => {
    expect(TeamSystem.removable(draft).ok).toBe(true);
    expect(unwrapErr(TeamSystem.removable(barberFixture()))).toEqual({
      errorCode: TeamErrorCode.NotDraft,
      barberId: FIXTURE_IDS.barber,
    });
    expect(TeamSystem.removable(departed).ok).toBe(false);
  });
});

describe('TeamSystem.changedFields — the names a write changes', () => {
  it('lists the stored fields that differ, ascending — never the id, never the provenance stamp', () => {
    const before = barberFixture();
    const after = unwrapOk(TeamSystem.setPool(before, false, OP));
    expect(after.writeOperationId).toBe(OP);
    expect(TeamSystem.changedFields(before, after)).toEqual([
      'barberJoinsAnyPool',
    ]);
    // A restamp alone is no change.
    expect(
      TeamSystem.changedFields(before, { ...before, writeOperationId: OP }),
    ).toEqual([]);
  });

  it('lists a creation’s and a deletion’s whole stored key list', () => {
    const created = TeamSystem.changedFields(null, draft);
    expect(created).toEqual(TeamSystem.changedFields(draft, null));
    expect(created).toContain('barberDraftTargetStatus');
    expect(created).toContain('name');
    expect(created).not.toContain('id');
    expect(created).not.toContain('writeOperationId');
    expect(created).toEqual([...created].sort());
    expect(TeamSystem.changedFields(null, null)).toEqual([]);
  });
});

describe('TeamSystem.writesOf — the record and its ONE row', () => {
  const actor = Actor.admin(UserId.of('u-admin'));
  const write = {
    action: AuditAction.TeamBarberPoolChanged,
    actor,
    nowUtcMs: NOW,
    operationId: OP,
  } as const;

  it('sets the record whole — the entity minus its id — beside its row under hash(idBasis)', () => {
    const before = barberFixture();
    const after = unwrapOk(TeamSystem.setPool(before, false, OP));
    const row = AuditSystem.planTeamBarber(
      AuditAction.TeamBarberPoolChanged,
      before.id,
      before,
      after,
      ['barberJoinsAnyPool'],
      actor,
      NOW,
      OP,
    );
    expect(
      TeamSystem.writesOf({ ...write, before, after }, fixtureHash),
    ).toEqual([
      WriteOp.set([Collections.Barbers, before.id], bodyOf(after)),
      WriteOp.create(
        [Collections.AuditLog, AuditEntryId.of(fixtureHash(row.idBasis))],
        row.row,
      ),
    ]);
    expect(row.row).toMatchObject({
      auditAction: 'TEAM_BARBER_POOL_CHANGED',
      resourceId: `barbers/${before.id}`,
      auditOperationId: OP,
      recordedAtUtcMs: NOW,
      teamBarberFields: ['barberJoinsAnyPool'],
      teamBarberStatusFrom: BarberStatus.Public,
      teamBarberStatusTo: BarberStatus.Public,
      teamBarberStartsLocalDate: before.barberStartsLocalDate,
      teamBarberLastWorkingLocalDate: null,
    });
  });

  it('removes a deleted record, its row naming the status it had and no period', () => {
    const [removal, row] = TeamSystem.writesOf(
      {
        ...write,
        action: AuditAction.TeamBarberDeleted,
        before: draft,
        after: null,
      },
      fixtureHash,
    );
    expect(removal).toEqual(WriteOp.remove([Collections.Barbers, NEW]));
    expect(row).toMatchObject({
      body: {
        auditAction: 'TEAM_BARBER_DELETED',
        resourceId: `barbers/${NEW}`,
        teamBarberStatusFrom: BarberStatus.Draft,
        teamBarberStatusTo: null,
        teamBarberStartsLocalDate: null,
        teamBarberLastWorkingLocalDate: null,
      },
    });
  });

  it('plans NOTHING for an act that changes no stored field — a save of what is there, a replay', () => {
    const barber = barberFixture();
    expect(
      TeamSystem.writesOf(
        { ...write, before: barber, after: { ...barber } },
        fixtureHash,
      ),
    ).toEqual([]);
    expect(
      TeamSystem.writesOf(
        {
          ...write,
          before: barber,
          after: unwrapOk(
            TeamSystem.setPool(barber, barber.barberJoinsAnyPool, OP),
          ),
        },
        fixtureHash,
      ),
    ).toEqual([]);
    expect(
      TeamSystem.writesOf({ ...write, before: null, after: null }, fixtureHash),
    ).toEqual([]);
  });

  it('derives the same row id for the same act — and another for another act', () => {
    const before = barberFixture();
    const after = unwrapOk(TeamSystem.setPool(before, false, OP));
    const rowPath = (operationId: OperationId) =>
      TeamSystem.writesOf(
        { ...write, before, after, operationId },
        fixtureHash,
      )[1]?.path;
    expect(rowPath(OP)).toEqual(rowPath(OP));
    expect(rowPath(OperationId.of('operation-another-0001'))).not.toEqual(
      rowPath(OP),
    );
  });
});

describe('TeamSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const barber = deepFreeze(barberFixture());
    const schedule = deepFreeze(barberScheduleFixture());
    const run = () =>
      TeamSystem.setShops(
        barber,
        [CENTER],
        { listedShops: [{ id: CENTER }], schedule, today: FIXTURE_TODAY },
        OP,
      );
    expect(run()).toEqual(run());
  });
});
