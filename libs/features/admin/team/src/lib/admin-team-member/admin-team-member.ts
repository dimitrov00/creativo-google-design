import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { BarberLifecycle } from '@core/components';
import { BarberId, type LocationId } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import {
  type HoursChair,
  StaffHoursSheet,
} from '@creativo/features/staff/dashboard/hours';
import {
  HOURS_DESK,
  type HoursDesk,
} from '@creativo/features/staff/dashboard/hours-desk';
import {
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import {
  UiAvatar,
  UiButton,
  UiChoiceMenu,
  UiSkeleton,
  UiSwitch,
} from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiRadiusDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import {
  UiAlert,
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiNotice,
  UiSectionHeader,
  UiSheetHeader,
  UiSheetHeadline,
  UiToast,
} from '@creativo/ui/patterns';
import { LinkAnswer } from '../link.vm';
import { MemberLinkSheet } from '../member-link-sheet/member-link-sheet';
import { MemberOfferingsSheet } from '../member-offerings-sheet/member-offerings-sheet';
import { BookingsAheadStore } from '../bookings-ahead.store';
import { MemberPeriodSheet } from '../member-period-sheet/member-period-sheet';
import { MemberReturnSheet } from '../member-return-sheet/member-return-sheet';
import { MemberProfileSheet } from '../member-profile-sheet/member-profile-sheet';
import { MemberShopsSheet } from '../member-shops-sheet/member-shops-sheet';
import { memberPageVm } from '../member.presenter';
import { DeleteAnswer, MemberEditor, type MemberPageVm } from '../member.vm';
import { TeamMemberStore } from '../team-member.store';
import { TeamRolesStore } from '../team-roles.store';
import { TeamWording } from '../team-wording.service';
import { TeamStore } from '../team.store';

/**
 * The hours sheet's host on this page: the record's roster and the week's
 * save are the page's store's.
 */
function hoursDesk(): HoursDesk {
  const store = inject(TeamMemberStore);
  return {
    rosterOf: (barberId) => store.rosterOf(barberId),
    setRosterWeek: (week) => store.setRosterWeek(week),
    absenceError: store.hoursRefusal,
    absencePending: store.pending,
  };
}

/**
 * A TEAM MEMBER'S PAGE (team onboarding D8, D9; staff permissions P9, P10):
 * one barber record. While it is in preparation, what it still needs leads
 * the page — each row a way into its own editor — and nothing asks anyone
 * to press «go live»: the record starts taking bookings the moment the
 * needed items are there. After that the same rows are at rest under
 * «Профил». The account linked to the record stands beside it, with the
 * owner's own door to a chair («Това съм аз» · «Не съм аз») and the way to
 * the levels that account holds.
 *
 * the levels that account holds. Someone else's account is linked from
 * «Свържи профил» and released by «Разкачи профила», each behind a
 * question: both end that person's sessions.
 *
 * The weekly hours are the schedule's own sheet, raised here over this
 * page's store (`HOURS_DESK`). It, «Услуги и цени» and «Свържи профил» are
 * loaded when they are first asked for; the short editors come with the
 * page.
 */
@Component({
  selector: 'lib-admin-team-member',
  imports: [
    MemberLinkSheet,
    MemberOfferingsSheet,
    MemberPeriodSheet,
    MemberReturnSheet,
    MemberProfileSheet,
    MemberShopsSheet,
    RouterLink,
    StaffHoursSheet,
    TranslocoDirective,
    UiAlert,
    UiAvatar,
    UiButton,
    UiChoiceMenu,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiNotice,
    UiPaddingDirective,
    UiRadiusDirective,
    UiSectionHeader,
    UiSheetHeader,
    UiSheetHeadline,
    UiSkeleton,
    UiStack,
    UiSwitch,
    UiTextDirective,
    UiToast,
    UiVisuallyHiddenDirective,
  ],
  providers: [
    TeamRolesStore,
    TeamMemberStore,
    BookingsAheadStore,
    { provide: HOURS_DESK, useFactory: hoursDesk },
  ],
  templateUrl: './admin-team-member.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class AdminTeamMember {
  protected readonly store = inject(TeamMemberStore);
  private readonly ahead = inject(BookingsAheadStore);
  private readonly team = inject(TeamStore);
  private readonly access = inject(StaffAccessService);
  private readonly wording = inject(TeamWording);
  private readonly catalog = inject(TeamCatalogService);
  private readonly router = inject(Router);
  private readonly clock = inject(CLOCK_PORTS);
  /** The default shop's zone — a date's year is said only outside its today's. */
  private readonly zone = inject(ShopZoneService).defaultZone();
  /** The instant the page opened: "today" is read once from it. */
  private readonly openedAtUtcMs = this.clock.nowUtcMs();

  /** The route's `:barberId` — bound by the router (`withComponentInputBinding`). */
  readonly barberId = input<string | undefined>(undefined);

  /** Which editor a row opens, for the template's switch. */
  protected readonly MemberEditor = MemberEditor;

  /** The editor that is open; `null` when none is. */
  protected readonly editor = signal<MemberEditor | null>(null);
  /** The open editor is leaving: its close animation runs. */
  protected readonly closing = signal(false);
  /** «Кой може да записва»: its menu is open. */
  protected readonly bookedByOpen = signal(false);
  /** The delete question is up. */
  protected readonly deleteOpen = signal(false);
  /** The «Разкачи профила» question is up. */
  protected readonly releaseOpen = signal(false);
  /** The hours were just saved — said once. */
  protected readonly hoursSaved = signal(false);

  protected readonly locale = this.wording.locale;

  /** The one chair the hours sheet opens on: this record's. */
  protected readonly hoursChairs = computed<readonly HoursChair[]>(() => {
    const barber = this.store.barber();
    return barber === undefined
      ? []
      : [{ id: barber.id, label: this.vm()?.name ?? '' }];
  });

  /** Where a new shift of the record is worked — the hours sheet asks by chair. */
  protected readonly homeOf = (): LocationId | null => this.store.homeShop();

  protected readonly today = computed(() => {
    const zone = this.zone();
    return zone === null
      ? null
      : ZonedTimeSystem.shopNow(this.openedAtUtcMs, zone).localDate;
  });

  /** The team is read and holds no such record: the page says so. */
  protected readonly missing = computed(
    () => this.store.known() && this.store.barber() === undefined,
  );

  protected readonly vm = computed<MemberPageVm | null>(() => {
    const words = this.wording.words();
    const memberWords = this.wording.memberWords();
    const linkWords = this.wording.linkWords();
    const barber = this.store.barber();
    const checklist = this.store.checklist();
    if (
      words === null ||
      memberWords === null ||
      linkWords === null ||
      barber === undefined ||
      checklist === null
    ) {
      return null;
    }
    return memberPageVm({
      barber,
      checklist,
      doneCount: this.store.doneCount(),
      servicesCount: this.store.servicesCount(),
      bookedBy: this.store.bookedBy(),
      shops: this.store.shops(),
      everyShop: this.store.everyShop(),
      multiShop: this.store.multiShop(),
      member: this.store.member(),
      recordClaim: this.store.recordClaim(),
      managesTeam: this.store.managesTeam(),
      mayEditProfile: this.store.mayEditProfile(),
      mayManage: this.store.mayManage(),
      mayEditHours: this.store.mayEditHours(),
      mayEditOfferings: this.store.mayEditOfferings(),
      deletable: this.store.deletable(),
      returnable: this.store.returnable(),
      leftover: this.ahead.leftover(),
      linksAccount: this.store.linksAccount(),
      releasesAccount: this.store.releasesAccount(),
      editsPermissions: this.access.editsPermissions(),
      permissions: this.access.permissions(),
      avatarSrc: this.catalog.findTeamBarberVm(barber.id)?.avatarSrc ?? null,
      words,
      memberWords,
      linkWords,
      locale: this.wording.locale(),
      today: this.today(),
    });
  });

  /**
   * Why the last call was refused, in the catalogue's words — said on the
   * page for its own rows; an open editor says its own.
   */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null || this.editor() !== null
      ? null
      : this.wording.refusalOf(error);
  });

  constructor() {
    this.catalog.watchTeam();
    // The account beside the record is the Team list's row: read it again,
    // so a page opened from a link is as fresh as one opened from the list.
    void this.team.load();
    // The route names the record; the store's own signals are not read here.
    effect(() => {
      const raw = this.barberId();
      const parsed = raw === undefined ? null : BarberId.parse(raw);
      untracked(() =>
        this.store.open(parsed !== null && parsed.ok ? parsed.value : null),
      );
    });
    // A leaver may still hold bookings after their last day: whoever can
    // bring them back is told so. Asked once per record and last day —
    // never for a working record, whose bookings are on the schedule.
    effect(() => {
      const barber = this.store.barber();
      const asks = this.store.returnable();
      untracked(() => {
        if (barber !== undefined) {
          this.ahead.ask(
            barber.id,
            asks ? barber.barberLastWorkingLocalDate : null,
          );
        }
      });
    });
  }

  protected openEditor(memberEditor: MemberEditor): void {
    this.store.clearRefusal();
    this.closing.set(false);
    this.editor.set(memberEditor);
  }

  /** ✕, Escape, the scrim, or a save that landed: the sheet leaves. */
  protected requestClose(): void {
    if (this.editor() !== null) this.closing.set(true);
  }

  protected finishClose(): void {
    if (!this.closing()) return;
    this.editor.set(null);
    this.closing.set(false);
    this.store.clearRefusal();
  }

  /** The hours sheet closed itself — after a save, or on ✕. */
  protected closeHours(): void {
    this.editor.set(null);
    this.store.clearHoursRefusal();
  }

  protected setPool(on: boolean): void {
    void this.store.setPool(on);
  }

  /** «Кой може да записва» answered: the live status picked, when it is one. */
  protected pickBookedBy(picked: string): void {
    this.bookedByOpen.set(false);
    if (
      BarberLifecycle.isLiveStatus(picked) &&
      picked !== this.store.bookedBy()
    ) {
      void this.store.setAccess(picked);
    }
  }

  /** «Това съм аз» · «Не съм аз». */
  protected claim(mine: boolean): void {
    void this.store.claim(mine);
  }

  /** «Опитай пак»: the link change again, so the person's sessions are ended. */
  protected endSessions(): void {
    void this.store.endSessions();
  }

  /**
   * A picture was picked: it becomes the barber's photo. The field is
   * emptied first, so picking the same file again is a change too.
   */
  protected onPhotoPicked(event: Event): void {
    const field = event.target as HTMLInputElement;
    const file = field.files?.item(0) ?? null;
    field.value = '';
    if (file !== null) void this.store.changePhoto(file);
  }

  /** The «Разкачи профила» question answered. */
  protected onReleasePick(answer: string): void {
    this.releaseOpen.set(false);
    if (answer === LinkAnswer.Confirm) void this.store.releaseAccount();
  }

  /** The delete question answered. */
  protected async onDeletePick(answer: string): Promise<void> {
    this.deleteOpen.set(false);
    if (answer !== DeleteAnswer.Delete) return;
    if (await this.store.remove()) {
      void this.router.navigate(['/admin/team']);
    }
  }
}
