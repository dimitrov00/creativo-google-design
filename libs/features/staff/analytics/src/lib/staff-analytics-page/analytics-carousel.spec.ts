import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsPageVm } from '../analytics-home.vm';
import { AnalyticsCarousel, heldScrollLeft } from './analytics-carousel';

/*
 * The carousel's swipe: one page at a time, whatever the momentum
 * (owner, 2026-11-09: "you cannot scroll and pass one sector").
 */

describe('heldScrollLeft — one page a swipe', () => {
  const WIDTH = 400;

  it('lets the track move within the pages either side of the one it settled on', () => {
    expect(heldScrollLeft(10 * WIDTH - 120, WIDTH, 10, 12)).toBe(
      10 * WIDTH - 120,
    );
    expect(heldScrollLeft(9 * WIDTH, WIDTH, 10, 12)).toBe(9 * WIDTH);
    expect(heldScrollLeft(11 * WIDTH, WIDTH, 10, 12)).toBe(11 * WIDTH);
  });

  it('holds a flick that would carry it further at the neighbouring page', () => {
    expect(heldScrollLeft(7 * WIDTH, WIDTH, 10, 12)).toBe(9 * WIDTH);
    expect(heldScrollLeft(0, WIDTH, 11, 12)).toBe(10 * WIDTH);
  });

  it('keeps to the run at either end, and leaves an unmeasured track alone', () => {
    expect(heldScrollLeft(-50, WIDTH, 0, 12)).toBe(0);
    expect(heldScrollLeft(20 * WIDTH, WIDTH, 11, 12)).toBe(11 * WIDTH);
    expect(heldScrollLeft(1234, 0, 3, 12)).toBe(1234);
  });
});

@Component({
  imports: [AnalyticsCarousel],
  template: `<lib-analytics-carousel
    [pages]="pages"
    [index]="index()"
    (settled)="settled.push($event)"
  />`,
})
class Host {
  readonly pages: readonly AnalyticsPageVm[] = Array.from(
    { length: 12 },
    (_, i) => ({
      key: `MONTH-${i}`,
      label: `Месец ${i}`,
      cards: null,
      team: null,
      query: {
        span: 'MONTH',
        from: '2026-01-01' as AnalyticsPageVm['query']['from'],
        to: null,
        barber: null,
        location: null,
      },
    }),
  );
  readonly index = signal(11);
  readonly settled: number[] = [];
}

describe('AnalyticsCarousel', () => {
  it('a flick from the last page stops on the one before, and settles there', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const track = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="analytics-carousel"]',
    ) as HTMLElement;
    Object.defineProperty(track, 'clientWidth', { value: 400 });
    track.scrollLeft = 2 * 400;
    track.dispatchEvent(new Event('scroll'));
    expect(track.scrollLeft).toBe(10 * 400);
    track.dispatchEvent(new Event('scrollend'));
    expect(fixture.componentInstance.settled).toEqual([10]);
  });

  it('holds a whole gesture to one page: momentum that outlives a settle goes no further', async () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const track = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="analytics-carousel"]',
      ) as HTMLElement;
      Object.defineProperty(track, 'clientWidth', { value: 400 });
      track.scrollLeft = 11 * 400;
      // The flick starts on the last page and snaps to the one before…
      track.dispatchEvent(new Event('wheel'));
      track.scrollLeft = 10 * 400;
      track.dispatchEvent(new Event('scroll'));
      track.dispatchEvent(new Event('scrollend'));
      fixture.componentInstance.index.set(10);
      fixture.detectChanges();
      // …while its momentum still streams in: held where the gesture began.
      vi.advanceTimersByTime(100);
      track.dispatchEvent(new Event('wheel'));
      track.scrollLeft = 8 * 400;
      track.dispatchEvent(new Event('scroll'));
      expect(track.scrollLeft).toBe(10 * 400);
      // Once the input has been quiet, the next swipe may go on.
      vi.advanceTimersByTime(400);
      track.dispatchEvent(new Event('wheel'));
      track.scrollLeft = 9 * 400;
      track.dispatchEvent(new Event('scroll'));
      expect(track.scrollLeft).toBe(9 * 400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws one dot per page up to the window, the page on screen marked', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const dots = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="analytics-page-dots"] .ui-page-control__dot',
    );
    expect(dots).toHaveLength(7);
    expect(dots[6]?.hasAttribute('data-current')).toBe(true);
  });
});
