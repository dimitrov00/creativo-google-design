import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  BarberActivation,
  BarberEdit,
  BarberLinkChange,
  BarberStatus,
  RecordClaim,
  Role,
} from '@core/components';
import { PipelineError } from '@core/errors';
import { Callables } from '@core/ports';
import { LocationId } from '@core/primitives';
import { localDate, locationFixture } from '@core/testing';
import { type TeamBedOptions, teamBed } from './team-bed.spec-support';
import {
  IVAN,
  IVAN_RECORD,
  NIKOLAY,
  NIKOLAY_RECORD,
  STEFAN,
  STEFAN_RECORD,
  TEAM,
  rosterOf,
  serviceOf,
} from './team.fixtures.spec-support';
import { TeamMemberStore } from './team-member.store';
import { TeamStore } from './team.store';

/*
 * `TeamMemberStore`: one barber record live — what it still needs, whose
 * it is to the person looking, and the calls the page makes — over
 * scripted calls and reads a spec can move.
 */

const REFUSED = PipelineError.fromWire('functions/permission-denied', {
  errorCode: 'ACCESS_DENIED',
  staffCapability: 'TEAM_MANAGE',
});

const RECORDS = [IVAN_RECORD, NIKOLAY_RECORD, STEFAN_RECORD];

/** The store on a record, the Team list read, every effect run. */
async function harness(barber = NIKOLAY, options: TeamBedOptions = {}) {
  const bed = teamBed({ members: TEAM, barbers: RECORDS, ...options });
  TestBed.configureTestingModule({
    providers: [...bed.providers, TeamMemberStore],
  });
  const store = TestBed.inject(TeamMemberStore);
  const team = TestBed.inject(TeamStore);
  await team.load();
  /** Lets the effects run and the calls in flight answer. */
  const settle = async (): Promise<void> => {
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
    TestBed.tick();
  };
  store.open(barber.barberId);
  await settle();
  return { store, team, settle, ...bed };
}

describe('TeamMemberStore — the record and what it needs', () => {
  it('reads the record off the team stream and its checklist off the live services and roster', async () => {
    const { store, liveServices, liveSchedules, settle } = await harness();
    expect(store.barber()).toBe(NIKOLAY_RECORD);
    expect(store.checklist()?.ready).toBe(false);
    expect(store.doneCount()).toBe(3);
    expect(store.servicesCount()).toBe(0);

    liveServices([serviceOf(IVAN.barberId, NIKOLAY.barberId)]);
    await settle();
    expect(store.doneCount()).toBe(4);
    expect(store.servicesCount()).toBe(1);

    liveSchedules([rosterOf(NIKOLAY.barberId)]);
    await settle();
    expect(store.doneCount()).toBe(5);
    expect(store.checklist()?.ready).toBe(true);
  });

  it('holds no record for an id the team does not carry, and says the team is read', async () => {
    const { store } = await harness({ ...NIKOLAY, barberId: IVAN.barberId });
    expect(store.barber()).toBe(IVAN_RECORD);
    store.open(null);
    expect(store.barber()).toBeUndefined();
    expect(store.known()).toBe(true);
    expect(store.checklist()).toBeNull();
  });

  it('finds the Team list’s row for the record: the account beside it', async () => {
    const { store } = await harness(IVAN);
    expect(store.member()).toBe(IVAN);
    expect(store.member()?.memberAccountName).toBe('Иван Петров');
  });
});

