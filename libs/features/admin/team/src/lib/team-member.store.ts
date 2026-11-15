import {
  Injectable,
  type WritableSignal,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import {
  BarberActivation,
  BarberEdit,
  type BarberEditRequest,
  type BarberLifecycle,
  type BarberOffering,
  BarberStatus,
  OfferingsEdit,
  RecordClaim,
  type Role,
  type RolesCall,
  type RosterCall,
} from '@core/components';
import type { Barber, BarberSchedule, ShopLocation } from '@core/entities';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { Callables, type ObserveSchedule } from '@core/ports';
import {
  AccessScope,
  type BarberId,
  ClientOperationId,
  type LocalDate,
  type LocationId,
  type Result,
  StaffCapability,
  type UserId,
} from '@core/primitives';
import {
  type BarberProfileInput,
  LocationScopeSystem,
  OfferingPriceSystem,
  type RecordViewer,
  RoleAssignmentSystem,
  StaffSetupSystem,
  TeamRosterSystem,
  TeamSystem,
} from '@core/systems';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  TeamCatalogService,
} from '@creativo/features/shared/catalog';
import {
  GATEWAY_PORTS,
  ID_PORTS,
  SCHEDULING_READ_PORTS,
  TEAM_ADMIN_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { TeamRolesStore } from './team-roles.store';
import { TeamStore } from './team.store';

/**
 * ONE TEAM MEMBER, LIVE (team onboarding D5, D8, D9; staff permissions P9):
 * the barber record off the staff's team stream, what it still needs
 * (`StaffSetupSystem.checklistOf` over the live record, services and
 * roster, so a save made anywhere redraws the checklist), the account the
 * Team list read beside it, and the calls the page makes.
 *
 * Provided by the member's page: one record per visit. Every write is a
 * callable; a save answers `true` when it landed and keeps its refusal for
 * the page when it did not. The go-live step is asked by itself the moment
 * a record in preparation shows every needed item done — when the page
 * opens on one, or after a save completes it.
 */
@Injectable()
export class TeamMemberStore {
  private readonly ports = inject(TEAM_ADMIN_PORTS);
  private readonly roles = inject(TeamRolesStore);
  private readonly gateway = inject(GATEWAY_PORTS);
  private readonly ids = inject(ID_PORTS);
  private readonly scheduling = inject(SCHEDULING_READ_PORTS);
  private readonly catalog = inject(TeamCatalogService);
  private readonly content = inject(CatalogContentService);
  private readonly team = inject(TeamStore);
  private readonly access = inject(StaffAccessService);
  private readonly account = inject(AccountStateService);

  private readonly _barberId = signal<BarberId | null>(null);
  private readonly _pending = signal(false);
  private readonly _refusal = signal<PipelineError | null>(null);
  private readonly _hoursRefusal = signal<PipelineError | null>(null);
  private readonly _wentLive = signal(false);
  /** The record the go-live step was last asked for: one ask per ready record. */
  private askedLive: BarberId | null = null;

  /** The record the page is on. */
  readonly barberId = this._barberId.asReadonly();

  /** The record, live; `undefined` while the team is unread or holds no such record. */
  readonly barber = computed<Barber | undefined>(() => {
    const barberId = this._barberId();
    return barberId === null
      ? undefined
      : this.catalog.teamBarbers().find((barber) => barber.id === barberId);
  });

  /** The team read has answered: a record it does not hold is really not there. */
  readonly known = this.catalog.teamKnown;

  private readonly rosterAnswer = toSignal(
    toObservable(this._barberId).pipe(
      switchMap((barberId) =>
        barberId === null
          ? of(undefined)
          : this.scheduling.observeSchedule(barberId),
      ),
    ),
  );

  /** The roster's read has answered. */
  private readonly rosterKnown = computed(
    () => this.rosterAnswer()?.ok === true,
  );

  /** The record's roster as read; `null` while unread, and for a record with none. */
  readonly roster = computed<BarberSchedule | null>(() => {
    const roster = this.rosterAnswer();
    return roster?.ok === true ? roster.value : null;
  });

  /** What the record still needs; `null` while there is no record. */
  readonly checklist = computed(() => {
    const barber = this.barber();
    const roster = this.rosterAnswer();
    return barber === undefined
      ? null
      : StaffSetupSystem.checklistOf(
          barber,
          this.content.allServices(),
          roster?.ok === true ? roster.value : null,
        );
  });

  /** How many of the needed items are done. */
  readonly doneCount = computed(() => {
    const checklist = this.checklist();
    return checklist === null ? 0 : StaffSetupSystem.doneCountOf(checklist);
  });

  /** How many services list the barber. */
  readonly servicesCount = computed(() => {
    const barberId = this._barberId();
    return barberId === null
      ? 0
      : OfferingPriceSystem.performedCount(
          this.content.allServices(),
          barberId,
        );
  });

  /** The shops the record works at, in the catalogue's order. */
  readonly shops = computed<readonly ShopLocation[]>(() => {
    const barber = this.barber();
    return barber === undefined
      ? []
      : this.content
          .locations()
          .filter((shop) =>
            LocationScopeSystem.servesLocation(barber, shop.id),
          );
  });

  /** The record names no shop of its own: it works at every one. */
  readonly everyShop = computed(() => {
    const barber = this.barber();
    return barber !== undefined && LocationScopeSystem.homeOf(barber) === null;
  });

  /** There are shops to tell apart. */
  readonly multiShop = computed(() =>
    LocationScopeSystem.isMultiShop(this.content.locations().length),
  );

  /** The Team list's row for the record: the account beside it. */
  readonly member = computed(() => {
    const barberId = this._barberId();
    return barberId === null
      ? null
      : TeamRosterSystem.recordOf(this.team.members() ?? [], barberId);
  });

  /** The person looking, as their stored account says. */
  private readonly viewer = computed<RecordViewer>(() => ({
    userId: this.account.userId(),
    linkedBarberId: this.access.linkedBarberId(),
    assignsRoles: this.access.editsPermissions(),
  }));

  /** Whose record it is to the person looking. */
  readonly recordClaim = computed<RecordClaim>(() => {
    const member = this.member();
    return member === null
      ? RecordClaim.None
      : TeamRosterSystem.claimOf(member, this.viewer());
  });

  /** They may link someone's account to the record («Свържи профил»). */
  readonly linksAccount = computed(() => {
    const member = this.member();
    return (
      member !== null && TeamRosterSystem.linksAccount(member, this.viewer())
    );
  });

  /** They may release the account linked to it («Разкачи профила»). */
  readonly releasesAccount = computed(() => {
    const member = this.member();
    return (
      member !== null && TeamRosterSystem.releasesAccount(member, this.viewer())
    );
  });

  /** The team's own accounts a record may be linked to without a lookup. */
  readonly unlinked = computed(() =>
    TeamRosterSystem.unlinkedOf(
      this.team.members() ?? [],
      this.account.userId(),
    ),
  );

  /** The record still takes edits: one that has left takes none. */
  private readonly editable = computed(() => {
    const barber = this.barber();
    return barber !== undefined && TeamSystem.editable(barber).ok;
  });

  /** The person looking manages the team: the accounts were read for them. */
  readonly managesTeam = computed(
    () => this.access.scopeOf(StaffCapability.TeamManage) !== AccessScope.None,
  );

  /** They may edit this record's profile. */
  readonly mayEditProfile = computed(() => {
    const barberId = this._barberId();
    return (
      barberId !== null &&
      this.editable() &&
      this.access.mayFor(StaffCapability.TeamProfiles, barberId)
    );
  });

  /** They may change this record's period, pool and access. */
  readonly mayManage = computed(() => {
    const barberId = this._barberId();
    return (
      barberId !== null &&
      this.editable() &&
      this.access.mayFor(StaffCapability.TeamManage, barberId)
    );
  });

  /** They may set what this record performs, and at what price. */
  readonly mayEditOfferings = computed(() => {
    const barberId = this._barberId();
    return (
      barberId !== null &&
      this.editable() &&
      this.access.mayFor(StaffCapability.TeamOfferings, barberId)
    );
  });

  /** They may change this record's weekly hours. */
  readonly mayEditHours = computed(() => {
    const barberId = this._barberId();
    return (
      barberId !== null &&
      this.editable() &&
      this.access.mayFor(StaffCapability.Hours, barberId)
    );
  });

  /**
   * The shop a new shift of the record is worked at: its own first shop,
   * else the catalogue's first for a record that works everywhere.
   */
  readonly homeShop = computed<LocationId | null>(() =>
    LocationScopeSystem.homeOrFirst(
      this.barber() ?? null,
      this.content.locations(),
    ),
  );

  /** They may delete it: a record that never went live, and they manage the team. */
  readonly deletable = computed(() => {
    const barber = this.barber();
    return (
      barber !== undefined &&
      this.managesTeam() &&
      TeamSystem.removable(barber).ok
    );
  });

  /**
   * In the «Който и да е» pool, as the page shows it: the record's own
   * answer, and the one just asked for until the record says it back.
   */
  readonly poolOn = linkedSignal(
    () => this.barber()?.barberJoinsAnyPool ?? false,
  );

  /** Who may book the record, the same way; `null` once it has left. */
  readonly bookedBy = linkedSignal<BarberLifecycle.LiveStatus | null>(() => {
    const barber = this.barber();
    return barber === undefined ? null : TeamSystem.accessOf(barber);
  });

  /** A call is on its way — the record's own, or a link change. */
  readonly pending = computed(() => this._pending() || this.roles.pending());

  /** Why the last call was refused; `null` when it was not. */
  readonly refusal = computed(() => this._refusal() ?? this.roles.refusal());

  /** Why the hours' last save was refused — the hours sheet's own line. */
  readonly hoursRefusal = this._hoursRefusal.asReadonly();

  /** The record has just gone live — said once. */
  readonly wentLive = this._wentLive.asReadonly();

  /** A link change landed, but that person's sessions were not ended: the page offers the retry. */
  readonly sessionsPending = this.roles.sessionsPending;

  constructor() {
    // THE GO-LIVE STEP (team onboarding D9): asked once for a record in
    // preparation that shows every needed item done, on reads that have
    // really answered — so an unread roster is never taken for "no hours"
    // and never for "ready" either. It writes nothing this effect reads.
    effect(() => {
      const barber = this.barber();
      const checklist = this.checklist();
      if (
        barber === undefined ||
        checklist === null ||
        barber.barberStatus !== BarberStatus.Draft ||
        !checklist.ready
      ) {
        this.askedLive = null;
        return;
      }
      if (!this.content.servicesKnown() || !this.rosterKnown()) return;
      if (this.askedLive === barber.id) return;
      this.askedLive = barber.id;
      untracked(() => void this.goLive(barber.id));
    });
  }

  /** The page opens on a record: its refusal and receipt are another record's no more. */
  open(barberId: BarberId | null): void {
    if (barberId === untracked(this._barberId)) return;
    this._barberId.set(barberId);
    this._refusal.set(null);
    this._wentLive.set(false);
    this.roles.reset();
  }

  /** The profile, whole: the name, the title, the few words, Instagram, the experience. */
  saveProfile(profile: BarberProfileInput): Promise<boolean> {
    return this.edit({ barberEdit: BarberEdit.Profile, ...profile });
  }

  /** The working period: the start day and the last working day. */
  savePeriod(
    barberStartsLocalDate: LocalDate,
    barberLastWorkingLocalDate: LocalDate | null,
  ): Promise<boolean> {
    return this.edit({
      barberEdit: BarberEdit.Period,
      barberStartsLocalDate,
      barberLastWorkingLocalDate,
    });
  }

  /** The shops the record works at, whole: `[]` is every shop. */
  saveShops(locationIds: readonly LocationId[]): Promise<boolean> {
    return this.edit({ barberEdit: BarberEdit.Shops, locationIds });
  }

  /**
   * «Услуги и цени»: the COMPLETE list of what the record performs —
   * `setBarberOfferings`, ONE act: a service left out is no longer theirs.
   */
  async saveOfferings(
    offerings: readonly BarberOffering.Entry[],
  ): Promise<boolean> {
    const answer = await this.act((operationId, barberId) =>
      this.ports.setBarberOfferings({
        offeringsEdit: OfferingsEdit.Set,
        offerings,
        barberId,
        operationId,
      }),
    );
    return answer?.ok === true;
  }

  /** In or out of the «Който и да е» pool; the switch goes back when the call is refused. */
  async setPool(barberJoinsAnyPool: boolean): Promise<void> {
    this.poolOn.set(barberJoinsAnyPool);
    const saved = await this.edit({
      barberEdit: BarberEdit.Pool,
      barberJoinsAnyPool,
    });
    if (!saved) {
      this.poolOn.set(untracked(this.barber)?.barberJoinsAnyPool ?? false);
    }
  }

  /** Who may book the record; the answer goes back when the call is refused. */
  async setAccess(barberStatus: BarberLifecycle.LiveStatus): Promise<void> {
    this.bookedBy.set(barberStatus);
    const saved = await this.edit({
      barberEdit: BarberEdit.Access,
      barberStatus,
    });
    if (!saved) {
      const barber = untracked(this.barber);
      this.bookedBy.set(
        barber === undefined ? null : TeamSystem.accessOf(barber),
      );
    }
  }

  /** «Изтрий»: a record that never went live, removed. `true` once it is gone. */
  async remove(): Promise<boolean> {
    const answer = await this.act((operationId, barberId) =>
      this.ports.deleteDraftBarber({ barberId, operationId }),
    );
    if (answer?.ok !== true) return false;
    await this.team.load();
    return true;
  }

  /**
   * «Това съм аз» · «Не съм аз» (staff permissions P9): the owner's own
   * account takes the record, or gives it back. Nobody is signed out: the
   * stored account moves and the page follows it.
   */
  claim(mine: boolean): Promise<boolean> {
    const userId = this.account.userId();
    return userId === null
      ? Promise.resolve(false)
      : this.relink(userId, this.access.storedRoles(), mine);
  }

  /**
   * «Свържи профил» (team onboarding D8): someone's account becomes this
   * record's — their stored roles, as the lookup or the Team list read
   * them, plus `barber`. The server ends that person's sessions.
   */
  linkAccount(userId: UserId, storedRoles: readonly Role[]): Promise<boolean> {
    return this.relink(userId, storedRoles, true);
  }

  /** «Разкачи профила»: the account linked to the record is released from it. */
  releaseAccount(): Promise<boolean> {
    const member = this.member();
    return member === null || member.memberUserId === null
      ? Promise.resolve(false)
      : this.relink(member.memberUserId, member.memberRoles, false);
  }

  /** A chair's roster, live — what the hours sheet reads. */
  rosterOf(barberId: BarberId): ReturnType<ObserveSchedule> {
    return this.scheduling.observeSchedule(barberId);
  }

  /**
   * The hours sheet's save: the record's whole week from a day on —
   * `setRosterWeek`, ONE roster write on the server, which judges whose
   * hours the caller may change. Its refusal is the sheet's to say.
   */
  async setRosterWeek(week: RosterCall.WeekChange): Promise<boolean> {
    const answer = await this.act(
      (operationId) =>
        this.gateway.callableClient(Callables.SetRosterWeek)({
          ...week,
          operationId,
        }),
      this._hoursRefusal,
    );
    return answer?.ok === true;
  }

  /** The hours sheet closed: its refusal goes with it. */
  clearHoursRefusal(): void {
    this._hoursRefusal.set(null);
  }

  /** The receipt was read. */
  dismissLive(): void {
    this._wentLive.set(false);
  }

  /** The refusal was read, or the sheet it belonged to closed. */
  clearRefusal(): void {
    this._refusal.set(null);
    this.roles.clearRefusal();
  }

  /**
   * «Опитай пак» after a link change whose sessions were not ended: the
   * same change again. Nothing is written twice; the server ends them.
   */
  endSessions(): Promise<boolean> {
    return this.roles.endSessions();
  }

  /**
   * One account linked to the record on the page, or released from it —
   * `setRoles` with the set and the link `RoleAssignmentSystem.recordLinkOf`
   * answers. `true` once the change is WRITTEN, whether or not that
   * person's sessions were ended (`TeamRolesStore`).
   */
  private relink(
    targetUserId: UserId,
    storedRoles: readonly Role[],
    linked: boolean,
  ): Promise<boolean> {
    const barberId = this._barberId();
    if (barberId === null || this._pending()) return Promise.resolve(false);
    const change = RoleAssignmentSystem.recordLinkOf(
      storedRoles,
      linked ? barberId : null,
    );
    this._refusal.set(null);
    const call: RolesCall = {
      targetUserId,
      roles: change.roles,
      ...change.link,
    };
    return this.roles.send(call);
  }

  /** One part of the record, replaced whole. */
  private async edit(request: BarberEditRequest): Promise<boolean> {
    const answer = await this.act((operationId, barberId) =>
      this.ports.editBarber({ ...request, barberId, operationId }),
    );
    if (answer?.ok !== true) return false;
    // The row on the Team list words the same record.
    void this.team.load();
    return true;
  }

  /**
   * The go-live step. Quiet: a refusal or a "not ready" changes nothing on
   * the page — the record stays in preparation, which is the safe state,
   * and the next ready record asks again.
   */
  private async goLive(barberId: BarberId): Promise<void> {
    const operationId = ClientOperationId.parse(this.ids.nextId());
    if (!operationId.ok) return;
    const answer = await this.ports.activateBarber({
      barberId,
      operationId: operationId.value,
    });
    if (
      answer.ok &&
      answer.value.barberActivation === BarberActivation.Activated &&
      untracked(this._barberId) === barberId
    ) {
      this._wentLive.set(true);
      void this.team.load();
    }
  }

  /**
   * One named call for the record on the page, in flight once; its refusal
   * kept where the one who made it reads it — the page's, unless told.
   */
  private async act<T>(
    dial: (
      operationId: ClientOperationId,
      barberId: BarberId,
    ) => Promise<Result<T, PipelineError>>,
    refused: WritableSignal<PipelineError | null> = this._refusal,
  ): Promise<Result<T, PipelineError> | null> {
    const barberId = this._barberId();
    if (barberId === null || this.pending()) return null;
    const operationId = ClientOperationId.parse(this.ids.nextId());
    if (!operationId.ok) {
      refused.set(PipelineError.bare(PipelineErrorCode.InvalidRequest));
      return null;
    }
    this._pending.set(true);
    refused.set(null);
    // A record's call is the news now: an older link refusal is not.
    this.roles.clearRefusal();
    const answer = await dial(operationId.value, barberId);
    this._pending.set(false);
    if (!answer.ok) refused.set(answer.error);
    return answer;
  }
}
