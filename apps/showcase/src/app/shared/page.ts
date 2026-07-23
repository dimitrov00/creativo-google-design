import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiStack } from '@creativo/ui/layout';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';

/**
 * Spec-page shell — one shared frame for every showcase page: back link,
 * display title, projected lede ([scLede]) and a spacious section stack
 * (default projection). Keeps every page on the same 64rem column and the
 * same rhythm.
 */
@Component({
  selector: 'sc-page',
  imports: [RouterLink, UiStack, UiFrameDirective, UiTextDirective],
  template: `
    <ui-stack
      uiSpacing="loose"
      uiFrame
      [uiFrameMaxWidth]="'64rem'"
      uiPaddingVertical="comfortable"
    >
      <ui-stack uiSpacing="regular" uiAlignment="leading">
        @if (scBack(); as back) {
          <a
            [routerLink]="back"
            uiText
            uiFont="callout"
            uiForegroundStyle="accent"
            class="sc-page__back"
          >
            ← {{ scBackLabel() }}
          </a>
        }
        <ui-stack uiSpacing="tight">
          <h1 uiText uiFont="extraLargeTitle">{{ scTitle() }}</h1>
          <p
            uiText
            uiFont="body"
            uiForegroundStyle="secondary"
            class="sc-page__lede"
          >
            <ng-content select="[scLede]" />
          </p>
        </ui-stack>
      </ui-stack>
      <ui-stack uiSpacing="spacious">
        <ng-content />
      </ui-stack>
    </ui-stack>
  `,
  styles: `
    .sc-page__back {
      text-decoration: none;
    }
    .sc-page__lede {
      max-inline-size: 44rem;
    }
    .sc-page__lede code {
      font: var(--sys-font-callout);
      font-family: var(--sys-font-family-mono);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScPage {
  readonly scTitle = input.required<string>();
  readonly scBack = input<string | null>('/controls');
  readonly scBackLabel = input('All controls');
}
