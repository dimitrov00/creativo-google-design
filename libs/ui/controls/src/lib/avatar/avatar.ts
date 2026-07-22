import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

/**
 * Avatar sizes extend the shared control vocabulary with a `display` tier —
 * the large profile portrait (112px) used by detail sheets. It's avatar-only:
 * no button/chip ever renders at portrait scale.
 */
export type UiAvatarSize = UiControlSize | 'display';

/** Custom element — conditional img-vs-initial rendering, not a native element fit. */
@Component({
  selector: 'ui-avatar',
  template: `
    @if (uiSrc(); as src) {
      <img [src]="src" [alt]="uiName()" class="ui-avatar__image" />
    } @else {
      <span class="ui-avatar__fallback" aria-hidden="true">{{
        initial()
      }}</span>
    }
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
    '[attr.data-size]': 'uiSize()',
  },
})
export class UiAvatar {
  readonly uiSrc = input<string | null>(null);
  readonly uiName = input('');
  readonly uiSize = input<UiAvatarSize>('regular');

  protected readonly initial = computed(() =>
    (this.uiName() || '?').slice(0, 1).toUpperCase(),
  );
}
