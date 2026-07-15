import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'cr-tokens-page',
  imports: [],
  templateUrl: './tokens.page.html',
  styleUrl: './tokens.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokensPage {
  protected readonly colors = [
    'background',
    'surface',
    'foreground',
    'accent',
    'accent-active',
    'analogous-0',
    'analogous-1',
    'analogous-2',
    'border',
    'focus-ring',
    'link',
    'link-hover',
  ];

  protected readonly spacing = [
    'none',
    'tight',
    'compact',
    'regular',
    'comfortable',
    'loose',
    'spacious',
  ];
  protected readonly fontSizes = [
    'caption',
    'footnote',
    'subheadline',
    'body',
    'callout',
    'headline',
    'title3',
    'title2',
    'title',
  ];
  // Kebab-cased to match the actual generated CSS custom property name
  // (Style Dictionary's nameKebab transform turns the "extraLarge" token
  // key into --cr-radius-extra-large) — unlike ButtonSize/InputSize's
  // "extraLarge", which is this repo's own literal data-size attribute
  // value, never run through that transform.
  protected readonly radii = [
    'none',
    'small',
    'regular',
    'large',
    'extra-large',
    'full',
  ];
  protected readonly elevations = ['0', '1', '2', '3', '4', '5'];
  protected readonly easings = [
    'standard',
    'decelerate',
    'accelerate',
    'emphasized',
  ];
}
