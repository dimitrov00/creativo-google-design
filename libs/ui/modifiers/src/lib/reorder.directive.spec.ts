import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  UiReorderHandle,
  UiReorderList,
  type UiReorderMove,
} from './reorder.directive';

@Component({
  imports: [UiReorderList, UiReorderHandle],
  template: `
    <ul uiReorderList (uiMoved)="moved($event)">
      @for (name of names(); track name) {
        <li [attr.data-name]="name">
          {{ name }}
          <button type="button" uiReorderHandle (click)="taps.push(name)">
            move
          </button>
        </li>
      }
    </ul>
  `,
})
class Host {
  readonly names = signal(['a', 'b', 'c']);
  readonly moves: UiReorderMove[] = [];
  readonly taps: string[] = [];

  moved(move: UiReorderMove): void {
    this.moves.push(move);
    const next = [...this.names()];
    const [name] = next.splice(move.from, 1);
    if (name !== undefined) next.splice(move.to, 0, name);
    this.names.set(next);
  }
}

/** Rows 40px tall, 10px apart, from the top of the page. */
function layOut(items: readonly HTMLElement[]): void {
  items.forEach((item, index) => {
    const top = index * 50;
    item.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 40,
        height: 40,
        left: 0,
        right: 100,
        width: 100,
      }) as DOMRect;
  });
}

function pointer(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientY });
  return event;
}

describe('uiReorderList', () => {
  let fixture: ComponentFixture<Host>;
  const items = () =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        'li',
      ),
    );
  const handle = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-name="${name}"] button`,
    ) as HTMLElement;
  const order = () => items().map((item) => item.dataset['name']);

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    layOut(items());
  });

  it('reports a drag past a neighbour’s middle as a move, and parts the others meanwhile', () => {
    const a = handle('a');
    a.dispatchEvent(pointer('pointerdown', 20));
    a.dispatchEvent(pointer('pointermove', 80));
    const [first, second, third] = items();
    expect(first?.hasAttribute('data-reorder-lifted')).toBe(true);
    expect(first?.style.translate).toBe('0 60px');
    expect(second?.style.translate).toBe('0 -50px');
    expect(third?.style.translate).toBe('');
    a.dispatchEvent(pointer('pointerup', 80));
    fixture.detectChanges();
    expect(fixture.componentInstance.moves).toEqual([{ from: 0, to: 1 }]);
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(items().every((item) => item.style.translate === '')).toBe(true);
  });

  it('keeps the dragged item inside the list, and takes the last place at its end', () => {
    const a = handle('a');
    a.dispatchEvent(pointer('pointerdown', 20));
    a.dispatchEvent(pointer('pointermove', 900));
    expect(items()[0]?.style.translate).toBe('0 100px');
    a.dispatchEvent(pointer('pointerup', 900));
    expect(fixture.componentInstance.moves).toEqual([{ from: 0, to: 2 }]);
  });

  it('swallows the click that ends a drag, and leaves a tap alone', () => {
    const b = handle('b');
    b.dispatchEvent(pointer('pointerdown', 70));
    b.dispatchEvent(pointer('pointermove', 10));
    b.dispatchEvent(pointer('pointerup', 10));
    b.click();
    expect(fixture.componentInstance.taps).toEqual([]);

    fixture.detectChanges();
    const c = handle('c');
    c.dispatchEvent(pointer('pointerdown', 120));
    c.dispatchEvent(pointer('pointermove', 122));
    c.dispatchEvent(pointer('pointerup', 122));
    c.click();
    expect(fixture.componentInstance.taps).toEqual(['c']);
    expect(fixture.componentInstance.moves).toEqual([{ from: 1, to: 0 }]);
  });

  it('moves one place on an arrow key and reports nothing at the list’s edge', () => {
    handle('b').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    expect(order()).toEqual(['a', 'c', 'b']);
    handle('b').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    handle('a').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    expect(fixture.componentInstance.moves).toEqual([{ from: 1, to: 2 }]);
  });

  it('puts everything back when the press is cancelled', () => {
    const a = handle('a');
    a.dispatchEvent(pointer('pointerdown', 20));
    a.dispatchEvent(pointer('pointermove', 80));
    a.dispatchEvent(pointer('pointercancel', 80));
    expect(items().every((item) => item.style.translate === '')).toBe(true);
    expect(fixture.componentInstance.moves).toEqual([]);
  });
});
