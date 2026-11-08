import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiListGroup, UiListRow } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import type { AnalyticsBarSegmentVm } from '../analytics.vm';

/**
 * THE TIME BAR (`docs/designs/staff-analytics.md`, the time bar) — the
 * period's rostered time up to now as one stacked bar of six parts (worked,
 * no-show, unmarked, blocked, unsold, other), each part's width its share,
 * and under it a legend that names every part in words with its time. The
 * accent law: colour is a shape — worked is the one orange, the rest graded
 * ink; the words are ink. The bar itself is one image to a reader (its
 * name), the legend says the parts.
 */
@Component({
  selector: 'lib-analytics-time-bar',
  imports: [UiListGroup, UiListRow, UiTextDirective],
  template: `
    <div
      class="analytics-time-bar__track"
      role="img"
      [attr.aria-label]="name()"
    >
      @for (segment of segments(); track segment.part) {
        @if (segment.share > 0) {
          <span
            class="analytics-time-bar__part"
            [attr.data-part]="segment.part"
            [style.flex-grow]="segment.share"
          ></span>
        }
      }
    </div>
    <ul uiListGroup class="analytics-time-bar__legend">
      @for (segment of segments(); track segment.part) {
        <li uiListRow uiSize="regular" [attr.data-testid]="segment.testId">
          <span
            uiLeading
            class="analytics-time-bar__swatch"
            [attr.data-part]="segment.part"
            aria-hidden="true"
          ></span>
          {{ segment.label }}
          <ng-container ngProjectAs="[uiTrailing]">
            <span uiTrailing uiText uiFont="callout">{{ segment.value }}</span>
          </ng-container>
        </li>
      }
    </ul>
  `,
  styleUrl: './analytics-time-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsTimeBar {
  readonly segments = input.required<readonly AnalyticsBarSegmentVm[]>();
  /** The bar's accessible name — «Работното време до сега». */
  readonly name = input.required<string>();
}
