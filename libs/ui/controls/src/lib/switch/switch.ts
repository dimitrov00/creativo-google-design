import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  model,
} from '@angular/core';

/**
 * ≙ SwiftUI `Toggle` — a native `<button role="switch">` for one binary
 * setting whose effect is IMMEDIATE.
 *
 * ### Why `role="switch"` and not a checkbox
 * A checkbox states an intent that a later Submit carries out ("send me the
 * newsletter" on a form). A switch IS the action: flipping it is the change.
 * Screen readers announce the two differently ("on/off" vs "checked"), and
 * the difference is exactly the one the user experiences, so it is not a
 * cosmetic choice. Use a checkbox pattern when there is a Save button between
 * the flip and the effect.
 *
 * ### The label belongs to the row, not to this control
 * The switch renders the track and the knob and nothing else — no projected
 * content, because a switch with a label inside it cannot be laid out as the
 * trailing accessory of a list row, which is where iOS puts every one of
 * them. Pair it with `ui-list-row` (or a `<label>`) and give it an
 * `aria-labelledby` or `aria-label` naming what it switches.
 *
 * ```html
 * <ui-list-row>
 *   Save to my profile
 *   <button uiSwitch uiTrailing [(uiOn)]="saveToProfile" aria-label="…"></button>
 * </ui-list-row>
 * ```
 */
@Component({
  selector: 'button[uiSwitch]',
  template: `<span class="ui-switch__knob" aria-hidden="true"></span>`,
  styleUrl: './switch.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-switch',
    type: 'button',
    role: 'switch',
    '[attr.aria-checked]': 'uiOn()',
    '[attr.data-on]': 'uiOn() ? "" : null',
    '[attr.aria-disabled]': 'uiDisabled() ? true : null',
    '[disabled]': 'uiDisabled()',
    '(click)': 'toggle()',
  },
})
export class UiSwitch {
  readonly uiOn = model(false);
  readonly uiDisabled = input(false);

  protected toggle(): void {
    if (this.uiDisabled()) return;
    this.uiOn.set(!this.uiOn());
  }
}
