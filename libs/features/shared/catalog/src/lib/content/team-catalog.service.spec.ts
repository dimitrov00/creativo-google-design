import { TestBed } from '@angular/core/testing';
import { NEVER, Subject } from 'rxjs';
import {
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
  TEAM_BARBER_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { BarberStatus } from '@core/components';
import type { Barber } from '@core/entities';
import { BarberId, Result, ServiceId } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import {
  barberFixture,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TERMS,
  memoryCatalogReadPorts,
  memoryMediaResolvePorts,
  serviceFixture,
} from '@core/testing';
import { CatalogContentService } from './catalog-content.service';
import { TeamCatalogService } from './team-catalog.service';

const ivan: Barber = barberFixture({ id: BarberId.of('ivan'), sortOrder: 1 });
const fade = serviceFixture({
  id: ServiceId.of('svc-fade'),
  offerings: [{ barberId: ivan.id, overrides: [], ...FIXTURE_TERMS }],
});

describe('TeamCatalogService — the barbers off the public list (team onboarding D3)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const student = barberFixture(
    { id: BarberId.of('student'), sortOrder: 2 },
    {
      barberStatus: BarberStatus.StaffOnly,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
    },
  );
  const gone = barberFixture(
    { id: BarberId.of('gone'), sortOrder: 3 },
    {
      barberStatus: BarberStatus.Departed,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      barberDepartedUserId: null,
      barberSessionsRevokedAtUtcMs: null,
      barberRehireStatus: BarberStatus.Public,
    },
  );
  const draft = barberFixture(
    { id: BarberId.of('draft'), sortOrder: 4 },
    {
      barberStatus: BarberStatus.Draft,
      barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
      barberDraftTargetStatus: BarberStatus.Public,
    },
  );

  function withTeam(options: {
    readonly team?: Subject<Result<readonly Barber[], RepositoryError>>;
    readonly lookup?: (ids: readonly BarberId[]) => readonly Barber[];
    readonly asked?: BarberId[][];
  }): TeamCatalogService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CATALOG_PORTS,
          useValue: memoryCatalogReadPorts({
            services: [fade],
            barbers: [ivan],
          }),
        },
        { provide: MEDIA_RESOLVE_PORTS, useValue: memoryMediaResolvePorts() },
        {
          provide: TEAM_BARBER_PORTS,
          useValue: {
            observeTeamBarbers: () => options.team?.asObservable() ?? NEVER,
            loadBarbers: async (ids: readonly BarberId[]) => {
              options.asked?.push([...ids]);
              return Result.ok(options.lookup?.(ids) ?? []);
            },
          },
        },
      ],
    });
    return TestBed.inject(TeamCatalogService);
  }

  it('reads nobody but the public list until a staff surface asks for the team', () => {
    const team = new Subject<Result<readonly Barber[], RepositoryError>>();
    const content = withTeam({ team });
    expect(team.observed).toBe(false);
    expect(content.teamBarbers()).toEqual([ivan]);

    content.watchTeam();
    content.watchTeam();
    expect(team.observed).toBe(true);
    // The public list stands until the team answers.
    expect(content.teamKnown()).toBe(false);
    expect(content.liveBarbers()).toEqual([ivan]);
  });

  it('splits the team by who works, who is current and who has worked', () => {
    const team = new Subject<Result<readonly Barber[], RepositoryError>>();
    const content = withTeam({ team });
    content.watchTeam();
    team.next(Result.ok([ivan, student, gone, draft]));

    expect(content.teamKnown()).toBe(true);
    expect(content.teamBarbers()).toEqual([ivan, student, gone, draft]);
    expect(content.liveBarbers()).toEqual([ivan, student]);
    expect(content.currentBarbers()).toEqual([ivan, student, draft]);
    expect(content.workedBarbers()).toEqual([ivan, student, gone]);
    expect(content.liveBarberVms().map((vm) => vm.id)).toEqual([
      ivan.id,
      student.id,
    ]);
    // The client-facing list is untouched.
    expect(TestBed.inject(CatalogContentService).barbers()).toEqual([ivan]);
  });

  it('names a past visit’s barber who is on no list by id, asking once each', async () => {
    const asked: BarberId[][] = [];
    const content = withTeam({
      lookup: (ids) =>
        [gone, student].filter((barber) => ids.includes(barber.id)),
      asked,
    });

    content.rememberBarbers([ivan.id, gone.id, student.id]);
    content.rememberBarbers([gone.id]);
    await Promise.resolve();
    await Promise.resolve();

    // Ivan is on the public list; the other two were asked once, together.
    expect(asked).toEqual([[gone.id, student.id]]);
    expect(content.namedBarberVms().map((vm) => vm.id)).toEqual([
      ivan.id,
      gone.id,
      student.id,
    ]);
  });
});
