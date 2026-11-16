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
import { TeamAddStore } from '../team-add.store';
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
  private readonly wording = inject(TeamWording);
  private readonly catalog = inject(TeamCatalogService);

  /** The shop's today: the day a newcomer starts unless told otherwise. */
  readonly uiToday = input<LocalDate | null>(null);
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
  protected readonly name = signal('');
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

  protected async add(): Promise<void> {
    const starts = this.starts();
    if (starts === null || !this.canAdd() || this.store.pending()) return;
    const copyFrom = BarberId.parse(this.copyFrom());
    const barberId = await this.store.add({
      name: this.name().trim(),
      barberStartsLocalDate: starts,
      copyFromBarberId: copyFrom.ok ? copyFrom.value : null,
    });
    if (barberId !== null) this.added.emit(barberId);
  }
}
