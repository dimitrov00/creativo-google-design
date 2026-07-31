import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServiceCardComponent } from './service-card.component';

@Component({
  imports: [ServiceCardComponent],
  template: `
    <cr-service-card
      uiServiceId="haircut"
      uiName="Класическо подстригване"
      uiMeta="45 мин · 30 лв."
      uiCoverUrl="/work/modern-cut.jpg"
      uiDetailsLabel="Детайли"
      uiBlockedLabel="Не се комбинира"
      [uiSelectedCount]="selectedCount()"
      [uiBlocked]="blocked()"
      [uiCapBlocked]="capBlocked()"
      [uiShowDetails]="showDetails()"
      (uiPressed)="presses = presses + 1"
      (uiDetailsPressed)="detailPresses = detailPresses + 1"
    />
  `,
})
class HostComponent {
  readonly selectedCount = signal(0);
  readonly blocked = signal(false);
  readonly capBlocked = signal(false);
  readonly showDetails = signal(true);
  presses = 0;
  detailPresses = 0;
}

describe('ServiceCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('reads in on the shared ui-media-card surface, square and scrimmed', () => {
    const card = host.querySelector('.cr-service-card__select ui-media-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-radius')).toBe('prominent');
    expect(
      card?.querySelector('ui-async-image')?.getAttribute('style'),
    ).toContain('1 / 1');
    expect(card?.querySelector('[data-overlay="scrim-media"]')).not.toBeNull();
    // Name + meta are the card's own inset caption stack, not local copy.
    expect(
      card?.querySelector('.ui-media-card__caption')?.textContent?.trim(),
    ).toContain('Класическо подстригване');
  });

  it('rides the card corner slot for the selection chip and flips it when selected', () => {
    const check = host.querySelector('ui-media-card > .cr-service-card__check');
    expect(check).not.toBeNull();
    expect(check?.hasAttribute('data-selected')).toBe(false);

    fixture.componentInstance.selectedCount.set(1);
    fixture.detectChanges();
    expect(
      host
        .querySelector('.cr-service-card__check')
        ?.hasAttribute('data-selected'),
    ).toBe(true);
    expect(
      host.querySelector('.cr-service-card')?.hasAttribute('data-selected'),
    ).toBe(true);
  });

  it('shows a check at one selection and a COUNT past one', () => {
    fixture.componentInstance.selectedCount.set(1);
    fixture.detectChanges();
    // A "1" badge on a single selection is noise.
    expect(
      host.querySelector('.cr-service-card__check ui-icon'),
    ).not.toBeNull();

    fixture.componentInstance.selectedCount.set(2);
    fixture.detectChanges();
    const check = host.querySelector('.cr-service-card__check');
    expect(check?.textContent?.trim()).toBe('2');
    expect(check?.querySelector('ui-icon')).toBeNull();
  });

  it('keeps the info pill a SIBLING of the select button (never nested)', () => {
    const select = host.querySelector('.cr-service-card__select');
    const info = host.querySelector('.cr-service-card__info');
    expect(select?.contains(info ?? null)).toBe(false);
    expect(info?.getAttribute('aria-label')).toBe('Детайли');
  });

  it('drops the info pill when the card’s own press opens details', () => {
    fixture.componentInstance.showDetails.set(false);
    fixture.detectChanges();
    // Booking's usage: no second affordance duplicating the card's job, and
    // no aria-pressed either — the press is navigation, not a toggle.
    expect(host.querySelector('.cr-service-card__info')).toBeNull();
    expect(
      host
        .querySelector('.cr-service-card__select')
        ?.hasAttribute('aria-pressed'),
    ).toBe(false);
  });

  it('emits press and details separately, and disables only the select at the cap', () => {
    host.querySelector<HTMLButtonElement>('.cr-service-card__select')?.click();
    host.querySelector<HTMLButtonElement>('.cr-service-card__info')?.click();
    expect(fixture.componentInstance.presses).toBe(1);
    expect(fixture.componentInstance.detailPresses).toBe(1);

    fixture.componentInstance.capBlocked.set(true);
    fixture.detectChanges();
    expect(
      host.querySelector<HTMLButtonElement>('.cr-service-card__select')
        ?.disabled,
    ).toBe(true);
    // Details stay reachable while the card itself is held.
    expect(
      host.querySelector<HTMLButtonElement>('.cr-service-card__info')?.disabled,
    ).toBe(false);
  });

  it('leaves a BLOCKED card fully pressable, muted, with the reason in the ring', () => {
    fixture.componentInstance.blocked.set(true);
    fixture.detectChanges();

    const select = host.querySelector<HTMLButtonElement>(
      '.cr-service-card__select',
    );
    // Blocked is not disabled: the press is how the explanation is reached.
    expect(select?.disabled).toBe(false);
    expect(
      host.querySelector('.cr-service-card')?.hasAttribute('data-blocked'),
    ).toBe(true);
    // The warning CAPSULE is gone: the whole card mutes, and the corner ring
    // that carries the checkmark when selected carries the "does not combine"
    // glyph instead. One slot, three states — the badge used to shout louder
    // than the selection it was qualifying.
    expect(host.querySelector('.cr-service-card__blocked')).toBeNull();
    const ring = host.querySelector('.cr-service-card__check');
    expect(ring?.hasAttribute('data-blocked')).toBe(true);
    expect(ring?.getAttribute('aria-label')).toContain('Не се комбинира');

    select?.click();
    expect(fixture.componentInstance.presses).toBe(1);
  });
});
