import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { gsap } from 'gsap';
import { vi } from 'vitest';
import { CursorDotComponent } from './cursor-dot.component';
import { CursorService, CursorTarget } from './cursor.service';

vi.mock('gsap', () => ({
  gsap: {
    quickTo: vi.fn(() => vi.fn()),
    set: vi.fn(),
    to: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

describe('CursorDotComponent', () => {
  let isEnabled: ReturnType<typeof signal<boolean>>;
  let activeTarget: ReturnType<typeof signal<CursorTarget | null>>;
  let fixture: ComponentFixture<CursorDotComponent>;

  beforeEach(() => {
    isEnabled = signal(true);
    activeTarget = signal<CursorTarget | null>(null);
    document.documentElement.removeAttribute('data-cr-cursor-active');
    TestBed.configureTestingModule({
      imports: [CursorDotComponent],
      providers: [
        { provide: CursorService, useValue: { isEnabled, activeTarget } },
      ],
    });
    fixture = TestBed.createComponent(CursorDotComponent);
  });

  it('marks itself data-active and hides the native cursor everywhere (not just body) when enabled', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.hasAttribute('data-active')).toBe(true);
    expect(document.documentElement.hasAttribute('data-cr-cursor-active')).toBe(
      true,
    );
  });

  it('restores the native cursor when disabled', () => {
    isEnabled.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.hasAttribute('data-active')).toBe(false);
    expect(document.documentElement.hasAttribute('data-cr-cursor-active')).toBe(
      false,
    );
  });

  it('tracks the pointer via left/top (not transform), for zero-lag positioning', () => {
    fixture.detectChanges();
    vi.mocked(gsap.set).mockClear();

    fixture.nativeElement.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 320,
        clientY: 240,
        bubbles: true,
      }),
    );

    expect(gsap.set).toHaveBeenCalledWith(expect.any(HTMLElement), {
      left: 320,
      top: 240,
    });
  });

  it('resizes the ring to match a "fill" target on activation, including its border-radius', () => {
    fixture.detectChanges();
    vi.mocked(gsap.set).mockClear();

    const target = document.createElement('button');
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      width: 80,
      height: 40,
      right: 180,
      bottom: 90,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });

    activeTarget.set({ element: target, style: 'fill' });
    fixture.detectChanges();

    expect(gsap.set).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ left: 140, top: 70, width: 80, height: 40 }),
    );
    target.remove();
  });

  it('grows the ring to a fixed size for a "scale" target, without locking its position', () => {
    fixture.detectChanges();
    vi.mocked(gsap.set).mockClear();

    const target = document.createElement('a');
    activeTarget.set({ element: target, style: 'scale' });
    fixture.detectChanges();

    expect(gsap.set).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ width: 40, height: 40 }),
    );

    // Position tracking must still follow the pointer for "scale" (unlike "fill").
    vi.mocked(gsap.set).mockClear();
    fixture.nativeElement.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 50,
        clientY: 60,
        bubbles: true,
      }),
    );
    expect(gsap.set).toHaveBeenCalledWith(expect.any(HTMLElement), {
      left: 50,
      top: 60,
    });
  });

  it("tints the ring to the target's --cr-cursor-fill-color while morphing, then schedules a fade-out once settled", () => {
    fixture.detectChanges();
    vi.mocked(gsap.set).mockClear();
    vi.mocked(gsap.to).mockClear();

    const target = document.createElement('button');
    target.style.setProperty('--cr-cursor-fill-color', 'rgb(254, 115, 108)');
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 80,
      height: 40,
      right: 80,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    activeTarget.set({ element: target, style: 'fill' });
    fixture.detectChanges();

    expect(gsap.set).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        backgroundColor: 'rgb(254, 115, 108)',
        mixBlendMode: 'normal',
      }),
    );
    // The fade-out is scheduled (a real gsap.to tween with a delay), not
    // applied immediately — the ring stays visible for the flight, and only
    // disappears once the target's own CSS has had time to flip to match.
    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ opacity: 0, delay: expect.any(Number) }),
    );
    target.remove();
  });

  it('falls back to the foreground color when a "fill" target never set --cr-cursor-fill-color', () => {
    fixture.detectChanges();
    vi.mocked(gsap.set).mockClear();

    const target = document.createElement('a');
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 80,
      height: 40,
      right: 80,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    activeTarget.set({ element: target, style: 'fill' });
    fixture.detectChanges();

    expect(gsap.set).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        backgroundColor: 'var(--cr-color-foreground)',
        mixBlendMode: 'normal',
      }),
    );
    target.remove();
  });

  it('cancels any pending fade and resets the tint (via clearProps, not a stale value) when leaving a "fill" target', () => {
    fixture.detectChanges();

    const tinted = document.createElement('button');
    tinted.style.setProperty('--cr-cursor-fill-color', 'rgb(254, 115, 108)');
    document.body.appendChild(tinted);
    vi.spyOn(tinted, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 80,
      height: 40,
      right: 80,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    activeTarget.set({ element: tinted, style: 'fill' });
    fixture.detectChanges();

    vi.mocked(gsap.set).mockClear();
    vi.mocked(gsap.killTweensOf).mockClear();
    activeTarget.set(null);
    fixture.detectChanges();

    expect(gsap.killTweensOf).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'opacity',
    );
    expect(gsap.set).toHaveBeenCalledWith(expect.any(HTMLElement), {
      clearProps: 'opacity,backgroundColor,mixBlendMode',
    });
    tinted.remove();
  });

  it('is hidden from assistive technology — purely decorative, pointer-only', () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('role')).toBe('presentation');
    expect(host.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the label text only when the active target provides one', () => {
    fixture.detectChanges();
    const label: HTMLElement = fixture.nativeElement.querySelector(
      '.cr-cursor-dot__label',
    );
    expect(label.hasAttribute('data-visible')).toBe(false);

    const target = document.createElement('a');
    activeTarget.set({ element: target, style: 'scale', label: 'View' });
    fixture.detectChanges();

    expect(label.hasAttribute('data-visible')).toBe(true);
    expect(label.textContent?.trim()).toBe('View');
  });
});
