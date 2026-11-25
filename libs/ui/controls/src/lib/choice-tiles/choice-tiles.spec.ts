import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiChoiceTiles, type UiChoiceTile } from './choice-tiles';

@Component({
  imports: [UiChoiceTiles],
  template: `
    <ui-choice-tiles
      [uiTiles]="tiles"
      [uiSelectedId]="selected()"
      uiLabel="Бакшиш"
      (uiPicked)="picked.push($event); selected.set($event)"
    />
  `,
})
class Host {
  tiles: readonly UiChoiceTile[] = [
    { id: 'none', label: 'Без', testId: 'tile-none' },
    { id: '200', label: '2,00 €', detail: '14 %', testId: 'tile-200' },
    { id: 'off', label: '9,00 €', disabled: true, testId: 'tile-off' },
    {
      id: 'up',
      label: 'до 15,00 €',
      detail: '+0,50 €',
      size: 'large',
      testId: 'tile-up',
    },
    { id: 'other', label: 'Друга сума', size: 'wide', testId: 'tile-other' },
  ];
  readonly selected = signal<string | null>('none');
  picked: string[] = [];
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, host, q };
}

describe('UiChoiceTiles', () => {
  it('is a radio group of tiles: one checked, the detail beneath the label, a pick reported', async () => {
    const { fixture, host, q } = await render();
    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Бакшиш');
    expect(q('tile-none')?.getAttribute('role')).toBe('radio');
    expect(q('tile-none')?.getAttribute('aria-checked')).toBe('true');
    expect(q('tile-none')?.hasAttribute('data-selected')).toBe(true);
    expect(q('tile-200')?.getAttribute('aria-checked')).toBe('false');
    expect(
      q('tile-200')
        ?.querySelector('.ui-choice-tile__label')
        ?.textContent?.trim(),
    ).toBe('2,00 €');
    expect(
      q('tile-200')
        ?.querySelector('.ui-choice-tile__detail')
        ?.textContent?.trim(),
    ).toBe('14 %');
    expect(q('tile-none')?.querySelector('.ui-choice-tile__detail')).toBeNull();
    // Every tile carries the house interactive grammar, so hover and press
    // read like the rows and cards around it.
    expect(q('tile-200')?.hasAttribute('data-interactive')).toBe(true);

    q('tile-200')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['200']);
    expect(q('tile-200')?.getAttribute('aria-checked')).toBe('true');
    expect(q('tile-none')?.getAttribute('aria-checked')).toBe('false');

    // A disabled tile is shown, not removed, and picks nothing.
    expect((q('tile-off') as HTMLButtonElement).disabled).toBe(true);
    q('tile-off')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['200']);
  });

  it('stamps each tile with its size for the bento, and the grid with its columns', async () => {
    const { host, q } = await render();
    expect(q('tile-200')?.getAttribute('data-size')).toBe('regular');
    expect(q('tile-up')?.getAttribute('data-size')).toBe('large');
    expect(q('tile-other')?.getAttribute('data-size')).toBe('wide');
    const grid = host.querySelector<HTMLElement>('[role="radiogroup"]');
    expect(grid?.style.getPropertyValue('--ui-choice-tiles-columns')).toBe('3');
  });

  it('rows one TILE rung tall, on the regular corner and the control fill: the tile face, read from its token', () => {
    const css = readFileSync(resolve(__dirname, 'choice-tiles.css'), 'utf8');
    const grid = /\.ui-choice-tiles__grid\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(grid).toContain('grid-auto-rows: var(--control-size-tile)');
    const tile = /\.ui-choice-tile\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(tile).toContain('border-radius: var(--control-radius-regular)');
    expect(tile).toContain('background: var(--sys-color-fill)');
  });

  it('moves the check with the arrow keys, like native radios, skipping what is disabled', async () => {
    const { fixture, q } = await render();
    q('tile-none')?.focus();
    q('tile-none')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['200']);
    expect(document.activeElement).toBe(q('tile-200'));
    // Right again skips the disabled tile and lands on the large one.
    q('tile-200')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['200', 'up']);
    expect(document.activeElement).toBe(q('tile-up'));
  });

  it('jumps to the ends on Home and End and wraps past them, as the segmented control does', async () => {
    const { fixture, q } = await render();
    const press = (key: string, id: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      q(id)?.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    expect(press('End', 'tile-none').defaultPrevented).toBe(true);
    expect(fixture.componentInstance.selected()).toBe('other');
    expect(document.activeElement).toBe(q('tile-other'));
    press('ArrowRight', 'tile-other');
    expect(fixture.componentInstance.selected()).toBe('none');
    press('ArrowLeft', 'tile-none');
    expect(fixture.componentInstance.selected()).toBe('other');
    press('Home', 'tile-other');
    expect(fixture.componentInstance.selected()).toBe('none');
    expect(document.activeElement).toBe(q('tile-none'));
    // A key the group does not own is left to the page.
    expect(press('Enter', 'tile-none').defaultPrevented).toBe(false);
    expect(fixture.componentInstance.selected()).toBe('none');
  });

  it('is one tab stop: the chosen tile, else the first that can be chosen', async () => {
    const { fixture, host } = await render();
    const stops = () =>
      Array.from(host.querySelectorAll<HTMLElement>('[role="radio"]')).map(
        (tile) => tile.getAttribute('tabindex'),
      );
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);
    fixture.componentInstance.selected.set('up');
    fixture.detectChanges();
    expect(stops()).toEqual(['-1', '-1', '-1', '0', '-1']);
    // Nothing chosen, and a chosen tile that is disabled, both hand the stop
    // to the first tile that can take focus.
    fixture.componentInstance.selected.set(null);
    fixture.detectChanges();
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);
    fixture.componentInstance.selected.set('off');
    fixture.detectChanges();
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);
  });
});
