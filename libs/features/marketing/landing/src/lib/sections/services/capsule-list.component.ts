import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiBadge, UiIcon, type UiIconName } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';

/** One display capsule — an optional semantic glyph beside its label. */
export interface CapsuleVm {
  readonly label: string;
  /** Semantic icon key (registry); omitted for capsules with no mark. */
  readonly icon?: UiIconName;
}

/**
 * Headed capsule list — the service sheet's "options" section: an h3
 * header over a wrapping row of non-interactive display capsules.
 *
 * Capsules are for OPTIONS: mutually-exclusive, descriptive choices that
 * re-price one service. A manifest of things that exist elsewhere in the
 * app (a bundle's members) is NOT this shape — that's a navigable list
 * with a disclosure chevron (HIG, App Store bundle pages), which is why
 * the includes section left this component.
 *
 * All DS: `span[uiBadge]` at the large size tier (`uiSize="large"`, the
 * chunky display rhythm — list-row naming precedent) inside `ui-flow`
 * (the wrapping chip cluster). Capsules HUG their labels on every width —
 * the buttons-hug ruling — so no column morph, no local layout CSS. The
 * list semantics ride ARIA roles (item count still announced to AT).
 */
@Component({
  selector: 'cr-capsule-list',
  imports: [UiBadge, UiFlow, UiIcon, UiStack, UiTextDirective],
  template: `
    <ui-stack uiSpacing="regular">
      <h3 uiText uiFont="title3">{{ heading() }}</h3>
      <ui-flow uiSpacing="compact" uiAlignment="leading" role="list">
        @for (item of items(); track $index) {
          <span uiBadge uiSize="large" role="listitem">
            @if (item.icon; as icon) {
              <ui-icon [uiName]="icon" />
            }
            {{ item.label }}
          </span>
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
  readonly items = input.required<readonly CapsuleVm[]>();
}
