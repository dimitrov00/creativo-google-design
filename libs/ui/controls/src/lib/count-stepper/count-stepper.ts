import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { UiIcon } from '../icon/icon';

/** How long the ✓ holds in the box before the count takes over. */
const ADDED_BEAT_MS = 550;

/**
 * THE COUNT STEPPER — add a thing, then have more or fewer of it.
 *
 * At zero it is one square: a `+` in the DS control fill. The first press
 * turns the square accent and the `+` into a ✓ for a beat (owner ruling
 * 2026-09-09: "a box with a plus animating to a check"), then the square
 * opens into `− n +`, the way a cart line does. Back to zero and it folds
 * into the square again. The consumer owns the number; this only asks for
 * the next one.
 *
 * Accessible as what it is: at zero one button that adds; above zero a
 * group with a remove button, the live count, and an add button. Every
 * button names the THING (`uiLabel`), not just its verb.
 */
@Component({
  selector: 'ui-count-stepper',
  imports: [UiIcon],
  template: `
    @if (showsBox()) {
      <button
        type="button"
        class="ui-count-stepper__add"
        [attr.data-added]="justAdded() ? '' : null"
        [attr.aria-label]="uiAddLabel() + ' ' + uiLabel()"
        [disabled]="justAdded()"
        (click)="step(1)"
      >
        <ui-icon uiName="action.add" class="ui-count-stepper__plus" />
        <ui-icon uiName="checklist.done" class="ui-count-stepper__check" />
      </button>
    } @else {
      <span
        class="ui-count-stepper__group"
        role="group"
        [attr.aria-label]="uiLabel()"
      >
        <button
          type="button"
          class="ui-count-stepper__step"
          [attr.aria-label]="uiRemoveLabel() + ' ' + uiLabel()"
          (click)="step(-1)"
        >
          <ui-icon uiName="action.remove" />
        </button>
        <span class="ui-count-stepper__count" aria-live="polite">{{
          uiValue()
        }}</span>
        <button
          type="button"
          class="ui-count-stepper__step"
          [attr.aria-label]="uiAddLabel() + ' ' + uiLabel()"
          [disabled]="atMax()"
          (click)="step(1)"
        >
          <ui-icon uiName="action.add" />
        </button>
      </span>
    }
  `,
  styleUrl: './count-stepper.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-count-stepper',
    '[attr.data-count]': 'uiValue()',
  },
})
export class UiCountStepper {
  readonly uiValue = input.required<number>();
  /** The thing being counted — a service, a seat — for the buttons' names. */
  readonly uiLabel = input('');
  readonly uiAddLabel = input('Add');
  readonly uiRemoveLabel = input('Remove');
  readonly uiMax = input<number | null>(null);
  readonly uiValueChange = output<number>();

  private readonly destroyRef = inject(DestroyRef);
  private beat: ReturnType<typeof setTimeout> | null = null;

  /** The ✓ moment between the first press and the count. */
  protected readonly justAdded = signal(false);
  protected readonly showsBox = computed(
    () => this.uiValue() === 0 || this.justAdded(),
  );
  protected readonly atMax = computed(() => {
    const max = this.uiMax();
    return max !== null && this.uiValue() >= max;
  });

  /** The value last seen, so a 0 → 1 step is recognised whoever made it. */
  private previous: number | null = null;

  constructor() {
    // THE BEAT FOLLOWS THE VALUE, not this control's own button: the row
    // that holds the stepper may put the thing on the list itself, and the
    // square must still turn to a ✓ for it (found live, 2026-09-09).
    effect(() => {
      const value = this.uiValue();
      const before = this.previous;
      this.previous = value;
      if (before === 0 && value === 1) {
        this.justAdded.set(true);
        if (this.beat !== null) clearTimeout(this.beat);
        this.beat = setTimeout(() => this.justAdded.set(false), ADDED_BEAT_MS);
      } else if (value !== 1) {
        // Any other move ends the beat at once: the numbers are the news now.
        if (this.beat !== null) clearTimeout(this.beat);
        this.beat = null;
        this.justAdded.set(false);
      }
    });
    this.destroyRef.onDestroy(() => {
      if (this.beat !== null) clearTimeout(this.beat);
    });
  }

  protected step(delta: number): void {
    const next = Math.max(0, this.uiValue() + delta);
    if (next === this.uiValue()) return;
    this.uiValueChange.emit(next);
  }
}
