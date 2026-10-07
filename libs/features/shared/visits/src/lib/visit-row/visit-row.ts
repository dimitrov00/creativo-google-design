import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { UiAvatar, UiDateTile, UiIcon, UiListRow } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import { StaffEventHead } from '../event-head/staff-event-head';
import type {
  VisitPerspective,
  VisitRowVm,
  VisitTrailing,
  VisitTrailingFact,
} from '../visit-row.vm';
import { VisitRowWords } from './visit-row-words';

/**
 * ONE VISIT, ONE ROW (client-card redesign §5.3.3–§5.3.5; revision 3 §2.5,
 * §3.11) — the row both visit lists draw.
 *
 * Every part is a DS part: the date stamp is `ui-date-tile`, the words are
 * the staff schedule's own event head (title, one fact line, the client's
 * quote), and the trailing edge is the barber's FACE in both perspectives:
 * that is the sameness of the two screens. This component only chooses
 * which element carries them and lays them out; it restyles none of them.
 *
 * What a STAFF row adds is the staff's fact, at the end of its second
 * line (`lib-visit-row-words`): the marks (photos counted, a discount, a
 * voucher), then the amount paid, a state in words beside its glyph, or
 * the capsule «Този час». Its title wraps, so what was done is never cut;
 * and the face's column is RESERVED on every visit's row, face or not (a
 * visit cut by several draws none), so the facts of a list end on one
 * vertical line and the amounts read as a column.
 *
 * The ELEMENT is the host's to say (`interactive`), the perspective's
 * when it says nothing:
 * - client → `button[uiListRow]`: tapping opens the visit's sheet, so the
 *   row is the control, named by its sentence (`aria-label`), and keeps
 *   the ids «Моите часове» and its e2e rely on (`appointment-row`,
 *   `data-appointment-id`, `data-status`).
 * - staff → a static `ui-list-row`: a barber reads a history, nothing opens
 *   (old R7), so the row is text — its sentence in a visually hidden line,
 *   the drawn parts hidden from the reader so nothing is heard twice.
 *
 * A row is a row: the featured card of the glance and of `/account` is
 * `lib-visit-card` (§3.10), with its own thumbs and its own `large` stamp.
 * Every row's stamp is the list's `regular` rung.
 *
 * The HOST is the list item (`role="listitem"`), so a consumer sets
 * `lib-visit-row`s straight into a `ul` — `ul[uiListGroup]` treats the
 * host as the one transparent wrapper its segments allow.
 *
 * A row NEVER carries a `›`: the client's opens a sheet, the staff's opens
 * nothing, and the sentence says every fact the eye reads — the date, the
 * status word, the price, the marks and the whole quote.
 */
@Component({
  selector: 'lib-visit-row',
  imports: [
    NgTemplateOutlet,
    StaffEventHead,
    VisitRowWords,
    UiAvatar,
    UiDateTile,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListRow,
    UiTextDirective,
    UiVisuallyHiddenDirective,
  ],
  templateUrl: './visit-row.html',
  styleUrl: './visit-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'listitem',
  },
})
export class VisitRow {
  readonly vm = input.required<VisitRowVm>();
  readonly perspective = input.required<VisitPerspective>();
  /**
   * Whether the row is a control. `null` is the perspective's own: the
   * client's row is a button, the staff's is static (revision 3 §3.11;
   * owner question Q6 sets it for the staff history).
   */
  readonly interactive = input<boolean | null>(null);
  /** The row was tapped: the host opens that visit. */
  readonly open = output<void>();

  /** Which element carries the parts. */
  protected readonly shape = computed<'button' | 'static'>(() =>
    (this.interactive() ?? this.perspective() === 'client')
      ? 'button'
      : 'static',
  );

  /**
   * The staff's layout: the words with the fact at the end of their second
   * line, the face in its reserved column. The client's row is as it was.
   */
  protected readonly staff = computed(() => this.perspective() === 'staff');

  /**
   * A waiting request's words wrap and are never cut. Its state has a fact
   * line of its own, and it is a plain row on the glance with no neighbour
   * to keep level, so a long list of days takes a second line rather than
   * an ellipsis (wave D r3): the head cuts nothing, and the list row's
   * label wraps (`uiLabelWraps`, `.lineLimit(nil)`). Every other row keeps
   * to one line each.
   */
  protected readonly wraps = computed(() => this.vm().kind === 'waitlist');

  /** Where the quote sits, for a test to find it: `history-row-{id}-quote`. */
  protected readonly quoteTestId = computed(() =>
    this.vm().quote === null ? null : `${this.vm().testId}-quote`,
  );

  /** The staff's fact, at the end of the second line; null on the client's row. */
  protected readonly fact = computed<VisitTrailingFact>(
    () => this.vm().trailingFact,
  );

  /** Who cut, as the trailing face; null where the row names nobody. */
  protected readonly face = computed<VisitTrailing>(() => this.vm().trailing);

  /**
   * The face's column is reserved on every VISIT of a staff list, face or
   * not, so the facts end on one line down the list. A waiting request
   * states no fact and keeps its whole width for its words.
   */
  protected readonly reservesFace = computed(
    () => this.staff() && this.vm().kind === 'visit',
  );

  /**
   * A staff row's label wraps (its title is never cut), and so does a
   * waiting request's; a client's row keeps to one line each.
   */
  protected readonly labelWraps = computed(() => this.staff() || this.wraps());

  /** The client's trailing edge is drawn only when it holds something. */
  protected readonly hasTrailing = computed(
    () => this.face() !== null || this.vm().marks.length > 0,
  );
}
