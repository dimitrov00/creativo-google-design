import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  input,
} from '@angular/core';

/**
 * A SHEET PAGE'S HEAD — its large title and the one line under it, said
 * once (2026-09-24).
 *
 * The visit sheet's pages had drifted into four heads: a bare title, a
 * title in a compact stack with a description, a title with a "consequence"
 * line at the page's own gap in a tertiary footnote (2.85:1 on a light
 * sheet), and — on the one page with a search — a title in a wrapper that
 * FOLDS while the search is engaged. The day's own sheets used a fifth, a
 * tight stack. This is the one head: the title (`uiSheetLargeTitle`, the
 * sheet header's sentinel) and at most one line under it, tight, the
 * platform's navigation subtitle.
 *
 * `uiFolded` is the `.searchable` grammar: while a search is engaged the
 * head folds away and the field rises under the bar, where the compact
 * title lands — the owner tells the sheet (`titleCollapsed`), because a
 * title folded in place never scrolls under the bar for the observer to
 * see it cross. The folded title also gives up its view-timeline, so the
 * scroll-linked reveal goes inert and the shell's flip shows the compact
 * title instead.
 *
 * ```html
 * <ui-sheet-headline [uiFolded]="searching()">
 *   <h2 uiSheetLargeTitle id="page-title" uiText uiFont="largeTitle">…</h2>
 *   <p uiText uiFont="subheadline" uiForegroundStyle="secondary">…</p>
 * </ui-sheet-headline>
 * ```
 *
 * Ink and type stay with the projected content, as `ui-empty-state` keeps
 * them. The fold takes the page's own gap with it; a container spaced other
 * than `comfortable` says so with `--ui-sheet-headline-gap`.
 */
@Component({
  selector: 'ui-sheet-headline',
  template: `<div class="ui-sheet-headline__body"><ng-content /></div>`,
  styleUrl: './sheet-headline.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, as every DS component: bare `.ui-*` selectors never match a
  // component's own host under emulated encapsulation.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-sheet-headline',
    '[attr.data-folded]': 'uiFolded() ? "" : null',
  },
})
export class UiSheetHeadline {
  /** Folded away while a search is engaged. */
  readonly uiFolded = input(false, { transform: booleanAttribute });
}
