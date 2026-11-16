import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LocalizedText } from '@core/components';
import { BarberId, type LocalDate } from '@core/primitives';
import { RoleAssignmentSystem } from '@core/systems';
import { TeamCatalogService } from '@creativo/features/shared/catalog';
import {
  UiButton,
  UiChoiceMenu,
  type UiChoiceOption,
  UiDateRow,
  UiModalSheet,
  UiTextField,
} from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiNotice,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import type { BarberAccountPick } from '../team-barber-account-sheet/team-barber-account-sheet';
import { TeamAddStore } from '../team-add.store';
import { TeamRolesStore } from '../team-roles.store';
import { TeamWording } from '../team-wording.service';

/** The copy menu's answer for nobody — an id no barber record carries. */
const COPY_FROM_NOBODY = '';

/**
 * «НОВ В ЕКИПА» — adding someone takes three answers (team onboarding D8):
 * their name, the day they start, and whose prices to begin with, so the
 * first day does not open on an empty list. «Добави» creates the record in
 * preparation and hands its id to the page, which opens the member's page.
 * Every default a barber gets can still be changed there.
 *
 * Once the record exists its name and day are final here: a copy that
 * failed is retried by the same button, and never adds a second person.
 */
@Component({
  selector: 'lib-team-add-sheet',
  imports: [
    UiDateRow,
    TranslocoDirective,
    UiButton,
    UiChoiceMenu,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiModalSheet,
    UiNotice,
    UiRadiusDirective,
    UiSheetActionBar,
    UiTextDirective,
    UiTextField,
  ],
  providers: [TeamAddStore],
  templateUrl: './team-add-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class TeamAddSheet {
  protected readonly store = inject(TeamAddStore);
  private readonly roles = inject(TeamRolesStore);
  private readonly wording = inject(TeamWording);
  private readonly catalog = inject(TeamCatalogService);

  /** The shop's today: the day a newcomer starts unless told otherwise. */
  readonly uiToday = input<LocalDate | null>(null);
  /**
   * The account the barber is made from (account first, A2) — named on the
   * sheet, its name the record's to start with, linked once the record
   * exists; `null` for a record with no account.
   */
  readonly uiAccount = input<BarberAccountPick | null>(null);
  /** The words for nobody in the copy menu. */
  readonly uiCopyNone = input('');
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();
  /** The record was added: its id, for the page to open. */
  readonly added = output<BarberId>();

  protected readonly locale = this.wording.locale;
  /** The record's name: the account's, until it is typed over. */
  protected readonly name = linkedSignal(() => this.uiAccount()?.name ?? '');
  /** A call is on its way: the record's, its prices', or its account's link. */
  protected readonly busy = computed(
    () => this.store.pending() || this.roles.pending(),
  );
  /** The record was added, but its account could not be linked (A3). */
  protected readonly linkFailed = signal(false);
  /** The record that was added, while the sheet still says what is left. */
  private readonly addedId = signal<BarberId | null>(null);
  /** The start day: today until another is picked. */
  protected readonly starts = linkedSignal<LocalDate | null>(() =>
    this.uiToday(),
  );
  protected readonly copyFrom = signal(COPY_FROM_NOBODY);
  protected readonly copyOpen = signal(false);

  /** Nobody, then every barber at work — whose prices can be copied. */
  protected readonly copyOptions = computed<readonly UiChoiceOption[]>(() => [
    { id: COPY_FROM_NOBODY, label: this.uiCopyNone() },
    ...this.catalog.liveBarberVms().map((barber) => ({
      id: barber.id,
      label: LocalizedText.pick(barber.name, this.locale()),
      avatarSrc: barber.avatarSrc,
    })),
  ]);

  protected readonly copyWord = computed(
    () =>
      this.copyOptions().find((option) => option.id === this.copyFrom())
        ?.label ?? this.uiCopyNone(),
  );

  /** The record exists already: its name and day are final, the copy alone is retried. */
  protected readonly locked = computed(() => this.store.added() !== null);

  protected readonly canAdd = computed(
    () => this.name().trim().length > 0 && this.starts() !== null,
  );

  /** Why the add was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  /** The name field's typed text. */
  protected typed(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /**
   * «Добави»: the record, its copied prices — then, for a barber made from
   * an account, that account linked to it («Свържи профил»'s call, the
   * stored roles plus `barber`). A link refused leaves the record (it is
   * the bookable thing) and says so, with the way to its page (A3).
   */
  protected async add(): Promise<void> {
    const left = this.addedId();
    if (left !== null) {
      this.added.emit(left);
      return;
    }
    const starts = this.starts();
    if (starts === null || !this.canAdd() || this.store.pending()) return;
    const copyFrom = BarberId.parse(this.copyFrom());
    const barberId = await this.store.add({
      name: this.name().trim(),
      barberStartsLocalDate: starts,
      copyFromBarberId: copyFrom.ok ? copyFrom.value : null,
    });
    if (barberId === null) return;
    const account = this.uiAccount();
    if (account !== null) {
      const change = RoleAssignmentSystem.recordLinkOf(
        account.storedRoles,
        barberId,
      );
      const linked = await this.roles.send({
        targetUserId: account.userId,
        roles: change.roles,
        ...change.link,
      });
      if (!linked) {
        this.addedId.set(barberId);
        this.linkFailed.set(true);
        return;
      }
    }
    this.added.emit(barberId);
  }
}