describe('TeamMemberStore — the go-live step (team onboarding D9)', () => {
  it('asks once when a record in preparation shows every needed item done, and says it went live', async () => {
    const { store, calls, listed, activates, liveSchedules, settle } =
      await harness(NIKOLAY, { services: [serviceOf(NIKOLAY.barberId)] });
    expect(calls.activations).toEqual([]);

    activates(BarberActivation.Activated);
    liveSchedules([rosterOf(NIKOLAY.barberId)]);
    await settle();

    expect(calls.activations).toHaveLength(1);
    expect(calls.activations[0]?.barberId).toBe(NIKOLAY.barberId);
    expect(store.wentLive()).toBe(true);
    // The Team list words the same record: read again.
    expect(listed.length).toBeGreaterThan(1);

    // The same ready record is not asked twice.
    liveSchedules([rosterOf(NIKOLAY.barberId)]);
    await settle();
    expect(calls.activations).toHaveLength(1);

    store.dismissLive();
    expect(store.wentLive()).toBe(false);
  });

  it('asks when the page opens on a record that is already ready', async () => {
    const { calls } = await harness(NIKOLAY, {
      services: [serviceOf(NIKOLAY.barberId)],
      schedules: [rosterOf(NIKOLAY.barberId)],
    });
    expect(calls.activations).toHaveLength(1);
  });

  it('never asks for a record at work, and says nothing when the step is not ready or is refused', async () => {
    const live = await harness(IVAN, {
      services: [serviceOf(IVAN.barberId)],
      schedules: [rosterOf(IVAN.barberId)],
    });
    expect(live.calls.activations).toEqual([]);
    TestBed.resetTestingModule();

    const refused = await harness(NIKOLAY, {
      services: [serviceOf(NIKOLAY.barberId)],
    });
    refused.refuses('activateBarber', REFUSED);
    refused.liveSchedules([rosterOf(NIKOLAY.barberId)]);
    await refused.settle();
    expect(refused.calls.activations).toHaveLength(1);
    expect(refused.store.wentLive()).toBe(false);
    expect(refused.store.refusal()).toBeNull();
  });
});

describe('TeamMemberStore — the record’s edits', () => {
  it('saves the profile whole as one named act, and reads the Team list again', async () => {
    const { store, calls, listed } = await harness();
    const before = listed.length;
    const profile = {
      name: { bg: 'Николай Стоянов', en: null },
      title: { bg: 'Бръснар', en: null },
      bio: null,
      instagramHandle: 'niko.cuts',
      yearsExperience: 4,
    };

    expect(await store.saveProfile(profile)).toBe(true);

    expect(calls.edits).toHaveLength(1);
    expect(calls.edits[0]).toMatchObject({
      barberEdit: BarberEdit.Profile,
      ...profile,
      barberId: NIKOLAY.barberId,
    });
    expect(calls.edits[0]?.operationId).toMatch(/^operation-\d{6}$/);
    expect(listed.length).toBe(before + 1);
    expect(store.refusal()).toBeNull();
  });

  it('saves the working period, each save under a name of its own', async () => {
    const { store, calls } = await harness();
    const starts = localDate('2026-12-08');
    const last = localDate('2027-06-30');

    expect(await store.savePeriod(starts, last)).toBe(true);
    expect(await store.savePeriod(starts, null)).toBe(true);

    expect(calls.edits.map((call) => call.barberEdit)).toEqual([
      BarberEdit.Period,
      BarberEdit.Period,
    ]);
    expect(calls.edits[0]).toMatchObject({
      barberStartsLocalDate: starts,
      barberLastWorkingLocalDate: last,
    });
    expect(calls.edits[1]).toMatchObject({
      barberLastWorkingLocalDate: null,
    });
    expect(calls.edits[0]?.operationId).not.toBe(calls.edits[1]?.operationId);
  });

  it('keeps a refusal for the page and answers false; the next save clears it', async () => {
    const { store, refuses } = await harness();
    refuses('editBarber', REFUSED);
    expect(await store.savePeriod(localDate('2026-12-08'), null)).toBe(false);
    expect(store.refusal()).toBe(REFUSED);
    expect(store.pending()).toBe(false);

    refuses('editBarber', null);
    expect(await store.savePeriod(localDate('2026-12-08'), null)).toBe(true);
    expect(store.refusal()).toBeNull();
  });

  it('flips the pool at once and puts it back when the call is refused', async () => {
    const { store, calls, refuses } = await harness();
    expect(store.poolOn()).toBe(true);

    const flipped = store.setPool(false);
    expect(store.poolOn()).toBe(false);
    await flipped;
    expect(calls.edits[0]).toMatchObject({
      barberEdit: BarberEdit.Pool,
      barberJoinsAnyPool: false,
    });
    // The record has not said it back yet: the answer asked for stands.
    expect(store.poolOn()).toBe(false);

    refuses('editBarber', REFUSED);
    await store.setPool(true);
    expect(store.poolOn()).toBe(NIKOLAY_RECORD.barberJoinsAnyPool);
    expect(store.refusal()).toBe(REFUSED);
  });

  it('answers who may book the record the same way, and follows the record when it says so', async () => {
    const { store, calls, liveBarbers, settle } = await harness();
    expect(store.bookedBy()).toBe(BarberStatus.Public);

    await store.setAccess(BarberStatus.StaffOnly);
    expect(calls.edits[0]).toMatchObject({
      barberEdit: BarberEdit.Access,
      barberStatus: BarberStatus.StaffOnly,
    });
    expect(store.bookedBy()).toBe(BarberStatus.StaffOnly);

    // The stream says the record went live for everyone after all.
    liveBarbers([IVAN_RECORD, { ...IVAN_RECORD, id: NIKOLAY.barberId }]);
    await settle();
    expect(store.bookedBy()).toBe(BarberStatus.Public);
  });

  it('deletes a record that never went live, waits for the list, and answers true', async () => {
    const { store, calls, listed, refuses } = await harness();
    const before = listed.length;
    expect(await store.remove()).toBe(true);
    expect(calls.deletes).toEqual([
      {
        barberId: NIKOLAY.barberId,
        operationId: calls.deletes[0]?.operationId,
      },
    ]);
    expect(listed.length).toBe(before + 1);

    refuses('deleteDraftBarber', REFUSED);
    expect(await store.remove()).toBe(false);
    expect(store.refusal()).toBe(REFUSED);
  });
});

