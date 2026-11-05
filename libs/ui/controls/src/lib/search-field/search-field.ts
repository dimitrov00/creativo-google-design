import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  booleanAttribute,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { UiIcon } from '@creativo/ui/icons';
import type { UiIconName } from '@creativo/ui/icons';
import { UiAvatar } from '../avatar/avatar';
import { UiButton, type UiControlSize } from '../button/button';
import { UiProgressView } from '../progress-view/progress-view';
import { UiTextField } from '../text-field/text-field';

/** A face a token leads its value with — a barber's portrait, or their monogram. */
export interface UiSearchFieldTokenFace {
  readonly src: string | null;
  readonly name: string;
}

/**
 * One token in the field — a filter the owner holds beside the text, drawn
 * as a key and its value («Бръснар │ Иван, Стефан»), ≙ GitLab's filtered
 * search token. An empty `value` is a token still being built: its key, and
 * a value segment holding the field's `uiTokenPlaceholder`.
 */
export interface UiSearchFieldToken {
  readonly id: string;
  /** What the token filters by: «Бръснар». */
  readonly key: string;
  /** What it holds: «Иван, Стефан»; '' while the token is still being built. */
  readonly value: string;
  /** Faces the value leads with (barbers); none for most kinds. */
  readonly faces: readonly UiSearchFieldTokenFace[];
  /** The token's accessible name: what it holds and what pressing it does. */
  readonly label: string;
  /** What Backspace says when it takes the token off («Махни филтъра Бръснар»). */
  readonly removeLabel: string;
}

let nextDropdownId = 0;

