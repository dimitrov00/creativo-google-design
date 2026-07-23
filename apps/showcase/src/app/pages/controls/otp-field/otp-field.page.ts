import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UiOtpField } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

@Component({
  selector: 'cr-otp-field-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiFlow, UiOtpField, UiStack, UiTextDirective],
  templateUrl: './otp-field.page.html',
  styleUrl: './otp-field.page.css',
})
export class OtpFieldPage {
  /** Untouched field — every slot idle; focus one to see the active ring. */
  protected readonly defaultValue = signal('');
  /** Complete code — all six slots in the filled state. */
  protected readonly filledValue = signal('492817');
  /** Rejected code — uiInvalid recolors the whole field. */
  protected readonly invalidValue = signal('000000');

  protected readonly shortValue = signal('');
  protected readonly longValue = signal('');
}
