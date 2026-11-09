import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  UI_PAGE_CONTROL_MAX_DOTS,
  UiPageControl,
  uiPageDots,
} from './page-control';

describe('uiPageDots', () => {
  it('draws one dot per page up to the cap, the current one marked, no edges', () => {
    expect(uiPageDots(3, 1)).toEqual([
      { page: 0, current: false, edge: false },
      { page: 1, current: true, edge: false },
      { page: 2, current: false, edge: false },
    ]);
    expect(uiPageDots(0, 0)).toEqual([]);
  });

  it('slides a window over a long run, the current page in its middle, the ends with more beyond shrunk', () => {
    const middle = uiPageDots(30, 15);
    expect(middle).toHaveLength(UI_PAGE_CONTROL_MAX_DOTS);
    expect(middle.map((dot) => dot.page)).toEqual([12, 13, 14, 15, 16, 17, 18]);
    expect(middle.find((dot) => dot.current)?.page).toBe(15);
    expect(middle.filter((dot) => dot.edge).map((dot) => dot.page)).toEqual([
      12, 18,
    ]);
  });

  it('pins the window at either end: the last page is the last dot, only the far edge shrinks', () => {
    const last = uiPageDots(30, 29);
    expect(last.map((dot) => dot.page)).toEqual([23, 24, 25, 26, 27, 28, 29]);
    expect(last.at(-1)).toEqual({ page: 29, current: true, edge: false });
    expect(last.filter((dot) => dot.edge).map((dot) => dot.page)).toEqual([23]);
    const first = uiPageDots(30, 0);
    expect(first.filter((dot) => dot.edge).map((dot) => dot.page)).toEqual([6]);
  });

  it('clamps an index outside the run', () => {
    expect(uiPageDots(4, 9).find((dot) => dot.current)?.page).toBe(3);
    expect(uiPageDots(4, -2).find((dot) => dot.current)?.page).toBe(0);
  });
});

@Component({
  imports: [UiPageControl],
  template: `<ui-page-control
    [uiCount]="count()"
    [uiIndex]="index()"
    [uiLabel]="label()"
  />`,
})
class Host {
  readonly count = signal(5);
  readonly index = signal(4);
  readonly label = signal('');
}

describe('UiPageControl', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      control: host.querySelector('ui-page-control') as HTMLElement,
    };
  }

  it('draws its dots, the current one marked, and stays decorative without a label', () => {
    const { control } = render();
    const dots = control.querySelectorAll('.ui-page-control__dot');
    expect(dots).toHaveLength(5);
    expect(dots[4]?.hasAttribute('data-current')).toBe(true);
    expect(control.getAttribute('aria-hidden')).toBe('true');
    expect(control.hasAttribute('role')).toBe(false);
  });

  it('speaks its label when given one, and hides itself for a single page', () => {
    const { fixture, control } = render();
    fixture.componentInstance.label.set('Страница 5 от 5');
    fixture.detectChanges();
    expect(control.getAttribute('role')).toBe('img');
    expect(control.getAttribute('aria-label')).toBe('Страница 5 от 5');
    expect(control.hasAttribute('aria-hidden')).toBe(false);
    fixture.componentInstance.count.set(1);
    fixture.detectChanges();
    expect(control.hidden).toBe(true);
  });
});
