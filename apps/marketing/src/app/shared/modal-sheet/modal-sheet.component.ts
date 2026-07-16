import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CursorTargetDirective } from '@creativo/shared/cursor';

@Component({
  selector: 'cr-modal-sheet',
  imports: [CursorTargetDirective],
  templateUrl: './modal-sheet.component.html',
  styleUrl: './modal-sheet.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalSheetComponent {
  private readonly document = inject(DOCUMENT);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private previousBodyOverflow = '';
  private backgroundHeader: HTMLElement | null = null;
  private previousFocus: HTMLElement | null = null;
  private environmentActive = false;
  private wasOpen = false;
  private dragPointerId: number | null = null;
  private dragStartY = 0;
  private dragStartTime = 0;
  private dragOffset = 0;

  readonly sheetId = input.required<string>();
  readonly labelledBy = input.required<string>();
  readonly closeLabel = input.required<string>();
  readonly open = input(false);
  readonly closing = input(false);
  readonly titleVisible = input(false);
  readonly dismissed = output<void>();
  readonly sheetScrolled = output<HTMLElement>();
  protected readonly dragging = signal(false);

  constructor() {
    effect(() => {
      const open = this.open();
      const active = open || this.closing();
      if (!isPlatformBrowser(this.platformId)) return;

      if (active && !this.environmentActive) this.activateEnvironment();
      if (open && !this.wasOpen) {
        requestAnimationFrame(() => {
          const host = this.elementRef.nativeElement;
          const scroller = host.querySelector<HTMLElement>(
            '.modal-sheet__scroll',
          );
          if (scroller) scroller.scrollTop = 0;
          host.querySelector<HTMLElement>('.modal-sheet__close')?.focus();
        });
      }
      if (!active && this.environmentActive) this.deactivateEnvironment();
      this.wasOpen = open;
    });

    this.destroyRef.onDestroy(() => {
      if (isPlatformBrowser(this.platformId)) this.deactivateEnvironment();
    });
  }

  protected requestDismiss(): void {
    if (!this.open() || this.closing()) return;
    this.dismissed.emit();
  }

  protected onBackdropPointerDown(event: PointerEvent): void {
    if (event.target === event.currentTarget) this.requestDismiss();
  }

  protected onScroll(event: Event): void {
    this.sheetScrolled.emit(event.currentTarget as HTMLElement);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestDismiss();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected onDragStart(event: PointerEvent): void {
    if (event.button !== 0 || this.closing()) return;
    if ((event.target as Element | null)?.closest('button, a')) return;

    this.dragPointerId = event.pointerId;
    this.dragStartY = event.clientY;
    this.dragStartTime = performance.now();
    this.dragOffset = 0;
    this.dragging.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  protected onDragMove(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragOffset = Math.max(0, event.clientY - this.dragStartY);
    this.dialogElement()?.style.setProperty(
      '--modal-sheet-drag-y',
      `${this.dragOffset}px`,
    );
    if (this.dragOffset > 0) event.preventDefault();
  }

  protected onDragEnd(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const handle = event.currentTarget as HTMLElement;
    this.dragPointerId = null;
    this.dragging.set(false);
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }

    const elapsed = Math.max(1, performance.now() - this.dragStartTime);
    const velocity = this.dragOffset / elapsed;
    if (this.dragOffset > 110 || velocity > 0.65) {
      this.requestDismiss();
      return;
    }
    this.dialogElement()?.style.setProperty('--modal-sheet-drag-y', '0px');
  }

  private dialogElement(): HTMLElement | null {
    return this.elementRef.nativeElement.querySelector<HTMLElement>(
      '.modal-sheet',
    );
  }

  private activateEnvironment(): void {
    this.environmentActive = true;
    this.previousFocus = this.document.activeElement as HTMLElement | null;
    this.previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    this.backgroundHeader =
      this.document.querySelector<HTMLElement>('.cr-shell__header');
    this.backgroundHeader?.setAttribute('inert', '');
  }

  private deactivateEnvironment(): void {
    if (!this.environmentActive) return;
    this.environmentActive = false;
    this.document.body.style.overflow = this.previousBodyOverflow;
    this.backgroundHeader?.removeAttribute('inert');
    this.backgroundHeader = null;
    this.dialogElement()?.style.removeProperty('--modal-sheet-drag-y');
    requestAnimationFrame(() => this.previousFocus?.focus());
    this.previousFocus = null;
  }
}
