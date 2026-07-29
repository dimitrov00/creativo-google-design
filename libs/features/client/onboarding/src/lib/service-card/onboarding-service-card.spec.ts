import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingServiceCard } from './onboarding-service-card';

@Component({
  imports: [OnboardingServiceCard],
  template: `
    <lib-onboarding-service-card
      serviceId="haircut"
      name="Класическо подстригване"
      meta="45 мин · 30 лв."
      coverUrl="/work/modern-cut.jpg"
      detailsLabel="Детайли"
      [selected]="selected()"
      [capBlocked]="capBlocked()"
      (toggled)="toggles = toggles + 1"
      (details)="opened = opened + 1"
    />
  `,
})
class HostComponent {
  selected = signal(false);
  capBlocked = signal(false);
  toggles = 0;
  opened = 0;
}

describe('OnboardingServiceCard', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host = fixture.nativeElement;
  });

  it('reads in on the shared ui-media-card surface, square and scrimmed', () => {
    const card: HTMLElement | null = host.querySelector(
      '.onboarding-service-card__select ui-media-card',
    );
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
    const check = host.querySelector(
      'ui-media-card > .onboarding-service-card__check',
    );
    expect(check).not.toBeNull();
    expect(check?.hasAttribute('data-selected')).toBe(false);

    fixture.componentInstance.selected.set(true);
    fixture.detectChanges();
    expect(
      host
        .querySelector('.onboarding-service-card__check')
        ?.hasAttribute('data-selected'),
    ).toBe(true);
    expect(
      host
        .querySelector('.onboarding-service-card')
        ?.hasAttribute('data-selected'),
    ).toBe(true);
  });

  it('keeps the info pill a SIBLING of the select button (never nested)', () => {
    const select = host.querySelector('.onboarding-service-card__select');
    const info = host.querySelector('.onboarding-service-card__info');
    expect(select?.contains(info ?? null)).toBe(false);
    expect(info?.getAttribute('aria-label')).toBe('Детайли');
  });

  it('emits toggle and details separately, and disables only the select at the cap', () => {
    host
      .querySelector<HTMLButtonElement>('.onboarding-service-card__select')
      ?.click();
    host
      .querySelector<HTMLButtonElement>('.onboarding-service-card__info')
      ?.click();
    expect(fixture.componentInstance.toggles).toBe(1);
    expect(fixture.componentInstance.opened).toBe(1);

    fixture.componentInstance.capBlocked.set(true);
    fixture.detectChanges();
    expect(
      host.querySelector<HTMLButtonElement>('.onboarding-service-card__select')
        ?.disabled,
    ).toBe(true);
    // Details stay reachable while the card itself is held.
    expect(
      host.querySelector<HTMLButtonElement>('.onboarding-service-card__info')
        ?.disabled,
    ).toBe(false);
  });
});
