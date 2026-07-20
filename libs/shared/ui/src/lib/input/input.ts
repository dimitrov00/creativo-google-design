import { Component, ElementRef, inject, input } from '@angular/core';
import { useCursorTarget } from '@creativo/shared/cursor';

export type InputSize = 'mini' | 'small' | 'regular' | 'large' | 'extraLarge';

@Component({
  selector: 'input[crInput]',
  imports: [],
  template: '',
  styleUrl: './input.css',
  host: {
    class: 'cr-input',
    '[attr.data-size]': 'size()',
    '[attr.data-invalid]': 'invalid() ? "" : null',
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
    '[attr.aria-describedby]': 'errorId() ?? null',
    // Text inputs are interactive too — the cursor should scale (40x40) on
    // hover just like a button, not just morph-capable elements.
    '[attr.data-cr-cursor-style]': "'scale'",
    '(pointerenter)': 'cursorHost.onPointerEnter()',
    '(pointerleave)': 'cursorHost.onPointerLeave()',
    '[attr.data-cr-cursor-hover]': 'cursorHost.isHovering() ? "" : null',
  },
})
export class Input {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly size = input<InputSize>('regular');
  readonly invalid = input(false);
  /** Id of an element (e.g. a validation message) this input's value is described by. */
  readonly errorId = input<string | undefined>(undefined);

  protected readonly cursorHost = useCursorTarget(
    this.elementRef,
    () => 'scale',
  );
}
