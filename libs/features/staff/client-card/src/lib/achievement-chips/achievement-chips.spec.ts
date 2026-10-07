import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../testing/css-rule';
import { ACHIEVEMENT_CHIPS } from '../../testing/client-pages.vm-fixtures';
import type { AchievementChipVm } from '../client-pages.vm';
import { AchievementChips } from './achievement-chips';

@Component({
  imports: [AchievementChips],
  template: `
    <lib-achievement-chips
      [chips]="chips()"
      [selectedId]="selected()"
      label="Категории"
      idPrefix="probe-chip"
      testIdPrefix="achievements-chip"
      data-testid="achievements-chips"
      (picked)="picked.push($event)"
    />
  `,
})
class Host {
  readonly chips = signal<readonly AchievementChipVm[]>(ACHIEVEMENT_CHIPS);
  readonly selected = signal('all');
  readonly picked: string[] = [];
}

async function mount(selected = 'all') {
  await TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.selected.set(selected);
  fixture.detectChanges();
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    band: host.querySelector<HTMLElement>('lib-achievement-chips'),
    toolbar: host.querySelector<HTMLElement>('ui-flow'),
    chips: [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="achievements-chip-"]',
      ),
    ],
    byId: (id: string) =>
      host.querySelector<HTMLButtonElement>(
        `[data-testid="achievements-chip-${id}"]`,
      ),
  };
}

describe('AchievementChips', () => {
  it('is a toolbar of small chips in flow, named «Категории», one chip per category in the page’s order', async () => {
    const { toolbar, chips } = await mount();
    expect(toolbar?.getAttribute('role')).toBe('toolbar');
    expect(toolbar?.getAttribute('aria-label')).toBe('Категории');
    // The DS flow wraps at the compact gap, leading-aligned: in flow, never
    // a rail (DV-A).
    expect(toolbar?.getAttribute('data-spacing')).toBe('compact');
    expect(toolbar?.getAttribute('data-alignment')).toBe('leading');
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
      'Всички',
      'Етапи',
      'Майсторство',
      'Бръснари',
      'Ритъм',
      'Специални',
      'Сезони',
    ]);
    for (const chip of chips) {
      expect(chip.getAttribute('type')).toBe('button');
      expect(chip.classList).toContain('ui-chip');
      expect(chip.getAttribute('data-control-size')).toBe('small');
    }
  });

  it('prints no count on a chip: the count is heard, each chip named with it', async () => {
    const { byId } = await mount();
    const stages = byId('milestones');
    expect(stages?.textContent?.trim()).toBe('Етапи');
    expect(stages?.getAttribute('aria-label')).toBe('Етапи, 3 от 5 спечелени');
    // The chip says «Бръснари»; its section keeps «Бръснари и салони».
    const barbers = byId('barbers');
    expect(barbers?.textContent?.trim()).toBe('Бръснари');
    expect(barbers?.getAttribute('aria-label')).toBe(
      'Бръснари и салони, 4 от 6 спечелени',
    );
  });

  it('marks the chosen chip as pressed, and the others not', async () => {
    const { byId, chips } = await mount('mastery');
    expect(byId('mastery')?.getAttribute('aria-pressed')).toBe('true');
    expect(byId('mastery')?.hasAttribute('data-selected')).toBe(true);
    expect(
      chips.filter((chip) => chip.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(1);
    expect(byId('all')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('gives every chip an id the region under the band is labelled by', async () => {
    const { byId } = await mount();
    expect(byId('all')?.id).toBe('probe-chip-all');
    expect(byId('seasons')?.id).toBe('probe-chip-seasons');
    expect(byId('seasons')?.getAttribute('data-chip')).toBe('seasons');
  });

  it('says which chip was tapped, the chosen one included, and decides nothing itself', async () => {
    const { fixture, byId } = await mount('all');
    byId('rhythm')?.click();
    byId('all')?.click();
    expect(fixture.componentInstance.picked).toEqual(['rhythm', 'all']);
    // Still the host's choice: nothing moved on its own.
    expect(byId('all')?.getAttribute('aria-pressed')).toBe('true');
    expect(byId('rhythm')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('follows the host: a new choice re-presses the band', async () => {
    const { fixture, byId } = await mount('all');
    fixture.componentInstance.selected.set('seasons');
    fixture.detectChanges();
    expect(byId('seasons')?.getAttribute('aria-pressed')).toBe('true');
    expect(byId('all')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('spaces the chips compact on a phone and tight in the ≥ 761 dialog, where one row holds all seven (review 3, round 2)', async () => {
    const phone = await mount();
    expect(phone.toolbar?.getAttribute('data-spacing')).toBe('compact');
    const view = document.defaultView as Window;
    Object.defineProperty(view, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (media: string) => ({
        matches: media === '(min-width: 761px)',
        media,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    try {
      TestBed.resetTestingModule();
      const dialog = await mount();
      expect(dialog.toolbar?.getAttribute('data-spacing')).toBe('tight');
    } finally {
      Reflect.deleteProperty(view, 'matchMedia');
    }
  });

  it('takes the sheet’s clearance as its scroll margin, and declares no colour, position or cover (§3.9)', () => {
    const host = cssRule('achievement-chips/achievement-chips.css', ':host');
    expect(host.get('scroll-margin-block-start')).toBe(
      'var(--modal-sheet-clear-top)',
    );
    expect(host.get('display')).toBe('block');
    expect(host.has('position')).toBe(false);
    expect(host.has('background')).toBe(false);
    expect(host.has('color')).toBe(false);
  });
});
