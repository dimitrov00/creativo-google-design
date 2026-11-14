import {
  type EnvironmentProviders,
  Injectable,
  type Provider,
  signal,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import {
  type PermissionsCall,
  type Role,
  StaffPermissions,
  type TeamCall,
  type TeamMember,
} from '@core/components';
import type { PipelineError } from '@core/errors';
import type { TeamAdminPorts } from '@core/ports';
import { AccessScope, Result, type StaffCapability } from '@core/primitives';
import { StaffAccessSystem } from '@core/systems';
import { FIXTURE_NOW_UTC_MS, FIXTURE_TIME_ZONE } from '@core/testing';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import {
  CLOCK_PORTS,
  ShopZoneService,
  TEAM_ADMIN_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { catalogueOf } from './catalogue.spec-support';

/*
 * The Team screens' test bed: the app's real catalogue behind Transloco,
 * the two calls scripted, and the session's access answered from the roles
 * and the cells a spec hands in — through the engine's own rule, so a spec
 * can move a cell and see the page follow. Specs only.
 */

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg') as Translation);
  }
}

/** What a spec's session is: who is looking, and what the owner has saved. */
export type TeamBedOptions = {
  /** The stored roles of whoever is looking; the owner's unless told. */
  readonly roles?: readonly Role[];
  /** The saved cells; every default unless told. */
  readonly stored?: Record<string, unknown>;
  /** What `listTeam` answers; a refusal when given one. */
  readonly members?: readonly TeamMember[];
  readonly listRefusal?: PipelineError;
  /** What `setStaffPermissions` answers when it refuses. */
  readonly saveRefusal?: PipelineError;
};

export function teamBed(options: TeamBedOptions = {}) {
  const roles = signal<readonly Role[]>(options.roles ?? ['admin']);
  const permissions = signal(StaffPermissions.read(options.stored ?? {}));
  const listed: TeamCall.ListRequest[] = [];
  const saves: PermissionsCall[] = [];
  let listAnswer: () => Result<TeamCall.Listed, PipelineError> = () =>
    options.listRefusal === undefined
      ? Result.ok({ members: options.members ?? [] })
      : Result.err(options.listRefusal);
  let saveRefusal = options.saveRefusal ?? null;

  const ports: TeamAdminPorts = {
    listTeam: async (request) => {
      listed.push(request);
      return listAnswer();
    },
    setStaffPermissions: async (call) => {
      saves.push(call);
      return saveRefusal === null
        ? Result.ok({ changes: [] })
        : Result.err(saveRefusal);
    },
  };

  const scopeOf = (staffCapability: StaffCapability): AccessScope =>
    StaffAccessSystem.scopeOf(permissions(), staffCapability, roles());

  const providers: (Provider | EnvironmentProviders)[] = [
    provideRouter([]),
    ...provideTransloco({
      config: {
        availableLangs: ['bg', 'en'],
        defaultLang: 'bg',
        fallbackLang: 'bg',
        missingHandler: { logMissingKey: false },
      },
      loader: CatalogueLoader,
    }),
    { provide: TEAM_ADMIN_PORTS, useValue: ports },
    {
      provide: StaffAccessService,
      useValue: {
        permissions,
        scopeOf,
        editsPermissions: () => roles().includes('admin'),
      },
    },
    {
      provide: TeamCatalogService,
      useValue: { watchTeam: () => undefined, teamBarberVms: signal([]) },
    },
    { provide: CLOCK_PORTS, useValue: { nowUtcMs: () => FIXTURE_NOW_UTC_MS } },
    {
      provide: ShopZoneService,
      useValue: { defaultZone: () => signal(FIXTURE_TIME_ZONE) },
    },
  ];

  return {
    providers,
    /** Every `listTeam` request, in order. */
    listed,
    /** Every `setStaffPermissions` call, in order. */
    saves,
    /** The live cells move, as the listener would say after a save. */
    liveCells: (stored: Record<string, unknown>) =>
      permissions.set(StaffPermissions.read(stored)),
    /** Whoever is looking changes. */
    lookingAs: (next: readonly Role[]) => roles.set(next),
    /** The next `listTeam` answers these rows. */
    listAnswers: (members: readonly TeamMember[]) => {
      listAnswer = () => Result.ok({ members });
    },
    /** The next save refuses, or lands again. */
    saveRefuses: (refusal: PipelineError | null) => {
      saveRefusal = refusal;
    },
  };
}
