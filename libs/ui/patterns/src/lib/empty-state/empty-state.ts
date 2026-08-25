import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/**
 * NOTHING HERE, said once for the whole app.
 *
 * Seven of these were hand-assembled across five feature libraries — a
 * `ui-stack` holding a line of copy and a call to action — and they had
 * already drifted: `uiSpacing="tight"` in five, `"compact"` in two;
 * `uiControlSize="small"` in the account card, `"regular"` everywhere else;
 * a title in the marketing three and none in the rest. None of that
 * variation meant anything, which is the definition of a pattern the design
 * system should own.
 *
 * ```html
 * <ui-empty-state [uiTitle]="t('careers.empty.title')">
 *   {{ t('careers.empty.body') }}
 *   <a uiActions uiButton uiButtonStyle="bordered" [href]="url">…</a>
 * </ui-empty-state>
 * ```
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. No icon or illustration slot — the app
 * has no empty-state art and inventing a hole for some invites seven
 * different fillings. No alignment, tone or size inputs. No built-in button:
 * callers project their own `uiButton`, so its style and size stay a
 * decision of the screen it sits on. And no ink on the body — the marketing
 * bodies inherit `.ui-card`'s primary foreground while the bare ones carry
 * `uiForegroundStyle="secondary"`, and a pattern that owned "the body
 * colour" would silently repaint three marketing screens. Ink stays with the
 * projected content until someone decides that repaint on purpose.
 */
@Component({
  selector: 'ui-empty-state',
  template: `
    @if (uiTitle()) {
      <p class="ui-empty-state__title">{{ uiTitle() }}</p>
    }
    <ng-content />
    <ng-content select="[uiActions]" />
  `,
  styleUrl: './empty-state.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, as every DS component: bare `.ui-*` selectors never match a
  // component's own host under emulated encapsulation.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-empty-state' },
})
export class UiEmptyState {
  /**
   * The headline. EMPTY MEANS NO LINE AT ALL — not an empty paragraph
   * holding space. That absence is the only difference between the carded
   * marketing shape and the bare one, which is why it is an input rather
   * than a variant.
   */
  readonly uiTitle = input('');
}
