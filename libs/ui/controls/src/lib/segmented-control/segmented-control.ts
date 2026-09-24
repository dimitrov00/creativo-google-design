import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { UiInteractiveDirective } from '@creativo/ui/modifiers';
import { UiIcon } from '../icon/icon';
import type { UiIconName } from '../icon/icon-registry';

export type UiSegmentedControlSize = 'small' | 'regular';
/** `rounded` is UISegmentedControl's own corner; `capsule` the toolbar PILL of iOS 26's bars. */
export type UiSegmentedControlShape = 'rounded' | 'capsule';

/**
 * One segment. `label` is ALWAYS the accessible name — an icon-only segment
 * keeps it as its `aria-label` and hides the words.
 */
export interface UiSegment {
  readonly id: string;
  readonly label: string;
  /** A glyph before the words — or instead of them with `iconOnly`. */
  readonly icon?: UiIconName;
  readonly iconOnly?: boolean;
  /** Shown, not removed, and picks nothing (the menus' own rule). */
  readonly disabled?: boolean;
  /** The segment's `data-testid`, when a test needs to find it. */
  readonly testId?: string;
}

/**
 * ≙ SwiftUI `Picker` with `.pickerStyle(.segmented)` — UISegmentedControl.
 *
 * A filled TRACK holding equal segments; the chosen one is a raised pill
 * that GLIDES between slots, hairlines stand between the others and step
 * aside next to the chosen one. For two to five short, mutually exclusive
 * answers that are all worth seeing at once — a map's shops, a list's
 * scope. More than that, or anything with a second line, is
 * `ui-choice-tiles`; a long list is `ui-choice-menu`.
 *
 * The control is sized by its surroundings — it hugs its segments unless a
 * consumer stretches it. `uiMaterial` on the host frosts it for riding
 * over a map or a picture (thick reads solid over busy tiles); the
 * track's own quiet film composes over the material, the glass button's
 * recipe.
 *
 * A radiogroup to assistive tech: one tab stop, arrows move the choice.
 */
@Component({
  selector: 'ui-segmented-control',
  imports: [UiIcon, UiInteractiveDirective],
  template: `
    <span class="ui-segmented-control__track">
      <span class="ui-segmented-control__thumb" aria-hidden="true"></span>
      @for (segment of uiSegments(); track segment.id) {
        <button
          type="button"
          role="radio"
          class="ui-segmented-control__segment"
          uiInteractive
          [attr.aria-checked]="segment.id === uiSelectedId()"
          [attr.aria-label]="segment.iconOnly ? segment.label : null"
          [attr.data-selected]="segment.id === uiSelectedId() ? '' : null"
          [attr.data-icon-only]="segment.iconOnly ? '' : null"
          [attr.data-segment-id]="segment.id"
          [attr.data-testid]="segment.testId ?? null"
          [attr.tabindex]="tabIndexOf(segment)"
          [disabled]="segment.disabled ?? false"
          (click)="pick(segment)"
          (keydown)="onKeydown($event)"
        >
          @if (segment.icon) {
            <ui-icon [uiName]="segment.icon" aria-hidden="true" />
          }
          @if (!segment.iconOnly) {
            <span class="ui-segmented-control__label">{{ segment.label }}</span>
          }
        </button>
      }
    </span>
  `,
  styleUrl: './segmented-control.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every DS composition: `.ui-*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-segmented-control',
    role: 'radiogroup',
    '[attr.aria-label]': 'uiLabel() || null',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-shape]': 'uiShape()',
    '[attr.data-empty]': "selectedIndex() < 0 ? '' : null",
    '[style.--ui-segmented-count]': 'uiSegments().length',
    '[style.--ui-segmented-index]': 'thumbIndex()',
  },
})
export class UiSegmentedControl {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly uiSegments = input.required<readonly UiSegment[]>();
  readonly uiSelectedId = input<string | null>(null);
  /** The group's accessible name. */
  readonly uiLabel = input('');
  /** `small` is the 36px control, `regular` the 44px one. */
  readonly uiControlSize = input<UiSegmentedControlSize>('small');
  /** The pill (`capsule`) for a view toggle in a toolbar; `rounded` otherwise. */
  readonly uiShape = input<UiSegmentedControlShape>('rounded');
  readonly uiPicked = output<string>();

  /** The chosen slot, `-1` for none — the thumb hides off the first slot. */
  protected readonly selectedIndex = computed(() =>
    this.uiSegments().findIndex(
      (segment) => segment.id === this.uiSelectedId(),
    ),
  );
  protected readonly thumbIndex = computed(() =>
    Math.max(0, this.selectedIndex()),
  );

  /** One tab stop: the chosen segment, else the first that can be. */
  protected tabIndexOf(segment: UiSegment): number {
    const selected = this.selectedIndex() >= 0 ? this.uiSelectedId() : null;
    const stop =
      selected ??
      this.uiSegments().find((entry) => !entry.disabled)?.id ??
      null;
    return segment.id === stop ? 0 : -1;
  }

  protected pick(segment: UiSegment): void {
    if (segment.disabled) return;
    this.uiPicked.emit(segment.id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const segments = this.uiSegments().filter((segment) => !segment.disabled);
    if (segments.length === 0) return;
    const current = segments.findIndex(
      (segment) => segment.id === this.uiSelectedId(),
    );
    let next: UiSegment | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = segments[(current + 1 + segments.length) % segments.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = segments[(current - 1 + segments.length) % segments.length];
        break;
      case 'Home':
        next = segments[0];
        break;
      case 'End':
        next = segments[segments.length - 1];
        break;
      default:
        return;
    }
    if (next === undefined) return;
    event.preventDefault();
    this.uiPicked.emit(next.id);
    // Matched by dataset, not by a selector: an id is the consumer's own
    // string and `CSS.escape` is not everywhere a test runs.
    Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        '[data-segment-id]',
      ),
    )
      .find((segment) => segment.dataset['segmentId'] === next.id)
      ?.focus();
  }
}
