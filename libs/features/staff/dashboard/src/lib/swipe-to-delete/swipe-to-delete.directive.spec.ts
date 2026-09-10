import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SwipeToDeleteDirective } from './swipe-to-delete.directive';

/**
 * A row inside something that ALSO listens for Escape — the sheet. The
 * wrapper stands in for the dialog: it counts the Escapes that reach it.
 */
@Component({
  imports: [SwipeToDeleteDirective],
  template: `
    <div role="dialog" tabindex="-1" (keydown)="onKeydown($event)">
      <ul>
        <li
          libSwipeToDelete
          data-testid="row"
          (deleted)="deleted = deleted + 1"
        >
          <div class="staff-visit__swipe-content">
            <button
              type="button"
              data-testid="chip"
              (click)="chips = chips + 1"
            >
              chip
            </button>
          </div>
          <button type="button" class="staff-visit__swipe-action">
            delete
          </button>
        </li>
      </ul>
      <button type="button" data-testid="outside">outside</button>
    </div>
  `,
})
class Host {
  deleted = 0;
  chips = 0;
  escapesSeenBySheet = 0;
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.escapesSeenBySheet += 1;
  }
}

describe('SwipeToDeleteDirective', () => {
  let fixture: ComponentFixture<Host>;
  const ROW_WIDTH = 360;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    // jsdom lays nothing out; the directive measures the row for its
    // thresholds, so the row is given a width.
    row().getBoundingClientRect = () =>
      ({ width: ROW_WIDTH, height: 68, left: 0, top: 0 }) as DOMRect;
  });

  const host = () => fixture.nativeElement as HTMLElement;
  const find = (testId: string) =>
    host().querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    ) as HTMLElement;
  const row = () => find('row');
  const content = () =>
    host().querySelector<HTMLElement>(
      '.staff-visit__swipe-content',
    ) as HTMLElement;

  const pointer = (type: string, clientX: number, target: HTMLElement) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        button: 0,
        clientX,
        clientY: 20,
        bubbles: true,
      }),
    );

  /** A finger travelling `dx` pixels across the content, in steps. */
  const swipe = (dx: number) => {
    const from = 300;
    pointer('pointerdown', from, content());
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      pointer('pointermove', from + (dx * i) / steps, content());
    }
    pointer('pointerup', from + dx, content());
    fixture.detectChanges();
  };

  const offset = () => row().style.getPropertyValue('--lib-swipe-x');

  it('settles open past half the act, and springs back short of it', () => {
    swipe(-30);
    expect(row().hasAttribute('data-open')).toBe(false);
    expect(offset()).toBe('0px');

    swipe(-60);
    expect(row().hasAttribute('data-open')).toBe(true);
    expect(offset()).toBe('-88px');
  });

  it('deletes outright past half the row', () => {
    swipe(-200);
    expect(fixture.componentInstance.deleted).toBe(1);
    expect(row().hasAttribute('data-open')).toBe(false);
  });

  it('leaves a tap alone — a chip on the row still takes its click', () => {
    pointer('pointerdown', 300, find('chip'));
    pointer('pointermove', 303, find('chip'));
    pointer('pointerup', 303, find('chip'));
    find('chip').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.chips).toBe(1);
    expect(row().hasAttribute('data-dragging')).toBe(false);
    expect(offset()).toBe('0px');
  });

  it('takes Escape and an outside press before the sheet does, only while open', () => {
    const escape = () =>
      find('outside').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );

    // Closed: Escape is the sheet's.
    escape();
    expect(fixture.componentInstance.escapesSeenBySheet).toBe(1);

    // Open: the swipe is the topmost transient — it closes, the sheet stays.
    swipe(-60);
    expect(row().hasAttribute('data-open')).toBe(true);
    escape();
    fixture.detectChanges();
    expect(row().hasAttribute('data-open')).toBe(false);
    expect(fixture.componentInstance.escapesSeenBySheet).toBe(1);

    // A press anywhere else closes it too.
    swipe(-60);
    expect(row().hasAttribute('data-open')).toBe(true);
    pointer('pointerdown', 10, find('outside'));
    fixture.detectChanges();
    expect(row().hasAttribute('data-open')).toBe(false);
  });
});