describe('TeamMemberStore — the weekly hours (the schedule’s sheet over this store)', () => {
  const week = {
    barberId: NIKOLAY.barberId,
    locationId: LocationId.of('loc-center'),
    fromLocalDate: localDate('2026-12-01'),
    segments: [],
    breaks: [],
  };

  it('saves the week as one named roster write, and answers true', async () => {
    const { store, calls } = await harness();

    expect(await store.setRosterWeek(week)).toBe(true);

    expect(calls.dialled).toHaveLength(1);
    expect(calls.dialled[0]?.callable).toBe(Callables.SetRosterWeek);
    expect(calls.dialled[0]?.input).toMatchObject(week);
    expect(
      (calls.dialled[0]?.input as { operationId: string }).operationId,
    ).toMatch(/^operation-\d{6}$/);
  });

  it('keeps a refusal for the sheet, never for the page', async () => {
    const { store, dialRefuses } = await harness();
    dialRefuses(Callables.SetRosterWeek, REFUSED);

    expect(await store.setRosterWeek(week)).toBe(false);

    expect(store.hoursRefusal()).toBe(REFUSED);
    expect(store.refusal()).toBeNull();
    store.clearHoursRefusal();
    expect(store.hoursRefusal()).toBeNull();
  });

  it('reads a chair’s roster off the staff’s stream', async () => {
    const { store } = await harness(NIKOLAY, {
      schedules: [rosterOf(NIKOLAY.barberId)],
    });
    const read = await firstValueFrom(store.rosterOf(NIKOLAY.barberId));
    expect(read.ok && read.value?.id).toBe(NIKOLAY.barberId);
  });

  it('names the shop a new shift is worked at: the record’s own, else the catalogue’s first', async () => {
    const center = locationFixture();
    const own = await harness(IVAN, { locations: [center] });
    expect(own.store.homeShop()).toBe(IVAN_RECORD.locationIds[0]);
    TestBed.resetTestingModule();

    // Nikolay works everywhere: the first shop the catalogue lists.
    const everywhere = await harness(NIKOLAY, { locations: [center] });
    expect(everywhere.store.homeShop()).toBe(center.id);
  });
});

