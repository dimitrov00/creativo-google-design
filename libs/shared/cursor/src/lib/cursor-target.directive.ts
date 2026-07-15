import { Directive, ElementRef, inject, input } from '@angular/core';
import { useCursorTarget } from './cursor-target.behavior';
import { CursorTargetStyle } from './cursor.service';

/**
 * Marks an arbitrary element as a custom-cursor target (nav links, custom
 * content — anything that isn't already one of the design system's own
 * interactive components). Button and Input get this behavior intrinsically
 * (see `useCursorTarget`) and don't need this directive.
 *
 * Two strategies (see `CursorTargetStyle`) — 'scale' is the default: most
 * interactive elements just grow the cursor slightly and get a plain color
 * change, no fill. 'fill' (morph into a pill covering the element) is an
 * explicit opt-in, reserved for outline/ghost/chip-shaped targets that have
 * a visible border or transparent background worth "filling in".
 */
@Directive({
  selector: '[crCursorTarget]',
  host: {
    class: 'cr-cursor-target',
    '[attr.data-cr-cursor-style]': 'style()',
    '(pointerenter)': 'host.onPointerEnter()',
    '(pointerleave)': 'host.onPointerLeave()',
    '[attr.data-cr-cursor-hover]': 'host.isHovering() ? "" : null',
  },
})
export class CursorTargetDirective {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly label = input<string | undefined>(undefined, {
    alias: 'crCursorTargetLabel',
  });
  readonly style = input<CursorTargetStyle>('scale', {
    alias: 'crCursorTargetStyle',
  });

  protected readonly host = useCursorTarget(
    this.elementRef,
    () => this.style(),
    () => this.label(),
  );
}
