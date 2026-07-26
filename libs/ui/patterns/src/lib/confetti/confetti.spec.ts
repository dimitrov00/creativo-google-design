import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiConfetti } from './confetti';

@Component({
  imports: [UiConfetti],
  template: `<ui-confetti
    data-testid="confetti"
    [uiCount]="count()"
    [uiDelay]="delay()"
  />`,
})
class HostComponent {
  count = signal(12);
  delay = signal(0);
}

describe('UiConfetti', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
  });

  function host(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="confetti"]');
  }

  function particles(): readonly Element[] {
    return Array.from(host().querySelectorAll('.ui-confetti__particle'));
  }

  it('spawns uiCount particles from the anchor on mount', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(particles().length).toBe(12);
  });

  it('is presentational chrome — hidden from AT, styled by the contract classes', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const el = host();
    expect(el.classList.contains('ui-confetti')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('tints and shapes every particle through the token-backed data contract', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const tints = new Set(
      particles().map((particle) => particle.getAttribute('data-tint')),
    );
    // All five token tints cycle through a 12-particle burst.
    expect(tints).toEqual(
      new Set(['accent', 'accent-soft', 'accent-faint', 'ink', 'ink-soft']),
    );
    for (const particle of particles()) {
      expect(['dot', 'slip']).toContain(particle.getAttribute('data-shape'));
    }
  });

  it('clamps the count into 1…240', async () => {
    fixture.componentInstance.count.set(500);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(particles().length).toBe(240);
  });

  it('spawns NOTHING under prefers-reduced-motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(particles().length).toBe(0);
  });

  it('tears the burst down on early destroy — no lingering DOM', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const el = host();
    expect(el.childElementCount).toBeGreaterThan(0);
    fixture.destroy();
    expect(el.childElementCount).toBe(0);
  });
});
