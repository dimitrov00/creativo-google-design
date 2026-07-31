import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  UI_DETENT_FRACTION,
  type UiDetent,
  UiDetentSheet,
} from './detent-sheet';

@Component({
  imports: [UiDetentSheet],
  template: `
    <div style="position: relative; height: 800px">
      <ui-detent-sheet
        [(uiDetent)]="detent"
        [uiDetents]="detents()"
        data-testid="sheet"
      >
        <h2 uiHeader>Nearby</h2>
        <button type="button" data-testid="row" (click)="taps.set(taps() + 1)">
          A row
        </button>
      </ui-detent-sheet>
    </div>
  `,
})
class HostComponent {
  readonly detent = signal<UiDetent>('medium');
  readonly detents = signal<readonly UiDetent[]>(['small', 'medium', 'large']);
  readonly taps = signal(0);
}

function sheet(fixture: ComponentFixture<HostComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('[data-testid="sheet"]');
}

function handle(fixture: ComponentFixture<HostComponent>): HTMLElement {
  return fixture.nativeElement.querySelector('.ui-detent-sheet__handle');
}

/** The inline custom property the host writes — how far the sheet is pushed down. */
function offsetPercent(fixture: ComponentFixture<HostComponent>): number {
  return Number.parseFloat(
    sheet(fixture).style.getPropertyValue('--ui-detent-offset'),
  );
}

/** A pointer gesture travelling `dy` pixels (negative is upward). */
function drag(target: HTMLElement, dy: number): void {
  const send = (type: string, clientY: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX: 100,
        clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
  send('pointerdown', 400);
  for (let step = 1; step <= 6; step++)
    send('pointermove', 400 + (dy * step) / 6);
  send('pointerup', 400 + dy);
}

/** A press with no travel — the gesture a selection is made with. */
function tap(target: HTMLElement): void {
  drag(target, 0);
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
}

describe('UiDetentSheet', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    // jsdom has no layout, so the sheet measures 0 and every drag is ignored
    // as "no height to travel". Give it the box the browser would.
    sheet(fixture).getBoundingClientRect = () =>
      ({
        height: 800,
        width: 400,
        top: 0,
        bottom: 800,
        left: 0,
        right: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  });

  it('rests at the requested detent, pushed down by the rest of its own height', () => {
    // The sheet's box is always the LARGEST detent; the current one is
    // expressed by how far down it is translated. `medium` (0.48) inside a
    // `large` (0.92) box shows just over half of it.
    const expected =
      (1 - UI_DETENT_FRACTION.medium / UI_DETENT_FRACTION.large) * 100;
    expect(offsetPercent(fixture)).toBeCloseTo(expected, 5);
    expect(sheet(fixture).getAttribute('data-detent')).toBe('medium');
  });

  it('is fully revealed at `large` — nothing left below the fold', () => {
    fixture.componentInstance.detent.set('large');
    fixture.detectChanges();
    expect(offsetPercent(fixture)).toBeCloseTo(0, 5);
  });

  it('steps up on a handle tap, and wraps back to the peek from the top', () => {
    // A tap is the keyboard-and-mouse path to the same thing the drag does;
    // wrapping means the handle is never a dead control.
    handle(fixture).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.detent()).toBe('large');

    handle(fixture).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.detent()).toBe('small');
  });

  it('moves one detent per arrow key, and stops at the ends', () => {
    const press = (key: string) => {
      handle(fixture).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
    };

    press('ArrowDown');
    expect(fixture.componentInstance.detent()).toBe('small');
    press('ArrowDown');
    expect(fixture.componentInstance.detent()).toBe('small');

    press('ArrowUp');
    press('ArrowUp');
    expect(fixture.componentInstance.detent()).toBe('large');
    press('ArrowUp');
    expect(fixture.componentInstance.detent()).toBe('large');
  });

  it('honours a REDUCED detent set — two-position sheets are legitimate', () => {
    fixture.componentInstance.detents.set(['medium', 'large']);
    fixture.componentInstance.detent.set('medium');
    fixture.detectChanges();

    handle(fixture).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.detent()).toBe('large');

    // Wraps to the smallest ALLOWED detent, not to `small`.
    handle(fixture).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.detent()).toBe('medium');
  });

  it('drags from a ROW, not only from bare padding', () => {
    // The rows in a real sheet ARE buttons, and the first pass refused to
    // track any gesture that started on a control — so a thumb placed on a
    // shop did nothing and the sheet only moved from the gaps between them.
    const row: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    drag(row, -240);
    fixture.detectChanges();

    expect(fixture.componentInstance.detent()).toBe('large');
  });

  it('a drag that ends on a row does not also CLICK that row', () => {
    const row: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    drag(row, -240);
    row.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.taps()).toBe(0);
  });

  it('a LATER tap still lands — drag suppression cannot go stale', () => {
    // The flag armed by a drag used to survive until the next click, whenever
    // that came, silently eating a legitimate tap seconds later.
    const row: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    drag(row, -240);
    row.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    tap(row);
    fixture.detectChanges();
    expect(fixture.componentInstance.taps()).toBe(1);
  });

  it('a short press is a TAP, not a drag', () => {
    const row: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="row"]',
    );
    // Under the threshold: the sheet must not move and the row must be clicked.
    drag(row, -4);
    tap(row);
    fixture.detectChanges();

    expect(fixture.componentInstance.detent()).toBe('medium');
    expect(fixture.componentInstance.taps()).toBe(1);
  });

  it('scrolls its content only at the tallest detent', () => {
    // Below it the sheet is a peek, and a scrollbar inside a peek invites the
    // user to scroll a box that is mostly off-screen instead of dragging it up.
    expect(sheet(fixture).getAttribute('data-detent')).toBe('medium');

    fixture.componentInstance.detent.set('large');
    fixture.detectChanges();
    expect(sheet(fixture).getAttribute('data-detent')).toBe('large');
  });
});
