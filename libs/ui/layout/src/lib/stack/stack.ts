import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiStackAxis = 'horizontal' | 'vertical' | 'z';
export type UiSpacing =
  | 'none'
  | 'tight'
  | 'compact'
  | 'regular'
  | 'comfortable'
  | 'loose'
  | 'spacious';
export type UiAlignment = 'leading' | 'center' | 'trailing' | 'stretch';

/** Flex-layout primitive — horizontal/vertical/z-stack, the workhorse layout building block. */
@Component({
  selector: 'ui-stack',
  template: `<ng-content />`,
  styleUrl: './stack.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-stack',
    '[attr.data-axis]': 'uiAxis()',
    '[attr.data-spacing]': 'uiSpacing()',
    '[attr.data-alignment]': 'uiAlignment()',
  },
})
export class UiStack {
  readonly uiAxis = input<UiStackAxis>('vertical');
  readonly uiSpacing = input<UiSpacing>('regular');
  readonly uiAlignment = input<UiAlignment>('stretch');
}
