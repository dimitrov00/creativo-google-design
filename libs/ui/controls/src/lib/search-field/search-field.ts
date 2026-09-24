import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  input,
  output,
  viewChild,
} from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { UiIconName } from '../icon/icon-registry';
import { UiProgressView } from '../progress-view/progress-view';
import { UiTextField } from '../text-field/text-field';

/**
 * ≙ SwiftUI `.searchable` — the ONE search field (2026-09-24).
 *
 * Three were hand-assembled in features before this: the visit sheet's
 * client search and its service search, each a band of material around a
 * text field whose padding the feature overrode to make room for a glyph
 * (a feature styling an input — the DS ruling says never), and the day's
 * search sheet, a bare field with no glyph and nothing pinned. They had
 * already drifted: one carried `autocomplete`, `spellcheck` and a Return
 * key hint, the other none of them.
 *
 * The anatomy is the platform's: the glyph leads INSIDE the field, the
 * field's own circled clear trails while there is a query — drawn here in
 * secondary ink at a full control's reach, because the engine's own ✕ is
 * a small blue glyph in one browser and nothing in another — and a lookup
 * in flight turns a quiet ring just clear of it. `uiPinned` makes the host the band that sticks
 * under a sheet's chrome while the list scrolls — full-bleed across the
 * sheet's inset, on the regular material the shell's own accessory wears,
 * exactly under the chrome whatever it measures (`ui-modal-sheet`
 * publishes `--modal-sheet-chrome-height`).
 *
 * ```html
 * <ui-search-field
 *   uiPinned
 *   [uiValue]="query()"
 *   [uiPlaceholder]="t('search')"
 *   uiTestId="people-search"
 *   (uiInput)="query.set($event)"
 *   (uiFocusChange)="searching.set($event)"
 * />
 * ```
 *
 * WHAT IT DOES NOT DO. It does not fold the page's large title — that is
 * the page's (`ui-sheet-headline`), told by the focus this reports — and it
 * holds no query of its own: the owner's value is the value.
 */
@Component({
  selector: 'ui-search-field',
  imports: [UiIcon, UiProgressView, UiTextField],
  template: `
    <span class="ui-search-field__frame">
      <!-- The glyph may say what the typing was taken for (a handset for a
           number, an envelope for a mail) — detection the reader can see,
           never a mode to pick. -->
      <ui-icon
        class="ui-search-field__glyph"
        aria-hidden="true"
        [uiName]="uiIcon()"
        [attr.data-kind]="uiIconKind()"
        [attr.data-testid]="uiTestId() ? uiTestId() + '-glyph' : null"
      />
      <!-- The value is read off the event: uiTextField is a COMPONENT,
           so a template reference here would name it, not the input. -->
      <input
        #field
        uiTextField
        type="search"
        class="ui-search-field__native"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="search"
        [attr.autocapitalize]="uiAutocapitalize()"
        [value]="uiValue()"
        [attr.placeholder]="uiPlaceholder() || null"
        [attr.aria-label]="uiLabel() || uiPlaceholder() || null"
        [attr.data-testid]="uiTestId()"
        (input)="uiInput.emit($any($event.target).value)"
        (focus)="uiFocusChange.emit(true)"
        (blur)="uiFocusChange.emit(false)"
        (keydown.enter)="uiSubmit.emit($any($event))"
        (keydown.arrowdown)="uiNavigate.emit($any($event))"
      />
      @if (uiValue() && uiClearLabel()) {
        <button
          type="button"
          class="ui-search-field__clear"
          [attr.aria-label]="uiClearLabel()"
          [attr.data-testid]="uiTestId() ? uiTestId() + '-clear' : null"
          (click)="clear()"
        >
          <ui-icon uiName="field.clear" aria-hidden="true" />
        </button>
      }
      @if (uiBusy()) {
        <ui-progress-view
          uiControlSize="small"
          class="ui-search-field__busy"
          [attr.data-testid]="uiBusyTestId()"
        />
      }
    </span>
  `,
  styleUrl: './search-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, as every DS component: bare `.ui-*` selectors never match a
  // component's own host under emulated encapsulation.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-search-field',
    '[attr.data-pinned]': 'uiPinned() ? "" : null',
    '[attr.data-has-value]': 'uiValue() ? "" : null',
    // The material modifier's own contract (`uiMaterial` → `data-material`),
    // stamped only while the band is pinned: a field in a form wears none.
    '[attr.data-material]': 'uiPinned() ? "regular" : null',
  },
})
export class UiSearchField {
  readonly uiValue = input('');
  readonly uiPlaceholder = input('');
  /** The accessible name when it should differ from the placeholder. */
  readonly uiLabel = input('');
  /** The leading glyph — the magnifier unless the owner detects more. */
  readonly uiIcon = input<UiIconName>('action.search');
  /** What the glyph says the typing was taken for, as a data attribute. */
  readonly uiIconKind = input<string | null>(null);
  readonly uiAutocapitalize = input<'off' | 'words' | 'sentences'>('off');
  /** A lookup in flight: the quiet ring at the trailing edge. */
  readonly uiBusy = input(false);
  readonly uiBusyTestId = input<string | null>(null);
  readonly uiTestId = input<string | null>(null);
  /** The band that sticks under a sheet's chrome while the list scrolls. */
  readonly uiPinned = input(false, { transform: booleanAttribute });
  /** The clear control's name; without one there is no clear control. */
  readonly uiClearLabel = input('');

  readonly uiInput = output<string>();
  /** Focus in and out — what a page's large title folds on. */
  readonly uiFocusChange = output<boolean>();
  /** Return: the owner decides what a submitted search does. */
  readonly uiSubmit = output<KeyboardEvent>();
  /** ↓ from the field: the owner moves focus into its results. */
  readonly uiNavigate = output<KeyboardEvent>();

  // `read: ElementRef`: the field is a COMPONENT host, not a bare input.
  private readonly field = viewChild('field', { read: ElementRef });

  /** The platform's clear: the query goes, the keyboard stays. */
  protected clear(): void {
    this.uiInput.emit('');
    (this.field()?.nativeElement as HTMLInputElement | undefined)?.focus();
  }
}
