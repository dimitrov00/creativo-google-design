import {
  ChangeDetectionStrategy,
  Component,
  WritableSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiOtpField, UiStack } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

interface OtpDemo {
  readonly length: number;
  readonly invalid: boolean;
  readonly value: WritableSignal<string>;
}

const LENGTHS = [4, 6, 8];
const INVALID_STATES = [false, true];

@Component({
  selector: 'cr-otp-field-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiOtpField, UiStack, UiTextDirective],
  templateUrl: './otp-field.page.html',
  styleUrl: './otp-field.page.css',
})
export class OtpFieldPage {
  protected readonly demos: OtpDemo[] = LENGTHS.flatMap((length) =>
    INVALID_STATES.map((invalid) => ({
      length,
      invalid,
      // Prefilled with a digit or two so both "filled" and "idle" slot
      // states are visible without needing to focus/type into the demo.
      value: signal('12'.slice(0, Math.min(2, length))),
    })),
  );
}
