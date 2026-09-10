import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';
import { UiIcon } from '../icon/icon';

/**
 * THE TIME FIELD — the platform's own picker behind a face that is ours.
 *
 * `input[type=time]` renders as the engine pleases: Chrome draws segmented
 * digits and its own picker glyph, iOS a rounded grey box, Firefox a spinner
 * — and none of them can be told what a value looks like in this design
 * system (owner, 2026-09-09: "unstyle the time input for all devices and
 * do our custom style HH:mm + clock"). So the native control STAYS, for the
 * wheel on iOS and the dial on Android, but it is transparent and lies over
 * a FACE the stylesheet owns: the value in tabular figures and the DS clock
 * glyph. A tap anywhere on the face reaches the native input beneath it,
 * and where the engine has `showPicker()` the tap opens the picker outright,
 * so a desktop click is not a hunt for the engine's own indicator.
 *
 * The value is the consumer's, as `HH:mm`; the field only reports what the
 * picker produced — on every `input` as well as `change`, because a field
 * that commits on blur makes the tap reaching for the save button the tap
 * that creates it. Empty draws `––:––`.
 */
@Component({
  selector: 'ui-time-field',
  imports: [UiIcon],
  template: `
    <span class="ui-time-field__face" aria-hidden="true">
      <span class="ui-time-field__value">{{ uiValue() || '––:––' }}</span>
      <ui-icon uiName="service.duration" />
    </span>
    <input
      #native
      type="time"
      class="ui-time-field__native"
      [value]="uiValue()"
      [attr.id]="uiId()"
      [attr.step]="uiStep()"
      [attr.min]="uiMin()"
      [attr.max]="uiMax()"
      [attr.aria-label]="uiLabel()"
      [attr.data-testid]="uiTestId()"
      (input)="uiValueChange.emit(native.value)"
      (change)="uiValueChange.emit(native.value)"
      (click)="open(native)"
    />
  `,
  styleUrl: './time-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-time-field',
    '[attr.data-control-size]': 'uiControlSize()',
  },
})
export class UiTimeField {
  /** `HH:mm`, or empty. */
  readonly uiValue = input('');
  /** The picker's grain, in seconds — five minutes by default. */
  readonly uiStep = input(300);
  readonly uiMin = input<string | null>(null);
  readonly uiMax = input<string | null>(null);
  /** The accessible name, when no `<label for>` names the field. */
  readonly uiLabel = input<string | null>(null);
  /** The native input's id, for a `<label for>`. */
  readonly uiId = input<string | null>(null);
  readonly uiTestId = input<string | null>(null);
  readonly uiControlSize = input<'small' | 'regular'>('regular');
  /** What the picker produced — `HH:mm`, or empty when cleared. */
  readonly uiValueChange = output<string>();

  protected open(native: HTMLInputElement): void {
    if (typeof native.showPicker !== 'function') return;
    try {
      native.showPicker();
    } catch {
      /* the engine wants its own gesture — the native tap still opens it */
    }
  }
}
