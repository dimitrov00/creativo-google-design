import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { UiControlSize } from '../button/button';

export type UiDateFieldSegment = 'day' | 'month' | 'year';

/** Numeric calendar-date segments — validation is the CONSUMER's (a domain VO decides what a legal date is). */
export interface UiDateFieldParts {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/**
 * Blur payload for validate-on-blur consumers: `empty` (untouched — an
 * optional field stays quiet), `partial` (some segments filled — worth an
 * "incomplete" nudge), or `complete` with the parts to validate.
 */
export type UiDateFieldBlurEvent =
  | { readonly kind: 'empty' }
  | { readonly kind: 'partial' }
  | { readonly kind: 'complete'; readonly parts: UiDateFieldParts };

type UiDateSlotState = 'active' | 'filled' | 'idle';

const SEGMENT_LENGTH: Record<UiDateFieldSegment, number> = {
  day: 2,
  month: 2,
  year: 4,
};

const SEGMENT_AUTOCOMPLETE: Record<UiDateFieldSegment, string> = {
  day: 'bday-day',
  month: 'bday-month',
  year: 'bday-year',
};

let nextUniqueId = 0;

/**
 * Segmented calendar-date entry — the GOV.UK date-input pattern styled as
 * a FIRST-CLASS input group: three individually labeled numeric inputs
 * ([DD] [MM] [YYYY]) grouped in a real `fieldset`+`legend`, plain
 * `type="text" inputmode="numeric"` (never spinbuttons), per-segment
 * `autocomplete="bday-*"`, hint + error slots below (footnote/caption
 * quiet-text convention, shared with `ui-phone-field`).
 *
 * The slots deliberately wear the SAME surface/border tokens as sibling
 * text fields, NOT `ui-otp-field`'s gray slots (owner-commissioned
 * research 2026-07-25: gray fill is the industry-wide DISABLED encoding —
 * Apple dims to gray, M3 uses low-alpha fills, Polaris names the token
 * `bg-surface-disabled` — and the OTP costume drags OTP expectations into
 * a personal-data field).
 *
 * Segment ORDER and LABELS are inputs — locales differ, so nothing is
 * hardcoded (English defaults only, same policy as the phone picker
 * chrome). NO auto-advance (GOV.UK: "never automatically tab users
 * between the fields of the date input"; USWDS concurs) — Tab/Shift-Tab
 * are never intercepted; Backspace in an empty segment moves back as a
 * pure correction aid, and a paste of the full date ('03.07.1990',
 * '03071990') into any segment distributes across all three.
 *
 * Value contract: `value` is `UiDateFieldParts | null` — non-null ONLY
 * while all three segments are complete. Whether those parts form a REAL
 * calendar date is the consumer's call (a domain VO), reported back via
 * the `error` input; `uiBlurred` fires when focus leaves the whole group
 * (validate on blur, never per keystroke).
 */
@Component({
  selector: 'ui-date-field',
  templateUrl: './date-field.html',
  styleUrl: './date-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-date-field',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-invalid]': 'error() ? "" : null',
    '[attr.data-disabled]': 'disabled() ? "" : null',
    '(focusout)': 'onGroupFocusOut($event)',
  },
})
export class UiDateField {
  /** The shared 36/44/52 control ladder — match the tier of neighboring fields. */
  readonly uiControlSize = input<UiControlSize>('regular');
  /** Complete segments (two-way) — `null` while any segment is unfinished. */
  readonly value = model<UiDateFieldParts | null>(null);
  /** Display order — locales differ ([['year','month','year']] never hardcoded). */
  readonly uiOrder = input<readonly UiDateFieldSegment[]>([
    'day',
    'month',
    'year',
  ]);
  /** Visible group label, rendered as the fieldset's legend. */
  readonly label = input('');
  /**
   * ≙ SwiftUI `.labelsHidden()` — suppresses the VISIBLE legend while it
   * keeps naming the fieldset for assistive tech. For when the surrounding
   * chrome already says it out loud (a sheet whose large title is
   * "Date of birth" shouldn't repeat itself one line down), which is the
   * same reasoning behind `ui-stepper`'s `uiLabelsHidden`.
   */
  readonly uiLabelHidden = input(false, { transform: booleanAttribute });
  /** Secondary helper line under the segments (caption tier). */
  readonly hint = input<string | null>(null);
  /** Consumer-decided error copy — renders destructive + `role="alert"`. */
  readonly error = input<string | null>(null);
  readonly disabled = input(false);

  /* Per-segment accessible labels + placeholders — English defaults,
     consumer-localizable (the DS layer has no i18n runtime). */
  readonly dayLabel = input('Day');
  readonly monthLabel = input('Month');
  readonly yearLabel = input('Year');
  readonly dayPlaceholder = input('DD');
  readonly monthPlaceholder = input('MM');
  readonly yearPlaceholder = input('YYYY');

