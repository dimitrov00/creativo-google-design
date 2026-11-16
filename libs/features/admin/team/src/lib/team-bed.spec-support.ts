import {
  type EnvironmentProviders,
  Injectable,
  type Provider,
  computed,
  signal,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, type Observable, map, of } from 'rxjs';
import {
  BarberActivation,
  BarberLifecycle,
  type PermissionsCall,
  type Role,
  type RolesCall,
  StaffPermissions,
  StaffSetupItem,
  type TeamCall,
  type TeamMember,
} from '@core/components';
import type {
  Appointment,
  Barber,
  BarberSchedule,
  Service,
  ShopLocation,
  User,
} from '@core/entities';
import { MediaError, type PipelineError, RepositoryError } from '@core/errors';
import type {
  BarberAheadPorts,
  GatewayPorts,
  RolesAdminPorts,
  SchedulingReadPorts,
  StagedUploadPorts,
  TeamAdminPorts,
  TeamRecordPorts,
  UserSearchPorts,
} from '@core/ports';
import {
  AccessScope,
  BarberBusyDayId,
  BarberId,
  BusyKey,
  type LocalDate,
  Result,
  type StaffCapability,
  UserId,
} from '@core/primitives';
import { StaffAccessSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  barberBusyDayFixture,
} from '@core/testing';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  TeamCatalogService,
} from '@creativo/features/shared/catalog';
import {
  AUTH_DEPLOYMENT_PORTS,
  BARBER_AHEAD_PORTS,
  CLOCK_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
  PROFILE_PORTS,
  ROLES_ADMIN_PORTS,
  SCHEDULING_READ_PORTS,
  ShopZoneService,
  STAGED_UPLOAD_PORTS,
  TEAM_ADMIN_PORTS,
  USER_SEARCH_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { catalogueOf } from './catalogue.spec-support';

/*
 * The Team screens' test bed: the app's real catalogue behind Transloco,
 * every call scripted and recorded, the staff's live reads held in signals
 * a spec can move, and the session's access answered from the roles, the
 * link and the cells a spec hands in — through the engine's own rules, so
 * a spec can move a cell and see the page follow. Specs only.
 */

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg') as Translation);
  }
}

/** What a spec's session is: who is looking, and what the shop holds. */
export type TeamBedOptions = {
  /** The stored roles of whoever is looking; the owner's unless told. */
  readonly roles?: readonly Role[];
  /** Their account; the owner's unless told. */
  readonly userId?: UserId;
  /** The barber record their account is linked to; none unless told. */
  readonly linkedBarberId?: BarberId | null;
  /** The saved cells; every default unless told. */
  readonly stored?: Record<string, unknown>;
  /** What `listTeam` answers; a refusal when given one. */
  readonly members?: readonly TeamMember[];
  readonly listRefusal?: PipelineError;
  /** What `setStaffPermissions` answers when it refuses. */
  readonly saveRefusal?: PipelineError;
  /** The barber records the staff's team stream holds. */
  readonly barbers?: readonly Barber[];
  /** The catalogue's services. */
  readonly services?: readonly Service[];
  /** The rosters, by their barber's id. */
  readonly schedules?: readonly BarberSchedule[];
  /** The catalogue's shops. */
  readonly locations?: readonly ShopLocation[];
  /** What the accounts' index answers a lookup, whatever is asked. */
  readonly accounts?: readonly User[];
  /** The stored accounts one read by id answers (`loadProfile`); none by default. */
  readonly profiles?: readonly User[];
  /** The visits the shop holds — what lies ahead of a barber is read from them. */
  readonly visits?: readonly Appointment[];
  /** The reads of what lies ahead of a barber fail. */
  readonly aheadFails?: boolean;
};

