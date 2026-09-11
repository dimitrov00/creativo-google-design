import { Component, signal } from '@angular/core';
import { vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiToast } from './toast';

@Component({
  imports: [UiToast],
  template: `
    <ui-toast
      [uiPresented]="presented()"
      uiLabel="Отбелязан като дошъл"
      uiActionLabel="Отмени"
      uiDismissLabel="Затвори"
      [uiDuration]="50"
      (uiAction)="acted = acted + 1"
      (uiDismissed)="dismissed = dismissed + 1"
    />
  `,
})
class Host {
  readonly presented = signal(false);
  acted = 0;
  dismissed = 0;
}

describe('UiToast', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  const surface = () =>
    fixture.nativeElement.querySelector('.ui-toast__surface') as HTMLElement;

  it('is a polite status region with the sentence and the one way back', () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();

    expect(surface().getAttribute('role')).toBe('status');
    expect(surface().getAttribute('aria-live')).toBe('polite');
    expect(surface().textContent).toContain('Отбелязан като дошъл');
    expect(surface().querySelector('button')?.textContent?.trim()).toBe(
      'Отмени',
    );
  });

  /*
   * ── THE DISMISS AND THE VISIBLE CLOCK (2026-09-11) ────────────────────
   * A ✕ that closes the toast at once, whose ring is the clock: it carries
   * the duration the timer runs on and freezes with the toast's own hold.
   */
  it('closes on its dismiss at once, named for assistive tech, and stops its clock', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    const dismiss =
      surface().querySelector<HTMLButtonElement>('.ui-toast__dismiss');
    expect(dismiss?.getAttribute('aria-label')).toBe('Затвори');
    // The ring inside it reads the toast's own duration.
    expect(surface().style.getPropertyValue('--ui-toast-duration')).toBe(
      '50ms',
    );
    expect(dismiss?.querySelector('.ui-toast__clock-left')).not.toBeNull();

    dismiss?.click();
    expect(fixture.componentInstance.dismissed).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Once, by the press — not again by the clock.
    expect(fixture.componentInstance.dismissed).toBe(1);
    expect(fixture.componentInstance.acted).toBe(0);
  });

  it('marks itself paused while held, so the ring freezes with the clock', () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    expect(surface().hasAttribute('data-paused')).toBe(false);
    surface().dispatchEvent(new Event('focusin'));
    fixture.detectChanges();
    expect(surface().hasAttribute('data-paused')).toBe(true);
    surface().dispatchEvent(new Event('focusout'));
    fixture.detectChanges();
    expect(surface().hasAttribute('data-paused')).toBe(false);
  });

  it('resumes with what was left of the clock, not from the top', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    // 50ms clock: hold after 30, release, and it should go within ~20 more —
    // long before a restarted 50 would have.
    await new Promise((resolve) => setTimeout(resolve, 30));
    surface().dispatchEvent(new Event('pointerenter'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.componentInstance.dismissed).toBe(0);
    surface().dispatchEvent(new Event('pointerleave'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fixture.componentInstance.dismissed).toBe(1);
  });

  it('emits the action once and stops its own clock', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    surface().querySelector('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.componentInstance.acted).toBe(1);
    expect(fixture.componentInstance.dismissed).toBe(0);
  });

  it('times out on its own, but not while someone is holding it', async () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    surface().dispatchEvent(new Event('pointerenter'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.componentInstance.dismissed).toBe(0);
    surface().dispatchEvent(new Event('pointerleave'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fixture.componentInstance.dismissed).toBe(1);
  });

  it('renders nothing at all when not presented', () => {
    expect(surface()).toBeNull();
  });

  /*
   * ── THE WAY OUT IS A FADE (2026-09-11) ────────────────────────────────
   * The surface stays for its exit animation and is unmounted only once it
   * has finished — the same way whether the clock ran out or the ✕ was
   * pressed. jsdom has no Web Animations, so one is stubbed with a promise
   * the test holds and releases.
   */
  it('stays mounted, marked leaving, until its exit has played', async () => {
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const animate = vi.fn(() => ({
      finished,
      cancel: () => undefined,
      pause: () => undefined,
      play: () => undefined,
    }));
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const original = proto.animate;
    proto.animate = animate;
    try {
      fixture.componentInstance.presented.set(true);
      fixture.detectChanges();
      fixture.componentInstance.presented.set(false);
      fixture.detectChanges();
      // Still there, on its way out, and not accepting a press.
      expect(surface()).not.toBeNull();
      expect(surface().hasAttribute('data-leaving')).toBe(true);
      expect(animate).toHaveBeenCalledTimes(1);
      finish();
      await finished;
      await Promise.resolve();
      fixture.detectChanges();
      expect(surface()).toBeNull();
    } finally {
      proto.animate = original;
    }
  });

  it('leaves at once where nothing can animate it', () => {
    fixture.componentInstance.presented.set(true);
    fixture.detectChanges();
    fixture.componentInstance.presented.set(false);
    fixture.detectChanges();
    expect(surface()).toBeNull();
  });
});
