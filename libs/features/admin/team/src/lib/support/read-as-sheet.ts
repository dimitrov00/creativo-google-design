import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { UserId } from '@core/primitives';
import { UiButton, UiModalSheet, UiTextField } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiNotice, UiSheetActionBar } from '@creativo/ui/patterns';
import { TeamWording } from '../team-wording.service';
import { ReadAsStartStore } from './read-as-start.store';

/**
 * «Виж като …» — the reason support gives before it reads as a person
 * (OR-24): who, what the session is (read-only, up to 15 minutes, written
 * down), the reason, and «Започни» in the dock. The reason is required by
 * the server; the button waits for one. A refusal stays on the sheet.
 */
@Component({
  selector: 'lib-read-as-sheet',
  imports: [
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiModalSheet,
    UiNotice,
    UiSheetActionBar,
    UiTextDirective,
    UiTextField,
  ],
  providers: [ReadAsStartStore],
  templateUrl: './read-as-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ReadAsSheet {
  protected readonly store = inject(ReadAsStartStore);
  private readonly wording = inject(TeamWording);

  readonly uiUserId = input.required<UserId>();
  readonly uiName = input.required<string>();
  readonly uiClosing = input(false);
  readonly dismissed = output<void>();
  readonly closeFinished = output<void>();

  protected readonly reason = signal('');
  protected readonly canStart = computed(
    () => this.reason().trim() !== '' && !this.store.pending(),
  );
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  protected typed(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected start(): void {
    if (!this.canStart()) return;
    void this.store.start(this.uiUserId(), this.reason().trim());
  }
}
