import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiRewardMoment } from './reward-moment';

describe('UiRewardMoment', () => {
  it('draws its mark with the progress disc, large and complete — one disc and one check stroke in the system', () => {
    const fixture = TestBed.createComponent(UiRewardMoment);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const disc = host.querySelector<HTMLElement>(
      '.ui-reward-moment__burst > .ui-progress-disc',
    );
    expect(disc?.dataset['phase']).toBe('complete');
    expect(disc?.dataset['controlSize']).toBe('large');
    expect(host.querySelector('.ui-reward-moment__badge')).toBeNull();
  });

  it('bursts its confetti from behind the disc', () => {
    const fixture = TestBed.createComponent(UiRewardMoment);
    fixture.detectChanges();
    const burst = (fixture.nativeElement as HTMLElement).querySelector(
      '.ui-reward-moment__burst',
    );
    expect(burst?.firstElementChild?.classList.contains('ui-confetti')).toBe(
      true,
    );
  });
});
