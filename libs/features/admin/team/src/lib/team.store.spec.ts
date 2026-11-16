import { TestBed } from '@angular/core/testing';
import { BarberEdit, type TeamCall, type TeamMember } from '@core/components';
import { PipelineError } from '@core/errors';
import type { TeamAdminPorts } from '@core/ports';
import { BarberId, Result } from '@core/primitives';
import {
  ID_PORTS,
  TEAM_ADMIN_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { LoadState } from '@creativo/shared/view-state';
import { UNUSED_RECORD_PORTS } from './team-bed.spec-support';
import { ELENA, IVAN, STEFAN, TEAM } from './team.fixtures.spec-support';
import { TeamStore } from './team.store';

/*
 * `TeamStore`: the team as `listTeam` answered it — its signals over a
 * scripted call.
 */

type Listed = Result<TeamCall.Listed, PipelineError>;

const REFUSED = PipelineError.fromWire('functions/permission-denied', {
  errorCode: 'ACCESS_DENIED',
  staffCapability: 'TEAM_MANAGE',
});

/** A store whose every read is held until the spec answers it. */
function harness(
  editBarber: TeamAdminPorts['editBarber'] = UNUSED_RECORD_PORTS.editBarber,
) {
  const pending: ((answer: Listed) => void)[] = [];
  const listTeam = vi.fn(
    () => new Promise<Listed>((resolve) => pending.push(resolve)),
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: TEAM_ADMIN_PORTS,
        useValue: {
          ...UNUSED_RECORD_PORTS,
          editBarber,
          listTeam,
          setStaffPermissions: async () => Result.ok({ changes: [] }),
        } satisfies TeamAdminPorts,
      },
      { provide: ID_PORTS, useValue: { nextId: () => 'operation-000001' } },
    ],
  });
  const store = TestBed.inject(TeamStore);
  return {
    store,
    listTeam,
    /** The read numbered `index` answers. */
    answer: async (index: number, answer: Listed) => {
      pending.at(index)?.(answer);
      await Promise.resolve();
    },
  };
}

const rows = (members: readonly TeamMember[]): Listed => Result.ok({ members });

describe('TeamStore', () => {
  it('is loading until the first answer, then holds the rows and their runs', async () => {
    const { store, listTeam, answer } = harness();
    expect(store.loadState()).toBe(LoadState.Loading);
    expect(store.members()).toBeNull();

    const read = store.load();
    expect(store.loading()).toBe(true);
    expect(listTeam).toHaveBeenCalledWith({});
    await answer(0, rows(TEAM));
    await read;

    expect(store.loadState()).toBe(LoadState.Ready);
    expect(store.loading()).toBe(false);
    expect(store.members()).toBe(TEAM);
    expect(store.sections().working.map((member) => member.barberId)).toEqual([
      'ivan',
      'georgi',
      'martin',
      'nikolay',
    ]);
    expect(store.sections().departed).toEqual([STEFAN]);
    expect(store.sections().others).toHaveLength(3);
  });

  it('reads an empty shop as empty, not as still loading', async () => {
    const { store, answer } = harness();
    const read = store.load();
    await answer(0, rows([]));
    await read;

    expect(store.loadState()).toBe(LoadState.Empty);
    expect(store.sections()).toEqual({ working: [], others: [], departed: [] });
  });

  it('a first read that fails is the failed state, with why', async () => {
    const { store, answer } = harness();
    const read = store.load();
    await answer(0, Result.err(REFUSED));
    await read;

    expect(store.loadState()).toBe(LoadState.Failed);
    expect(store.refusal()).toBe(REFUSED);
    expect(store.members()).toBeNull();
  });

  it('keeps the rows on screen when a later read fails, and clears the reason when one lands', async () => {
    const { store, answer } = harness();
    const first = store.load();
    await answer(0, rows([IVAN]));
    await first;

    const second = store.load();
    await answer(1, Result.err(REFUSED));
    await second;
    expect(store.loadState()).toBe(LoadState.Ready);
    expect(store.members()).toEqual([IVAN]);
    expect(store.refusal()).toBe(REFUSED);

    const third = store.load();
    await answer(2, rows([IVAN, ELENA]));
    await third;
    expect(store.members()).toEqual([IVAN, ELENA]);
    expect(store.refusal()).toBeNull();
  });

  it('drops an older read that lands after a newer one', async () => {
    const { store, answer } = harness();
    const older = store.load();
    const newer = store.load();

    await answer(1, rows([IVAN, ELENA]));
    await newer;
    await answer(0, rows([IVAN]));
    await older;

    expect(store.members()).toEqual([IVAN, ELENA]);
    expect(store.loading()).toBe(false);
  });

  describe('«Опитай пак» — a leaver’s owed sessions, ended now', () => {
    const STEFAN_ID = BarberId.of('stefan');

    it('sends END_SESSIONS for the leaver, says who is being ended meanwhile, and reads the list again once it lands', async () => {
      const editBarber = vi.fn(async () => Result.ok({ barberId: STEFAN_ID }));
      const { store, listTeam, answer } = harness(editBarber);
      const ending = store.endSessions(STEFAN_ID);
      expect(store.ending()).toBe(STEFAN_ID);
      await Promise.resolve();
      await Promise.resolve();
      expect(editBarber).toHaveBeenCalledWith({
        barberEdit: BarberEdit.EndSessions,
        barberId: STEFAN_ID,
        operationId: 'operation-000001',
      });
      await answer(0, rows(TEAM));
      await ending;
      expect(store.ending()).toBeNull();
      expect(store.endRefusal()).toBeNull();
      expect(listTeam).toHaveBeenCalledTimes(1);
    });

    it('keeps the refusal beside the leaver when the sessions cannot be ended yet — nothing read again', async () => {
      const refused = PipelineError.fromWire('functions/unavailable', {
        errorCode: 'TEAM_SESSIONS_NOT_ENDED',
        barberId: 'stefan',
      });
      const { store, listTeam } = harness(async () => Result.err(refused));
      await store.endSessions(STEFAN_ID);
      expect(store.ending()).toBeNull();
      expect(store.endRefusal()).toEqual({
        barberId: STEFAN_ID,
        error: refused,
      });
      expect(listTeam).not.toHaveBeenCalled();
    });
  });
});
