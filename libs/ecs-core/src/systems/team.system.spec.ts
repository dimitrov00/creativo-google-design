import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  BarberActivation,
  BarberStatus,
  BlockReason,
  Role,
  StaffSetupItem,
} from '@core/components';
import {
  BarberId,
  LocationId,
  OperationId,
  UtcEpochMs,
} from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import {
  barberFixture,
  barberScheduleFixture,
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  localDate,
  unwrapErr,
  unwrapOk,
  userFixture,
} from '@core/testing';
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

const admin = userFixture({ roles: [Role.Admin] });
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

describe('TeamSystem.admit — who manages the team', () => {
  it('admits the admin on their STORED roles, alone or beside another role', () => {
    expect(TeamSystem.admit(admin, NOW).ok).toBe(true);
    expect(
      TeamSystem.admit(userFixture({ roles: [Role.Barber, Role.Admin] }), NOW)
        .ok,
    ).toBe(true);
  });

  it('refuses everyone else, an account that is gone, and a blocked admin', () => {
    for (const roles of [
      [Role.Barber],
      [Role.Receptionist],
      [Role.ContentManager],
      [Role.Sysadmin],
      [Role.Client],
      [],
    ]) {
      expect(unwrapErr(TeamSystem.admit(userFixture({ roles }), NOW))).toEqual({
        errorCode: TeamErrorCode.Forbidden,
      });
    }
    expect(TeamSystem.admit(null, NOW).ok).toBe(false);
    expect(
      TeamSystem.admit(
        userFixture({
          roles: [Role.Admin],
          ...AccountLifecycle.block(BlockReason.Manual, null),
        }),
        NOW,
      ).ok,
    ).toBe(false);
  });
});

describe('TeamSystem.admitProfileEdit — who edits a barber’s profile', () => {
  const ivan = FIXTURE_IDS.barber;

  it('admits the admin, the content editor, and the barber whose account is linked to this record', () => {
    expect(TeamSystem.admitProfileEdit(admin, ivan, NOW).ok).toBe(true);
    expect(
      TeamSystem.admitProfileEdit(
        userFixture({ roles: [Role.ContentManager] }),
        ivan,
        NOW,
      ).ok,
    ).toBe(true);
    expect(
      TeamSystem.admitProfileEdit(
        userFixture({ roles: [Role.Barber], linkedBarberId: ivan }),
        ivan,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it('refuses a barber another record, an unlinked barber, the front desk, and anyone blocked', () => {
    const refused = [
      userFixture({ roles: [Role.Barber], linkedBarberId: NEW }),
      userFixture({ roles: [Role.Barber] }),
      userFixture({ roles: [Role.Receptionist] }),
      userFixture({
        roles: [Role.Barber],
        linkedBarberId: ivan,
        ...AccountLifecycle.block(BlockReason.Manual, null),
      }),
      null,
    ];
    for (const caller of refused) {
      expect(TeamSystem.admitProfileEdit(caller, ivan, NOW).ok).toBe(false);
    }
  });
});

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
    knownLocationIds: [CENTER, MLADOST],
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
    knownLocationIds: [CENTER, MLADOST],
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

describe('TeamSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const barber = deepFreeze(barberFixture());
    const schedule = deepFreeze(barberScheduleFixture());
    const run = () =>
      TeamSystem.setShops(
        barber,
        [CENTER],
        { knownLocationIds: [CENTER], schedule, today: FIXTURE_TODAY },
        OP,
      );
    expect(run()).toEqual(run());
  });
});