/** The call a barber record's write made, by its port. */
export type RecordCalls = {
  readonly adds: TeamCall[];
  readonly edits: TeamCall.Edit[];
  readonly offerings: TeamCall.Offerings[];
  readonly deletes: TeamCall.Named[];
  readonly activations: TeamCall.Named[];
  readonly roles: RolesCall[];
  /** Every call dialled through the gateway by name — the hours' `setRosterWeek`. */
  readonly dialled: { readonly callable: string; readonly input: unknown }[];
  /** Every prefix the accounts' index was asked, in order. */
  readonly searched: string[];
  /** Every `setBarberPhoto` call, in order. */
  readonly photos: TeamCall.Photo[];
  /** Every read of what lies ahead of a barber: whose, from which day on. */
  readonly aheadAsked: {
    readonly barberId: BarberId;
    readonly fromLocalDate: LocalDate;
  }[];
  /** Every picture staged, in order: whose folder, under which name, how many bytes of what. */
  readonly staged: {
    readonly userId: UserId;
    readonly stagedName: string;
    readonly contentType: string;
    readonly size: number;
  }[];
};

/** A record's writes for a spec that makes none: each one fails the spec that calls it. */
export const UNUSED_RECORD_PORTS: TeamRecordPorts = {
  addBarber: () => Promise.reject(new Error('addBarber was not expected')),
  editBarber: () => Promise.reject(new Error('editBarber was not expected')),
  setBarberOfferings: () =>
    Promise.reject(new Error('setBarberOfferings was not expected')),
  deleteDraftBarber: () =>
    Promise.reject(new Error('deleteDraftBarber was not expected')),
  activateBarber: () =>
    Promise.reject(new Error('activateBarber was not expected')),
  setBarberPhoto: () =>
    Promise.reject(new Error('setBarberPhoto was not expected')),
};

/** A barber as the catalogue's services hand it to a face. */
function faceOf(barber: Barber) {
  return {
    id: barber.id,
    name: barber.name,
    title: barber.title,
    bio: barber.bio,
    avatarSrc: '',
    objectPosition: '',
  };
}

