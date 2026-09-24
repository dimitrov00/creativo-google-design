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
});
