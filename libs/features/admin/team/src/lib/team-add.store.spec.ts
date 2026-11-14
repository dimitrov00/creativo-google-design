import { TestBed } from '@angular/core/testing';
import { BarberStatus, OfferingsEdit } from '@core/components';
import { PipelineError } from '@core/errors';
import { localDate } from '@core/testing';
import { teamBed } from './team-bed.spec-support';
import { IVAN } from './team.fixtures.spec-support';
import { TeamAddStore } from './team-add.store';

/*
 * `TeamAddStore`: «Добави» — a new barber record, then a colleague's
 * prices copied onto it, as two named acts over scripted calls.
 */

const REFUSED = PipelineError.fromWire('functions/permission-denied', {
  errorCode: 'ACCESS_DENIED',
  staffCapability: 'TEAM_MANAGE',
});

const STARTS = localDate('2026-12-01');

function harness() {
  const bed = teamBed();
  TestBed.configureTestingModule({
    providers: [...bed.providers, TeamAddStore],
  });
  return { store: TestBed.inject(TeamAddStore), ...bed };
}

describe('TeamAddStore — «Добави»', () => {
  it('adds the record as a barber gets it: every shop, bookable by everyone once live, in the pool', async () => {
    const { store, calls, listed } = harness();

    const barberId = await store.add({
      name: 'Николай Стоянов',
      barberStartsLocalDate: STARTS,
      copyFromBarberId: null,
    });

    expect(calls.adds).toHaveLength(1);
    expect(calls.adds[0]).toEqual({
      name: { bg: 'Николай Стоянов', en: null },
      locationIds: [],
      barberStartsLocalDate: STARTS,
      barberLastWorkingLocalDate: null,
      barberDraftTargetStatus: BarberStatus.Public,
      barberJoinsAnyPool: true,
      operationId: calls.adds[0]?.operationId,
    });
    // The act's name IS the new record's id.
    expect(barberId).toBe(calls.adds[0]?.operationId);
    expect(store.added()).toBe(barberId);
    expect(calls.offerings).toEqual([]);
    // The Team list has a new row: read again.
    expect(listed).toHaveLength(1);
    expect(store.pending()).toBe(false);
  });

  it('then copies a colleague’s prices onto the new record, as an act of its own', async () => {
    const { store, calls } = harness();

    const barberId = await store.add({
      name: 'Николай Стоянов',
      barberStartsLocalDate: STARTS,
      copyFromBarberId: IVAN.barberId,
    });

    expect(barberId).not.toBeNull();
    expect(calls.offerings).toEqual([
      {
        offeringsEdit: OfferingsEdit.Copy,
        copyFromBarberId: IVAN.barberId,
        barberId,
        operationId: calls.offerings[0]?.operationId,
      },
    ]);
    expect(calls.offerings[0]?.operationId).not.toBe(
      calls.adds[0]?.operationId,
    );
  });

  it('a refused add creates nothing and keeps its refusal; the next try adds', async () => {
    const { store, calls, refuses } = harness();
    refuses('addBarber', REFUSED);
    expect(
      await store.add({
        name: 'Николай Стоянов',
        barberStartsLocalDate: STARTS,
        copyFromBarberId: IVAN.barberId,
      }),
    ).toBeNull();
    expect(store.refusal()).toBe(REFUSED);
    expect(store.added()).toBeNull();
    expect(calls.offerings).toEqual([]);

    refuses('addBarber', null);
    expect(
      await store.add({
        name: 'Николай Стоянов',
        barberStartsLocalDate: STARTS,
        copyFromBarberId: null,
      }),
    ).not.toBeNull();
    expect(store.refusal()).toBeNull();
    expect(calls.adds).toHaveLength(2);
  });

  it('a copy that fails leaves the record there, and the retry copies without adding a second person', async () => {
    const { store, calls, refuses } = harness();
    const answers = {
      name: 'Николай Стоянов',
      barberStartsLocalDate: STARTS,
      copyFromBarberId: IVAN.barberId,
    };
    refuses('setBarberOfferings', REFUSED);

    expect(await store.add(answers)).toBeNull();
    expect(store.refusal()).toBe(REFUSED);
    const created = store.added();
    expect(created).not.toBeNull();

    refuses('setBarberOfferings', null);
    expect(await store.add(answers)).toBe(created);
    expect(calls.adds).toHaveLength(1);
    expect(calls.offerings).toHaveLength(2);
    expect(calls.offerings[1]?.barberId).toBe(created);
    // A retry is a new act: its own name.
    expect(calls.offerings[1]?.operationId).not.toBe(
      calls.offerings[0]?.operationId,
    );
  });
});
