import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  GridColumn,
  GridCommit,
  GridDraft,
  GridEvent,
} from '../time-grid/staff-time-grid';
import { StaffTimeline } from './staff-timeline';

/**
 * The timeline's own arithmetic — one row per chair, one band across them,
 * and the grid's gesture along the other axis.
 */

function event(partial: Partial<GridEvent> & Pick<GridEvent, 'id'>): GridEvent {
  return {
    kind: 'visit',
    startMinute: 600,
    endMinute: 645,
    title: 'Георги Петров',
    detail: null,
    attribution: null,
    status: null,
    terminal: false,
    past: false,
    accessibleName: 'Георги Петров, 10:00–10:45',
    statusIcon: null,
    partyLabel: null,
    ...partial,
    barberTone: partial.barberTone ?? null,
  };
}

const BLOCK = event({
  id: 'draft-block',
  kind: 'block',
  startMinute: 720,
  endMinute: 780,
  title: 'Блок',
  accessibleName: 'Блок, 12:00–13:00',
});

function column(partial: Partial<GridColumn> = {}): GridColumn {
  return {
    id: 'ivan',
    title: 'Иван Колев',
    detail: null,
    dayNumber: null,
    isToday: false,
    avatarSrc: null,
    events: [BLOCK],
    open: [{ startMinute: 540, endMinute: 1080 }],
    ...partial,
  };
}

/** Three chairs: one booking under the band, one beside it. */
function shop(): readonly GridColumn[] {
  return [
    column({
      events: [
        event({
          id: 'martin',
          startMinute: 750,
          endMinute: 780,
          title: 'Мартин Илиев',
        }),
        BLOCK,
      ],
    }),
    column({
      id: 'stefan',
      title: 'Стефан Петров',
      events: [
        event({ id: 'georgi', startMinute: 600, endMinute: 645 }),
        BLOCK,
      ],
      open: [{ startMinute: 600, endMinute: 1140 }],
    }),
    column({ id: 'niko', title: 'Нико Димов' }),
  ];
}

