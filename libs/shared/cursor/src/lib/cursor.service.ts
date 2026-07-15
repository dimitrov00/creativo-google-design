import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

/**
 * Two hover strategies, confirmed live against design.google:
 * - 'fill': the cursor morphs into a pill overlaying the target's bounds
 *   (used for chip/pill-shaped targets — `data-link-style="chip"` there).
 * - 'scale': the cursor keeps following the pointer but grows slightly;
 *   the target itself just gets a plain color change, no fill/invert
 *   (used for plain text links — `data-link-style="default"` there).
 */
export type CursorTargetStyle = 'fill' | 'scale';

export interface CursorTarget {
  readonly element: HTMLElement;
  readonly label?: string;
  readonly style: CursorTargetStyle;
}

@Injectable({ providedIn: 'root' })
export class CursorService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;

  // Angular's SSR/prerender DOM shim provides a `defaultView`-like object
  // that is truthy but does not implement `matchMedia` — a plain `?.` guard
  // isn't enough on its own, this needs an actual function-type check.
  private readonly reducedMotionQuery = this.matchMediaSafe(
    '(prefers-reduced-motion: reduce)',
  );
  private readonly coarsePointerQuery =
    this.matchMediaSafe('(pointer: coarse)');

  private readonly prefersReducedMotion = signal(
    this.reducedMotionQuery?.matches ?? false,
  );
  private readonly isCoarsePointer = signal(
    this.coarsePointerQuery?.matches ?? true,
  );

  /** False on touch devices, and whenever the OS/browser asks for reduced motion. */
  readonly isEnabled = computed(
    () => !this.prefersReducedMotion() && !this.isCoarsePointer(),
  );

  /** The element the custom cursor is currently "attached" to, if any. Set by CursorTargetDirective. */
  readonly activeTarget = signal<CursorTarget | null>(null);

  constructor() {
    this.reducedMotionQuery?.addEventListener('change', (event) =>
      this.prefersReducedMotion.set(event.matches),
    );
    this.coarsePointerQuery?.addEventListener('change', (event) =>
      this.isCoarsePointer.set(event.matches),
    );
  }

  private matchMediaSafe(query: string): MediaQueryList | undefined {
    return typeof this.window?.matchMedia === 'function'
      ? this.window.matchMedia(query)
      : undefined;
  }
}
