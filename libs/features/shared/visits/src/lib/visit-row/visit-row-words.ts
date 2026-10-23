import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import { UiBadge, UiIcon } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { StaffEventHead } from '../event-head/staff-event-head';
import {
  TrailingFactFace,
  VisitRowEntry,
  VisitRowOutcome,
  type VisitRowVm,
  type VisitTrailingFact,
} from '../visit-row.vm';

/**
 * A STAFF ROW'S WORDS (client-card revision 3 §2.5, §3.11) — the event
 * head, with the staff's fact at the end of its SECOND line.
 *
 * The title keeps the whole text column and wraps when it must, so a
 * two-service visit is never cut to make room for money; under it the
 * fact line gives way to the fact, which never shrinks: the marks (photos
 * counted, a discount, a voucher) and then ONE of the amount paid, a state
 * in words beside its glyph, or the capsule «Този час». A quote, a third
 * line, runs the whole width again.
 *
 * The head is MOUNTED, never re-drawn: its title, its fact lines, its held
 * run and its quote are its own. What this part adds is the place of the
 * fact among the head's lines, and that needs the two in ONE grid: the
 * head and its run of lines step out of the layout (`display: contents`)
 * and their lines become this grid's items beside the fact. That is a
 * host's layout over the head's published classes
 * (`.staff-event-head__*`), which is why this part is unscoped, as the
 * schedule's grid and timeline are. The better home is a slot of the head
 * itself (a figure at the end of its first fact line): the head is not
 * this package's file, so it is asked for in the round's contract deltas.
 *
 * Decoration to a reader: the row's sentence says every fact, so the
 * whole part is hidden from it.
 */
@Component({
  selector: 'lib-visit-row-words',
  imports: [
    StaffEventHead,
    UiBadge,
    UiForegroundStyleDirective,
    UiIcon,
    UiTextDirective,
  ],
  templateUrl: './visit-row-words.html',
  styleUrl: './visit-row-words.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'visit-row-words',
    'aria-hidden': 'true',
    '[attr.data-lead-whole]': "leadWhole() ? '' : null",
  },
})
export class VisitRowWords {
  readonly vm = input.required<VisitRowVm>();
  /** What ends the second line; null draws the marks alone, or nothing. */
  readonly fact = input<VisitTrailingFact>(null);
  /**
   * A waiting request's lines wrap and are never cut (wave D r3); a
   * visit's fact line keeps to one line, its barber held against the
   * ellipsis.
   */
  readonly wraps = input(false);

  /** The fact's faces, for the template's `@case`s. */
  protected readonly TrailingFactFace = TrailingFactFace;

  /** Where the quote sits, for a test to find it: `history-row-{id}-quote`. */
  protected readonly quoteTestId = computed(() =>
    this.vm().quote === null ? null : `${this.vm().testId}-quote`,
  );

  /** The end of the second line is drawn only when it holds something. */
  protected readonly ends = computed(
    () => this.fact() !== null || this.vm().marks.length > 0,
  );

  /**
   * A cancelled visit's first line is its status word, whole — the one
   * fact the row is about (review r5) — so the line takes its own width
   * as its basis, not the floor: the struck amount stays beside it where
   * both fit and drops to a line of its own where they do not
   * (visit-row-words.css, "a status-led row").
   */
  protected readonly leadWhole = computed(
    () =>
      this.vm().visitRowEntry === VisitRowEntry.Visit &&
      this.vm().outcome === VisitRowOutcome.Cancelled,
  );
}
