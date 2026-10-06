import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  contentChild,
  effect,
  input,
  isDevMode,
} from '@angular/core';
import { UiGauge } from '../gauge/gauge';

/**
 * The ring a headline's face can wear. `warning` is the one tone the head
 * needs today: a client whose online booking is paused (the state line says
 * it in words; the ring is decoration, as the Contacts card's is).
 */
export type UiHeadlineMediaTone = 'warning';

/**
 * ≙ a navigation title's display mode, said for a PAGE'S HEAD. `standard`
 * is every sheet page's head: the title on the leading edge, the face (when
 * there is one) a `large` disc at the trailing edge. `hero` is a PROFILE:
 * the face on top, centred and `extraLarge`, the name under it — the page
 * is about that one person, or that one medal (revision 3, R2-C).
 */
export type UiHeadlineStyle = 'standard' | 'hero';

/**
 * THE HEAD'S FACE (≙ a Contacts card photo, 2026-09-28) — exactly one per
 * headline: `ui-avatar`, `ui-medal`. In the `standard` layout it is a
 * `large` (52) control at the TRAILING edge, so the leading title edge
 * stays every other sheet page's edge, and it rides the large title's exit
 * fade (sheet-header.css), so the disc never ghosts behind the bar's chips.
 * In the `hero` layout it is `extraLarge` (112), centred over the name, and
 * leaves on a timeline of its OWN (sheet-headline.css).
 *
 * The media is projected, never imported: a pattern cannot know which
 * control is the face. The head only needs to KNOW one is there, and
 * `contentChild` sees only an imported directive — hence the bundle,
 * `UI_SHEET_HEADLINE`, which every consumer with a face imports.
 */
@Directive({
  selector: '[uiHeadlineMedia]',
  host: { class: 'ui-headline-media' },
})
export class UiHeadlineMedia {}

/**
 * THE FACE'S PLATE (revision 3, hero only) — one white capsule on the
 * face's lower rim, half over it: a client's tier. It is the consumer's
 * `span[uiBadge uiOnMedia]` (a pattern imports no control) and it is
 * projected INSIDE the media, so whatever happens to the face happens to
 * it: it rises with it, it leaves with it, it is `aria-hidden` with it.
 * The consumer says its words in a visually hidden `span` after the quiet
 * line.
 */
@Directive({
  selector: '[uiHeadlinePlate]',
  host: { class: 'ui-headline-plate' },
})
export class UiHeadlinePlate {}

/** The ring the hero draws round its face: how full, and in which tone. */
interface HeadlineRing {
  readonly value: number;
  readonly tone: UiHeadlineMediaTone | null;
}

/**
 * A SHEET PAGE'S HEAD — its large title and the lines under it, said
 * once (2026-09-24).
 *
 * The visit sheet's pages had drifted into four heads: a bare title, a
 * title in a compact stack with a description, a title with a "consequence"
 * line at the page's own gap in a tertiary footnote (2.85:1 on a light
 * sheet), and — on the one page with a search — a title in a wrapper that
 * FOLDS while the search is engaged. The day's own sheets used a fifth, a
 * tight stack. This is the one head: the title (`uiSheetLargeTitle`, the
 * sheet header's sentinel) and at most TWO quiet lines under it, tight, the
 * platform's navigation subtitle (two since revision 3: the history's
 * facts take a second).
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
 *
 * A FACE, TRAILING (2026-09-28; `standard`): one `[uiHeadlineMedia]`
 * control at the trailing edge, the title column floored at the disc's
 * height and centred in it — a one-line title with its line sits balanced
 * beside the 52 disc; a longer title grows downward while the disc stays on
 * its first line. `uiMediaTone` rings the face (inset: the body clips).
 * Still in the system; no page of the client stack uses it.
 *
 * ```html
 * <ui-sheet-headline [uiMediaTone]="paused() ? 'warning' : null">
 *   <h2 uiSheetLargeTitle id="page-title" uiText uiFont="title2">…</h2>
 *   <p uiText uiFont="subheadline" uiForegroundStyle="secondary">…</p>
 *   <ui-avatar uiHeadlineMedia uiControlSize="large" [uiName]="name()" />
 * </ui-sheet-headline>
 * ```
 *
 * THE HERO (revision 3; `uiHeadlineStyle="hero"`): you are in somebody's
 * profile, and the head says so. One centred column: the face
 * (`extraLarge`, 112) in a ring box of 128, the name under it (`title`
 * 28/700, the page's one 28), the quiet lines under the name. The DOM stays
 * title first — the media is `aria-hidden` and only MOVED above.
 *
 * - THE RING (`uiMediaValue`, 0 … 1) is a `ui-gauge` of the circular style
 *   round the face: progress to the next tier. `null` draws none and keeps
 *   the box, so nothing moves when a flag flips. `uiMediaTone="warning"`
 *   wins over it: a FULL ring in the warning tone. A projected `ui-medal`
 *   wears its own ring: leave the value `null`.
 * - THE PLATE (`[uiHeadlinePlate]`) stands on the ring box's bottom edge.
 * - THE RISE (`--ui-sheet-headline-rise`, the consumer's) lifts the head
 *   into the bar's row, between ‹ and ✕. The glance sets
 *   `calc(var(--modal-sheet-chrome-height) - var(--sys-space-comfortable))`;
 *   the medal's page sets none.
 * - THE STAGE (`uiMediaStage`) gives the face a panel of its own: an
 *   accent wash the column wide, a white spotlight under the ring, the
 *   pass's two discs in its trailing part. A medal's page, not a person's.
 * - THE EXIT: the face, its ring, its plate and its stage leave together,
 *   on the media's OWN view-timeline, before they reach the bar; without
 *   scroll-driven animations they leave with the header's flip.
 *
 * ```html
 * <ui-sheet-headline
 *   uiHeadlineStyle="hero"
 *   [uiMediaTone]="paused() ? 'warning' : null"
 *   [uiMediaValue]="tierProgress()"
 * >
 *   <h2 uiSheetLargeTitle id="page-title" uiText uiFont="title">…</h2>
 *   <p uiText uiFont="callout" uiForegroundStyle="secondary">…</p>
 *   <span uiVisuallyHidden>Злато, още 7 посещения до Платина</span>
 *   <ui-avatar uiHeadlineMedia uiControlSize="extraLarge" [uiName]="name()" />
 *   <span uiHeadlinePlate uiBadge [uiOnMedia]="true" uiIcon="loyalty.tier">Злато</span>
 * </ui-sheet-headline>
 * ```
 *
 * The ring, the plate and the stage belong to the hero: on a `standard`
 * head they draw nothing, and development says so once.
 */
