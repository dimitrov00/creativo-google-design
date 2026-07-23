import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiPaddingDirective } from '@creativo/ui/modifiers';

export type UiButtonVariant =
  'prominent' | 'bordered' | 'tinted' | 'plain' | 'destructive' | 'overlay';
export type UiControlSize = 'compact' | 'regular' | 'prominent';
export type UiControlShape = 'rounded' | 'capsule';

/** Native `<button>`/`<a>` element — free a11y semantics, zero ARIA hand-rolling. */
@Component({
  selector: 'button[uiButton], a[uiButton]',
  template: `<ng-content />`,
  styleUrl: './button.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-button',
    '[attr.data-variant]': 'uiVariant()',
    '[attr.data-size]': 'uiSize()',
    '[attr.data-shape]': 'uiShape()',
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
  readonly uiVariant = input<UiButtonVariant>('prominent');
  readonly uiSize = input<UiControlSize>('regular');
  readonly uiShape = input<UiControlShape>('rounded');
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