export function teamBed(options: TeamBedOptions = {}) {
  const roles = signal<readonly Role[]>(options.roles ?? ['admin']);
  const linked = signal<BarberId | null>(options.linkedBarberId ?? null);
  const userId = options.userId ?? UserId.of('u-owner');
  const permissions = signal(StaffPermissions.read(options.stored ?? {}));
  const barbers = signal<readonly Barber[]>(options.barbers ?? []);
  const services = signal<readonly Service[]>(options.services ?? []);
  const locations = signal<readonly ShopLocation[]>(options.locations ?? []);
  const schedules = new BehaviorSubject<readonly BarberSchedule[]>(
    options.schedules ?? [],
  );
  const listed: TeamCall.ListRequest[] = [];
  const saves: PermissionsCall[] = [];
  const calls: RecordCalls = {
    adds: [],
    edits: [],
    offerings: [],
    deletes: [],
    activations: [],
    roles: [],
    dialled: [],
    searched: [],
    photos: [],
    aheadAsked: [],
    staged: [],
  };
  let listAnswer: () => Result<TeamCall.Listed, PipelineError> = () =>
    options.listRefusal === undefined
      ? Result.ok({ members: options.members ?? [] })
      : Result.err(options.listRefusal);
  let saveRefusal = options.saveRefusal ?? null;
  /** What a record's write refuses with, by its port's name; none unless told. */
  const refusals = new Map<keyof TeamAdminPorts, PipelineError>();
  let activation: BarberActivation = BarberActivation.Unchanged;
  let minted = 0;

  const saved = (
    port: keyof TeamAdminPorts,
    barberId: BarberId,
  ): Result<TeamCall.Saved, PipelineError> => {
    const refusal = refusals.get(port);
    return refusal === undefined
      ? Result.ok({ barberId })
      : Result.err(refusal);
  };

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
    addBarber: async (call) => {
      calls.adds.push(call);
      // The act's name IS the new record's id.
      return saved('addBarber', BarberId.of(call.operationId));
    },
    editBarber: async (call) => {
      calls.edits.push(call);
      return saved('editBarber', call.barberId);
    },
    setBarberOfferings: async (call) => {
      calls.offerings.push(call);
      return saved('setBarberOfferings', call.barberId);
    },
    deleteDraftBarber: async (call) => {
      calls.deletes.push(call);
      return saved('deleteDraftBarber', call.barberId);
    },
    setBarberPhoto: async (call) => {
      calls.photos.push(call);
      return saved('setBarberPhoto', call.barberId);
    },
    activateBarber: async (call) => {
      calls.activations.push(call);
      const refusal = refusals.get('activateBarber');
      if (refusal !== undefined) return Result.err(refusal);
      return Result.ok(
        activation === BarberActivation.NotReady
          ? {
              barberId: call.barberId,
              barberActivation: activation,
              staffSetupItem: StaffSetupItem.Hours,
            }
          : { barberId: call.barberId, barberActivation: activation },
      );
    },
  };

  let rolesRefusal: PipelineError | null = null;
  const rolesPorts: RolesAdminPorts = {
    setRoles: async (call) => {
      calls.roles.push(call);
      if (rolesRefusal !== null) return Result.err(rolesRefusal);
      // The viewer's own stored account moves, as the listener would say;
      // someone else's change is theirs, and reaches the page through the
      // Team list.
      if (call.targetUserId === userId) {
        roles.set(call.roles);
        linked.set(call.linkedBarberId);
      }
      return Result.ok({
        targetUserId: call.targetUserId,
        roles: call.roles,
        rolesChanged: true,
        linkedBarberId: call.linkedBarberId,
        linkChanged: true,
      });
    },
  };

  /** What a call dialled by name refuses with; none unless told. */
  const dialRefusals = new Map<string, PipelineError>();
  const gateway = {
    callableClient: (callable: string) => async (input: unknown) => {
      calls.dialled.push({ callable, input });
      const refusal = dialRefusals.get(callable);
      return refusal === undefined ? Result.ok({}) : Result.err(refusal);
    },
  } as unknown as GatewayPorts;

  let stagingFails = false;
  const staging: StagedUploadPorts = {
    stageUpload: async (stagedUserId, stagedName, image) => {
      if (stagingFails) return Result.err(MediaError.transient('staffUploads'));
      calls.staged.push({
        userId: stagedUserId,
        stagedName,
        contentType: image.type,
        size: image.size,
      });
      return Result.ok(undefined);
    },
  };

  let searchFails = false;
  const userSearch: UserSearchPorts = {
    searchUsers: async (prefix) => {
      calls.searched.push(prefix);
      return searchFails
        ? Result.err(RepositoryError.readFailed(null, null))
        : Result.ok(options.accounts ?? []);
    },
  };

  const scopeOf = (staffCapability: StaffCapability): AccessScope =>
    StaffAccessSystem.scopeOf(permissions(), staffCapability, roles());

  const scheduling = {
    observeSchedule: (barberId: BarberId) =>
      schedules.pipe(
        map((all) =>
          Result.ok(all.find((roster) => roster.id === barberId) ?? null),
        ),
      ),
  } as unknown as SchedulingReadPorts;

  /**
   * What lies ahead of a barber, over the bed's visits: a busy day for
   * each day a visit seats them on, and that day's visits by its key.
   */
  const visits = options.visits ?? [];
  const aheadFailure = RepositoryError.readFailed('appointments', 'denied');
  const ahead: BarberAheadPorts = {
    loadBusyDaysFrom: async (barberId, fromLocalDate) => {
      calls.aheadAsked.push({ barberId, fromLocalDate });
      if (options.aheadFails === true) return Result.err(aheadFailure);
      const days = [
        ...new Set(
          visits
            .filter(
              (visit) =>
                visit.barberIds.includes(barberId) &&
                visit.localDate >= fromLocalDate,
            )
            .map((visit) => visit.localDate),
        ),
      ].sort();
      return Result.ok(
        days.map((localDate) =>
          barberBusyDayFixture({
            id: BarberBusyDayId.of(BusyKey.of(barberId, localDate)),
            barberId,
            localDate,
          }),
        ),
      );
    },
    loadBarberDay: async (key) =>
      Result.ok(visits.filter((visit) => visit.busyKeys.includes(key))),
  };

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
    { provide: ROLES_ADMIN_PORTS, useValue: rolesPorts },
    { provide: GATEWAY_PORTS, useValue: gateway },
    { provide: SCHEDULING_READ_PORTS, useValue: scheduling },
    { provide: USER_SEARCH_PORTS, useValue: userSearch },
    {
      provide: PROFILE_PORTS,
      useValue: {
        loadProfile: async (userId: UserId) =>
          Result.ok(
            (options.profiles ?? []).find((user) => user.id === userId) ?? null,
          ),
        observeProfile: () => of(Result.ok(null)),
      },
    },
    { provide: BARBER_AHEAD_PORTS, useValue: ahead },
    { provide: STAGED_UPLOAD_PORTS, useValue: staging },
    {
      provide: AUTH_DEPLOYMENT_PORTS,
      useValue: { authDeployment: { defaultCountry: 'BG' } },
    },
    {
      provide: ID_PORTS,
      useValue: {
        nextId: () => `operation-${String(++minted).padStart(6, '0')}`,
      },
    },
    {
      provide: StaffAccessService,
      useValue: {
        permissions,
        storedRoles: roles,
        linkedBarberId: linked,
        scopeOf,
        mayFor: (staffCapability: StaffCapability, barberId: BarberId) =>
          StaffAccessSystem.reaches(
            {
              accessScope: scopeOf(staffCapability),
              linkedBarberId: linked(),
            },
            barberId,
          ),
        editsPermissions: () => roles().includes('admin'),
      },
    },
    { provide: AccountStateService, useValue: { userId: signal(userId) } },
    {
      provide: TeamCatalogService,
      useValue: {
        watchTeam: () => undefined,
        teamBarbers: barbers,
        teamKnown: signal(true),
        teamBarberVms: computed(() => barbers().map(faceOf)),
        liveBarberVms: computed(() =>
          barbers().filter(BarberLifecycle.isLive).map(faceOf),
        ),
        findTeamBarberVm: (barberId: BarberId) => {
          const barber = barbers().find((record) => record.id === barberId);
          return barber === undefined ? undefined : faceOf(barber);
        },
        findTeamBarber: (barberId: BarberId) =>
          barbers().find((record) => record.id === barberId),
      },
    },
    {
      provide: CatalogContentService,
      useValue: {
        allServices: services,
        findAnyService: (serviceId: string) =>
          services().find((service) => service.id === serviceId),
        locations,
        servicesKnown: signal(true),
      },
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
    /** Every call a barber record's write made, by its port. */
    calls,
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
    /** A record's write refuses from now on, or lands again. */
    refuses: (port: keyof TeamAdminPorts, refusal: PipelineError | null) => {
      if (refusal === null) refusals.delete(port);
      else refusals.set(port, refusal);
    },
    /** A call dialled by name refuses from now on, or lands again. */
    dialRefuses: (callable: string, refusal: PipelineError | null) => {
      if (refusal === null) dialRefusals.delete(callable);
      else dialRefusals.set(callable, refusal);
    },
    /** Staging a picture fails from now on, or works again. */
    stagingFails: (fails: boolean) => {
      stagingFails = fails;
    },
    /** The accounts' index cannot be read from now on, or answers again. */
    searchFails: (fails: boolean) => {
      searchFails = fails;
    },
    /** `setRoles` refuses from now on, or lands again. */
    rolesRefuse: (refusal: PipelineError | null) => {
      rolesRefusal = refusal;
    },
    /** What the go-live step answers from now on. */
    activates: (answer: BarberActivation) => {
      activation = answer;
    },
    /** The team stream says these records, as the listener would. */
    liveBarbers: (next: readonly Barber[]) => barbers.set(next),
    /** The catalogue says these services. */
    liveServices: (next: readonly Service[]) => services.set(next),
    /** The rosters say these, as the listener would. */
    liveSchedules: (next: readonly BarberSchedule[]) => schedules.next(next),
  };
}
