import { ChangeDetectionStrategy, Component } from '@angular/core';
import type {
  UiAvatarOrbitFace,
  UiAvatarSize,
  UiControlSize,
} from '@creativo/ui/controls';
import {
  UiAvatar,
  UiAvatarGroup,
  UiAvatarOrbit,
  UiChip,
} from '@creativo/ui/controls';
import { UiFlow, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { ScDemo } from '@showcase/shared/demo';
import { ScPage } from '@showcase/shared/page';

interface AvatarImageSample {
  readonly size: UiAvatarSize;
  readonly src: string;
}

@Component({
  selector: 'cr-avatar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScDemo,
    ScPage,
    UiAvatar,
    UiAvatarGroup,
    UiAvatarOrbit,
    UiChip,
    UiFlow,
    UiStack,
    UiTextDirective,
  ],
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

  /** The group rides the shared control ladder — no portrait tier for a cluster. */
  protected readonly groupSizes: UiControlSize[] = [
    'small',
    'regular',
    'large',
  ];

  /** The orbit's centre: the one the picture is about. */
  protected readonly orbitCenter: UiAvatarOrbitFace = {
    id: 'center',
    name: 'Ada Lovelace',
    avatarSrc: 'https://i.pravatar.cc/256?img=47',
  };

  /** Eight people around her — five seated, the count in the sixth seat. */
  protected readonly orbitFaces: readonly UiAvatarOrbitFace[] = [
    {
      id: 'p1',
      name: 'Grace Hopper',
      avatarSrc: 'https://i.pravatar.cc/128?img=25',
    },
    { id: 'p2', name: 'Edsger Dijkstra', avatarSrc: null },
    {
      id: 'p3',
      name: 'Alan Turing',
      avatarSrc: 'https://i.pravatar.cc/128?img=12',
    },
    {
      id: 'p4',
      name: 'Barbara Liskov',
      avatarSrc: 'https://i.pravatar.cc/128?img=32',
    },
    { id: 'p5', name: 'Donald Knuth', avatarSrc: null },
    { id: 'p6', name: 'Frances Allen', avatarSrc: null },
    { id: 'p7', name: 'Ken Thompson', avatarSrc: null },
    { id: 'p8', name: 'Radia Perlman', avatarSrc: null },
  ];

  /** Two around her: the inner orbit's first seats. */
  protected readonly orbitPair = this.orbitFaces.slice(0, 2);

  /** Guaranteed-to-fail source — demonstrates the error → placeholder path. */
  protected readonly brokenSrc = 'https://example.invalid/x.png';
}
