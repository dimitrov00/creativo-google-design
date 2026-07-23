import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { UiAvatarSize } from '@creativo/ui/controls';
import { UiAvatar } from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '../../../shared/demo';
import { ScPage } from '../../../shared/page';

interface AvatarImageSample {
  readonly size: UiAvatarSize;
  readonly src: string;
}

@Component({
  selector: 'cr-avatar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScDemo, ScPage, UiAvatar, UiFlow, UiStack, UiTextDirective],
  templateUrl: './avatar.page.html',
  styleUrl: './avatar.page.css',
})
export class AvatarPage {
  /** The full avatar ladder — extraLarge is the avatar-only portrait tier. */
  protected readonly sizes: UiAvatarSize[] = [
    'small',
    'regular',
    'large',
    'extraLarge',
  ];

  protected readonly imageSamples: AvatarImageSample[] = [
    { size: 'small', src: 'https://i.pravatar.cc/128?img=12' },
    { size: 'regular', src: 'https://i.pravatar.cc/128?img=25' },
    { size: 'large', src: 'https://i.pravatar.cc/128?img=32' },
    { size: 'extraLarge', src: 'https://i.pravatar.cc/256?img=47' },
  ];

  /** Guaranteed-to-fail source — demonstrates the error → placeholder path. */
  protected readonly brokenSrc = 'https://example.invalid/x.png';
}
