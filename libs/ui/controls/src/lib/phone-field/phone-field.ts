import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  LOCALE_ID,
  PendingTasks,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { CountryIso2 } from '@core/components';
import type {
  CountryNaming,
  PhoneCountry,
  PhoneDraft,
  PhoneSystem,
} from '@core/systems';
import { UiListGroup, UiListRow } from '@creativo/ui/patterns';
import { UiModalSheet } from '../modal-sheet/modal-sheet';
import { UiVisuallyHiddenDirective } from '@creativo/ui/modifiers';
import { UiControlSize } from '../button/button';
import { UiIcon } from '@creativo/ui/icons';
import { UiTextField } from '../text-field/text-field';

/**
 * `PhoneSystem` rides `libphonenumber-js` (~170 kB of metadata) — a DYNAMIC
 * import of the component-local `./phone-field.lazy` keeps it out of every
 * initial bundle that merely imports the `@creativo/ui/controls` barrel; the
 * chunk loads once, when the first phone field constructs (owner ruling F6).
 * The types above are `import type` (erased at compile time), so only the
 * functions arrive late.
 */
type PhoneApi = typeof PhoneSystem;

/**
 * How the picker names and orders countries in `locale` — the words half
 * `PhoneSystem.listPhoneCountries` takes, because a system never builds an
 * `Intl` object: `Intl.DisplayNames` (platform-provided — zero country-name
 * payload shipped) and `Intl.Collator`.
 */
function countryNaming(locale: string): CountryNaming {
  const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale);
  return {
    nameOf: (code) => displayNames.of(code) ?? null,
    compare: (a, b) => collator.compare(a, b),
  };
}

/** The picker's ~250 countries per locale — built once and shared by every
 *  phone field; the list is pure, so the cache never invalidates. */
const countriesByLocale = new Map<string, readonly PhoneCountry[]>();

function phoneCountries(
  phone: PhoneApi,
  locale: string,
): readonly PhoneCountry[] {
  const cached = countriesByLocale.get(locale);
  if (cached) return cached;
  const countries = phone.listPhoneCountries(countryNaming(locale));
  countriesByLocale.set(locale, countries);
  return countries;
}

/** E.164 max is 15 digits — one digit of slack absorbs a stray trunk zero. */
const MAX_DIGITS = 16;

/** Type-ahead buffer lifetime (APG listbox convention). */
const TYPEAHEAD_RESET_MS = 500;

/** The DS compact/regular boundary — same 760px gate as the sheet family. */
const COMPACT_MEDIA = '(max-width: 760px)';

/** How the country picker presents — resolved fresh at every open. */
export type UiPhoneFieldPickerPresentation = 'sheet' | 'popover';

let nextUniqueId = 0;

/**
 * ISO alpha-2 → squared SVG flag URL (owner ruling: crisp rounded-square
 * flags, not emoji glyphs). The SVGs come from the `flag-icons` package's
 * `1x1` set, mapped into every consuming app's build as
 * `assets/flags/1x1/*.svg` (see the `assets` entries in
 * `apps/web/project.json` / `apps/showcase/project.json`) — browser-lazy
 * per row, zero bundle cost, identical rendering on every OS. The img is
 * `aria-hidden` decorative; the accessible name stays "Name +dial".
 */
function flagSrc(code: string): string {
  return `assets/flags/1x1/${code.toLowerCase()}.svg`;
}

/** Digits and `+` are the characters the formatter keeps — everything else
 *  (spaces, hyphens, brackets) is presentation it may re-arrange. */
function countSignificantChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if ((char >= '0' && char <= '9') || char === '+') count++;
  }
  return count;
}

