import { TestBed } from '@angular/core/testing';
import { Role, StaffPermissions } from '@core/components';
import { PipelineError } from '@core/errors';
import { AccessScope, StaffCapability } from '@core/primitives';
import { PermissionsStore } from './permissions.store';
import { teamBed } from './team-bed.spec-support';

/*
 * `PermissionsStore`: «Права» as the owner is editing it — the draft over
 * the live cells, what a save would change, and the save itself.
 */

const { None, Own, All } = AccessScope;
const { Hours, TimeOff, TeamManage, Analytics } = StaffCapability;

const REFUSED = PipelineError.fromWire('functions/permission-denied', {
  errorCode: 'GOVERNANCE_PERMISSIONS_FORBIDDEN',
});

function harness(stored: Record<string, unknown> = {}) {
  const bed = teamBed({ stored });
  TestBed.configureTestingModule({ providers: bed.providers });
  return { store: TestBed.inject(PermissionsStore), ...bed };
}

const scope = (
  store: PermissionsStore,
  level: 'barber' | 'receptionist' | 'content_manager',
  capability: StaffCapability,
) => StaffPermissions.scopeOf(store.next(), level, capability);

describe('PermissionsStore — the draft', () => {
  it('starts on the saved cells with nothing to save', () => {
    const { store } = harness({ barberTimeOffScope: All });
    expect(store.next()).toEqual(
      StaffPermissions.read({ barberTimeOffScope: All }),
    );
    expect(store.changes()).toEqual([]);
    expect(store.dirty()).toBe(false);
    expect([...store.unsaved()]).toEqual([]);
  });

  it('an answered row shows at once and is what a save would change, with both sides', () => {
    const { store } = harness();
    store.set(Role.Receptionist, Hours, None);

    expect(scope(store, Role.Receptionist, Hours)).toBe(None);
    expect(store.dirty()).toBe(true);
    expect(store.changes()).toEqual([
      {
        staffCapability: Hours,
        role: Role.Receptionist,
        accessScopeFrom: All,
        accessScopeTo: None,
      },
    ]);
    expect([...store.unsaved()]).toEqual([Role.Receptionist]);
  });

  it('a row answered back to what is saved is no change', () => {
    const { store } = harness();
    store.set(Role.Barber, Hours, All);
    store.set(Role.Barber, Hours, Own);

    expect(store.dirty()).toBe(false);
    expect(store.changes()).toEqual([]);
  });

  it('refuses a scope the cell does not offer: the draft is untouched', () => {
    const { store } = harness();
    store.set(Role.Receptionist, Hours, Own);
    store.set(Role.Barber, TeamManage, Own);

    expect(store.dirty()).toBe(false);
    expect(scope(store, Role.Receptionist, Hours)).toBe(All);
  });

  it('holds one draft across the levels', () => {
    const { store } = harness();
    store.set(Role.Barber, TimeOff, All);
    store.set(Role.Receptionist, Hours, None);
    store.set(Role.ContentManager, Analytics, All);

    expect(store.changes()).toHaveLength(3);
    expect([...store.unsaved()].sort()).toEqual(
      [Role.Barber, Role.ContentManager, Role.Receptionist].sort(),
    );
  });

  it('«Върни стандартните» puts every row of one level back and leaves the others', () => {
    const { store } = harness({
      barberTimeOffScope: All,
      barberTeamOfferingsScope: Own,
      receptionistHoursScope: None,
    });
    store.restore(Role.Barber);

    expect(StaffPermissions.departuresOf(store.next(), Role.Barber)).toEqual(
      [],
    );
    expect(
      StaffPermissions.departuresOf(store.next(), Role.Receptionist),
    ).toEqual([Hours]);
    // Back to the standard is itself a change to save: two cells of it.
    expect(store.changes().map((change) => change.staffCapability)).toEqual([
      TimeOff,
      StaffCapability.TeamOfferings,
    ]);
    // On a level already standard there is nothing to restore.
    store.restore(Role.ContentManager);
    expect(store.changes()).toHaveLength(2);
  });

  it('follows the live cells under a draft: untouched rows move, touched ones keep what was asked', () => {
    const { store, liveCells } = harness();
    store.set(Role.Receptionist, Hours, None);

    // Another owner's save lands.
    liveCells({ receptionistTimeOffScope: None, receptionistHoursScope: None });

    expect(scope(store, Role.Receptionist, TimeOff)).toBe(None);
    // What this owner asked for is now what is saved: nothing left to save.
    expect(store.dirty()).toBe(false);
  });
});

describe('PermissionsStore.save', () => {
  it('sends the cells that would change, in one call, as the scopes wanted', async () => {
    const { store, saves } = harness();
    store.set(Role.Receptionist, Hours, None);
    store.set(Role.Barber, TimeOff, All);
    // Asked and taken back: not sent.
    store.set(Role.Barber, Hours, All);
    store.set(Role.Barber, Hours, Own);

    await store.save();

    expect(saves).toHaveLength(1);
    expect(
      [...(saves[0]?.changes ?? [])].sort((a, b) =>
        a.role.localeCompare(b.role),
      ),
    ).toEqual([
      { staffCapability: TimeOff, role: Role.Barber, accessScope: All },
      { staffCapability: Hours, role: Role.Receptionist, accessScope: None },
    ]);
  });

  it('a save that lands: the receipt, no draft, and the saved rows never flicker back', async () => {
    const { store, liveCells } = harness();
    store.set(Role.Receptionist, Hours, None);

    await store.save();

    expect(store.receipt()).toBe(true);
    expect(store.dirty()).toBe(false);
    expect(store.saving()).toBe(false);
    // The listener has not answered yet: the page still shows what was saved.
    expect(scope(store, Role.Receptionist, Hours)).toBe(None);

    // The listener answers with the same cells: nothing moves.
    liveCells({ receptionistHoursScope: None });
    expect(scope(store, Role.Receptionist, Hours)).toBe(None);
    expect(store.dirty()).toBe(false);

    // A later change by anyone is followed again.
    liveCells({});
    expect(scope(store, Role.Receptionist, Hours)).toBe(All);
  });

  it('a refused save keeps the draft and says why; the next change clears the reason', async () => {
    const { store, saveRefuses } = harness();
    saveRefuses(REFUSED);
    store.set(Role.Receptionist, Hours, None);

    await store.save();

    expect(store.refusal()).toBe(REFUSED);
    expect(store.receipt()).toBe(false);
    expect(store.dirty()).toBe(true);
    expect(scope(store, Role.Receptionist, Hours)).toBe(None);

    store.set(Role.Receptionist, TimeOff, None);
    expect(store.refusal()).toBeNull();
  });

  it('saves nothing when nothing would change', async () => {
    const { store, saves } = harness();
    await store.save();
    store.set(Role.Barber, Hours, Own);
    await store.save();

    expect(saves).toEqual([]);
    expect(store.receipt()).toBe(false);
  });

  it('the receipt goes on the next change, and when dismissed', async () => {
    const { store } = harness();
    store.set(Role.Receptionist, Hours, None);
    await store.save();
    expect(store.receipt()).toBe(true);

    store.set(Role.Barber, TimeOff, All);
    expect(store.receipt()).toBe(false);

    await store.save();
    store.dismissReceipt();
    expect(store.receipt()).toBe(false);
  });
});
