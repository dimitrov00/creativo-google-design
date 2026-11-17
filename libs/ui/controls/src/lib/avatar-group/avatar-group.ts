import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/**
 * THE AVATAR GROUP — several people as ONE mark (2026-09-17; owner:
 * "shouldn't it be an avatar group?"): the projected `ui-avatar`s overlap
 * by a third of their disc, each cut out of the one behind it by a ring of
 * the ground they sit on, the first in front — Photos' people at a
 * picture's corner, Messages' group. The ring is a hook
 * (`--ui-avatar-group-ring`): the surface on a page, white over media, the
 * consumer says. More people than fit are a count in the last disc's
 * place. The group is one thing to assistive tech — `role="group"` and the
 * consumer's `aria-label` naming everyone — so the discs are decoration.
 */
@Component({
  selector: 'ui-avatar-group',
  template: `<ng-content />
    @if (uiOverflow() > 0) {
      <span class="ui-avatar-group__more" aria-hidden="true"
        >+{{ uiOverflow() }}</span
      >
    }`,
  styleUrl: './avatar-group.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-avatar-group',
    role: 'group',
    '[attr.data-control-size]': 'uiControlSize()',
  },
})
export class UiAvatarGroup {
  /** The discs' tier — the same word the avatars inside carry. */
  readonly uiControlSize = input<UiControlSize>('regular');
  /** How many more people than the discs shown; `0` draws nothing. */
  readonly uiOverflow = input(0);
}