/** Caret index in `text` sitting just after `count` significant chars. */
function caretIndexForSignificant(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if ((char >= '0' && char <= '9') || char === '+') {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return text.length;
}

/** Silently drop digits past `max` (keep formatting chars as typed). */
function capDigits(raw: string, max: number): string {
  let digits = 0;
  let out = '';
  for (const char of raw) {
    if (char >= '0' && char <= '9') {
      digits++;
      if (digits > max) continue;
    }
    out += char;
  }
  return out;
}

/**
 * Composite phone field — ONE bordered frame reading as a single control:
 * `[ country trigger ▾ +359 | tel input ]`, visible label above (the
 * footnote label convention baked in — the one place the DS does this,
 * because the composite demands it), hint + error below.
 *
 * Value contract: `value` is canonical E.164 (`'+359888123456'`) or `null`
 * — it is non-null ONLY while the draft is a valid number; national
 * as-you-type formatting (`PhoneSystem.formatDraft`, caret preserved) is
 * presentation. A typed/pasted/autofilled `+…` re-detects and switches the
 * `country` model (autofill's international value is never rejected);
 * changing country from the picker keeps the entered digits and refocuses
 * the input. Placeholder is the country's real example number.
 *
 * Validation is the CONSUMER's: `error` is an input. Validate on blur
 * (`uiBlurred` emits the current field text) + on submit via
 * `PhoneSystem.parse`, and clear the error live once `value` goes
 * non-null (`draft.isValid` — reward early, punish late).
 *
 * The country picker adapts per viewport, resolved fresh at every open
 * (the HIG popover→sheet adaptation): on compact widths (≤760px, the DS
 * boundary) it presents on the DS bottom sheet; on regular widths it is
 * an anchored popover dropdown under the trigger. Both hold the same
 * search field + `ui-list-group` of "flag Name — +dial" rows, wired as
 * the APG combobox-with-listbox pattern: the trigger is the
 * `role="combobox"`, the row run a genuine `role="listbox"` with
 * `role="option"` children, keyboard focus stays on the search box (or
 * the listbox surface) and travels the options via
 * `aria-activedescendant` (Down/Up/Home/End, type-ahead, Enter). Escape
 * is the sheet's own dismissal on compact; in the popover it closes and
 * returns focus to the trigger (outside pointerdown / Tab-away close it
 * too). Flags are emoji regional-indicator pairs (`aria-hidden` — on
 * Windows they legibly degrade to the ISO letter pair). Picker chrome
 * copy ships with English defaults — consumers localize via the `*Label`
 * inputs (the DS layer has no i18n runtime, same as UiOtpField's slot
 * labels).
 */
@Component({
  selector: 'ui-phone-field',
  templateUrl: './phone-field.html',
  styleUrl: './phone-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  imports: [
    NgTemplateOutlet,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiTextField,
    UiVisuallyHiddenDirective,
  ],
  host: {
    class: 'ui-phone-field',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-invalid]': 'error() ? "" : null',
    '[attr.data-disabled]': 'disabled() ? "" : null',
  },
})
export class UiPhoneField {
  /** Selected country (two-way). Falls back to `defaultCountry` until the
   *  user picks or types one — the fallback never writes the model. */
  readonly country = model<CountryIso2 | null>(null);
  /** Canonical E.164 (two-way) — non-null ONLY while the draft is valid. */
  readonly value = model<string | null>(null);
  /** Tenant/deployment default (resolved by the feature layer, not here). */
  readonly defaultCountry = input<CountryIso2 | null>(null);
  /** Visible label above the frame (footnote convention). */
  readonly label = input('');
  /** Secondary helper line under the frame (e.g. the priming hint). */
  readonly hint = input<string | null>(null);
  /** Consumer-decided error copy — renders destructive + `role="alert"`. */
  readonly error = input<string | null>(null);
  readonly uiControlSize = input<UiControlSize>('regular');
  readonly disabled = input(false);
  readonly required = input(false);
  /** Locale for country names/sorting (`Intl.DisplayNames`/`Collator`). */
  readonly locale = input<string>(inject(LOCALE_ID));

