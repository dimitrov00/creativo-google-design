import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSheet } from './sheet';

@Component({
  imports: [UiSheet],
  template: `<ui-sheet
    [uiIsPresented]="open()"
    [uiClosing]="closing()"
    [uiPlacement]="'end'"
    [uiPresentationSizing]="sizing()"
    data-testid="sheet"
    >content</ui-sheet
  >`,
})
class HostComponent {
  open = signal(false);
  closing = signal(false);
  sizing = signal<'automatic' | 'page'>('automatic');
}

describe('UiSheet', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes placement as a data-* attribute and role="dialog", omitting data-presented/aria-modal by default', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="sheet"]',
    );
    expect(el.classList.contains('ui-sheet')).toBe(true);
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('data-placement')).toBe('end');
    expect(el.getAttribute('data-presented')).toBeNull();
    expect(el.getAttribute('aria-modal')).toBeNull();
  });

  it('writes data-presented and aria-modal="true" when uiIsPresented is true', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="sheet"]',
    );
    expect(el.getAttribute('data-presented')).toBe('');
    expect(el.getAttribute('aria-modal')).toBe('true');
  });

  it('writes the default sizing as data-presentation-sizing="automatic"', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="sheet"]',
    );
    expect(el.getAttribute('data-presentation-sizing')).toBe('automatic');
  });

  it('writes data-presentation-sizing="page" for the wide set-piece', () => {
    fixture.componentInstance.sizing.set('page');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="sheet"]',
    );
    expect(el.getAttribute('data-presentation-sizing')).toBe('page');
  });

  it('keeps the modal environment active while uiClosing is true', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');

    // Owner starts its exit transition: open flips off, closing flips on —
    // the behavior's environment (body scroll lock) must stay active.
    fixture.componentInstance.open.set(false);
    fixture.componentInstance.closing.set(true);
    fixture.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');

    // Exit transition done — environment releases.
    fixture.componentInstance.closing.set(false);
    fixture.detectChanges();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('projects content inside a .ui-sheet__surface wrapper', () => {
    fixture.detectChanges();
    const surface: HTMLElement =
      fixture.nativeElement.querySelector('.ui-sheet__surface');
    expect(surface).toBeTruthy();
    expect(surface.textContent?.trim()).toBe('content');
  });

  describe('stacked on another sheet', () => {
    @Component({
      imports: [UiSheet],
      template: `<ui-sheet [uiIsPresented]="true" data-testid="outer">
        <ui-sheet [uiIsPresented]="inner()" data-testid="inner">card</ui-sheet>
      </ui-sheet>`,
    })
    class StackedHost {
      inner = signal(false);
    }

    it('marks the surface it is declared in while it is up, presents as a manual popover, and keeps its Escape to itself', async () => {
      // The outer `beforeEach` already built a module around the plain
      // host; this host needs its own.
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [StackedHost],
      }).compileComponents();
      const stacked = TestBed.createComponent(StackedHost);
      stacked.detectChanges();
      const host: HTMLElement = stacked.nativeElement;
      const outerSurface = host.querySelector(
        '[data-testid="outer"] > .ui-sheet__surface',
      );
      const inner = host.querySelector('[data-testid="inner"]');
      // Found once the tree is built: the inner is projected into the
      // outer's surface after its own constructor ran.
      expect(inner?.getAttribute('data-stacked')).toBe('');
      expect(inner?.getAttribute('popover')).toBe('manual');
      expect(outerSurface?.hasAttribute('data-ui-sheet-stacked')).toBe(false);

      stacked.componentInstance.inner.set(true);
      stacked.detectChanges();
      expect(outerSurface?.hasAttribute('data-ui-sheet-stacked')).toBe(true);

      // Escape on the inner surface asks the inner alone; the outer never
      // hears the key.
      let outerHeard = 0;
      host
        .querySelector('[data-testid="outer"]')
        ?.addEventListener('keydown', () => (outerHeard += 1));
      inner
        ?.querySelector('.ui-sheet__surface')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      expect(outerHeard).toBe(0);

      stacked.componentInstance.inner.set(false);
      stacked.detectChanges();
      expect(outerSurface?.hasAttribute('data-ui-sheet-stacked')).toBe(false);
    });
  });
});
