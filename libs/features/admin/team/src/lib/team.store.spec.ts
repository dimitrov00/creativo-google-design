import { TestBed } from '@angular/core/testing';
import type { TeamCall, TeamMember } from '@core/components';
import { PipelineError } from '@core/errors';
import type { TeamAdminPorts } from '@core/ports';
import { Result } from '@core/primitives';
import { TEAM_ADMIN_PORTS } from '@creativo/infrastructure/firebase-app';
import { LoadState } from '@creativo/shared/view-state';
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
function harness() {
  const pending: ((answer: Listed) => void)[] = [];
  const listTeam = vi.fn(
    () => new Promise<Listed>((resolve) => pending.push(resolve)),
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: TEAM_ADMIN_PORTS,
        useValue: {
          listTeam,
          setStaffPermissions: async () => Result.ok({ changes: [] }),
        } satisfies TeamAdminPorts,
      },
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
});