describe('StaffTimeline', () => {
  let fixture: ComponentFixture<StaffTimeline>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StaffTimeline],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffTimeline);
  });

  /* A finished drag leaves one capture-phase click listener behind, cleared
     on a zero-delay timer; yield so it cannot eat the next test's click. */
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  function render(
    columns: readonly GridColumn[] = shop(),
    editable = true,
  ): HTMLElement {
    fixture.componentRef.setInput('columns', columns);
    fixture.componentRef.setInput('uiWindow', {
      startMinute: 0,
      endMinute: 1440,
    });
    fixture.componentRef.setInput('uiSnapMinutes', 5);
    fixture.componentRef.setInput('uiMinMinutes', 5);
    fixture.componentRef.setInput('uiEditableEventId', 'draft-block');
    fixture.componentRef.setInput('uiEditable', editable);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const grab = (host: HTMLElement, testid: string): HTMLElement => {
    const el = host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    if (el === null) throw new Error(`no ${testid}`);
    return el;
  };

  const fraction = (el: HTMLElement, name: string) =>
    Number(el.style.getPropertyValue(name));

  function drags(): {
    readonly changed: GridDraft[];
    readonly committed: GridCommit[];
  } {
    const changed: GridDraft[] = [];
    const committed: GridCommit[] = [];
    fixture.componentInstance.draftChanged.subscribe((d) => changed.push(d));
    fixture.componentInstance.draftCommitted.subscribe((c) =>
      committed.push(c),
    );
    return { changed, committed };
  }

  /** The fallback scale a layout-less harness drags at: 80px an hour. */
  const travel = (minutes: number) => (minutes * 80) / 60;

  const pointer = (
    type: string,
    clientX: number,
    pointerType?: string,
  ): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      clientX,
      clientY: 0,
      ...(pointerType ? { pointerType } : {}),
    });

  it("lays one row per chair and the band once across them, at the block's own fractions", () => {
    const host = render();
    expect(
      host.querySelectorAll('[data-testid="staff-timeline-row"]'),
    ).toHaveLength(3);
    const bands = host.querySelectorAll<HTMLElement>(
      '[data-testid="staff-timeline-band"]',
    );
    expect(bands).toHaveLength(1);
    const band = bands[0];
    if (!band) throw new Error('no band');
    // 12:00 of a 24-hour extent; one hour of it.
    expect(fraction(band, '--staff-bar-from')).toBeCloseTo(0.5, 5);
    expect(fraction(band, '--staff-bar-span')).toBeCloseTo(1 / 24, 5);
    expect(band.getAttribute('aria-label')).toBe('Блок, 12:00–13:00');
    // Its NAME sits on the ruler over its middle, not on its face.
    const tag = grab(host, 'staff-timeline-band-tag');
    expect(tag.textContent).toContain('Блок');
    expect(fraction(tag, '--staff-readout-fraction')).toBeCloseTo(
      0.5 + 1 / 48,
      5,
    );
    expect(band.textContent?.trim()).toBe('');
    // The ruler: an hour a label, midnight to eleven at night.
    expect(host.querySelectorAll('.staff-timeline__hour')).toHaveLength(24);
    // The hours a chair is shut, shaded per row: Ivan's 00–09 and 18–24.
    const ivan = host.querySelector('[data-row="ivan"]');
    const closed = [
      ...(ivan?.querySelectorAll<HTMLElement>(
        '[data-testid="staff-timeline-closed"]',
      ) ?? []),
    ];
    expect(closed.map((run) => fraction(run, '--staff-bar-from'))).toEqual([
      0, 0.75,
    ]);
  });

  it('marks the booking under the band in red, and leaves the one beside it alone', () => {
    const host = render();
    const bars = [
      ...host.querySelectorAll<HTMLElement>(
        '[data-testid="staff-timeline-bar"]',
      ),
    ];
    expect(bars).toHaveLength(2);
    const martin = bars.find((bar) => bar.textContent?.includes('Мартин'));
    const georgi = bars.find((bar) => bar.textContent?.includes('Георги'));
    expect(martin?.hasAttribute('data-collides')).toBe(true);
    expect(georgi?.hasAttribute('data-collides')).toBe(false);
  });

  it('moves one edge and leaves the other where it was', () => {
    const host = render();
    const seen = drags();
    const handle = grab(host, 'staff-timeline-handle-end');

    handle.dispatchEvent(pointer('pointerdown', 0));
    document.dispatchEvent(pointer('pointermove', travel(15)));
    fixture.detectChanges();
    expect(seen.changed.at(-1)).toEqual({
      id: 'draft-block',
      startMinute: 720,
      endMinute: 795,
    });
    // The readout, on the ruler, at the far edge of the finger — red,
    // because the band now sits on Мартин. It takes the name's place.
    const readout = grab(host, 'staff-timeline-readout');
    expect(readout.textContent).toContain('13:15');
    expect(readout.getAttribute('data-tone')).toBe('destructive');
    expect(
      host.querySelector('[data-testid="staff-timeline-band-tag"]'),
    ).toBeNull();

    document.dispatchEvent(pointer('pointerup', travel(15)));
    expect(seen.committed).toEqual([
      { id: 'draft-block', startMinute: 720, endMinute: 795, kind: 'resize' },
    ]);
  });

  it('slides the whole band and keeps its length', () => {
    const host = render();
    const seen = drags();
    const band = grab(host, 'staff-timeline-band');

    band.dispatchEvent(pointer('pointerdown', 0));
    document.dispatchEvent(pointer('pointermove', travel(10)));
    document.dispatchEvent(pointer('pointerup', travel(10)));
    fixture.detectChanges();

    expect(seen.changed.at(-1)).toEqual({
      id: 'draft-block',
      startMinute: 730,
      endMinute: 790,
    });
    expect(seen.committed.at(-1)?.kind).toBe('move');
  });

  it('steps from the keyboard: the arrows slide, End reaches the bound', () => {
    const host = render();
    const seen = drags();
    const band = grab(host, 'staff-timeline-band');
    band.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(seen.committed.at(-1)).toEqual({
      id: 'draft-block',
      startMinute: 725,
      endMinute: 785,
      kind: 'move',
    });
    fixture.detectChanges();
    const end = grab(host, 'staff-timeline-handle-end');
    expect(end.getAttribute('aria-orientation')).toBe('horizontal');
    end.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    expect(seen.committed.at(-1)).toEqual({
      id: 'draft-block',
      startMinute: 725,
      endMinute: 1440,
      kind: 'resize',
    });
  });

  it('scrolls rather than moving when a finger travels off the band', () => {
    const host = render();
    const seen = drags();
    const band = grab(host, 'staff-timeline-band');
    band.dispatchEvent(pointer('pointerdown', 0, 'touch'));
    document.dispatchEvent(pointer('pointermove', travel(15), 'touch'));
    document.dispatchEvent(pointer('pointerup', travel(15), 'touch'));
    expect(seen.changed).toEqual([]);
    expect(seen.committed).toEqual([]);
  });

  it('hatches a band that covers the whole axis — an all-day block', () => {
    const whole = event({ ...BLOCK, startMinute: 0, endMinute: 1440 });
    const host = render(
      shop().map((c) => ({
        ...c,
        events: c.events.map((e) => (e.id === BLOCK.id ? whole : e)),
      })),
      false,
    );
    const band = grab(host, 'staff-timeline-band');
    expect(band.hasAttribute('data-whole')).toBe(true);
    expect(fraction(band, '--staff-bar-span')).toBe(1);
  });

  it('washes the minutes of the band that have already gone, on today', () => {
    fixture.componentRef.setInput('nowMinute', 750);
    const host = render(shop().map((c) => ({ ...c, isToday: true })));
    const wash = host.querySelector<HTMLElement>(
      '.staff-timeline__band-elapsed',
    );
    expect(wash).not.toBeNull();
    // 12:30 of a 12:00–13:00 band: half of it.
    expect(fraction(wash as HTMLElement, '--staff-band-elapsed')).toBeCloseTo(
      0.5,
      5,
    );
    expect(
      host
        .querySelector('[data-testid="staff-timeline-now-label"]')
        ?.textContent?.trim(),
    ).toBe('12:30');
  });

  it('draws the band but no handles when the caller says it is not editable', () => {
    const host = render(shop(), false);
    const band = grab(host, 'staff-timeline-band');
    expect(band.hasAttribute('inert')).toBe(true);
    expect(band.hasAttribute('data-whole')).toBe(false);
    expect(
      host.querySelector('[data-testid="staff-timeline-handle-start"]'),
    ).toBeNull();
  });
});
