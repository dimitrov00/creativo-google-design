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
});
