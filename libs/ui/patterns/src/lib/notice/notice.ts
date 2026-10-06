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
 * carry the tone; the TITLE and the FACTS stay in the foreground ink in
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
 */
@Component({
  selector: 'ui-notice',
  imports: [UiIcon],
  template: `
    @if (uiIcon(); as icon) {
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
  /** The tone's glyph, leading, aligned to the first line. */
  readonly uiIcon = input<UiIconName | null>(null);
  readonly uiAnnounce = input<UiNoticeAnnounce>('off');
  /** The accessible name when no title is projected (a compact notice). */
  readonly uiLabel = input<string | null>(null);

  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The projected title's id, once it is there; the title then names the notice. */
  protected readonly titleId = signal<string | null>(null);

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
