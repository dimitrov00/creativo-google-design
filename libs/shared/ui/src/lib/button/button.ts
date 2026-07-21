import { Component, ElementRef, computed, inject, input } from '@angular/core';
import { CursorTargetStyle, useCursorTarget } from '@creativo/shared/cursor';

export type ButtonVariant =
  | 'primary'
  | 'action'
  | 'accent'
  | 'secondary'
  | 'ghost'
  | 'outline'
  | 'destructive';
export type ButtonSize = 'mini' | 'small' | 'regular' | 'large' | 'extraLarge';
export type ButtonShape = 'rounded' | 'pill';
/** Combines with variant (typically 'outline'/'ghost') for a "bordered destructive" look. */
export type ButtonTone = 'neutral' | 'danger';

// Only bordered/transparent-chrome variants morph — they have visible
// border/background worth hiding in favor of the cursor overlay taking
// over entirely. Solid variants (primary/secondary/destructive) already
// read clearly on their own; morphing them just replaces one filled look
// with another for no benefit, so they only get the plain cursor scale.
const FILL_VARIANTS = new Set<ButtonVariant>(['outline', 'ghost']);

@Component({
  // Anchors get the same host API — every marketing CTA is a link, and a
  // hand-rolled `<a>` copy of Button was the single biggest source of style
  // drift (case study §F9). Anchor hosts simply never match the :disabled
  // CSS states; `loading` still blocks activation via the click guard +
  // aria-disabled, which work identically for both elements.
  selector: 'button[crButton], a[crButton]',
  imports: [],
  templateUrl: './button.html',
  styleUrl: './button.css',
  host: {
    class: 'cr-button',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
    '[attr.data-shape]': 'shape()',
    '[attr.data-tone]': 'tone()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
    // aria-busy alone doesn't block activation (APG) — pair it with
    // aria-disabled and a capturing click guard rather than the native
    // `disabled` attribute, which the "disabled" spec test below confirms
    // stays fully under the caller's own control.
    '[attr.aria-disabled]': 'loading() ? "true" : null',
    '(click)': 'blockClickWhileLoading($event)',
    '[attr.data-cr-cursor-style]': 'resolvedCursorStyle()',
    '(pointerenter)': 'cursorHost.onPointerEnter()',
    '(pointerleave)': 'cursorHost.onPointerLeave()',
    '[attr.data-cr-cursor-hover]': 'cursorHost.isHovering() ? "" : null',
  },
})
export class Button {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('regular');
  readonly shape = input<ButtonShape>('rounded');
  readonly tone = input<ButtonTone>('neutral');
  readonly loading = input(false);
  /** Text shown next to the cursor dot while hovering (cursor-target label). */
  readonly cursorLabel = input<string | undefined>(undefined);
  /** Overrides the variant-derived cursor morph. The default stands
   * (outline/ghost fill, solid scale), but marketing's conversion CTAs are
   * solid pills whose signature interaction IS the fill morph — that's a
   * design decision the consumer owns, not the variant. */
  readonly cursorStyle = input<CursorTargetStyle | undefined>(undefined);

  protected readonly resolvedCursorStyle = computed<CursorTargetStyle>(
    () =>
      this.cursorStyle() ??
      (FILL_VARIANTS.has(this.variant()) ? 'fill' : 'scale'),
  );
  protected readonly cursorHost = useCursorTarget(
    this.elementRef,
    () => this.resolvedCursorStyle(),
    () => this.cursorLabel(),
  );

  protected blockClickWhileLoading(event: Event): void {
    if (this.loading()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
}