@Component({
  selector: 'ui-sheet-headline',
  imports: [UiGauge],
  template: `
    <div class="ui-sheet-headline__body">
      <div class="ui-sheet-headline__text"><ng-content /></div>
      <span class="ui-sheet-headline__media" aria-hidden="true">
        @if (stage()) {
          <span class="ui-sheet-headline__spot"></span>
          <span class="ui-sheet-headline__motif" data-disc="major"></span>
          <span class="ui-sheet-headline__motif" data-disc="minor"></span>
        }
        @if (ring(); as ring) {
          <ui-gauge
            class="ui-sheet-headline__ring"
            aria-hidden="true"
            uiGaugeStyle="circularCapacity"
            uiControlSize="extraLarge"
            [uiValue]="ring.value"
            [uiMin]="0"
            [uiMax]="1"
            uiLabel=""
            uiValueText=""
            [attr.data-tone]="ring.tone"
          />
        }
        <ng-content select="[uiHeadlineMedia]" />
        <ng-content select="[uiHeadlinePlate]" />
      </span>
    </div>
  `,
  styleUrl: './sheet-headline.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, as every DS component: bare `.ui-*` selectors never match a
  // component's own host under emulated encapsulation.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-sheet-headline',
    '[attr.data-headline-style]': 'uiHeadlineStyle()',
    '[attr.data-folded]': 'uiFolded() ? "" : null',
    '[attr.data-media]': 'media() ? "" : null',
    '[attr.data-media-tone]': 'media() ? uiMediaTone() : null',
    '[attr.data-media-stage]': 'stage() ? "" : null',
    '[attr.data-plate]': 'plated() ? "" : null',
  },
})
export class UiSheetHeadline {
  /** Folded away while a search is engaged. */
  readonly uiFolded = input(false, { transform: booleanAttribute });
  /** ≙ the head's display mode: `hero` centres an `extraLarge` face over the name. */
  readonly uiHeadlineStyle = input<UiHeadlineStyle>('standard');
  /** The ring the face wears; `null` (the default) is no ring. In the hero it wins over `uiMediaValue`. */
  readonly uiMediaTone = input<UiHeadlineMediaTone | null>(null);
  /** Hero only: how full the ring round the face is, 0 … 1; `null` draws no ring and keeps its box. */
  readonly uiMediaValue = input<number | null>(null);
  /** Hero only: the face stands on a stage (a medal's page). */
  readonly uiMediaStage = input(false, { transform: booleanAttribute });

  /** The projected face, when the consumer imported the directive. */
  protected readonly media = contentChild(UiHeadlineMedia);
  /** The projected plate, when the consumer imported the directive. */
  private readonly plate = contentChild(UiHeadlinePlate);

  /** A hero with a face: the one head that draws a ring, a plate, a stage. */
  private readonly heroFace = computed(
    () => this.uiHeadlineStyle() === 'hero' && this.media() !== undefined,
  );

  protected readonly stage = computed(
    () => this.heroFace() && this.uiMediaStage(),
  );

  protected readonly plated = computed(
    () => this.heroFace() && this.plate() !== undefined,
  );

  /** The warning ring is FULL and wins; else the value's arc; else no ring. */
  protected readonly ring = computed<HeadlineRing | null>(() => {
    if (!this.heroFace()) return null;
    if (this.uiMediaTone() === 'warning') return { value: 1, tone: 'warning' };
    const value = this.uiMediaValue();
    if (value === null) return null;
    return {
      value: Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0,
      tone: null,
    };
  });

  constructor() {
    if (isDevMode()) {
      let warned = false;
      effect(() => {
        if (warned || this.uiHeadlineStyle() === 'hero') return;
        const asked = [
          this.uiMediaValue() !== null ? 'uiMediaValue' : null,
          this.uiMediaStage() ? 'uiMediaStage' : null,
          this.plate() !== undefined ? '[uiHeadlinePlate]' : null,
        ].filter((name) => name !== null);
        if (asked.length === 0) return;
        warned = true;
        console.warn(
          `[ui-sheet-headline] ${asked.join(', ')}: the ring, the plate and ` +
            `the stage belong to uiHeadlineStyle="hero"; a standard head ` +
            `draws none of them.`,
        );
      });
    }
  }
}

/**
 * Import bundle: `contentChild` matches only an IMPORTED directive, so a
 * head with a face imports all of it — `UiSheetHeadline` alone projects the
 * face's node but never learns it is there, and draws no media column.
 */
export const UI_SHEET_HEADLINE = [
  UiSheetHeadline,
  UiHeadlineMedia,
  UiHeadlinePlate,
] as const;
