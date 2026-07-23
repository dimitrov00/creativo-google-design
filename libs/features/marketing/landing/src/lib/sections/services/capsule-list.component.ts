import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiTextDirective } from '@creativo/ui/modifiers';

/**
 * Headed capsule list — the "variants" and "bundle includes" sections of
 * the service sheet share this exact shape (h3 header + a wrapping row of
 * non-interactive display capsules), previously rendered twice inline.
 *
 * The capsules are deliberately NOT ui-badge/ui-chip: non-interactive
 * display capsules in the old sheet's chunky rhythm (tap-target-scale
 * padding, quiet foreground-alpha fill) — badge's caption-tight padding
 * and 14% tone tints would break the sheet's visual weight. Built on the
 * DS capsule-radius, alpha-ladder and type tokens instead.
 */
@Component({
  selector: 'cr-capsule-list',
  imports: [UiTextDirective],
  template: `
    <header class="cr-capsule-list__header">
      <h3 uiText uiFont="title3">{{ heading() }}</h3>
    </header>
    <ul class="cr-capsule-list__items">
      @for (item of items(); track $index) {
        <li uiText uiFont="caption" uiWeight="semibold">{{ item }}</li>
      }
    </ul>
  `,
  // Unscoped (landing sheet-section convention for DS-composed internals);
  // the .cr-capsule-list__ prefix keeps selectors unique.
  encapsulation: ViewEncapsulation.None,
  styles: `
    cr-capsule-list {
      display: block;
    }

    .cr-capsule-list__header {
      margin-block-end: var(--sys-space-regular);
    }

    .cr-capsule-list__header h3 {
      margin: 0;
    }

    .cr-capsule-list__items {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sys-space-compact);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .cr-capsule-list__items li {
      padding: var(--sys-space-regular);
      border-radius: var(--control-radius-capsule);
      /* Quiet fill from the theme-aware alpha ladder (the old hand-mixed
         5.5% read too faint in dark mode). */
      background: color-mix(
        in srgb,
        currentColor var(--sys-alpha-fill),
        transparent
      );
      /* The caption role's automatic secondary ink is for captions; these
         capsules carry primary content. */
      color: var(--sys-color-foreground);
    }

    @media (max-width: 760px) {
      .cr-capsule-list__items {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--sys-space-compact);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapsuleListComponent {
  readonly heading = input.required<string>();
  readonly items = input.required<readonly string[]>();
}
