import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { StaffPermissions } from '@core/components';
import { AccessScope, type BarberId, StaffCapability } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import {
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { LoadState } from '@creativo/shared/view-state';
import { UiAvatar, UiButton, UiSkeleton } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiPaddingDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSectionHeader,
  UiSheetHeader,
} from '@creativo/ui/patterns';
import { TeamAddSheet } from '../team-add-sheet/team-add-sheet';
import { TeamWording } from '../team-wording.service';
import { teamPageVm } from '../team.presenter';
import { TeamStore } from '../team.store';
import type { TeamPageVm } from '../team.vm';

/**
 * «ЕКИП» — the Team page (team onboarding D8; staff permissions P10): one
 * list of everyone who works here, as `listTeam` answered it for the person
 * looking. Whoever manages the team sees the records and the accounts;
 * whoever edits every barber's profile or prices sees the records alone.
 * The owner also finds the way to «Права» here.
 *
 * A barber record's row leads to its page; whoever manages the team adds
 * someone from the bar's ＋. An account with no record is read here: its
 * roles are the client card's to change.
 */
@Component({
  selector: 'lib-admin-team',
  imports: [
    RouterLink,
    TeamAddSheet,
    TranslocoDirective,
    UiAvatar,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiNotice,
    UiPaddingDirective,
    UiSectionHeader,
    UiSheetHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './admin-team.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class AdminTeam {
  protected readonly store = inject(TeamStore);
  private readonly access = inject(StaffAccessService);
  private readonly wording = inject(TeamWording);
  private readonly catalog = inject(TeamCatalogService);
  private readonly clock = inject(CLOCK_PORTS);
  /** The default shop's zone — a date's year is said only outside its today's. */
  private readonly zone = inject(ShopZoneService).defaultZone();
  /** The instant the page opened: "today" is read once from it. */
  private readonly openedAtUtcMs = this.clock.nowUtcMs();

  /** Where the read stands, for the template's switch. */
  protected readonly LoadState = LoadState;

  private readonly router = inject(Router);

  /** The owner alone edits «Права»: the row is theirs. */
  protected readonly editsPermissions = this.access.editsPermissions;

  /** Whoever manages the team adds to it: the bar's ＋ is theirs. */
  protected readonly managesTeam = computed(
    () => this.access.scopeOf(StaffCapability.TeamManage) !== AccessScope.None,
  );

  /** The add sheet is up. */
  protected readonly addOpen = signal(false);
  /** The add sheet is leaving: its close animation runs. */
  protected readonly addClosing = signal(false);
  /** The record the add sheet created: the page opens it once the sheet has left. */
  private addedId: BarberId | null = null;

  protected readonly today = computed(() => {
    const zone = this.zone();
    return zone === null
      ? null
      : ZonedTimeSystem.shopNow(this.openedAtUtcMs, zone).localDate;
  });

  /** Each record's portrait, from the staff's catalogue of the whole team. */
  private readonly avatars = computed(
    () =>
      new Map<BarberId, string | null>(
        this.catalog
          .teamBarberVms()
          .map((barber) => [barber.id, barber.avatarSrc]),
      ),
  );

  protected readonly vm = computed<TeamPageVm | null>(() => {
    const words = this.wording.words();
    return words === null
      ? null
      : teamPageVm({
          sections: this.store.sections(),
          managesTeam: this.managesTeam(),
          avatars: this.avatars(),
          words,
          locale: this.wording.locale(),
          today: this.today(),
        });
  });

  /** «Стандартни» · «3 промени» — how far the shop's permissions are from the standard. */
  protected readonly permissionsValue = computed(() => {
    const words = this.wording.words();
    if (words === null) return '';
    const cells = this.access.permissions();
    let departures = 0;
    for (const level of StaffPermissions.LEVELS) {
      departures += StaffPermissions.departuresOf(cells, level).length;
    }
    return departures === 0 ? words.standard : words.changes(departures);
  });

  /** Why the read failed, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  constructor() {
    this.catalog.watchTeam();
    void this.store.load();
  }

  protected retry(): void {
    void this.store.load();
  }

  protected openAdd(): void {
    this.addedId = null;
    this.addClosing.set(false);
    this.addOpen.set(true);
  }

  /** ✕, Escape, the scrim: the sheet leaves. */
  protected closeAdd(): void {
    if (this.addOpen()) this.addClosing.set(true);
  }

  /** The record was added: the sheet leaves, then its page opens. */
  protected onAdded(barberId: BarberId): void {
    this.addedId = barberId;
    this.closeAdd();
  }

  protected finishAdd(): void {
    if (!this.addClosing()) return;
    this.addOpen.set(false);
    this.addClosing.set(false);
    const barberId = this.addedId;
    this.addedId = null;
    if (barberId !== null) {
      void this.router.navigate(['/admin/team/member', barberId]);
    }
  }
}
