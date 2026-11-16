import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LocalizedText } from '@core/components';
import type { Barber } from '@core/entities';
import type { LocalDate } from '@core/primitives';
import { TeamSystem } from '@core/systems';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { UiButton, UiDateRow, UiModalSheet } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { TeamMemberStore } from '../team-member.store';
import { TeamWording } from '../team-wording.service';
import { firstWord } from '../team.format';

/**
 * «ВЪРНИ В ЕКИПА» — a barber who has left, back on the team (team
 * onboarding D10): the same record, so their name, their prices and their
 * past visits are where they were, and the week they last worked stands
 * again from the day picked. One answer: the day they start.
 *
 * The sheet holds a draft and decides nothing. Which day it opens on and
 * the earliest it offers are `TeamSystem.suggestedReturn` and
 * `earliestReturn`; whether the day picked is one a return takes is
 * `TeamSystem.rehire`'s answer, the rule the server asks. The account is
 * not brought back: the sheet says so, and «Свържи профил» does it.
 * Mounted while it is open, so every opening starts from the record.
 */
@Component({
  selector: 'lib-member-return-sheet',
  imports: [
    UiDateRow,
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiNotice,
    UiSheetActionBar,
    UiTextDirective,
  ],
  templateUrl: './member-return-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class MemberReturnSheet implements OnInit {
  protected readonly store = inject(TeamMemberStore);
  private readonly wording = inject(TeamWording);
  /** The instant the sheet opened: the stamp a return would carry, for the rule's own check. */
  private readonly openedAtUtcMs = inject(CLOCK_PORTS).nowUtcMs();

  /** The record brought back. */
  readonly uiBarber = input.required<Barber>();
  /** The shop's today: the day the sheet opens on. */
  readonly uiToday = input<LocalDate | null>(null);
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim — or a return that landed. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  protected readonly locale = this.wording.locale;
  /** The start day as drafted; `null` until the shop's today is known. */
  protected readonly starts = signal<LocalDate | null>(null);

  /** The earliest day the month offers: the day after the last day worked. */
  protected readonly earliest = computed(() =>
    TeamSystem.earliestReturn(this.uiBarber()),
  );

  /** «Стефан се връща със същия профил, цени и работно време…» */
  protected readonly lede = computed(() => {
    const memberWords = this.wording.memberWords();
    return memberWords === null
      ? ''
      : memberWords.returnLede(
          firstWord(LocalizedText.pick(this.uiBarber().name, this.locale())),
        );
  });

  /** The day drafted is one a return takes (`TeamSystem.rehire`). */
  protected readonly canSave = computed(() => {
    const starts = this.starts();
    return (
      starts !== null &&
      TeamSystem.rehire(this.uiBarber(), starts, this.openedAtUtcMs, null).ok
    );
  });

  /** Why the return was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  /** The day the sheet opens on, read once: today, or the earliest return when that is later. */
  ngOnInit(): void {
    const today = untracked(this.uiToday);
    if (today !== null) {
      this.starts.set(
        TeamSystem.suggestedReturn(untracked(this.uiBarber), today),
      );
    }
  }

  protected async save(): Promise<void> {
    const starts = this.starts();
    if (starts === null || !this.canSave() || this.store.pending()) return;
    if (await this.store.rehire(starts)) this.dismissed.emit();
  }
}
