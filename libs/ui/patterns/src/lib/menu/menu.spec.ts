import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiMenu, UiMenuItem, UiMenuTrigger } from './menu';

@Component({
  imports: [UiMenu, UiMenuItem, UiMenuTrigger],
  template: `
    <ui-menu
      [uiPresented]="open()"
      uiLabel="Photo actions"
      (uiDismissed)="dismissed = dismissed + 1; open.set(false)"
    >
      <button uiMenuTrigger type="button" (click)="open.set(true)">Edit</button>
      <button uiMenuItem type="button" (click)="chose = chose + 1">
        Choose photo
      </button>
      <button
        uiMenuItem
        uiMenuItemRole="destructive"
        type="button"
        (click)="removed = removed + 1"
      >
        Remove photo
      </button>
    </ui-menu>
  `,
})
class Host {
  readonly open = signal(false);
  dismissed = 0;
  chose = 0;
  removed = 0;
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

function surface(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>('.ui-menu__surface')!;
}

function items(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.ui-menu__item'));
}

async function open(
  fixture: { detectChanges(): void; whenStable(): Promise<unknown> },
  component: Host,
) {
  component.open.set(true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('UiMenu', () => {
  it('stamps the APG menu-button relationship on the trigger', async () => {
    const { host } = await render();
    const trigger = host.querySelector('[uiMenuTrigger]');

    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the surface mounted but hidden while closed, so items stay out of the tab order', async () => {
    const { host } = await render();

    expect(surface(host)).not.toBeNull();
    expect(surface(host).hasAttribute('data-open')).toBe(false);
    expect(surface(host).getAttribute('role')).toBe('menu');
    expect(surface(host).getAttribute('aria-label')).toBe('Photo actions');
    // Every item is a real menuitem, never reachable by Tab (visibility
    // does that; tabindex -1 keeps them out even mid-transition).
    for (const item of items(host)) {
      expect(item.getAttribute('role')).toBe('menuitem');
      expect(item.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('opens on the trigger and flips aria-expanded', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    expect(surface(host).hasAttribute('data-open')).toBe(true);
    expect(
      host.querySelector('[uiMenuTrigger]')?.getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('moves focus onto the first item when it opens, so the keyboard model is live immediately', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    expect(document.activeElement).toBe(items(host)[0]);
  });

  it('marks the destructive item, which HIG places last', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    const all = items(host);
    expect(all[0]?.getAttribute('data-role')).toBe('default');
    expect(all.at(-1)?.getAttribute('data-role')).toBe('destructive');
  });

  it('moves focus between items with the arrow keys, wrapping around', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    const all = items(host);
    all[0]?.focus();
    surface(host).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(all[1]);

    surface(host).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(all[0]);

    surface(host).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    expect(document.activeElement).toBe(all.at(-1));
  });

  it('dismisses on Escape and hands focus back to the trigger', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    surface(host).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.dismissed).toBe(1);
    expect(document.activeElement).toBe(host.querySelector('[uiMenuTrigger]'));
  });

  it('keeps Escape to itself — a sheet around it must not close on the same press', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);
    // Stand-in for the dialog's own keydown listener, an ancestor.
    let reachedAncestor = 0;
    const onAncestor = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reachedAncestor += 1;
    };
    host.addEventListener('keydown', onAncestor);

    surface(host).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    host.removeEventListener('keydown', onAncestor);

    expect(fixture.componentInstance.dismissed).toBe(1);
    expect(reachedAncestor).toBe(0);
  });

  it('closes on Escape from its own trigger too, and keeps that press to itself', async () => {
    // A surface with nothing to focus — a calendar, a search — leaves
    // focus on the trigger, where the surface's handler cannot hear the
    // key; it went on to close the sheet around the menu (2026-09-10).
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);
    let reachedAncestor = 0;
    const onAncestor = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reachedAncestor += 1;
    };
    host.addEventListener('keydown', onAncestor);

    host
      .querySelector('[uiMenuTrigger]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    fixture.detectChanges();
    host.removeEventListener('keydown', onAncestor);

    expect(fixture.componentInstance.dismissed).toBe(1);
    expect(reachedAncestor).toBe(0);
  });

  it('rides the top layer as a popover, placed from its trigger', async () => {
    const { fixture, host } = await render();
    // A `popover` element: `showPopover()` lifts it above every stacking
    // context and clip on the page; the coordinates are fixed, from the
    // trigger's rect, written on open.
    expect(surface(host).getAttribute('popover')).toBe('manual');
    await open(fixture, fixture.componentInstance);
    expect(surface(host).style.top).not.toBe('');
    expect(surface(host).style.left).not.toBe('');
    expect(
      surface(host).style.getPropertyValue('--ui-menu-anchor-width'),
    ).not.toBe('');
  });

  it('dismisses on an outside press but not on a press inside', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    surface(host).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    );
    expect(fixture.componentInstance.dismissed).toBe(0);

    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    );
    expect(fixture.componentInstance.dismissed).toBe(1);
  });

  /*
   * ── MODAL TO THE PAGE BEHIND IT (2026-09-11) ──────────────────────────
   * A menu on the platform is modal: the touch that dismisses it goes to
   * nothing else, and nothing behind it scrolls while it is open. Without
   * this the first touch outside both closed the menu and scrolled the sheet
   * under it, so the trigger slid away from the fading surface.
   */
  it('swallows a touch and a wheel outside, and lets both through inside', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    const outsideTouch = new Event('touchstart', {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(outsideTouch);
    expect(outsideTouch.defaultPrevented).toBe(true);

    const insideTouch = new Event('touchstart', {
      bubbles: true,
      cancelable: true,
    });
    surface(host).dispatchEvent(insideTouch);
    expect(insideTouch.defaultPrevented).toBe(false);

    const outsideWheel = new Event('wheel', {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(outsideWheel);
    expect(outsideWheel.defaultPrevented).toBe(true);

    const insideWheel = new Event('wheel', { bubbles: true, cancelable: true });
    items(host)[0]?.dispatchEvent(insideWheel);
    expect(insideWheel.defaultPrevented).toBe(false);

    // Closed, it listens for nothing.
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    const afterClose = new Event('touchstart', {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(afterClose);
    expect(afterClose.defaultPrevented).toBe(false);
  });

  it('resolves one side per presentation and states it on the surface', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);
    expect(surface(host).getAttribute('data-placement')).toMatch(
      /^(bottom|top)$/,
    );
    expect(surface(host).getAttribute('data-alignment')).toBe('leading');
    // The window's usable width reaches the stylesheet, so the surface can
    // never be forced wider than the screen by its own minimum.
    expect(
      surface(host).style.getPropertyValue('--ui-menu-window-inline'),
    ).toMatch(/px$/);
  });

  it('runs the item action and closes — every item is a one-shot command', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    items(host)[0]?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.chose).toBe(1);
    expect(fixture.componentInstance.dismissed).toBe(1);
    expect(surface(host).hasAttribute('data-open')).toBe(false);
  });

  it('light-dismisses when focus tabs out', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    surface(host).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(fixture.componentInstance.dismissed).toBe(1);
  });

  /*
   * ── THE SURFACE IS BOUNDED BOTH WAYS ──────────────────────────────────
   *
   * The inline size was constrained from the start and the block size never
   * was, so a menu with more items than the room below its trigger grew
   * straight off the screen — the tail of a long catalogue unreachable, with
   * nothing to say it was there.
   */
  it('caps its own height and scrolls, rather than growing off the screen', async () => {
    const { fixture, host } = await render();
    await open(fixture, fixture.componentInstance);

    const cap = surface(host).style.getPropertyValue('--ui-menu-max-block');
    expect(cap).toMatch(/^\d+(\.\d+)?px$/);

    /*
     * ⚠ The CLAMP is the part under test, not the arithmetic.
     *
     * `room` is derived from a rect, and a rect read against a host that has
     * moved — a sheet mid-scroll, a transform in flight — can be arbitrarily
     * large. That is not hypothetical: measuring inside the opening effect
     * rather than after render produced a 1163px cap on an 812px screen, and
     * the menu it was meant to bound ran off the bottom of the phone.
     *
     * jsdom reports every rect as zero, so the raw `room` here is the whole
     * viewport — which is exactly the shape of that bug, and the ceiling is
     * what has to survive it.
     */
    const ceiling = window.innerHeight * 0.55;
    expect(Number.parseFloat(cap)).toBeLessThanOrEqual(ceiling + 0.01);
    // Never taller than the screen, whatever the arithmetic says.
    expect(Number.parseFloat(cap)).toBeLessThan(window.innerHeight);
  });
});
