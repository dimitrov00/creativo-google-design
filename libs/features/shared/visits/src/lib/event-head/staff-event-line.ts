import type { UiIconName } from '@creativo/ui/controls';

/*
 * The event head's LINES, apart from the component that draws them: a row's
 * view model (`visit-row.vm.ts`) and the pure builders that fill it name
 * these shapes without reaching for an Angular component, and the head
 * (`lib-staff-event-head`) takes them as its `lines` input.
 */

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
  /**
   * The line's closing run, which no ellipsis takes. It is the END of
   * `text` with its joint included: « · Иван» of «Младост · Иван». Where
   * the head keeps its lines to one line, the runs before it truncate
   * first, so a long shop name can never push out who did the cut
   * (client-card redesign, wave D r2). `text` is still the whole line as
   * read. A line that wraps, or one drawn as marked `parts`, draws `text`
   * whole.
   */
  readonly hold?: string;
}
