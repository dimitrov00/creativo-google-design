import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiRadiusDirective } from '@creativo/ui/modifiers';

export type UiSkeletonAnimation = 'shimmer' | 'pulse' | 'none';

/** Custom element — placeholder block; radius composed from UiRadiusDirective. */
@Component({
  selector: 'ui-skeleton',
  template: '',
  styleUrl: './skeleton.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-skeleton',
    '[attr.data-animation]': 'uiAnimation()',
    '[attr.aria-hidden]': '"true"',
  },
  hostDirectives: [{ directive: UiRadiusDirective, inputs: ['uiRadius'] }],
})
export class UiSkeleton {
  readonly uiAnimation = input<UiSkeletonAnimation>('shimmer');
}
