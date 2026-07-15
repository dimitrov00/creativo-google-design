import { ElementRef, Signal, inject, signal } from '@angular/core';
import { CursorService, CursorTargetStyle } from './cursor.service';

export interface CursorTargetHost {
  readonly isHovering: Signal<boolean>;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

/**
 * The shared hover-tracking logic behind both `CursorTargetDirective` (for
 * arbitrary elements — nav links, custom content) and any design-system
 * component that wants INTRINSIC cursor-target behavior (Button, Input)
 * without every usage site needing to remember to add a separate
 * `crCursorTarget` attribute. A signal composable: must be called from an
 * injection context (a component/directive constructor), same as
 * `inject()` itself.
 *
 * Deliberately NOT a `hostDirectives` composition — callers like `Button`
 * need to feed it an internally-`computed()` style/label derived from their
 * own inputs, which `hostDirectives`' consumer-only input model can't
 * express. See docs/design-research/decisions.md.
 */
export function useCursorTarget(
  elementRef: ElementRef<HTMLElement>,
  style: () => CursorTargetStyle,
  label: () => string | undefined = () => undefined,
): CursorTargetHost {
  const cursorService = inject(CursorService);
  const isHovering = signal(false);

  return {
    isHovering,
    onPointerEnter: () => {
      if (!cursorService.isEnabled()) return;
      isHovering.set(true);
      cursorService.activeTarget.set({
        element: elementRef.nativeElement,
        label: label(),
        style: style(),
      });
    },
    onPointerLeave: () => {
      isHovering.set(false);
      if (cursorService.activeTarget()?.element === elementRef.nativeElement) {
        cursorService.activeTarget.set(null);
      }
    },
  };
}