  /** Focus left the WHOLE group — the consumer's validate-on-blur moment. */
  readonly uiBlurred = output<UiDateFieldBlurEvent>();

  private readonly uniqueId = `ui-date-field-${nextUniqueId++}`;
  protected readonly hintId = `${this.uniqueId}-hint`;
  protected readonly errorId = `${this.uniqueId}-error`;

  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly texts: Record<
    UiDateFieldSegment,
    ReturnType<typeof signal<string>>
  > = {
    day: signal(''),
    month: signal(''),
    year: signal(''),
  };

  protected readonly focusedSegment = signal<UiDateFieldSegment | null>(null);

  protected readonly describedBy = computed(() => {
    const ids = [
      this.hint() ? this.hintId : null,
      this.error() ? this.errorId : null,
    ].filter((id): id is string => id !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  /** Last value this component itself synced — breaks the model feedback
   *  loop so only EXTERNAL writes re-drive the segment texts. */
  private lastSyncedValue: UiDateFieldParts | null = null;

  constructor() {
    // External `value` writes (prefill) repopulate the segments; `null`
    // clears them only when the write is genuinely external.
    effect(() => {
      const external = this.value();
      if (partsEqual(external, this.lastSyncedValue)) return;
      this.lastSyncedValue = external;
      untracked(() => {
        this.texts.day.set(
          external ? String(external.day).padStart(2, '0') : '',
        );
        this.texts.month.set(
          external ? String(external.month).padStart(2, '0') : '',
        );
        this.texts.year.set(
          external ? String(external.year).padStart(4, '0') : '',
        );
      });
    });
  }

  protected textFor(segment: UiDateFieldSegment): string {
    // eslint-disable-next-line security/detect-object-injection -- `segment` is one of the three `UiDateFieldSegment` literals off `uiOrder()`, never external input.
    return this.texts[segment]();
  }

  protected lengthFor(segment: UiDateFieldSegment): number {
    // eslint-disable-next-line security/detect-object-injection -- `segment` is one of the three `UiDateFieldSegment` literals, never external input.
    return SEGMENT_LENGTH[segment];
  }

  protected autocompleteFor(segment: UiDateFieldSegment): string {
    // eslint-disable-next-line security/detect-object-injection -- `segment` is one of the three `UiDateFieldSegment` literals, never external input.
    return SEGMENT_AUTOCOMPLETE[segment];
  }

  protected labelFor(segment: UiDateFieldSegment): string {
    switch (segment) {
      case 'day':
        return this.dayLabel();
      case 'month':
        return this.monthLabel();
      case 'year':
        return this.yearLabel();
    }
  }

  protected placeholderFor(segment: UiDateFieldSegment): string {
    switch (segment) {
      case 'day':
        return this.dayPlaceholder();
      case 'month':
        return this.monthPlaceholder();
      case 'year':
        return this.yearPlaceholder();
    }
  }

  protected stateFor(segment: UiDateFieldSegment): UiDateSlotState {
    if (this.focusedSegment() === segment) return 'active';
    return this.textFor(segment) !== '' ? 'filled' : 'idle';
  }

  protected onInput(index: number, event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const segment = this.segmentAt(index);
    const length = this.lengthFor(segment);
    const digits = inputEl.value.replace(/\D/g, '');
    if (digits.length > length) {
      // Autofill / programmatic multi-char entry — distribute like a paste.
      this.distribute(index, inputEl.value, inputEl);
      return;
    }
    this.setText(segment, digits);
    inputEl.value = digits;
    if (digits.length === length) {
      // Auto-advance on a COMPLETE segment — owner decision 2026-07-25,
      // made knowingly against GOV.UK/USWDS guidance ("never automatically
      // tab…"): the flow-feel wins for this product. Constrained to the
      // unambiguous 2/2/4 completion; Tab/Shift-Tab are never intercepted
      // and Backspace-on-empty moves back, so correction stays cheap.
      this.focusSlot(inputEl, index + 1);
    }
    this.emit();
  }

  protected onPaste(index: number, event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text) return;
    event.preventDefault();
    this.distribute(index, text, event.target as HTMLInputElement);
  }

  protected onKeydown(index: number, event: KeyboardEvent): void {
    // Backspace in an EMPTY segment moves focus back; Tab/Shift-Tab are
    // never intercepted (GOV.UK constraint).
    if (
      event.key === 'Backspace' &&
      this.textFor(this.segmentAt(index)) === '' &&
      index > 0
    ) {
      this.focusSlot(event.target as HTMLInputElement, index - 1);
    }
  }

  protected onSegmentFocus(segment: UiDateFieldSegment): void {
    this.focusedSegment.set(segment);
  }

  protected onSegmentBlur(segment: UiDateFieldSegment, event: Event): void {
    if (this.focusedSegment() === segment) {
      this.focusedSegment.set(null);
    }
    // A lone '3' in day/month is unambiguous once the user moves on —
    // zero-pad so the completeness rule (2/2/4 digits) doesn't punish it.
    const text = this.textFor(segment);
    if (segment !== 'year' && text.length === 1) {
      const padded = text.padStart(2, '0');
      this.setText(segment, padded);
      (event.target as HTMLInputElement).value = padded;
      this.emit();
    }
  }

  /** Fires `uiBlurred` only when focus leaves the WHOLE group. */
  protected onGroupFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.hostRef.nativeElement.contains(next)) {
      return;
    }
    const parts = this.completeParts();
    if (parts) {
      this.uiBlurred.emit({ kind: 'complete', parts });
      return;
    }
    const anyFilled =
      this.texts.day() !== '' ||
      this.texts.month() !== '' ||
      this.texts.year() !== '';
    this.uiBlurred.emit(anyFilled ? { kind: 'partial' } : { kind: 'empty' });
  }

