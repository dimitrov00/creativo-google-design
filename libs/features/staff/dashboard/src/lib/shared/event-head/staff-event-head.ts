import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@creativo/ui/controls';

/** A run of a marked line: the typed part of it (`hit`), or the rest. */
export interface StaffEventRun {
  readonly text: string;
  readonly hit: boolean;
}

/**
 * One line under the title — a fact about the booking, a glyph leading it
 * when it needs one. `parts`, when given, draw the SAME text as runs with
 * the matched ones in the primary ink (the add-client page's search).
 */
export interface StaffEventLine {
  readonly text: string;
  readonly icon?: UiIconName;
  readonly testId?: string;
  readonly parts?: readonly StaffEventRun[];
}

/** The frame's block, or the agenda's card: one grammar, two densities. */
export type StaffEventHeadSize = 'compact' | 'regular';

/**
 * An hour that did not happen — a cancellation, a no-show. Both are struck
 * through on the name (owner, 2026-09-10: "the missed event should also
 * appear with strikethrough so it's recognisable"); the glyph in the
 * host's foot still says which.
 */
export function hollowStatus(status: string | null | undefined): boolean {
  return status === 'cancelled' || status === 'no_show';
}

/**
 * THE EVENT'S HEAD — one recipe for the frame's block and the agenda's
 * card (owner, 2026-09-16: "the agenda card should be the same as the grid
 * event, but bigger, so we stay consistent"). The words on the left — the
 * title, then every fact on its own line — and the clock on the right,
 * start over end, the relative reading beneath.
 *
 * Two densities of ONE grammar. `compact` is the frame's: a block scanned
 * at a glance, one line each with an ellipsis, the clock only where the
 * column can spare it, the service riding the title's own line on a block
 * too short for two (`inline`). `regular` is the card's: read at arm's
 * length, every role one step up, lines wrap and nothing truncates. The
 * same leading in both, so the card is the block scaled and not a looser
 * cousin of it.
 *
 * Type is the recipe's own (staff-event-head.css), in longhands: the title
 * in the text face at 600 — who — and every fact line and the clock in the
 * mono face, one advance per glyph, the owner's ruling for data. No `font`
 * shorthand anywhere, so the app's tabular figures are never reset here.
 *
 * Presentational and inert: the host owns the row — its accessible name,
 * its drag, its tap. The STATES it draws are INPUTS, stamped on this host
 * and styled here (`struck`: the name struck through on an hour that did
 * not happen; `receded`: the facts lifted back over the contrast floor on a
 * past card). They used to be the hosts' own rules reaching in by class —
 * which only a host with unscoped styles can do: the agenda's stylesheet is
 * view-scoped, its compiled rule wanted the host's `_ngcontent` mark on a
 * title that lives in THIS view, and the no-show quietly lost its strike
 * (owner, 2026-09-17: "what happened to the no-show being strikethrough?!").
 * A host that is unscoped may still reach in for what is its own (the
 * grid's inert dimming); a state of the head is the head's. The clock is
 * decoration where the host's name already states the times
 * (`timesDecorative`).
 */
@Component({
  selector: 'lib-staff-event-head',
  imports: [UiIcon],
  template: `
    <span class="staff-event-head__lines">
      <span
        class="staff-event-head__title"
        [attr.data-marked]="titleParts() ? '' : null"
      >
        @if (titleParts(); as parts) {
          @for (run of parts; track $index) {
            <span [class.staff-event-head__hit]="run.hit">{{ run.text }}</span>
          }
        } @else {
          {{ title() }}
        }
        @if (inlineLine(); as line) {
          <span class="staff-event-head__sep" aria-hidden="true"> · </span
          ><span class="staff-event-head__inline">{{ line.text }}</span>
        }
      </span>
      @for (line of stackedLines(); track $index) {
        <span
          class="staff-event-head__line"
          [attr.data-testid]="line.testId ?? null"
        >
          @if (line.icon; as icon) {
            <ui-icon [uiName]="icon" aria-hidden="true" />
          }
          <span
            class="staff-event-head__text"
            [attr.data-marked]="line.parts ? '' : null"
          >
            @if (line.parts; as parts) {
              @for (run of parts; track $index) {
                <span [class.staff-event-head__hit]="run.hit">{{
                  run.text
                }}</span>
              }
            } @else {
              {{ line.text }}
            }
          </span>
        </span>
      }
    </span>
    @if (start() || end() || gloss()) {
      <span
        class="staff-event-head__times"
        [attr.aria-hidden]="timesDecorative() ? 'true' : null"
        [attr.data-testid]="timesTestId()"
      >
        @if (start(); as start) {
          <span class="staff-event-head__start">{{ start }}</span>
        }
        @if (end(); as end) {
          <span class="staff-event-head__end">{{ end }}</span>
        }
        @if (gloss(); as gloss) {
          <span
            class="staff-event-head__gloss"
            [attr.data-testid]="glossState() ? 'staff-event-state' : null"
            >{{ gloss }}</span
          >
        }
      </span>
    }
  `,
  styleUrl: './staff-event-head.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every recipe in this feature: `.staff-event-head__*` is
  // the contract, and the hosts' state rules must be able to reach in.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'staff-event-head',
    '[attr.data-size]': 'size()',
    '[attr.data-struck]': "struck() ? '' : null",
    '[attr.data-receded]': "receded() ? '' : null",
    '[attr.data-truncate]': "truncate() ? '' : null",
    '[attr.data-gloss-state]': "glossState() ? '' : null",
  },
})
export class StaffEventHead {
  /** Who — the one line in the text face. */
  readonly title = input.required<string>();
  /**
   * The title as RUNS, the typed ones marked — a search result's name
   * (2026-09-22). Null draws `title` plain; the accessible text is the same
   * either way.
   */
  readonly titleParts = input<readonly StaffEventRun[] | null>(null);
  /** Every fact under the title, in the host's order; an empty list is no lines. */
  readonly lines = input<readonly StaffEventLine[]>([]);
  /** The first line rides the title's own line — a quarter-hour block holds one. */
  readonly inline = input(false);
  readonly start = input<string | null>(null);
  readonly end = input<string | null>(null);
  /** The relative reading under the clock — «след 2 ч». */
  readonly gloss = input<string | null>(null);
  /**
   * The gloss names a STATE, not a time — «Отказан», «Не дойде»
   * (owner, 2026-09-24: "so it's instantly recognised"): it takes the
   * foreground ink and the weight, so it outranks the clock above it.
   */
  readonly glossState = input(false);
  readonly size = input<StaffEventHeadSize>('regular');
  /** An hour that did not happen: the name is struck through. */
  readonly struck = input(false);
  /** A past hour: the fact lines lift back over the contrast floor of a faded card. */
  readonly receded = input(false);
  /** The host's accessible name already states the times: the clock is decoration. */
  readonly timesDecorative = input(false);
  /**
   * One line each with an ellipsis, whatever the size — a PICKER row is
   * scanned down a list, not read at arm's length (2026-09-22). `compact`
   * truncates on its own; this asks the same of `regular`.
   */
  readonly truncate = input(false);
  readonly timesTestId = input<string | null>(null);

  protected readonly inlineLine = computed(() =>
    this.inline() ? (this.lines()[0] ?? null) : null,
  );

  protected readonly stackedLines = computed(() =>
    this.inline() ? this.lines().slice(1) : this.lines(),
  );
}