/** Where the dropdown opens: under the field, or over it (Photos' card, for a field on the floor). */
export type UiSearchFieldDropdownPlacement = 'below' | 'above';

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
 * TOKENS (2026-11-04, keyed the same day). `uiTokens` puts the owner's
 * filters in the field BEFORE the text (≙ `.searchable(tokens:)`, drawn as
 * GitLab's filtered-search token): each a key segment on the plain fill and
 * a value segment on the value pill's stronger fill, both translucent, so
 * they stack over the field's own fill. A token is ONE button with no ✕:
 * pressing it emits `uiTokenActivate` — the owner opens its values, where
 * removing lives. Backspace in an empty field emits `uiTokenRemove` with the
 * last token's id (and says what it took off in a live region).
 * `uiActiveToken` rings the token being edited. Tokens and text wrap
 * together and the field grows a line; the text keeps a readable width
 * rather than shrinking to a few letters. The default is none, and a field
 * without tokens is unchanged. The owner holds the tokens, as it holds the
 * value.
 *
 * THE DROPDOWN (2026-11-04). Content projected with `uiSearchDropdown` hangs
 * under the field on the menu's thick material while `uiDropdownOpen` — the
 * suggestions of a filtered search, ≙ GitLab's and Jira's. It covers what
 * is under the field and never moves it. A press inside it keeps the focus
 * where it was (Safari focuses no button on a press, so the field's focus
 * would otherwise be lost before the click lands). `uiFocusChange` reports
 * the focus of the WHOLE field — the text, its tokens and the dropdown — so
 * moving from the text into the list is no blur. Escape emits `uiEscape`.
 *
 * ON THE FLOOR (2026-11-05, ≙ iOS 26 Mail and Photos). The field does not
 * dock itself: a bottom search rides the page's own bar
 * (`ui-page-action-bar`, as its `uiFill`), which owns the fade, the floor,
 * the safe area and the keyboard. There, `uiControlSize="large"` sizes the
 * field and its ✕ as the bar's other controls; content projected with
 * `uiSearchAccessory` rides ABOVE the field (Photos' chips);
 * `uiDismissLabel` puts the ✕ beside it that ends the search (`uiDismiss`),
 * Mail's; and `uiDropdownPlacement="above"` opens the dropdown OVER the
 * field, hugging its rows at the leading edge — Photos' floating card.
 * `uiEscapeClaimed` says the owner has something of its own open that
 * Escape closes first (a key's values listed beside the field): Escape then
 * emits `uiEscape` instead of reaching the sheet.
 *
 * WHAT IT DOES NOT DO. It does not fold the page's large title — that is
 * the page's (`ui-sheet-headline`), told by the focus this reports — and it
 * holds no query of its own: the owner's value is the value.
 */
@Component({
  selector: 'ui-search-field',
  imports: [UiAvatar, UiButton, UiIcon, UiProgressView, UiTextField],
  template: `
    <!-- Above the field (Photos' chips). A press keeps the field's focus. -->
    <div class="ui-search-field__accessory" (mousedown)="keepFocus($event)">
      <ng-content select="[uiSearchAccessory]" />
    </div>
    <span
      class="ui-search-field__frame"
      [style.view-transition-name]="uiTransitionName()"
    >
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
      @for (token of uiTokens(); track token.id) {
        <!-- One button, two segments: the key on the plain fill, the value
             on the value pill's. A press keeps the field's focus (mousedown)
             and asks the owner to open the token's values. -->
        <button
          type="button"
          class="ui-search-field__token"
          [attr.aria-label]="token.label"
          [attr.data-active]="uiActiveToken() === token.id ? '' : null"
          [attr.data-building]="token.value === '' ? '' : null"
          [attr.data-testid]="
            uiTestId() ? uiTestId() + '-token-' + token.id : null
          "
          (mousedown)="$event.preventDefault()"
          (click)="activateToken(token)"
        >
          <span class="ui-search-field__token-key">{{ token.key }}</span>
          @if (token.value === '') {
            <!-- Still being built: the value segment is there, holding the
                 placeholder, so the token is already the shape it will be. -->
            <span class="ui-search-field__token-value" aria-hidden="true">
              <span class="ui-search-field__token-text">{{
                uiTokenPlaceholder()
              }}</span>
            </span>
          } @else {
            <span class="ui-search-field__token-value">
              @if (token.faces.length > 0) {
                <span class="ui-search-field__faces" aria-hidden="true">
                  @for (face of token.faces; track $index) {
                    <ui-avatar
                      uiControlSize="small"
                      [uiSrc]="face.src"
                      [uiName]="face.name"
                    />
                  }
                </span>
              }
              <span class="ui-search-field__token-text">{{ token.value }}</span>
            </span>
          }
        </button>
      }
      <!-- The value is read off the event: uiTextField is a COMPONENT,
           so a template reference here would name it, not the input. -->
      <input
        #field
        uiTextField
        [uiControlSize]="uiControlSize()"
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
        [attr.aria-controls]="uiDropdownOpen() ? dropdownId : null"
        [attr.data-testid]="uiTestId()"
        (input)="uiInput.emit($any($event.target).value)"
        (focus)="focusIn()"
        (blur)="focusOut($any($event))"
        (keydown.enter)="uiSubmit.emit($any($event))"
        (keydown.arrowdown)="uiNavigate.emit($any($event))"
        (keydown.backspace)="backspace($any($event))"
        (keydown.escape)="escape($any($event))"
      />
      @if (uiValue() && uiClearLabel()) {
        <button
          type="button"
          class="ui-search-field__clear"
          [attr.aria-label]="uiClearLabel()"
          [attr.data-testid]="uiTestId() ? uiTestId() + '-clear' : null"
          (mousedown)="$event.preventDefault()"
          (click)="clear()"
        >
          <ui-icon uiName="field.clear" aria-hidden="true" />
        </button>
      }
      <!-- What Backspace took off, said once for a reader who cannot see the chip go. -->
      <span
        data-visually-hidden
        role="status"
        aria-live="polite"
        [attr.data-testid]="uiTestId() ? uiTestId() + '-announce' : null"
        >{{ announcement() }}</span
      >
      @if (uiBusy()) {
        <ui-progress-view
          uiControlSize="small"
          class="ui-search-field__busy"
          [attr.data-testid]="uiBusyTestId()"
        />
      }
    </span>
    @if (uiDismissLabel()) {
      <!-- Ends the search, beside the field (Mail's ✕). -->
      <button
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        [uiControlSize]="uiControlSize()"
        [uiIconOnly]="true"
        class="ui-search-field__dismiss"
        [attr.aria-label]="uiDismissLabel()"
        [attr.data-testid]="uiTestId() ? uiTestId() + '-dismiss' : null"
        (click)="uiDismiss.emit()"
      >
        <ui-icon uiName="sheet.close" />
      </button>
    }
    <!-- THE DROPDOWN: mounted while open, under the field (or over it), over
         the list. A press inside keeps the focus where it was; Escape inside
         closes it. -->
    @if (uiDropdownOpen()) {
      <div
        class="ui-search-field__dropdown"
        role="region"
        [id]="dropdownId"
        [attr.aria-label]="uiDropdownLabel() || null"
        [attr.data-testid]="uiTestId() ? uiTestId() + '-dropdown' : null"
        (mousedown)="keepFocus($event)"
        (keydown.escape)="escape($any($event))"
      >
        <ng-content select="[uiSearchDropdown]" />
      </div>
    }
  `,
  styleUrl: './search-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, as every DS component: bare `.ui-*` selectors never match a
  // component's own host under emulated encapsulation.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-search-field',
    '[attr.data-pinned]': 'uiPinned() ? "" : null',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-dropdown-placement]': 'uiDropdownPlacement()',
    '[attr.data-has-dismiss]': 'uiDismissLabel() ? "" : null',
    '[attr.data-has-value]': 'uiValue() ? "" : null',
    '[attr.data-has-tokens]': 'uiTokens().length > 0 ? "" : null',
    '[attr.data-dropdown-open]': 'uiDropdownOpen() ? "" : null',
    // The material modifier's own contract (`uiMaterial` → `data-material`),
    // stamped only while the band is pinned: a field in a form wears none.
    '[attr.data-material]': 'uiPinned() ? "regular" : null',
    '(focusin)': 'focusIn()',
    '(focusout)': 'focusOut($event)',
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
  /** The field's rung and its ✕'s — `large` beside a bottom bar's other controls. */
  readonly uiControlSize = input<UiControlSize>('regular');
  /** The ✕ beside the field that ends the search; without a name there is none. */
  readonly uiDismissLabel = input('');
  /** The owner has something open that Escape closes before the sheet does. */
  readonly uiEscapeClaimed = input(false);
  /**
   * A `view-transition-name` for the field's capsule, so a view transition
   * can grow another element sharing the name — a bar's search button —
   * into it and back. None by default.
   */
  readonly uiTransitionName = input<string | null>(null);
  /** The clear control's name; without one there is no clear control. */
  readonly uiClearLabel = input('');
  /** The filters before the text — none by default. */
  readonly uiTokens = input<readonly UiSearchFieldToken[]>([]);
  /** What the value segment of a token still being built says: «избери…». */
  readonly uiTokenPlaceholder = input('');
  /** The token whose values the owner has open: it wears the focus ring. */
  readonly uiActiveToken = input<string | null>(null);
  /** The projected `uiSearchDropdown` content hangs under the field. */
  readonly uiDropdownOpen = input(false);
  /** The dropdown's accessible name («Филтри»). */
  readonly uiDropdownLabel = input('');
  /** Under the field (the default), or over it, hugging its rows — a field on the floor. */
  readonly uiDropdownPlacement = input<UiSearchFieldDropdownPlacement>('below');

  readonly uiInput = output<string>();
  /** Focus into and out of the whole field — the text, its tokens, its dropdown. */
  readonly uiFocusChange = output<boolean>();
  /** Return: the owner decides what a submitted search does. */
  readonly uiSubmit = output<KeyboardEvent>();
  /** ↓ from the field: the owner moves focus into its results. */
  readonly uiNavigate = output<KeyboardEvent>();
  /** Backspace on an empty field: the id of the last token, to take off. */
  readonly uiTokenRemove = output<string>();
  /** A token pressed: the owner opens its values. */
  readonly uiTokenActivate = output<string>();
  /** Escape while the dropdown is open, or the owner claims it: the owner closes its thing. */
  readonly uiEscape = output<void>();
  /** The ✕ beside the field: the owner ends the search. */
  readonly uiDismiss = output<void>();

  /** The live region's text: the last token Backspace removed. */
  protected readonly announcement = signal('');
  protected readonly dropdownId = `ui-search-field-dropdown-${nextDropdownId++}`;

  // `read: ElementRef`: the field is a COMPONENT host, not a bare input.
  private readonly field = viewChild('field', { read: ElementRef });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private focused = false;

  /** Puts the caret in the text — the owner's way back into the field. */
  focus(): void {
    (this.field()?.nativeElement as HTMLInputElement | undefined)?.focus();
  }

  protected activateToken(token: UiSearchFieldToken): void {
    this.uiTokenActivate.emit(token.id);
    this.focus();
  }

  /** Backspace in an empty field takes the last token off (and says so). */
  protected backspace(event: KeyboardEvent): void {
    const tokens = this.uiTokens();
    const last = tokens[tokens.length - 1];
    if (last === undefined || (event.target as HTMLInputElement).value !== '') {
      return;
    }
    event.preventDefault();
    this.announcement.set(last.removeLabel);
    this.uiTokenRemove.emit(last.id);
  }

  /** Escape closes the dropdown, or what the owner claims, first; with neither it is the sheet's. */
  protected escape(event: KeyboardEvent): void {
    if (!this.uiDropdownOpen() && !this.uiEscapeClaimed()) return;
    event.preventDefault();
    event.stopPropagation();
    this.uiEscape.emit();
    this.focus();
  }

  /** A press in the dropdown or the accessory keeps the focus where it is, unless it lands on a text input. */
  protected keepFocus(event: MouseEvent): void {
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
  }

  /** The platform's clear: the query goes, the keyboard stays. */
  protected clear(): void {
    this.uiInput.emit('');
    this.focus();
  }

  /** Focus arrived — on the text, or anywhere in the field. Reported once. */
  protected focusIn(): void {
    if (this.focused) return;
    this.focused = true;
    this.uiFocusChange.emit(true);
  }

  /**
   * Focus left — the text's own blur and the whole field's focusout both
   * land here, and a move to another part of the field (a token, a row of
   * the dropdown) is no leaving. Each change is reported once.
   */
  protected focusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) return;
    if (!this.focused) return;
    this.focused = false;
    this.uiFocusChange.emit(false);
  }
}
