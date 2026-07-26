import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';
import { UiAsyncImage } from '../async-image/async-image';

/**
 * Avatar sizes extend the shared control vocabulary with a `display` tier —
 * the large profile portrait (112px) used by detail sheets. It's avatar-only:
 * no button/chip ever renders at portrait scale.
 */
/** Avatar's display tier ≙ .controlSize(.extraLarge). */
export type UiAvatarSize = UiControlSize | 'extraLarge';

/**
 * Custom element — composes `ui-async-image` internally, mirroring SwiftUI
 * `AsyncImage(url:) { image } placeholder: { monogram }`: the initial IS
 * the placeholder, shown while bytes load, kept on error, and permanent
 * for a null src.
 */
@Component({
  selector: 'ui-avatar',
  imports: [UiAsyncImage],
  template: `
    <ui-async-image
      class="ui-avatar__media"
      [uiSrc]="uiSrc()"
      [uiAlt]="uiName()"
    >
      <span uiPlaceholder class="ui-avatar__fallback" aria-hidden="true">{{
        initial()
      }}</span>
    </ui-async-image>
  `,
  styleUrl: './avatar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped by design: `.ui-*` + `[data-*]` selectors are the design
  // system's entire styling contract (§3.1) — a global cascade-layer
  // vocabulary, not per-component shadow-DOM isolation. It's also required
  // for correctness: Angular's emulated encapsulation only stamps the
  // `_ngcontent-<id>` attribute selectors need onto a component's CONTENT
  // nodes, never onto its own HOST element, so a bare `.ui-avatar { … }`
  // rule in avatar.css would silently never match `<ui-avatar>` itself.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-avatar',
    '[attr.data-control-size]': 'uiControlSize()',
  },
})
export class UiAvatar {
  readonly uiSrc = input<string | null>(null);
  readonly uiName = input('');
  readonly uiControlSize = input<UiAvatarSize>('regular');

  /** Apple-monogram initials: first letters of the first two words ("Ана Чек" → "АЧ"), single letter for one word, '?' when nameless. */
  protected readonly initial = computed(() => {
    const words = this.uiName().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    return words
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase();
  });
}
