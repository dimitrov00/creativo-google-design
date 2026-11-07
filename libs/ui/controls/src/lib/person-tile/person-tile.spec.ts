import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiPersonTile } from './person-tile';

@Component({
  imports: [UiPersonTile],
  template: `
    <button
      uiPersonTile
      [uiSrc]="src()"
      uiName="Стефан Петров"
      [uiSelected]="selected()"
    >
      Стефан Петров
    </button>
  `,
})
class Host {
  readonly src = signal<string | null>(null);
  readonly selected = signal<boolean | null>(null);
}

function mount() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const tile = fixture.nativeElement.querySelector(
    '.ui-person-tile',
  ) as HTMLButtonElement;
  return { fixture, host: fixture.componentInstance, tile };
}

describe('UiPersonTile', () => {
  it('is a button whose face is decoration and whose name is the label', () => {
    const { tile } = mount();
    expect(tile.getAttribute('type')).toBe('button');
    expect(
      tile.querySelector('.ui-person-tile__face')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      tile.querySelector('.ui-avatar')?.getAttribute('data-control-size'),
    ).toBe('tile');
    expect(
      tile.querySelector('.ui-person-tile__name')?.textContent?.trim(),
    ).toBe('Стефан Петров');
  });

  it('a plain press carries no mark and no pressed state', () => {
    const { tile } = mount();
    expect(tile.querySelector('.ui-person-tile__check')).toBeNull();
    expect(tile.hasAttribute('aria-pressed')).toBe(false);
    expect(tile.hasAttribute('data-selected')).toBe(false);
  });

  it('a choice carries an empty ring, then the check and the ring round the face', () => {
    const { fixture, host, tile } = mount();
    host.selected.set(false);
    fixture.detectChanges();
    const check = () => tile.querySelector('.ui-person-tile__check');
    expect(check()).not.toBeNull();
    expect(check()?.hasAttribute('data-selected')).toBe(false);
    expect(tile.getAttribute('aria-pressed')).toBe('false');

    host.selected.set(true);
    fixture.detectChanges();
    expect(check()?.hasAttribute('data-selected')).toBe(true);
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect(tile.hasAttribute('data-selected')).toBe(true);
  });
});