  /**
   * Distributes a pasted/autofilled date across the segments. Separator
   * form ('03.07.1990', '3/7/1990') maps its three groups onto the display
   * order (padding day/month); a bare digit run of the full length
   * ('03071990') fills all segments from the first; anything shorter fills
   * forward from the receiving segment.
   */
  private distribute(
    startIndex: number,
    text: string,
    origin: HTMLInputElement,
  ): void {
    const order = this.uiOrder();
    const groups = text.split(/\D+/).filter((group) => group !== '');

    if (groups.length === order.length) {
      const padded = order.map((segment, index) => {
        // eslint-disable-next-line security/detect-object-injection -- `index` is a numeric loop offset into the component's own order array.
        const group = groups[index] ?? '';
        return group.padStart(this.lengthFor(segment), '0');
      });
      if (
        padded.every((g, i) => g.length === this.lengthFor(order[i] ?? 'day'))
      ) {
        order.forEach((segment, index) => {
          // eslint-disable-next-line security/detect-object-injection -- `index` is a numeric loop offset into the component's own order array.
          this.setText(segment, padded[index] ?? '');
        });
        origin.value = this.textFor(this.segmentAt(startIndex));
        this.focusSlot(origin, order.length - 1);
        this.emit();
        return;
      }
    }

    const digits = text.replace(/\D/g, '');
    if (!digits) {
      origin.value = this.textFor(this.segmentAt(startIndex));
      return;
    }
    const total = order.reduce(
      (sum, segment) => sum + this.lengthFor(segment),
      0,
    );
    const from = digits.length >= total ? 0 : startIndex;
    let cursor = 0;
    let lastWritten = from;
    for (
      let index = from;
      index < order.length && cursor < digits.length;
      index++
    ) {
      const segment = this.segmentAt(index);
      const length = this.lengthFor(segment);
      this.setText(segment, digits.slice(cursor, cursor + length));
      cursor += length;
      lastWritten = index;
    }
    origin.value = this.textFor(this.segmentAt(startIndex));
    this.focusSlot(origin, lastWritten);
    this.emit();
  }

  private segmentAt(index: number): UiDateFieldSegment {
    // eslint-disable-next-line security/detect-object-injection -- `index` is a numeric loop/slot offset, never external input.
    return this.uiOrder()[index] ?? 'day';
  }

  private setText(segment: UiDateFieldSegment, text: string): void {
    // eslint-disable-next-line security/detect-object-injection -- `segment` is one of the three `UiDateFieldSegment` literals, never external input.
    this.texts[segment].set(text);
  }

  private completeParts(): UiDateFieldParts | null {
    const day = this.texts.day();
    const month = this.texts.month();
    const year = this.texts.year();
    if (day.length !== 2 || month.length !== 2 || year.length !== 4) {
      return null;
    }
    return { day: Number(day), month: Number(month), year: Number(year) };
  }

  private emit(): void {
    const parts = this.completeParts();
    if (partsEqual(parts, this.value())) return;
    this.lastSyncedValue = parts;
    this.value.set(parts);
  }

  private focusSlot(current: HTMLInputElement, index: number): void {
    const slots = current
      .closest('.ui-date-field')
      ?.querySelectorAll<HTMLInputElement>('.ui-date-field__slot');
    // eslint-disable-next-line security/detect-object-injection -- `index` is a numeric slot offset, never external input.
    slots?.[index]?.focus();
  }
}

function partsEqual(
  a: UiDateFieldParts | null,
  b: UiDateFieldParts | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.day === b.day && a.month === b.month && a.year === b.year;
}
