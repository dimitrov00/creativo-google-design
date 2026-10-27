import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  linkedSignal,
} from '@angular/core';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';

/**
 * ui-reference — the one line a failed call leaves behind for a report:
 * «Код за справка: <id>», in the mono cut, copied on a tap.
 *
 * A person who writes in about a refusal can read the line out or paste it,
 * and support finds every server line of that call under the same id. The
 * line is the consumer's words with the id already in them (`uiLabel`); the
 * value copied is the id alone (`uiValue`), printed in full and allowed to
 * wrap — a reference cut to an ellipsis is one nobody can quote.
 *
 * The tap writes the id to the clipboard and, once it landed, says so in a
 * polite `role="status"` line (`uiCopiedText`) — the region is there from
 * the first render, so assistive tech hears the confirmation when it
 * arrives. Where the platform has no clipboard (an insecure origin, a
 * refused permission) nothing is said: the line stays there to read. A new
 * value starts unconfirmed.
 *
 * DS inputs only; the consumer decides whether there is a line at all.
 */
@Component({
  selector: 'ui-reference',
  imports: [UiInteractiveDirective],
  template: `
    <button
      type="button"
      class="ui-reference__line"
      uiInteractive
      (click)="copy()"
    >
      {{ uiLabel() }}
    </button>
    <span class="ui-reference__copied" role="status" aria-live="polite">{{
      copied() ? uiCopiedText() : ''
    }}</span>
  `,
  styleUrl: './reference.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-reference__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-reference' },
})
export class UiReference {
  /**
   * The line as printed — the consumer's words with the id in them. Named
   * `uiLabel`, never `uiText`: `[uiText]` is the text modifier's selector
   * (`@creativo/ui/modifiers`), which would attach to this element.
   */
  readonly uiLabel = input.required<string>();
  /** What a tap copies: the id itself. */
  readonly uiValue = input.required<string>();
  /** What is announced once the id is on the clipboard. */
  readonly uiCopiedText = input('');

  /** Confirmed for THIS value; a new value starts unconfirmed. */
  protected readonly copied = linkedSignal({
    source: this.uiValue,
    computation: () => false,
  });

  protected async copy(): Promise<void> {
    const value = this.uiValue();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // No clipboard here (or it was refused): the line stays to be read.
      return;
    }
    if (this.uiValue() === value) this.copied.set(true);
  }
}
