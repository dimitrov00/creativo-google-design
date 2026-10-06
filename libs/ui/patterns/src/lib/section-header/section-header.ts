import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterEveryRender,
  booleanAttribute,
  computed,
  inject,
  input,
  isDevMode,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';

export type UiSectionHeaderAlign = 'leading' | 'center';

/**
 * ≙ SwiftUI `.headerProminence(_:)` — SwiftUI's own two values, for a
 * heading INSIDE a sheet (2026-09-28). `null` (the default) is the landing
 * trio, untouched.
 *
 * - `increased` — a module heading, always the small rung (36) tall: an
 *   optional leading glyph, the title in the title3 role (20/600), an
 *   optional detail, and at most one hugged trailing action («24 ›»,
 *   «Всички ›») that names where it goes and stays inside the column.
 * - `standard` — a list-section label: one quiet footnote line, title and
 *   detail, flush with the group's outer edge; it may pin under the bar.
 */
export type UiSectionHeaderProminence = 'standard' | 'increased';

/**
 * Eyebrow tone. `accent` (default) is the marketing brand-moment eyebrow
 * (category labels over landing sections): the words in primary ink, led
 * by a dot in the accent (the accent law, 2026-09-29: colour is a shape,
 * words are ink — an 11 px word is never tinted). `secondary` is for
 * STATUS qualifiers — e.g. onboarding's "Optional" — quiet secondary ink
 * and no dot, where a mark would hand the least important word on the
 * screen the loudest shape (HIG: color signals importance/interactivity;
 * status metadata reads in secondary label).
 */
export type UiSectionHeaderEyebrowTone = 'accent' | 'secondary';

/**
 * Section-opening header trio — the ONE sanctioned eyebrow/title/lede
 * recipe (UI/UX case study §2.4: six hand-rolled eyebrow copies and three
 * title scales collapsed into this pattern).
 *
 * Markup contract (attribute-marked slots, any heading level):
 * ```html
 * <ui-section-header>
 *   <p uiEyebrow>{{ eyebrow }}</p>
 *   <h2 uiTitle id="...">{{ title }}</h2>
 *   <p uiLede>{{ lede }}</p>
 * </ui-section-header>
 * ```
 * `uiOnMedia` flips the ink to the media-overlay ramp (text over video or
 * photography). Every slot is optional.
 *
 * INSIDE A SHEET the trio is the wrong size — an 11 px uppercase eyebrow
 * and a display title are a landing's voice. `uiHeaderProminence` gives the
 * sheet its own two headings (the house's hand-rolled footnote labels and
 * the client card's module heads, said once), with their own slots:
 * ```html
 * <ui-section-header uiHeaderProminence="increased">
 *   <h3 uiTitle>Посещения</h3>
 *   <button uiSectionAction uiButton uiButtonStyle="plain" uiControlSize="small" …>
 *     24 <ui-icon uiName="nav.disclosure" />
 *   </button>
 * </ui-section-header>
 *
 * <ui-section-header uiHeaderProminence="standard" [uiPinned]="true">
 *   <h3 uiTitle id="year-2026">2026</h3>
 *   <span uiSectionDetail>9 посещения</span>
 * </ui-section-header>
 * ```
 * Never uppercase, never tracked. The glyph is `increased`'s alone (a list
 * label carries none); the action is projected, so it names its own
 * destination; one action at most.
 *
 * THE ACTION'S CONTRACT (2026-09-29): a plain action is
 * `uiControlSize="small"`. Its 36 box is the row's height and the whole of
 * what hover, press and the focus ring paint, inside the column; the 44
 * target is a slop that paints nothing. A `regular` or `large` plain action
 * still renders inside the column, grows its row, and warns in development.
 */
@Component({
  selector: 'ui-section-header',
  imports: [UiIcon],
  template: `
    @if (glyph(); as glyph) {
      <ui-icon
        class="ui-section-header__glyph"
        [uiName]="glyph"
        uiScale="medium"
      />
    }
    <ng-content />
  `,
  styleUrl: './section-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-section-header',
    '[attr.data-alignment]': 'uiAlignment()',
    '[attr.data-on-media]': "uiOnMedia() ? '' : null",
    '[attr.data-eyebrow-tone]': 'uiEyebrowTone()',
    '[attr.data-header-prominence]': 'uiHeaderProminence()',
    '[attr.data-pinned]': "pinned() ? '' : null",
  },
})
export class UiSectionHeader {
  readonly uiAlignment = input<UiSectionHeaderAlign>('leading');
  readonly uiOnMedia = input(false);
  readonly uiEyebrowTone = input<UiSectionHeaderEyebrowTone>('accent');
  /** ≙ `.headerProminence`. `null` (default) = the landing trio, unchanged. */
  readonly uiHeaderProminence = input<UiSectionHeaderProminence | null>(null);
  /** Leading glyph, `increased` only (secondary ink, 20 px). */
  readonly uiIcon = input<UiIconName | null>(null);
  /**
   * `standard` only: sticks under the sheet's bar (≙ a plain `List`'s
   * pinned section header), on the sheet's surface.
   */
  readonly uiPinned = input(false, { transform: booleanAttribute });

  protected readonly glyph = computed(() =>
    this.uiHeaderProminence() === 'increased' ? this.uiIcon() : null,
  );
  protected readonly pinned = computed(
    () => this.uiHeaderProminence() === 'standard' && this.uiPinned(),
  );

  constructor() {
    if (isDevMode()) {
      // The action is a projected attribute-marked element, not an imported
      // directive, so a content query cannot see it (and it may arrive
      // late, behind a placeholder): the heading reads its own content
      // after a render, until it has spoken once.
      const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
      let warned = false;
      afterEveryRender({
        read: () => {
          if (warned || this.uiHeaderProminence() === null) return;
          const action = host.querySelector(OVERSIZED_PLAIN_ACTION);
          if (!action) return;
          warned = true;
          console.warn(
            '[ui-section-header] a plain [uiSectionAction] is ' +
              'uiControlSize="small": its 36 box is the heading\'s row, and ' +
              `a "${action.getAttribute('data-control-size')}" one grows ` +
              'the row past the rhythm of the headings beside it.',
          );
        },
      });
    }
  }
}

/** A plain button in the action slot on any rung but the small one. */
const OVERSIZED_PLAIN_ACTION =
  ":scope > [uisectionaction].ui-button[data-button-style='plain']:not([data-control-size='small'])";
