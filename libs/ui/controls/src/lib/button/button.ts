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
    '[attr.aria-busy]': 'uiLoading() || null',
  },
  hostDirectives: [{ directive: UiPaddingDirective, inputs: ['uiPadding'] }],
})
export class UiButton {
  readonly uiVariant = input<UiButtonVariant>('prominent');
  readonly uiSize = input<UiControlSize>('regular');
  readonly uiShape = input<UiControlShape>('rounded');
  readonly uiLoading = input(false);
}
