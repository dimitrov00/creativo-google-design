import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';
import { UiAsyncImage } from '../async-image/async-image';
import { UiIcon } from '../icon/icon';
import type { UiIconName } from '../icon/icon-registry';

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
  imports: [UiAsyncImage, UiIcon],
  template: `
    <ui-async-image
      class="ui-avatar__media"
      [uiSrc]="uiSrc()"
      [uiAlt]="uiName()"
    >
      <span uiPlaceholder class="ui-avatar__fallback" aria-hidden="true">
        @if (uiIcon(); as glyph) {
          <ui-icon [uiName]="glyph" />
        } @else if (initial(); as monogram) {
          {{ monogram }}
        } @else {
          <ui-icon uiName="account.anonymous" />
        }
      </span>
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

  /**
   * A GLYPH in place of the monogram — for a disc that stands for something
   * other than a person: "anyone", a team, an unassigned lane.
   *
   * It exists so that "a face-shaped mark where a face would go" is one
   * recipe rather than a hand-rolled capsule per feature. Both the booking
   * flow's "Anyone" and the staff scope picker's "All barbers" drew their own
   * disc — same radius, same fill, same size ladder, two definitions — until
   * this input made them the same control.
   *
   * The glyph rides the tier's own font (icons inherit font size), so it
   * scales with `uiControlSize` for free, and takes the avatar's ink, so
   * `--ui-avatar-ink` tints it exactly as it tints a monogram.
   *
   * It is a PLACEHOLDER, like the monogram: a real `uiSrc` still wins.
   */
  readonly uiIcon = input<UiIconName | null>(null);

  /**
   * Apple-monogram initials: first letters of the first two words
   * ("Ана Чек" → "АЧ"), a single letter for one word, and EMPTY when there is
   * no name.
   *
   * Empty rather than "?": a question mark is a glyph that asks the viewer
   * something, and nobody is being asked anything — we simply do not have the
   * name yet. The template falls back to the person silhouette, which is what
   * every system avatar shows for an unknown someone.
   */
  protected readonly initial = computed(() => {
    const words = this.uiName().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    return words
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase();
  });
}
