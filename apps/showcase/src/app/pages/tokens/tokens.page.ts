import { ChangeDetectionStrategy, Component } from '@angular/core';
import type {
  UiFontStyle,
  UiFontWeight,
  UiPaddingScale,
  UiRadiusScale,
} from '@creativo/ui/modifiers';
import {
  UiPaddingDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';

interface ControlSizeSample {
  readonly name: 'compact' | 'regular' | 'prominent';
  readonly px: number;
}

/** [uiWeight] is required alongside [uiFont] — mirrors each role's intrinsic weight from tokens.css. */
const WEIGHT_BY_ROLE: Record<UiFontStyle, UiFontWeight> = {
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
  imports: [UiTextDirective, UiPaddingDirective, UiRadiusDirective],
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

  protected readonly spacing: UiPaddingScale[] = [
    'none',
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
    'capsule',
  ];

  /** px equivalents at --sys-density: 1 (density="regular"), per tokens.css's own comments. */
  protected readonly controlSizes: ControlSizeSample[] = [
    { name: 'compact', px: 36 },
    { name: 'regular', px: 44 },
    { name: 'prominent', px: 52 },
  ];

  protected weightFor(role: UiFontStyle): UiFontWeight {
    // eslint-disable-next-line security/detect-object-injection -- `role` is always one of the closed UiFontStyle union values from `textRoles`, never external input.
    return WEIGHT_BY_ROLE[role];
  }
}