  /* Picker chrome copy — English defaults, consumer-localizable. */
  readonly pickerTitle = input('Country code');
  readonly searchLabel = input('Search countries');
  readonly closeLabel = input('Close');
  readonly noResultsLabel = input('No matches');

  /** Blur notification for the consumer's validate-on-blur; payload is the
   *  current (national-formatted) field text for `PhoneSystem.parse`. */
  readonly uiBlurred = output<string>();

  private readonly uniqueId = `ui-phone-field-${nextUniqueId++}`;
  protected readonly inputId = `${this.uniqueId}-input`;
  protected readonly hintId = `${this.uniqueId}-hint`;
  protected readonly errorId = `${this.uniqueId}-error`;
  protected readonly listboxId = `${this.uniqueId}-listbox`;
  protected readonly searchId = `${this.uniqueId}-search`;
  protected readonly sheetId = `${this.uniqueId}-sheet`;
  protected readonly sheetTitleId = `${this.uniqueId}-sheet-title`;

  private readonly telInput =
    viewChild<ElementRef<HTMLInputElement>>('telInput');
  private readonly triggerButton =
    viewChild<ElementRef<HTMLButtonElement>>('triggerButton');
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The lazily-loaded `PhoneSystem` — `null` for the few ms before the
   *  chunk lands (typing degrades to raw text, then re-formats). */
  private readonly phone = signal<PhoneApi | null>(null);

  /** National-formatted presentation text currently in the input. */
  protected readonly inputText = signal('');
  protected readonly pickerOpen = signal(false);
  /** Holds the modal sheet mounted through its exit transition (ui-modal-sheet's open/closing dance). */
  protected readonly pickerClosing = signal(false);
  /** Options render lazily on first open (≈250 rows stay out of the DOM
   *  until needed) and stay rendered so the close transition has content. */
  protected readonly pickerEverOpened = signal(false);
  /** Sheet on compact widths, anchored popover on regular — re-resolved at
   *  every open, so a resized window presents correctly without reload. */
  protected readonly presentation =
    signal<UiPhoneFieldPickerPresentation>('sheet');
  protected readonly searchQuery = signal('');
  protected readonly activeIndex = signal(0);

