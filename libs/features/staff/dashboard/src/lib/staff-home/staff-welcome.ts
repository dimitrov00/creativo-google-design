import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { LocalizedText, RouteCapabilities } from '@core/components';
import { Locale, type UserId } from '@core/primitives';
import { StaffSetupSystem } from '@core/systems';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import {
  type BarberVm,
  TeamCatalogService,
} from '@creativo/features/shared/catalog';
import {
  UiAvatar,
  UiAvatarGroup,
  UiButton,
  UiModalSheet,
} from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import type { WelcomeFaceVm, WelcomeVm } from './staff-home.vm';
import { welcomeVm } from './staff-welcome.presenter';

/** The device's own note that this account let the welcome go. */
const SEEN_KEY = 'staff-welcome-seen:';

function seenHere(userId: UserId | null): boolean {
  if (userId === null) return false;
  try {
    return localStorage.getItem(SEEN_KEY + userId) !== null;
  } catch {
    return false;
  }
}

function rememberSeen(userId: UserId | null): void {
  if (userId === null) return;
  try {
    localStorage.setItem(SEEN_KEY + userId, '1');
  } catch {
    // A private window: the page is answered for this visit all the same.
  }
}

/**
 * THE WELCOME (account first, A4 —
 * `docs/architecture/decisions/2026-11-16-account-first-team.md`): the
 * first time a barber whose account is linked to their record opens the
 * schedule, a page of its own greets them — their face in front of the
 * colleagues they join, by their first name — and says what this place is
 * for them: their schedule, their profile, the hours and prices the owner
 * sets.
 *
 * It shows while nothing of their own profile is done
 * (`StaffSetupSystem.welcomes`) and their own page would open for them
 * (`RouteCapabilities.OwnProfile`): once they have set anything, on any
 * device, they have found their way in. «По-късно» lets it go on this
 * device (a barber signing in with a client in the chair needs today's
 * schedule, not a tour); «Да започваме» opens their own page. The setup
 * card on the schedule stays until the profile is done. Nothing is stored
 * for the account (A6, as amended).
 */
@Component({
  selector: 'lib-staff-welcome',
  imports: [
    TranslocoDirective,
    UiAvatar,
    UiAvatarGroup,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiModalSheet,
    UiTextDirective,
  ],
  templateUrl: './staff-welcome.html',
  styleUrl: './staff-welcome.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `staff-welcome`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class StaffWelcomeSheet {
  private readonly access = inject(StaffAccessService);
  private readonly session = inject(AccountStateService);
  private readonly team = inject(TeamCatalogService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  private readonly copyTable = toSignal(this.transloco.selectTranslation());
  /** This device let the welcome go for the signed-in account. */
  private readonly seen = linkedSignal(() => seenHere(this.session.userId()));
  /** The page is leaving: its close runs. */
  protected readonly closing = signal(false);

  /** The page, for a linked barber whose profile is untouched — unless this device let it go. */
  protected readonly vm = computed<WelcomeVm | null>(() => {
    this.copyTable();
    const barberId = this.access.linkedBarberId();
    if (
      barberId === null ||
      this.seen() ||
      !this.team.teamKnown() ||
      !this.access.opens(RouteCapabilities.OwnProfile)
    ) {
      return null;
    }
    const barber = this.team
      .teamBarbers()
      .find((record) => record.id === barberId);
    if (
      barber === undefined ||
      !StaffSetupSystem.welcomes(StaffSetupSystem.checklistOf(barber, [], null))
    ) {
      return null;
    }
    const locale = this.locale();
    const faceOf = (vm: BarberVm): WelcomeFaceVm => ({
      id: vm.id,
      name: LocalizedText.pick(vm.name, locale),
      avatarSrc: vm.avatarSrc === '' ? null : vm.avatarSrc,
    });
    const own = this.team.findTeamBarberVm(barberId);
    const words = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate<string>(`staff.welcome.${key}`, params);
    return welcomeVm({
      firstName: this.session.account()?.firstName ?? null,
      own:
        own === undefined
          ? {
              id: barberId,
              name: LocalizedText.pick(barber.name, locale),
              avatarSrc: null,
            }
          : faceOf(own),
      colleagues: this.team
        .liveBarberVms()
        .filter((vm) => vm.id !== barberId)
        .map(faceOf),
      words: {
        headlineNamed: (name) => words('headlineNamed', { name }),
        headline: words('headline'),
        ledeWith: (names) => words('ledeWith', { names }),
        ledeAlone: words('ledeAlone'),
        more: (count) => words('more', { count }),
      },
      locale,
    });
  });

  /** The catalogue's language as the record's names are kept. */
  private locale(): Locale {
    return this.transloco.getActiveLang() === Locale.En ? Locale.En : Locale.Bg;
  }

  /** «Да започваме»: their own page, where the profile is set. */
  protected start(): void {
    rememberSeen(this.session.userId());
    void this.router.navigate(['/staff/profile']);
    this.seen.set(true);
  }

  /** «По-късно», Escape: the page leaves, and stays gone on this device. */
  protected later(): void {
    rememberSeen(this.session.userId());
    this.closing.set(true);
  }

  protected closeFinished(): void {
    this.seen.set(true);
    this.closing.set(false);
  }
}
