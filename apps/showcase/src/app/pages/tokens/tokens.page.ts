import { ChangeDetectionStrategy, Component } from '@angular/core';
import type {
  UiFontStyle,
  UiFontWeight,
  UiRadiusScale,
} from '@creativo/ui/modifiers';
import { UiRadiusDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import type { UiSpacing } from '@creativo/ui/layout';
import { ScDemo } from '../../shared/demo';
import { ScGapViz } from '../../shared/gap-viz';
import { ScPage } from '../../shared/page';

interface ControlSizeSample {
  readonly name: 'small' | 'regular' | 'large';
  readonly px: number;
}

/** [uiWeight] is required alongside [uiFont] — mirrors each role's intrinsic weight from tokens.css. */
const WEIGHT_BY_ROLE: Record<UiFontStyle, UiFontWeight> = {
  display: 'bold',
  eyebrow: 'bold',
  extraLargeTitle: 'bold',
  largeTitle: 'bold',
  title: 'bold',
  title2: 'bold',
  title3: 'semibold',
  headline: 'semibold',
  body: 'regular',
  callout: 'regular',
  subheadline: 'medium',
  footnote: 'medium',
  caption: 'medium',
};

@Component({
  selector: 'cr-tokens-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScGapViz,
    ScPage,
    UiFlow,
    UiRadiusDirective,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './tokens.page.html',
  styleUrl: './tokens.page.css',
})
export class TokensPage {
  protected readonly colors = [
    'background',
    'foreground',
    'surface',
    'surface-secondary',
    'primary',
    'accent',
    'destructive',
    'success',
    'warning',
  ];

  /** Rendered smallest→largest via `[uiFont]`'s SwiftUI text roles. */
  protected readonly textRoles: UiFontStyle[] = [
    'caption',
    'footnote',
    'subheadline',
    'callout',
    'body',
    'headline',
    'title3',
    'title2',
    'title',
    'largeTitle',
    'extraLargeTitle',
  ];

  protected readonly spacing: Exclude<UiSpacing, 'none'>[] = [
    'tight',
    'compact',
    'regular',
    'comfortable',
    'loose',
    'spacious',
  ];

  protected readonly radii: UiRadiusScale[] = [
    'subtle',
    'regular',
    'prominent',
    'hero',
    'capsule',
  ];

  /** px equivalents at --sys-density: 1 (density="regular"), per tokens.css's own comments. */
  protected readonly controlSizes: ControlSizeSample[] = [
    { name: 'small', px: 36 },
    { name: 'regular', px: 44 },
    { name: 'large', px: 52 },
  ];

  protected weightFor(role: UiFontStyle): UiFontWeight {
    // eslint-disable-next-line security/detect-object-injection -- `role` is always one of the closed UiFontStyle union values from `textRoles`, never external input.
    return WEIGHT_BY_ROLE[role];
  }
}
