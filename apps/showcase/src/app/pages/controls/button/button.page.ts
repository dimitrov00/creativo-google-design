import { ChangeDetectionStrategy, Component } from '@angular/core';
import type {
  UiButtonRole,
  UiButtonStyle,
  UiControlSize,
} from '@creativo/ui/controls';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import {
  UiFrameDirective,
  UiMaterialDirective,
  UiPaddingDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface ButtonStyleRow {
  readonly style: UiButtonStyle;
  readonly role?: UiButtonRole;
}

@Component({
  selector: 'cr-button-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiButton,
    UiFlow,
    UiFrameDirective,
    UiIcon,
    UiMaterialDirective,
    UiPaddingDirective,
    UiRadiusDirective,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './button.page.html',
  styleUrl: './button.page.css',
})
export class ButtonPage {
  /** One row per uiButtonStyle; glass lives on the media canvas instead. */
  protected readonly styleRows: ButtonStyleRow[] = [
    { style: 'borderedProminent' },
    { style: 'bordered' },
    { style: 'strokedBorder' },
    { style: 'plain' },
    { style: 'borderedProminent', role: 'destructive' },
  ];
  protected readonly sizes: UiControlSize[] = ['small', 'regular', 'large'];
}
