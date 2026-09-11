import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
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
 * never watches the undo vanish under it. A pause is a pause: the clock
 * resumes with what was left, not from the top.
 *
 * ### The dismiss, and the clock made visible (owner, 2026-09-11)
 * A ✕ at the trailing edge closes the toast at once, for whoever has read
 * it and wants the screen back. Its ring IS the clock: a hairline that
 * drains over `uiDuration` and freezes while the toast is held, so how much
 * time is left is never a guess. One control, two meanings — the way a
 * notification's close ring reads on the platform. Drawn inline rather
 * than with `ui-icon` or `ui-progress-ring`: controls already depends on
 * patterns, so a pattern cannot import a control without closing a cycle.
 *
 * ### The way out is a fade, not a cut (owner, 2026-09-11)
 * The surface stays mounted for one regular beat after `uiPresented` drops
 * and leaves the way it came — down and out — whether the clock ran out or
 * the ✕ was pressed; reduced motion leaves at once. The ring and the exit
 * are Web Animations rather than stylesheet keyframes, because a REPLACED
 * message (a second stamp inside the first's eight seconds) restarts the
 * clock, and a script-owned animation can be restarted, paused and resumed
 * in step with the timer where a keyframe on a mounted element cannot.
 *
 * The consumer flips `uiPresented` and listens for `uiAction` /
 * `uiDismissed`; the toast owns nothing but the timer and its own surface.
 * One toast per page. A second message replaces the first — stacking undo
 * banners is how someone undoes the wrong thing.
 */
@Component({
  selector: 'ui-toast',
  imports: [UiInteractiveDirective, UiMaterialDirective, UiRadiusDirective],
  template: `
    @if (shown()) {
      <div
        #surface
        class="ui-toast__surface"
        uiMaterial="thick"
        role="status"
        aria-live="polite"
        [attr.data-paused]="paused() ? '' : null"
        [attr.data-leaving]="leaving() ? '' : null"
        [style.--ui-toast-duration.ms]="uiDuration()"
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
        <!-- The dismiss: a ✕ inside the clock's ring. The ring drains from
             full over the duration and holds with the toast; the glyph is
             two strokes, so no control is imported. -->
        <button
          type="button"
          class="ui-toast__dismiss"
          uiInteractive
          uiRadius="capsule"
          [attr.aria-label]="uiDismissLabel()"
          (click)="dismiss()"
        >
          <svg class="ui-toast__clock" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="ui-toast__clock-track" cx="12" cy="12" r="10.5" />
            <circle
              #ring
              class="ui-toast__clock-left"
              cx="12"
              cy="12"
              r="10.5"
              pathLength="1"
            />
            <path
              class="ui-toast__clock-glyph"
              d="M8.5 8.5l7 7M15.5 8.5l-7 7"
            />
          </svg>
        </button>
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
  /** The dismiss control's accessible name — the consumer's word, translated. */
  readonly uiDismissLabel = input.required<string>();
  /** How long it stays while nobody is holding it, in ms. */
  readonly uiDuration = input(8000);

  readonly uiAction = output<void>();
  readonly uiDismissed = output<void>();

  protected readonly paused = signal(false);
  /** Mounted — including the beat it takes to leave. */
  protected readonly shown = signal(false);
  /** On its way out: `uiPresented` has dropped, the exit is playing. */
  protected readonly leaving = signal(false);
  private readonly surface = viewChild<ElementRef<HTMLElement>>('surface');
  private readonly ring = viewChild<ElementRef<SVGCircleElement>>('ring');
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** What is left on the clock, and when it last started running. */
  private remaining = 0;
  private armedAt = 0;
  /** The ring's drain, script-owned so it pauses and restarts with the clock. */
  private drain: Animation | null = null;
  private exit: Animation | null = null;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Every presentation — and every REPLACED message — restarts the clock;
    // every dismissal clears it. `paused` is read UNTRACKED: a hold must
    // not re-run this and hand the clock its full duration back — that was
    // the old restart-on-release.
    effect(() => {
      const presented = this.uiPresented();
      const duration = this.uiDuration();
      this.uiLabel();
      this.clear();
      this.remaining = duration;
      if (presented) {
        this.exit?.cancel();
        this.exit = null;
        this.leaving.set(false);
        this.shown.set(true);
        if (!untracked(() => this.paused())) this.arm();
      } else if (untracked(() => this.shown())) {
        this.leave();
      }
    });
    // The ring can only be started once it exists — after the surface has
    // rendered — and again whenever a fresh presentation re-arms the clock.
    effect(() => {
      const ring = this.ring()?.nativeElement ?? null;
      const duration = this.uiDuration();
      this.uiLabel();
      untracked(() => this.startDrain(ring, duration));
    });
    this.destroyRef.onDestroy(() => {
      this.clear();
      this.drain?.cancel();
      this.exit?.cancel();
    });
  }

  /**
   * Held — a pointer over it, focus inside it — the clock stops where it
   * is; released, it runs on from there. The ring on the dismiss does the
   * same through `data-paused`, so the two never drift apart.
   */
  protected hold(held: boolean): void {
    if (held === this.paused()) return;
    this.paused.set(held);
    if (held) {
      this.remaining = Math.max(
        0,
        this.remaining - (Date.now() - this.armedAt),
      );
      this.clear();
      this.drain?.pause();
    } else if (this.uiPresented()) {
      this.arm();
      this.drain?.play();
    }
  }

  protected act(): void {
    this.clear();
    this.uiAction.emit();
  }

  /** The ✕: gone now, whatever the clock said. */
  protected dismiss(): void {
    this.clear();
    this.uiDismissed.emit();
  }

  private arm(): void {
    this.armedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.uiDismissed.emit();
    }, this.remaining);
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * The ring, from full to empty over the clock's duration — restarted
   * whenever the clock is, held wherever the clock is held. Where the
   * platform has no Web Animations (jsdom), the ring simply stays full.
   */
  private startDrain(ring: SVGCircleElement | null, duration: number): void {
    this.drain?.cancel();
    this.drain = null;
    if (ring === null || typeof ring.animate !== 'function') return;
    this.drain = ring.animate(
      [{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }],
      { duration, easing: 'linear', fill: 'forwards' },
    );
    if (this.paused()) this.drain.pause();
  }

  /**
   * Out the way it came in — down and faded, one regular beat — and only
   * then unmounted, so the ✕ and the timer end the same way. Reduced
   * motion, or no Web Animations, leaves at once.
   */
  private leave(): void {
    const surface = this.surface()?.nativeElement ?? null;
    this.drain?.cancel();
    this.drain = null;
    this.paused.set(false);
    if (
      surface === null ||
      typeof surface.animate !== 'function' ||
      this.reducedMotion()
    ) {
      this.shown.set(false);
      return;
    }
    this.leaving.set(true);
    const style = getComputedStyle(surface);
    const duration = this.motionMs(
      style.getPropertyValue('--sys-motion-duration-regular'),
      200,
    );
    const easing =
      style.getPropertyValue('--sys-motion-ease-standard').trim() || 'ease-in';
    this.exit?.cancel();
    const exit = surface.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(8px) scale(0.98)' },
      ],
      { duration, easing, fill: 'forwards' },
    );
    this.exit = exit;
    exit.finished
      .then(() => {
        if (this.exit !== exit) return;
        this.exit = null;
        this.leaving.set(false);
        this.shown.set(false);
      })
      .catch(() => {
        /* cancelled by a re-presentation — the surface stays */
      });
  }

  private reducedMotion(): boolean {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private motionMs(raw: string, fallback: number): number {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.trim().endsWith('ms') ? value : value * 1000;
  }
}
