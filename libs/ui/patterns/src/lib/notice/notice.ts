import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterEveryRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';

/**
 * What the notice is about, carried by its glyph and its wash — never by
 * the title's ink. `neutral` is a fact (a pinned note, saved data, a module
 * that did not load, a suggestion: nothing has happened yet); `accent` a
 * thing in progress (a pending approval); `warning` a restriction in force
 * (a pause); `destructive` a refusal.
 */
export type UiNoticeTone = 'neutral' | 'accent' | 'warning' | 'destructive';

/**
 * Whether the notice speaks when it appears. `off` (the default) is a
 * standing fact, read in order with the page (`role="note"`); `polite` a
 * status a reader hears when it lands (`role="status"`); `assertive` a
 * refusal that interrupts (`role="alert"`) — composer refusals only.
 */
export type UiNoticeAnnounce = 'off' | 'polite' | 'assertive';

/**
 * The mark a tone wears when the consumer names none. A warning and a
 * refusal are told apart from a plain fact at a glance, on every screen,
 * by the same two glyphs — never by a wash alone, which a reader in a
 * hurry (or one who does not see the hue) takes for a note. A fact and a
 * thing in progress have no mark of their own: theirs is the consumer's
 * (a cloud, a cake), or none.
 */
const TONE_GLYPH: Readonly<Record<UiNoticeTone, UiIconName | null>> = {
  neutral: null,
  accent: null,
  warning: 'notice.warning',
  destructive: 'notice.refusal',
};

let nextTitleId = 0;

/**
 * THE NOTICE — a standing fact in the flow of a page: a pause in force, a
 * pinned note, data read offline, a module that failed with its retry, a
 * refusal. The one retry grammar of the stack: a page or a module that
 * could not load says so here, with «Опитай пак» projected as its action.
 *
 * A sibling of the list segments, not a card: the grouped segment's fill
 * (a tone washes it at `--sys-alpha-tint`, opaque, never translucent), the
 * segment's prominent corner, no border, no shadow. The glyph and the wash
 * carry the tone: the glyph is bare, in the tone's own colour — the same
 * in every tone — and the wash is that tone over white. A warning and a
 * refusal ALWAYS wear their mark, so they are never mistaken for a note; the TITLE and the FACTS stay in the foreground ink in
 * every tone, because the tone's own text cut drops under AA on its own
 * wash, and a title that changed colour with the tone would read as a
 * different thing each time.
 *
 * Slots: `[uiNoticeTitle]` (the consumer's `h3` or `p`, in its outline —
 * with `tabindex="-1"` when focus may need to land on it), the default
 * slot for the fact lines, `[uiNoticeActions]` for the consumer's
 * `uiButton`s (bordered, neutral, regular: 44, never small). Without a
 * title the notice is COMPACT — one line of facts, its action beside it —
 * and `uiLabel` names it («Закачена бележка»); with one, the title names
 * it (`aria-labelledby`, the title's own id or one the notice gives it).
 *
 * It never dismisses itself, never floats and never holds a disabled
 * action: a notice with nothing left for the viewer to do shows its facts
 * alone. It does not animate itself either — a consumer inserting one
 * live runs the enter on its own host.
 *
 * @uiPurpose A standing message in the flow of a page (a pause, a warning,
 *   a failed load with its retry) that stays until the fact changes.
 * @uiSwiftUI none
 * @uiAliases banner, callout, inline alert, info box, error message, retry
 * @uiNotThis A receipt that leaves by itself is `ui-toast`; a question that
 *   blocks the screen until it is answered is `ui-alert`.
 */
@Component({
  selector: 'ui-notice',
  imports: [UiIcon],
  template: `
    @if (glyph(); as icon) {
      <ui-icon class="ui-notice__glyph" [uiName]="icon" uiScale="medium" />
    }
    <div class="ui-notice__content">
      <ng-content select="[uiNoticeTitle]" />
      <div class="ui-notice__facts"><ng-content /></div>
      <div class="ui-notice__actions">
        <ng-content select="[uiNoticeActions]" />
      </div>
    </div>
  `,
  styleUrl: './notice.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-notice__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-notice',
    '[attr.data-tone]': 'uiTone()',
    '[attr.role]': 'role()',
    '[attr.aria-labelledby]': 'titleId()',
    '[attr.aria-label]': 'titleId() ? null : uiLabel()',
  },
})
export class UiNotice {
  readonly uiTone = input<UiNoticeTone>('neutral');
  /**
   * The glyph, leading, aligned to the first line. Left out, a warning and
   * a refusal wear their tone's own mark (`TONE_GLYPH`), so every one of
   * them reads the same; a consumer names one only when the notice is
   * about a particular thing (data read offline, a birthday).
   */
  readonly uiIcon = input<UiIconName | null>(null);
  readonly uiAnnounce = input<UiNoticeAnnounce>('off');
  /** The accessible name when no title is projected (a compact notice). */
  readonly uiLabel = input<string | null>(null);

  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The projected title's id, once it is there; the title then names the notice. */
  protected readonly titleId = signal<string | null>(null);

  /** The consumer's glyph, else the tone's own. */
  protected readonly glyph = computed(
    () => this.uiIcon() ?? TONE_GLYPH[this.uiTone()],
  );

  protected readonly role = computed(() => {
    switch (this.uiAnnounce()) {
      case 'polite':
        return 'status';
      case 'assertive':
        return 'alert';
      default:
        return 'note';
    }
  });

  constructor() {
    // The title is a projected attribute-marked element, not an imported
    // directive, so a content query cannot see it: the notice reads its
    // own content after each render and keeps the name pointing at the
    // title that is there — a title added or removed later re-points it.
    afterEveryRender({
      write: () => {
        const title = this.host.querySelector<HTMLElement>(
          ':scope > .ui-notice__content > [uiNoticeTitle]',
        );
        if (title && !title.id) {
          title.id = `ui-notice-title-${nextTitleId++}`;
        }
        const id = title?.id ?? null;
        if (id !== this.titleId()) this.titleId.set(id);
      },
    });
  }
}
