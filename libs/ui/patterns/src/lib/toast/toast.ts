import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  UiInteractiveDirective,
  UiMaterialDirective,
  UiRadiusDirective,
} from '@creativo/ui/modifiers';

/**
 * ui-toast — a transient status line with ONE action, docked at the bottom.
 *
 * ≙ the iOS "Undo" banner and Material's snackbar, narrowed to what this app
 * needs: a sentence that says what just happened and the way back from it.
 * It is a `role="status"` region, so assistive tech announces it politely
 * and never steals focus — a toast that grabbed focus would interrupt the
 * very tap sequence it is confirming.
 *
 * The clock is the consumer's promise to the person: `uiDuration` (8 s by
 * default — WCAG's "enough time" floor for a one-word action) runs while
 * nobody is looking at it and PAUSES on hover or focus, so a slow thumb
 * never watches the undo vanish under it. The consumer flips `uiPresented`
 * and listens for `uiAction` / `uiDismissed`; the toast owns nothing but the
 * timer and its own surface.
 *
 * One toast per page. A second message replaces the first — stacking undo
 * banners is how someone undoes the wrong thing.
 */
@Component({
  selector: 'ui-toast',
  imports: [UiInteractiveDirective, UiMaterialDirective, UiRadiusDirective],
  template: `
    @if (uiPresented()) {
      <div
        class="ui-toast__surface"
        uiMaterial="thick"
        role="status"
        aria-live="polite"
        [attr.data-paused]="paused() ? '' : null"
        (pointerenter)="hold(true)"
        (pointerleave)="hold(false)"
        (focusin)="hold(true)"
        (focusout)="hold(false)"
      >
        <span class="ui-toast__label">{{ uiLabel() }}</span>
        @if (uiActionLabel()) {
          <!-- A plain button, not uiButton: controls already depends on
               patterns (the modal sheet uses the sheet header), so a pattern
               cannot import a control without closing a cycle. The house
               hover/press grammar comes from the modifier directives instead. -->
          <button
            type="button"
            class="ui-toast__action"
            uiInteractive
            uiRadius="capsule"
            (click)="act()"
          >
            {{ uiActionLabel() }}
          </button>
        }
      </div>
    }
  `,
  styleUrl: './toast.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped on purpose, like every DS pattern: the stylesheet is
  // `.ui-toast`-prefixed and the host is positioned by the consumer's page.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-toast',
    '[attr.data-presented]': "uiPresented() ? '' : null",
  },
})
export class UiToast {
  readonly uiPresented = input(false);
  /** The sentence: what just happened. */
  readonly uiLabel = input('');
  /** The one way back. Absent = a plain notice that only times out. */
  readonly uiActionLabel = input('');
  /** How long it stays while nobody is holding it, in ms. */
  readonly uiDuration = input(8000);

  readonly uiAction = output<void>();
  readonly uiDismissed = output<void>();

  protected readonly paused = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Every presentation restarts the clock; every dismissal clears it. A
    // replaced message therefore gets its full duration, not the remainder.
    effect(() => {
      const presented = this.uiPresented();
      const duration = this.uiDuration();
      this.clear();
      if (presented && !this.paused()) this.arm(duration);
    });
    this.destroyRef.onDestroy(() => this.clear());
  }

  protected hold(held: boolean): void {
    this.paused.set(held);
    if (held) {
      this.clear();
    } else if (this.uiPresented()) {
      this.arm(this.uiDuration());
    }
  }

  protected act(): void {
    this.clear();
    this.uiAction.emit();
  }

  private arm(duration: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.uiDismissed.emit();
    }, duration);
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