  protected readonly effectiveCountry = computed(
    () => this.country() ?? this.defaultCountry(),
  );
  protected readonly countries = computed(() => {
    const phone = this.phone();
    return phone ? phoneCountries(phone, this.locale()) : [];
  });
  protected readonly selectedCountry = computed((): PhoneCountry | null => {
    const code = this.effectiveCountry();
    if (code === null) return null;
    return this.countries().find((country) => country.code === code) ?? null;
  });
  protected readonly triggerDial = computed(() => {
    const selected = this.selectedCountry();
    return selected ? `+${selected.dialCode}` : '+';
  });
  /** SVG flag URL for the selected country — decorative (`aria-hidden`). */
  protected readonly triggerFlag = computed(() => {
    const selected = this.selectedCountry();
    return selected ? flagSrc(selected.code) : '';
  });
  protected readonly triggerAriaLabel = computed(() => {
    const selected = this.selectedCountry();
    return selected
      ? `${this.pickerTitle()}: ${selected.name} +${selected.dialCode}`
      : this.pickerTitle();
  });
  protected readonly placeholder = computed(() => {
    const code = this.effectiveCountry();
    return (code && this.phone()?.example(code)) || '';
  });
  protected readonly describedBy = computed(() => {
    const ids = [
      this.hint() ? this.hintId : null,
      this.error() ? this.errorId : null,
    ].filter((id): id is string => id !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  });
  protected readonly filteredCountries = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const all = this.countries();
    // Plain A–Z always (owner ruling: no pinning — alphabetical scanning
    // wins); the picker instead SCROLLS to the selected country on open
    // (`openPicker`, with the shell's scroll reset opted out).
    if (!query) return all;
    // Filter by localized name, ISO code or dial code ('+359' or '359').
    const dialQuery = query.replace(/^\+/, '');
    return all.filter(
      (country) =>
        country.name.toLowerCase().includes(query) ||
        country.code.toLowerCase().startsWith(query) ||
        (dialQuery !== '' &&
          /^\d+$/.test(dialQuery) &&
          country.dialCode.startsWith(dialQuery)),
    );
  });
  protected readonly activeOptionId = computed(() => {
    if (!this.pickerOpen()) return null;
    const active = this.filteredCountries()[this.activeIndex()];
    return active ? this.optionId(active.code) : null;
  });

  /** Last value this component itself synced — breaks the model feedback
   *  loop so only EXTERNAL writes re-drive the presentation text. */
  private lastSyncedValue: string | null = null;
  private typeaheadBuffer = '';
  private typeaheadAt = 0;

  constructor() {
    // The outside-press listener must never outlive the component.
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('pointerdown', this.onDocumentPointerDown, {
        capture: true,
      }),
    );

    // Load the phone chunk through PendingTasks so zoneless whenStable
    // (tests, hydration) waits for it.
    void inject(PendingTasks).run(async () => {
      const { PhoneSystem } = await import('./phone-field.lazy');
      this.phone.set(PhoneSystem);
    });

    // External `value` writes (prefill, autofill through the model) act
    // like a pasted international number: re-detect country, re-format.
    // Also tracks `phone` so a value set before the chunk landed is
    // processed as soon as it does.
    effect(() => {
      const phone = this.phone();
      const external = this.value();
      if (external === this.lastSyncedValue || !phone) return;
      this.lastSyncedValue = external;
      untracked(() => {
        if (!external) {
          this.inputText.set('');
          return;
        }
        const draft = phone.formatDraft(external, null);
        if (draft.country && draft.country !== this.country()) {
          this.country.set(draft.country);
        }
        this.inputText.set(draft.formatted);
      });
    });
  }

  protected optionId(code: CountryIso2): string {
    return `${this.uniqueId}-option-${code}`;
  }

  protected flagFor(code: CountryIso2): string {
    return flagSrc(code);
  }

  /* ── Tel input ──────────────────────────────────────────────────── */

  protected onInput(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const raw = capDigits(inputEl.value, MAX_DIGITS);
    const phone = this.phone();
    if (!phone) {
      // Chunk not landed yet (first ms) — keep the raw text; the next
      // keystroke re-formats the full value anyway.
      this.inputText.set(raw);
      return;
    }
    const significantBeforeCaret = countSignificantChars(
      inputEl.value.slice(0, inputEl.selectionStart ?? inputEl.value.length),
    );
    const draft = phone.formatDraft(raw, this.effectiveCountry());
    // A `+<dial code>` carries its own country — switch the model (typed,
    // pasted or autofilled international values are all honored).
    if (
      raw.trimStart().startsWith('+') &&
      draft.country &&
      draft.country !== this.country()
    ) {
      this.country.set(draft.country);
    }
    this.inputText.set(draft.formatted);
    // Re-render the whole formatted value, then put the caret back after
    // the same COUNT of significant chars it sat behind before formatting.
    inputEl.value = draft.formatted;
    const caret = caretIndexForSignificant(
      draft.formatted,
      significantBeforeCaret,
    );
    inputEl.setSelectionRange(caret, caret);
    this.syncValue(draft);
  }

  protected onInputBlur(): void {
    // Snap the DISPLAYED text to the canonical national grouping — a messy
    // paste ('08 88-12 34 56') or any text that slipped past the as-you-type
    // path re-renders as `PhoneSystem`'s canonical format ('088 812 3456').
    // Reads the DOM value (not the signal) so even divergence the input
    // event never saw gets normalized.
    const phone = this.phone();
    const inputEl = this.telInput()?.nativeElement;
    const text = inputEl?.value ?? this.inputText();
    if (phone && text.trim() !== '') {
      const draft = phone.formatDraft(text, this.effectiveCountry());
      this.inputText.set(draft.formatted);
      if (inputEl) inputEl.value = draft.formatted;
      this.syncValue(draft);
    }
    this.uiBlurred.emit(this.inputText());
  }

  private syncValue(draft: PhoneDraft): void {
    const e164 = draft.isValid ? draft.e164 : null;
    // Belt and braces on the value contract: emitted E.164 NEVER carries
    // whitespace or punctuation — `+` and digits only.
    const next = e164 === null ? null : e164.replace(/[^+\d]/g, '');
    this.lastSyncedValue = next;
    if (next !== this.value()) this.value.set(next);
  }

  /* ── Trigger ────────────────────────────────────────────────────── */

  /** The popover leaves the trigger reachable — a second press closes. */
  protected togglePicker(): void {
    if (this.pickerOpen()) {
      this.closePicker(false);
      return;
    }
    this.openPicker();
  }

  protected openPicker(): void {
    if (this.disabled()) return;
    this.presentation.set(this.resolvePresentation());
    this.pickerEverOpened.set(true);
    this.searchQuery.set('');
    const selected = this.effectiveCountry();
    const index = selected
      ? this.countries().findIndex((country) => country.code === selected)
      : 0;
    this.activeIndex.set(Math.max(0, index));
    this.pickerOpen.set(true);
    // Center the selected country once the panel has rendered (APG: keep
    // the active option visible). No race: the modal shell's open-time
    // scroll reset is opted out (`resetScrollOnOpen=false`).
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          this.setActive(this.activeIndex(), 'center'),
        ),
      );
    }
    if (this.presentation() === 'popover') {
      // Outside pointerdown closes (the popover has no scrim); capture
      // phase so a press that stops propagation still closes it.
      document.addEventListener('pointerdown', this.onDocumentPointerDown, {
        capture: true,
      });
      // The desktop popover is the editable-combobox variant — focus lands
      // in its search box once the panel has rendered.
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() =>
          document.getElementById(this.searchId)?.focus(),
        );
      }
    }
  }

  /** Compact/touch (≤760px, the DS sheet gate) → sheet; wider → anchored
   *  popover. Decided at OPEN time so a resize needs no reload. */
  private resolvePresentation(): UiPhoneFieldPickerPresentation {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return 'sheet';
    }
    return window.matchMedia(COMPACT_MEDIA).matches ? 'sheet' : 'popover';
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    // APG combobox: Down/Up on the collapsed combobox open the listbox
    // (Enter/Space are the button's own activation — no handler needed).
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.openPicker();
    }
  }

  /* ── Picker ─────────────────────────────────────────────────────── */

  protected closePicker(refocusInput: boolean): void {
    if (!this.pickerOpen()) return;
    // The modal sheet's exit rides its own CSS transition — `closing`
    // holds the surface mounted until `closeFinished` (the ui-modal-sheet
    // open/closing dance every consumer follows).
    if (this.presentation() === 'sheet') this.pickerClosing.set(true);
    this.pickerOpen.set(false);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, {
      capture: true,
    });
    if (!refocusInput) return;
    if (this.presentation() === 'popover') {
      // No modal behavior in the popover path — hand focus straight back
      // to the tel input so the user keeps typing.
      this.telInput()?.nativeElement.focus();
    } else if (typeof requestAnimationFrame !== 'undefined') {
      // The sheet behavior restores focus to the TRIGGER (the previously
      // focused element) in a rAF on deactivation; after a country change
      // the user should land back in the tel input to keep typing — so
      // re-focus one frame after that restore runs.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => this.telInput()?.nativeElement.focus()),
      );
    }
  }

  /** The modal sheet's exit transition finished — safe to unmount. */
  protected onPickerCloseFinished(): void {
    this.pickerClosing.set(false);
  }

  /** Esc in the popover: close and return focus to the trigger (APG). */
  protected closePopoverToTrigger(): void {
    this.closePicker(false);
    this.triggerButton()?.nativeElement.focus();
  }

  /** Tab/Shift-Tab out of the popover closes it (light-dismiss surface). */
  protected onPopoverFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      !this.hostRef.nativeElement.contains(next) &&
      this.presentation() === 'popover'
    ) {
      this.closePicker(false);
    }
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.hostRef.nativeElement.contains(event.target as Node)) {
      this.closePicker(false);
    }
  };

  protected selectCountry(code: CountryIso2): void {
    const phone = this.phone();
    if (!phone) return; // options can't render before the chunk lands
    // Keep the entered digits, re-interpreted against the new country
    // (never wipe on country change). If the text was international, strip
    // the OLD dial code first so only the national digits carry over.
    const text = this.inputText().trim();
    let digits = text.replace(/\D/g, '');
    const previous = this.selectedCountry();
    if (
      text.startsWith('+') &&
      previous &&
      digits.startsWith(previous.dialCode)
    ) {
      digits = digits.slice(previous.dialCode.length);
    }
    this.country.set(code);
    const draft = phone.formatDraft(digits, code);
    this.inputText.set(draft.formatted);
    this.syncValue(draft);
    this.closePicker(true);
  }

  protected onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
  }

  protected onPickerKeydown(event: KeyboardEvent): void {
    const options = this.filteredCountries();
    const inSearch =
      event.target instanceof HTMLInputElement &&
      event.target.id === this.searchId;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.setActive(Math.min(this.activeIndex() + 1, options.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.setActive(Math.max(this.activeIndex() - 1, 0));
        return;
      case 'Home':
      case 'End':
        // In the search box, Home/End keep their native caret behavior
        // (APG combobox); on the surface they jump the option focus.
        if (inSearch) return;
        event.preventDefault();
        this.setActive(event.key === 'Home' ? 0 : options.length - 1);
        return;
      case 'Enter': {
        event.preventDefault();
        const active = options[this.activeIndex()];
        if (active) this.selectCountry(active.code);
        return;
      }
      case 'Escape':
        // Sheet presentation: Escape bubbles to the ui-sheet host →
        // dismiss + focus restore. Popover: close here, focus returns to
        // the trigger (APG combobox Escape).
        if (this.presentation() === 'popover') {
          event.preventDefault();
          event.stopPropagation();
          this.closePopoverToTrigger();
        }
        return;
      default:
        if (
          !inSearch &&
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          this.typeahead(event.key);
          event.preventDefault();
        }
    }
  }

  private typeahead(char: string): void {
    const now = Date.now();
    if (now - this.typeaheadAt > TYPEAHEAD_RESET_MS) this.typeaheadBuffer = '';
    this.typeaheadAt = now;
    this.typeaheadBuffer += char.toLowerCase();
    const options = this.filteredCountries();
    if (options.length === 0) return;
    // A repeated single char cycles matches; a growing buffer refines from
    // the current option (standard listbox type-ahead).
    const start =
      this.typeaheadBuffer.length === 1
        ? this.activeIndex() + 1
        : this.activeIndex();
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset) % options.length;
      // eslint-disable-next-line security/detect-object-injection -- `index` is a numeric modulo offset, never external input.
      const candidate = options[index];
      if (candidate?.name.toLowerCase().startsWith(this.typeaheadBuffer)) {
        this.setActive(index);
        return;
      }
    }
  }

  private setActive(
    index: number,
    block: ScrollLogicalPosition = 'nearest',
  ): void {
    if (index < 0) return;
    this.activeIndex.set(index);
    // eslint-disable-next-line security/detect-object-injection -- `index` is a clamped numeric option offset, never external input.
    const active = this.filteredCountries()[index];
    if (!active) return;
    const option = document.getElementById(this.optionId(active.code));
    // jsdom has no scrollIntoView — presentation nicety only.
    option?.scrollIntoView?.({ block });
  }
}
