import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';

/** One thing a check list offers. */
export interface UiCheckOption {
  readonly id: string;
  readonly label: string;
  /** A quieter second fact on the trailing edge (an address, a count). */
  readonly detail?: string;
  /** The row's `data-testid`, when a test needs to find it. */
  readonly testId?: string;
}

/** What a mark shows: all of it, none of it, or part of it. */
export const UiCheckState = {
  On: 'ON',
  Off: 'OFF',
  Mixed: 'MIXED',
} as const;
export type UiCheckState = (typeof UiCheckState)[keyof typeof UiCheckState];

/**
 * ≙ SwiftUI `Toggle(sources:isOn:)` over a `List` of `Toggle`s — a list
 * where SEVERAL things may be chosen, headed by one row that stands for all
 * of them.
 *
 * ### The shape
 * ONE surface — a single card, never a run of separated segments (owner,
 * 2026-11-27: seams between the rows cut the tree apart). Its rows are the
 * list's own, not `ui-list-row`: a row here is a branch of one thing, not
 * an item of a list. The HEAD row («Всички салони») carries a mark with
 * three states: a check when everything under it is chosen, a dash when
 * some is, an empty ring when none is. Tapping it chooses everything, or —
 * when everything already is — clears it. Each thing under it is a row of
 * its own with the same mark, hung from the head by a TRACE: a hairline
 * that drops from the head's mark and turns into each row. The trace is
 * what says "these belong to that one" without an indent's guesswork, and
 * the ring is what says "more than one" before anything is tapped.
 *
 * ### The motion
 * A mark turning on fills from its centre on the snappy spring while its
 * check draws itself; a dash and a check trade places by drawing over each
 * other, never by a swap. When the head chooses everything the rows answer
 * one after another, a beat apart, so the eye reads the cause.
 *
 * ### Data in, ids out
 * The owner holds the chosen ids; the list reports the new ones
 * (`uiSelectedIdsChange`), in the options' own order. It keeps no state.
 *
 * @uiPurpose Choosing several things from a short list, with one head row
 *   that stands for all of them and shows when only some are chosen.
 * @uiSwiftUI `Toggle(sources:isOn:)` heading a `List` of `Toggle`s
 * @uiAliases checklist, checkboxes, multi-select, multiselect, select all,
 *   tri-state, indeterminate, check tree, pick several
 * @uiNotThis One answer from a few is `ui-segmented-control` or
 *   `ui-choice-menu`; a filter that narrows a list is `uiChip`; one setting
 *   that takes effect at once is `uiSwitch`.
 */
@Component({
  selector: 'ui-check-list',
  imports: [UiInteractiveDirective],
  template: `
    <div
      class="ui-check-list__surface"
      role="group"
      [attr.aria-label]="uiLabel()"
    >
      <button
        type="button"
        role="checkbox"
        class="ui-check-list__row ui-check-list__head"
        uiInteractive
        [disabled]="uiDisabled()"
        [attr.aria-checked]="ariaChecked(allState())"
        [attr.data-testid]="uiAllTestId() ?? null"
        (click)="toggleAll()"
      >
        <span
          class="ui-check-list__mark"
          aria-hidden="true"
          [attr.data-state]="allState()"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path
              class="ui-check-list__check"
              pathLength="1"
              d="M7 12.6l3.3 3.3L17 9"
            />
            <path class="ui-check-list__dash" pathLength="1" d="M7.5 12h9" />
          </svg>
        </span>
        <span class="ui-check-list__label">{{ uiAllLabel() }}</span>
        @if (uiSummary(); as summary) {
          <span class="ui-check-list__detail">{{ summary }}</span>
        }
      </button>
      @for (option of uiOptions(); track option.id; let index = $index) {
        <button
          type="button"
          role="checkbox"
          class="ui-check-list__row ui-check-list__item"
          uiInteractive
          [disabled]="uiDisabled()"
          [style.--ui-check-order]="index"
          [attr.aria-checked]="chosen().has(option.id)"
          [attr.data-testid]="option.testId ?? null"
          (click)="toggle(option.id)"
        >
          <span
            class="ui-check-list__mark"
            aria-hidden="true"
            [attr.data-state]="chosen().has(option.id) ? 'ON' : 'OFF'"
          >
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                class="ui-check-list__check"
                pathLength="1"
                d="M7 12.6l3.3 3.3L17 9"
              />
            </svg>
          </span>
          <span class="ui-check-list__label">{{ option.label }}</span>
          @if (option.detail) {
            <span class="ui-check-list__detail">{{ option.detail }}</span>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './check-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-check-list',
    '[attr.data-invalid]': 'uiInvalid() ? "" : null',
  },
})
export class UiCheckList {
  /** The things offered, in the order they are listed. */
  readonly uiOptions = input.required<readonly UiCheckOption[]>();
  /** The ids chosen. An id no option holds is ignored. */
  readonly uiSelectedIds = input.required<readonly string[]>();
  /** The head row's words — «Всички салони». */
  readonly uiAllLabel = input.required<string>();
  /** The group's accessible name. */
  readonly uiLabel = input.required<string>();
  /** A quiet fact on the head's trailing edge — «2 от 3». */
  readonly uiSummary = input<string | null>(null);
  readonly uiAllTestId = input<string | null>(null);
  readonly uiDisabled = input(false, { transform: booleanAttribute });
  /** Nothing is chosen where something must be: the empty rings say so. */
  readonly uiInvalid = input(false, { transform: booleanAttribute });

  /** The chosen ids, in the options' order. */
  readonly uiSelectedIdsChange = output<readonly string[]>();

  protected readonly chosen = computed(() => {
    const offered = new Set(this.uiOptions().map((option) => option.id));
    return new Set(this.uiSelectedIds().filter((id) => offered.has(id)));
  });

  protected readonly allState = computed((): UiCheckState => {
    const count = this.chosen().size;
    if (count === 0) return UiCheckState.Off;
    return count === this.uiOptions().length
      ? UiCheckState.On
      : UiCheckState.Mixed;
  });

  protected ariaChecked(state: UiCheckState): 'true' | 'false' | 'mixed' {
    return state === UiCheckState.On
      ? 'true'
      : state === UiCheckState.Mixed
        ? 'mixed'
        : 'false';
  }

  /** The head: everything, or — when everything already is — nothing. */
  protected toggleAll(): void {
    this.uiSelectedIdsChange.emit(
      this.allState() === UiCheckState.On
        ? []
        : this.uiOptions().map((option) => option.id),
    );
  }

  protected toggle(id: string): void {
    const chosen = this.chosen();
    this.uiSelectedIdsChange.emit(
      this.uiOptions()
        .map((option) => option.id)
        .filter((each) => (each === id ? !chosen.has(each) : chosen.has(each))),
    );
  }
}
