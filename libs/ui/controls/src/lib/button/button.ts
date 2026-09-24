import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiPaddingDirective } from '@creativo/ui/modifiers';
import { UiProgressView } from '../progress-view/progress-view';

/**
 * ≙ SwiftUI `.buttonStyle(_:)` — the exact SwiftUI vocabulary:
 * `borderedProminent` (filled primary), `bordered` (the soft tinted fill —
 * what iOS renders for `.bordered`), `plain` (quiet label), `glass`
 * (iOS 26 Liquid Glass chrome over media). `strokedBorder` is the one
 * house extension (SwiftUI has no outline style; named from
 * `Shape.strokeBorder`).
 */
export type UiButtonStyle =
  'borderedProminent' | 'bordered' | 'strokedBorder' | 'plain' | 'glass';
/**
 * ≙ SwiftUI `ButtonRole` — recolors any style, exactly like `Button(role:)`.
 *
 * There is deliberately no `warning` tier. HIG does not tint primary buttons
 * by severity — a filled prominent button is the tint colour, and even a
 * genuinely destructive confirmation is red TEXT inside an alert, not an
 * amber CTA. An action that trades one thing for another says so in its
 * LABEL ("Replace"), which is the rule about never relying on colour alone.
 */
export type UiButtonRole = 'destructive';
/** ≙ SwiftUI `.tint(_:)` — `neutral` renders the gray `.bordered` chip
 *  (utility toggles, sheet chrome) instead of the accent-tinted fill. */
export type UiButtonTint = 'neutral';
/** ≙ SwiftUI `.controlSize(_:)` — small(36) · regular(44) · large(52); avatar adds extraLarge. */
export type UiControlSize = 'small' | 'regular' | 'large';
/**
 * ≙ SwiftUI `.buttonBorderShape(_:)`.
 *
 * **`capsule` is the default (owner ruling, 2026-07-30): capsules and circles
 * everywhere.** It was `roundedRectangle`, and the audit that prompted this
 * found the split was never a decision — 57 call sites asked for `capsule`
 * explicitly and NOT ONE ever asked for `roundedRectangle`. Every rounded
 * rectangle in the app was somewhere a developer forgot the attribute, which
 * is why the booking flow had capsule CTAs on three steps and rectangles on
 * three others.
 *
 * `roundedRectangle` stays available for a button that genuinely wants to read
 * as a panel rather than a control; it now has to be asked for.
 */
export type UiButtonBorderShape = 'roundedRectangle' | 'capsule';

/** Native `<button>`/`<a>` element — free a11y semantics, zero ARIA
 * hand-rolling. The `span[uiButton]` form is the DECORATIVE affordance:
 * button chrome on a non-interactive element inside a larger tappable
 * surface (a card that IS the button), where nesting a real control would
 * be invalid HTML — pair it with `aria-hidden` on the cluster. */
@Component({
  selector: 'button[uiButton], a[uiButton], span[uiButton]',
  // BUSY (owner, 2026-09-17: "when saving or performing an async operation
  // in any button add a spinner so you instantly know what is happening"):
  // the button draws its OWN ring while `uiLoading` — no consumer composes
  // a progress view into a label. The label keeps the box's width and goes
  // clear (button.css); the ring turns at the centre in the button's ink.
  // Hidden from assistive tech: `aria-busy` on the button already says it.
  template: `<ng-content />
    @if (uiLoading()) {
      <span class="ui-button__progress" aria-hidden="true">
        <ui-progress-view
          [uiControlSize]="uiControlSize() === 'large' ? 'regular' : 'small'"
        />
      </span>
    }`,
  imports: [UiProgressView],
  styleUrl: './button.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-button',
    '[attr.data-button-style]': 'uiButtonStyle()',
    '[attr.data-role]': 'uiRole() ?? null',
    '[attr.data-tint]': 'uiTint() ?? null',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-border-shape]': 'uiButtonBorderShape()',
    '[attr.data-state]': 'uiLoading() ? "loading" : null',
    '[attr.data-spread]': "uiSpread() ? '' : null",
    '[attr.data-on-media]': "uiOnMedia() ? '' : null",
    '[attr.data-icon-only]': "uiIconOnly() ? '' : null",
    '[attr.data-multiline]': "uiMultiline() ? '' : null",
    '[attr.data-selected]': "uiSelected() ? '' : null",
    '[attr.aria-pressed]': 'uiSelected() ?? null',
    '[attr.aria-busy]': 'uiLoading() || null',
  },
  hostDirectives: [{ directive: UiPaddingDirective, inputs: ['uiPadding'] }],
})
export class UiButton {
  readonly uiButtonStyle = input<UiButtonStyle>('borderedProminent');
  /** `Button(role: .destructive)` — composes with any uiButtonStyle. */
  readonly uiRole = input<UiButtonRole | undefined>(undefined);
  /** `.tint(_:)` — unset keeps the accent tint; `neutral` is the gray
   *  utility chip (sheet closes, layout toggles). */
  readonly uiTint = input<UiButtonTint | undefined>(undefined);
  readonly uiControlSize = input<UiControlSize>('regular');
  readonly uiButtonBorderShape = input<UiButtonBorderShape>('capsule');
  readonly uiLoading = input(false);
  /** Sheet-CTA ROW GRAMMAR: tall pill, leading content clustered, trailing
   *  glyph at the far edge. Width is NOT part of the grammar — like every
   *  button it hugs its content; compose with
   *  `uiFrame uiFrameMaxWidth="infinity"` (.frame(maxWidth: .infinity))
   *  when the row should fill. */
  readonly uiSpread = input(false);
  /** Over video/photography: prominent renders white-on-media in both
   *  themes (a theme-colored pill sinks into dark footage). */
  readonly uiOnMedia = input(false);
  /** SwiftUI `.labelStyle(.iconOnly)`: square glyph box at the exact
   *  size tier (36/44/52) — the circular icon button hand-rolled across
   *  the landing (header trigger, sheet closes, layout toggles…). */
  readonly uiIconOnly = input(false);
  /** Toggle-style `isOn` state for triggers/toggles. Unset (undefined)
   *  omits BOTH attributes — a plain button must never announce as an
   *  unpressed toggle; bind it (even to `false`) only on real toggles,
   *  which then get `aria-pressed` for free (chip precedent). */
  readonly uiSelected = input<boolean | undefined>(undefined);
  /** Wrapping label (`.lineLimit(nil)`): height GROWS from the size
   *  tier's min-block-size — the one sanctioned block padding. */
  readonly uiMultiline = input(false);
}