describe('TeamMemberStore — «Това съм аз» · «Не съм аз» (staff permissions P9)', () => {
  it('is open to the owner on a record nobody is linked to', async () => {
    const { store } = await harness();
    expect(store.recordClaim()).toBe(RecordClaim.Open);
  });

  it('takes the record: setRoles on the owner’s own account, with barber added and a SET link, then it is theirs', async () => {
    const { store, calls } = await harness();

    expect(await store.claim(true)).toBe(true);

    expect(calls.roles).toHaveLength(1);
    expect(calls.roles[0]).toMatchObject({
      targetUserId: 'u-owner',
      barberLinkChange: BarberLinkChange.Set,
      linkedBarberId: NIKOLAY.barberId,
    });
    expect([...(calls.roles[0]?.roles ?? [])].sort()).toEqual(
      [Role.Admin, Role.Barber].sort(),
    );
    // The stored account moved: the record is the viewer's own at once.
    expect(store.recordClaim()).toBe(RecordClaim.Mine);
  });

  it('gives it back: barber removed and the link cleared', async () => {
    const { store, calls } = await harness(NIKOLAY, {
      roles: [Role.Barber, Role.Admin],
      linkedBarberId: NIKOLAY.barberId,
    });
    expect(store.recordClaim()).toBe(RecordClaim.Mine);

    expect(await store.claim(false)).toBe(true);

    expect(calls.roles[0]).toMatchObject({
      roles: [Role.Admin],
      barberLinkChange: BarberLinkChange.Clear,
      linkedBarberId: null,
    });
    expect(store.recordClaim()).toBe(RecordClaim.Open);
  });

  it('keeps a refused link for the page', async () => {
    const { store, rolesRefuse } = await harness();
    rolesRefuse(REFUSED);
    expect(await store.claim(true)).toBe(false);
    expect(store.refusal()).toBe(REFUSED);
    expect(store.recordClaim()).toBe(RecordClaim.Open);
  });
});

describe('TeamMemberStore — what the person looking may change', () => {
  it('the owner may change everything on a record in preparation, and delete it', async () => {
    const { store } = await harness();
    expect(store.managesTeam()).toBe(true);
    expect(store.mayEditProfile()).toBe(true);
    expect(store.mayManage()).toBe(true);
    expect(store.mayEditHours()).toBe(true);
    expect(store.deletable()).toBe(true);
  });

  it('a content editor may edit the profile and nothing else', async () => {
    const { store } = await harness(IVAN, { roles: [Role.ContentManager] });
    expect(store.managesTeam()).toBe(false);
    expect(store.mayEditProfile()).toBe(true);
    expect(store.mayManage()).toBe(false);
    expect(store.mayEditHours()).toBe(false);
    expect(store.deletable()).toBe(false);
    expect(store.recordClaim()).toBe(RecordClaim.None);
  });

  it('the front desk may change the hours and nothing else', async () => {
    const { store } = await harness(IVAN, { roles: [Role.Receptionist] });
    expect(store.mayEditHours()).toBe(true);
    expect(store.mayEditProfile()).toBe(false);
    expect(store.mayManage()).toBe(false);
  });

  it('a record at work cannot be deleted, and one that has left takes no edit', async () => {
    const live = await harness(IVAN);
    expect(live.store.deletable()).toBe(false);
    TestBed.resetTestingModule();

    const gone = await harness(STEFAN);
    expect(gone.store.mayEditProfile()).toBe(false);
    expect(gone.store.mayManage()).toBe(false);
    expect(gone.store.mayEditHours()).toBe(false);
    expect(gone.store.bookedBy()).toBeNull();
  });
});
