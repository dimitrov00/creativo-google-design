import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
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
} from '@creativo/ui/modifiers';

/**
 * One answer an alert offers.
 *
 * `cancel` is the safe way out: it is what Escape and a press on the scrim
 * mean, and it sits where the platform puts Cancel — leading in a row,
 * last in a stack. `destructive` wears the destructive ink — the ONLY
 * coloured answer: the rest are label ink, because this app's orange
 * accent is a neighbour of red and two tinted answers read as one colour
 * (owner, 2026-09-23). `preferred` draws bold: the answer the platform
 * would give on Return, which for an alert about losing something is the
 * one that keeps it.
 */
export interface UiAlertAction {
  readonly id: string;
  readonly label: string;
  readonly role?: 'cancel' | 'destructive' | 'default';
  readonly preferred?: boolean;
  /** The button's `data-testid`, when a test needs to find it. */
  readonly testId?: string;
}

/**
 * Labels longer than this stack before anything is measured; two shorter
 * ones are TRIED side by side and measured once drawn — the platform's own
 * rule is "side by side unless a label would wrap", and a half-row of the
 * DS alert measure (20rem) seats about this many characters at body size.
 * On a 320px phone the card is narrower than its measure and a bold
 * answer this long may not fit: the count is only the cheap first answer,
 * and the measurement (see `settleLayout`) is the true one — it can only
 * ever stack.
 */
const ROW_LABEL_MAX = 13;

let sequence = 0;

/**
 * ui-alert — ≙ SwiftUI `.alert`: a short question the person must answer
 * before anything else happens.
 *
 * NOT a sheet (owner, 2026-09-23: the discard guard "looks more like a
 * second sheet appearing"). A sheet is a place to do something; an alert is
 * a sentence and its answers, centred, on the platform's own geometry — a
 * card of thick material over a scrim at the DS alert measure (the
 * platform's 270pt taken a step up to this app's 52pt buttons; owner,
 * 2026-09-23), the title and message centred, the answers as equal 52pt
 * text rows divided by hairlines, the destructive one red, the rest label
 * ink, the safe one bold. It pops (scale from 1.12, the platform's own
 * entrance) and fades out; under reduced motion it simply appears.
 *
 * Built on the native `<dialog>` shown modally: the top layer, the focus
 * trap, `inert` for everything beneath, Escape and the focus restore on
 * close all come from the platform rather than from a behaviour of ours.
 * Escape and a press on the scrim mean the `cancel` answer, reported as
 * `uiDismissed`; every answer reports through `uiPicked` with its id. The
 * consumer flips `uiPresented`; the alert owns nothing but its own surface
 * and its exit.
 *
 * Built from the modifiers alone — controls depend on patterns, so a
 * pattern's buttons are its own plain buttons, as the toast's are.
 */
@Component({
  selector: 'ui-alert',
  imports: [UiInteractiveDirective, UiMaterialDirective],
  template: `
    @if (shown()) {
      <dialog
        #dialog
        class="ui-alert__dialog"
        role="alertdialog"
        [attr.aria-labelledby]="titleId"
        [attr.aria-describedby]="uiMessage() ? messageId : null"
        [attr.data-leaving]="leaving() ? '' : null"
        (cancel)="onCancel($event)"
        (keydown)="onKeydown($event)"
        (pointerdown)="onScrimDown($event)"
        (pointerup)="onScrimUp($event)"
      >
        <!-- The surface takes initial focus itself, as the sheet does: the
             modal environment is live without ringing a control on open,
             and Tab reaches the answers from there. -->
        <div
          #surface
          class="ui-alert__surface"
          uiMaterial="thick"
          tabindex="-1"
          autofocus
        >
          <div class="ui-alert__text">
            <h2 class="ui-alert__title" [id]="titleId">{{ uiTitle() }}</h2>
            @if (uiMessage()) {
              <p class="ui-alert__message" [id]="messageId">
                {{ uiMessage() }}
              </p>
            }
          </div>
          <div class="ui-alert__actions" [attr.data-layout]="layout()">
            @for (action of ordered(); track action.id) {
              <button
                type="button"
                class="ui-alert__action"
                uiInteractive
                [attr.data-role]="action.role ?? 'default'"
                [attr.data-preferred]="action.preferred ? '' : null"
                [attr.data-testid]="action.testId ?? null"
                (click)="pick(action)"
              >
                {{ action.label }}
              </button>
            }
          </div>
        </div>
      </dialog>
    }
  `,
  styleUrl: './alert.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped on purpose, like every DS pattern: the stylesheet is
  // `.ui-alert`-prefixed and reaches the native dialog and its backdrop.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-alert',
    '[attr.data-presented]': "uiPresented() ? '' : null",
  },
})
export class UiAlert {
  readonly uiPresented = input(false);
  /** The question, in a few words. */
  readonly uiTitle = input.required<string>();
  /** What is at stake — one sentence, or nothing. */
  readonly uiMessage = input<string | null>(null);
  /** The answers, two or three; one of them `cancel`. */
  readonly uiActions = input.required<readonly UiAlertAction[]>();

  readonly uiPicked = output<string>();
  /** Escape or the scrim — the `cancel` answer without a press. */
  readonly uiDismissed = output<void>();

  readonly titleId = `ui-alert-title-${++sequence}`;
  readonly messageId = `ui-alert-message-${sequence}`;

  /** Mounted — including the beat it takes to leave. */
  protected readonly shown = signal(false);
  protected readonly leaving = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly surface = viewChild<ElementRef<HTMLElement>>('surface');
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private exit: Animation | null = null;

  /** A rowed pair that, once drawn, turned out to wrap: it stacks. */
  private readonly wrapped = signal(false);

