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

/** Custom element — fixed-length OTP input made of native, individually focusable slots. */
@Component({
  selector: 'ui-otp-field',
  template: `
    @for (i of indices(); track i) {
      <input
        class="ui-otp-field__slot"
        type="text"
        inputmode="numeric"
        maxlength="1"
        [attr.data-state]="stateFor(i)"
        [value]="charAt(i)"
        (input)="onInput(i, $event)"
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
  },
})
export class UiOtpField {
  readonly uiLength = input(6);
  readonly value = model('');
  readonly uiInvalid = input(false);

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
    const char = inputEl.value.slice(-1);
    const chars = this.value().split('');
    // eslint-disable-next-line security/detect-object-injection -- `i` is a numeric loop index derived from `indices()`, never external input.
    chars[i] = char;
    this.value.set(chars.join(''));

    if (char && i < this.uiLength() - 1) {
      this.focusSlot(inputEl, i + 1);
    }
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
