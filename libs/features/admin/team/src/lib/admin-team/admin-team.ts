import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
 * A row is read, not pressed, in this slice: the member's page and the add
 * sheet arrive next, and a row that led nowhere would be a lie.
 */
@Component({
  selector: 'lib-admin-team',
  imports: [
    RouterLink,
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

  /** The owner alone edits «Права»: the row is theirs. */
  protected readonly editsPermissions = this.access.editsPermissions;

  private readonly today = computed(() => {
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
          managesTeam:
            this.access.scopeOf(StaffCapability.TeamManage) !==
            AccessScope.None,
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
}