  /** Side by side for two short answers; a stack for anything longer. */
  protected readonly layout = computed<'row' | 'stacked'>(() => {
    const actions = this.uiActions();
    return actions.length === 2 &&
      !this.wrapped() &&
      actions.every((action) => action.label.length <= ROW_LABEL_MAX)
      ? 'row'
      : 'stacked';
  });

  /** The answer Return gives: the preferred one, else the safe one. */
  private readonly onReturn = computed(
    () =>
      this.uiActions().find((action) => action.preferred) ??
      this.uiActions().find((action) => action.role === 'cancel') ??
      null,
  );

  /** Cancel leads a row and closes a stack — the platform's own order. */
  protected readonly ordered = computed(() => {
    const actions = this.uiActions();
    const cancel = actions.filter((action) => action.role === 'cancel');
    const rest = actions.filter((action) => action.role !== 'cancel');
    return this.layout() === 'row'
      ? [...cancel, ...rest]
      : [...rest, ...cancel];
  });

  constructor() {
    effect(() => {
      const presented = this.uiPresented();
      if (presented) {
        this.exit?.cancel();
        this.exit = null;
        this.leaving.set(false);
        this.shown.set(true);
        afterNextRender(
          () => {
            this.open();
            this.settleLayout();
          },
          { injector: this.injector },
        );
      } else if (untracked(() => this.shown())) {
        this.leave();
      }
    });
    // New answers are measured again; the old verdict must not stack them.
    effect(() => {
      this.uiActions();
      untracked(() => this.wrapped.set(false));
      afterNextRender(() => this.settleLayout(), { injector: this.injector });
    });
    this.destroyRef.onDestroy(() => {
      this.exit?.cancel();
      this.close();
    });
  }

  protected pick(action: UiAlertAction): void {
    this.uiPicked.emit(action.id);
  }

  /** Escape: the platform would close the dialog itself; the exit is ours. */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.uiDismissed.emit();
  }

  /**
   * The dialog owns its keys. Escape and Tab stop here so a sheet the
   * alert was declared inside never hears them (its own Escape would
   * dismiss it under the card); Return on the surface — not on an answer,
   * which activates itself — gives the preferred answer, as the platform
   * does.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Enter') return;
    if (event.target !== this.surface()?.nativeElement) return;
    const answer = this.onReturn();
    if (answer === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.uiPicked.emit(answer.id);
  }

  /**
   * A rowed pair is drawn with its labels on one line each and measured:
   * a label wider than its half-row wraps, and the platform's answer to a
   * wrapping label is a stack. The label's own box is held against the
   * answer's CONTENT box — `scrollWidth` only reports overflow past the
   * padding, and a bold 13-letter answer on a 320px phone (the card is
   * 288px there) sat in the padding, start-aligned and touching the
   * hairline, with nothing to say so (found in review). Nothing to measure
   * where nothing is laid out (a test runner), and a stack is never
   * un-stacked by this.
   */
  private settleLayout(): void {
    if (this.layout() !== 'row') return;
    const dialog = this.dialog()?.nativeElement;
    if (!dialog) return;
    const answers = dialog.querySelectorAll<HTMLElement>('.ui-alert__action');
    for (const answer of answers) {
      if (answer.clientWidth === 0) continue;
      const style = getComputedStyle(answer);
      const content =
        answer.clientWidth -
        Number.parseFloat(style.paddingInlineStart) -
        Number.parseFloat(style.paddingInlineEnd);
      const range = document.createRange();
      range.selectNodeContents(answer);
      if (range.getBoundingClientRect().width > content) {
        this.wrapped.set(true);
        return;
      }
    }
  }

  /**
   * The dialog fills the viewport, so a press outside the surface lands on
   * it. A press that STARTS and ENDS on the scrim dismisses — the sheet's
   * own rule — so a finger that slid off an answer does not.
   */
  private scrimPressed = false;

  protected onScrimDown(event: PointerEvent): void {
    this.scrimPressed = event.target === this.dialog()?.nativeElement;
  }

  protected onScrimUp(event: PointerEvent): void {
    const onScrim =
      this.scrimPressed && event.target === this.dialog()?.nativeElement;
    this.scrimPressed = false;
    if (onScrim) this.uiDismissed.emit();
  }

  private open(): void {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        return;
      } catch {
        // Already in the top layer, or not connected — fall through.
      }
    }
    // An engine without modal dialogs (a test runner): open in place.
    dialog.setAttribute('open', '');
  }

  private close(): void {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  /**
   * Out the way it came — a fade with a breath of shrink, one regular beat
   * — and only then closed, so the platform's focus restore runs once the
   * card is gone. Reduced motion, or no Web Animations, closes at once.
   */
  private leave(): void {
    const surface = this.surface()?.nativeElement ?? null;
    const dialog = this.dialog()?.nativeElement ?? null;
    if (
      surface === null ||
      dialog === null ||
      typeof surface.animate !== 'function' ||
      this.reducedMotion()
    ) {
      this.close();
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
        { opacity: 0, transform: 'scale(0.96)' },
      ],
      { duration, easing, fill: 'forwards' },
    );
    try {
      // The scrim fades with the card where the engine lets a backdrop
      // animate; elsewhere it simply goes with the dialog.
      dialog.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration,
        easing,
        fill: 'forwards',
        pseudoElement: '::backdrop',
      });
    } catch {
      // No backdrop animation on this engine.
    }
    this.exit = exit;
    exit.finished
      .then(() => {
        if (this.exit !== exit) return;
        this.exit = null;
        this.leaving.set(false);
        this.close();
        this.shown.set(false);
      })
      .catch(() => {
        /* cancelled by a re-presentation — the card stays */
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
