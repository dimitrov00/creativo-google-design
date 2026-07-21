import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiCard } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';

interface ControlLink {
  readonly slug: string;
  readonly name: string;
}

@Component({
  selector: 'cr-controls-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiCard, UiTextDirective],
  templateUrl: './controls.page.html',
  styleUrl: './controls.page.css',
})
export class ControlsPage {
  protected readonly controls: ControlLink[] = [
    { slug: 'button', name: 'Button' },
    { slug: 'input', name: 'Input' },
    { slug: 'otp-field', name: 'OTP Field' },
    { slug: 'chip', name: 'Chip' },
    { slug: 'badge', name: 'Badge' },
    { slug: 'avatar', name: 'Avatar' },
    { slug: 'spinner', name: 'Spinner' },
    { slug: 'skeleton', name: 'Skeleton' },
    { slug: 'stack', name: 'Stack' },
    { slug: 'toolbar', name: 'Toolbar' },
    { slug: 'sheet', name: 'Sheet' },
    { slug: 'card', name: 'Card' },
  ];
}
