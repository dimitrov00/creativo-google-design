import { ChangeDetectionStrategy, Component } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UiSwipeAction, UiSwipeActions } from './swipe-actions';

/*
 * The swipe actions: a row followed sideways, resting open past half its
 * actions' reach, the primary action run by a full swipe, and every action
 * reachable without a swipe at all.
 */

@Component({
  imports: [UiSwipeActions, UiSwipeAction],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-swipe-actions [uiFullSwipe]="fullSwipe">
      <button type="button" class="row" (click)="taps.push('row')">Row</button>
      <button uiSwipeAction uiTrailing (click)="taps.push('first')">
        First
      </button>
      <button
        uiSwipeAction
        uiTrailing
        uiTint="destructive"
        (click)="taps.push('second')"
      >
        Second
      </button>
    </ui-swipe-actions>
    <button type="button" class="elsewhere">Elsewhere</button>
  `,
})
class Host {
  fullSwipe = true;
  readonly taps: string[] = [];
}

/** One action's reach: its 76 px and the 2 px seam. */
const REACH = 78;

function pointer(type: string, clientX: number, at = 0, clientY = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'timeStamp', { value: at });
  return event;
}

describe('ui-swipe-actions', () => {
  let fixture: ComponentFixture<Host>;
  let host: HTMLElement;
  let row: HTMLElement;
  const offset = () => host.style.getPropertyValue('--ui-swipe-offset');
  /** A slow drag from `from` to `to`, let go at rest. */
  const drag = (from: number, to: number): void => {
    row.dispatchEvent(pointer('pointerdown', from, 0));
    row.dispatchEvent(pointer('pointermove', (from + to) / 2, 400));
    row.dispatchEvent(pointer('pointermove', to, 800));
    row.dispatchEvent(pointer('pointermove', to, 1200));
    row.dispatchEvent(pointer('pointerup', to, 1600));
    fixture.detectChanges();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    host = (fixture.nativeElement as HTMLElement).querySelector(
      'ui-swipe-actions',
    ) as HTMLElement;
    row = host.querySelector('.row') as HTMLElement;
    host.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
  });

  it('puts each action behind its edge, the trailing one by default', () => {
    const edge = host.querySelector('[data-edge="trailing"]');
    expect(edge?.querySelectorAll('.ui-swipe-action').length).toBe(2);
    expect(
      host.querySelector('.ui-swipe-action[data-tint="destructive"]')
        ?.textContent,
    ).toContain('Second');
  });

  it('follows the finger, rests open past half the reach and closes short of it', () => {
    row.dispatchEvent(pointer('pointerdown', 200, 0));
    row.dispatchEvent(pointer('pointermove', 150, 400));
    fixture.detectChanges();
    expect(offset()).toBe('-50px');
    expect(host.hasAttribute('data-swiping')).toBe(true);
    expect(host.getAttribute('data-swipe')).toBe('trailing');
    row.dispatchEvent(pointer('pointermove', 150, 800));
    row.dispatchEvent(pointer('pointerup', 150, 1200));
    fixture.detectChanges();
    expect(offset()).toBe('0px');
    expect(host.hasAttribute('data-swiping')).toBe(false);

    drag(200, 100);
    expect(offset()).toBe(`${-2 * REACH}px`);
  });

  it('refuses a pull toward an edge with no actions, and leaves a scroll alone', () => {
    drag(100, 200);
    expect(offset()).toBe('0px');

    row.dispatchEvent(pointer('pointerdown', 200, 0, 0));
    row.dispatchEvent(pointer('pointermove', 195, 100, 40));
    row.dispatchEvent(pointer('pointermove', 100, 200, 80));
    expect(host.hasAttribute('data-swiping')).toBe(false);
    expect(offset()).toBe('0px');
  });

  it('runs the primary action on a full swipe, and resists one when it is off', () => {
    row.dispatchEvent(pointer('pointerdown', 290, 0));
    row.dispatchEvent(pointer('pointermove', 40, 400));
    fixture.detectChanges();
    expect(host.getAttribute('data-full')).toBe('trailing');
    row.dispatchEvent(pointer('pointermove', 40, 800));
    row.dispatchEvent(pointer('pointerup', 40, 1200));
    fixture.detectChanges();
    expect(fixture.componentInstance.taps).toEqual(['first']);
    expect(offset()).toBe('0px');
  });

  it('swallows the click that ends a swipe; a tap on the open row only closes it', () => {
    drag(200, 100);
    row.click();
    expect(fixture.componentInstance.taps).toEqual([]);

    // Open still: the swallowed click closed nothing.
    expect(offset()).toBe(`${-2 * REACH}px`);
    row.click();
    expect(fixture.componentInstance.taps).toEqual([]);
    expect(offset()).toBe('0px');

    row.click();
    expect(fixture.componentInstance.taps).toEqual(['row']);
  });

  it('runs a tapped action and closes behind it', async () => {
    drag(200, 100);
    // The release's own click would have come and gone by now.
    await new Promise((resolve) => setTimeout(resolve));
    host.querySelector<HTMLElement>('.ui-swipe-action')?.click();
    expect(fixture.componentInstance.taps).toEqual(['first']);
    expect(offset()).toBe('0px');
  });

  it('opens for focus on an action and closes when focus leaves or a press lands elsewhere', () => {
    const action = host.querySelector<HTMLElement>('.ui-swipe-action');
    action?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(offset()).toBe(`${-2 * REACH}px`);

    action?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    );
    expect(offset()).toBe('0px');

    drag(200, 100);
    (fixture.nativeElement as HTMLElement)
      .querySelector('.elsewhere')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(offset()).toBe('0px');
  });
});
