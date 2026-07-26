import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  model,
  signal,
} from '@angular/core';

type UiOtpSlotState = 'active' | 'filled' | 'idle';

/**
 * Custom element — fixed-length OTP input made of native, individually
 * focusable slots.
 *
 * Autofill/paste semantics: every slot is `inputmode="numeric"
 * autocomplete="one-time-code" pattern="[0-9]*"` (never `type="number"`),
 * and any multi-character arrival — a paste, an iOS keyboard code
 * suggestion, WebOTP — is DISTRIBUTED across the slots from the receiving
 * one onward (no `maxlength` attribute: browsers would truncate the paste
 * to one character before we ever saw it).
 */
@Component({
  selector: 'ui-otp-field',
  template: `
    @for (i of indices(); track i) {
      <input
        class="ui-otp-field__slot"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]*"
        [disabled]="uiDisabled()"
        [attr.data-state]="stateFor(i)"
        [value]="charAt(i)"
        (input)="onInput(i, $event)"
        (paste)="onPaste(i, $event)"
        (keydown)="onKeydown(i, $event)"
        (focus)="focusedIndex.set(i)"
        (blur)="onBlur(i)"
        [attr.aria-label]="'Digit ' + (i + 1)"
      />
    }
  `,
  styleUrl: './otp-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-otp-field',
    '[attr.data-invalid]': 'uiInvalid() ? "" : null',
    '[attr.data-disabled]': 'uiDisabled() ? "" : null',
  },
})
export class UiOtpField {
  readonly uiLength = input(6);
  readonly value = model('');
  readonly uiInvalid = input(false);
  /** Locks every slot (e.g. the auth flow's auto-verify "checking" state). */
  readonly uiDisabled = input(false);

  protected readonly focusedIndex = signal<number | null>(null);
  protected readonly indices = computed(() =>
    Array.from({ length: this.uiLength() }, (_, i) => i),
  );

  protected charAt(i: number): string {
    // eslint-disable-next-line security/detect-object-injection -- `i` is a numeric loop index derived from `indices()`, never external input.
    return this.value()[i] ?? '';
  }

  protected stateFor(i: number): UiOtpSlotState {
    if (this.focusedIndex() === i) {
      return 'active';
    }
    return this.charAt(i) !== '' ? 'filled' : 'idle';
  }

  protected onInput(i: number, event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const raw = inputEl.value;
    if (raw.length > 1) {
      // Autofill / programmatic multi-char entry — distribute like a paste.
      this.fillFrom(i, raw, inputEl);
      return;
    }
    const char = raw.slice(-1);
    if (char && !/[0-9]/.test(char)) {
      // Digits only — `inputmode`/`pattern` shape the mobile keyboard but
      // do NOT block hardware-keyboard letters; the paste path already
      // strips non-digits, this closes the single-keystroke hole.
      inputEl.value = this.charAt(i);
      return;
    }
    const chars = this.value().split('');
    // eslint-disable-next-line security/detect-object-injection -- `i` is a numeric loop index derived from `indices()`, never external input.
    chars[i] = char;
    this.value.set(chars.join(''));

    if (char && i < this.uiLength() - 1) {
      this.focusSlot(inputEl, i + 1);
    }
  }

  protected onPaste(i: number, event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text) return;
    event.preventDefault();
    this.fillFrom(i, text, event.target as HTMLInputElement);
  }

  /**
   * Distributes the digits of `text` across the slots starting at `start`
   * (a full-length code always fills from slot 0 — the common "paste the
   * whole code anywhere" gesture), then focuses the slot after the last
   * written digit.
   */
  private fillFrom(
    start: number,
    text: string,
    origin: HTMLInputElement,
  ): void {
    const digits = text.replace(/\D/g, '');
    if (!digits) {
      // Nothing usable — restore the slot's rendered value.
      origin.value = this.charAt(start);
      return;
    }
    const length = this.uiLength();
    const from = digits.length >= length ? 0 : start;
    const chars = Array.from(
      { length },
      // eslint-disable-next-line security/detect-object-injection -- `index` is a numeric Array.from index, never external input.
      (_, index) => this.value()[index] ?? '',
    );
    let written = 0;
    for (; written < digits.length && from + written < length; written++) {
      chars[from + written] = digits.charAt(written);
    }
    this.value.set(chars.join(''));
    const focusIndex = Math.min(from + written, length - 1);
    origin.value = this.charAt(start);
    this.focusSlot(origin, focusIndex);
  }

  protected onKeydown(i: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && this.charAt(i) === '' && i > 0) {
      this.focusSlot(event.target as HTMLInputElement, i - 1);
    }
  }

  protected onBlur(i: number): void {
    if (this.focusedIndex() === i) {
      this.focusedIndex.set(null);
    }
  }

  private focusSlot(current: HTMLInputElement, index: number): void {
    const slots = current
      .closest('.ui-otp-field')
      ?.querySelectorAll<HTMLInputElement>('.ui-otp-field__slot');
    // eslint-disable-next-line security/detect-object-injection -- `index` is a numeric slot offset, never external input.
    slots?.[index]?.focus();
  }
}
