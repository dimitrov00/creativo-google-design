import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiBadge } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';

/**
 * Headed capsule list — the "variants" and "bundle includes" sections of
 * the service sheet share this exact shape (h3 header + a wrapping row of
 * non-interactive display capsules), previously rendered twice inline.
 *
 * All DS: `span[uiBadge]` at the large size tier (`uiSize="large"`, the
 * chunky display rhythm — list-row naming precedent) inside `ui-flow`
 * (the wrapping chip cluster). Capsules HUG their labels on every width —
 * the buttons-hug ruling — so no column morph, no local layout CSS. The
 * list semantics ride ARIA roles (item count still announced to AT).
 */
@Component({
  selector: 'cr-capsule-list',
  imports: [UiBadge, UiFlow, UiStack, UiTextDirective],
  template: `
    <ui-stack uiSpacing="regular">
      <h3 uiText uiFont="title3">{{ heading() }}</h3>
      <ui-flow uiSpacing="compact" uiAlignment="leading" role="list">
        @for (item of items(); track $index) {
          <span uiBadge uiSize="large" role="listitem">{{ item }}</span>
        }
      </ui-flow>
    </ui-stack>
  `,
  // Unscoped (landing sheet-section convention for DS-composed internals).
  encapsulation: ViewEncapsulation.None,
  styles: `
    cr-capsule-list {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapsuleListComponent {
  readonly heading = input.required<string>();
  readonly items = input.required<readonly string[]>();
}
