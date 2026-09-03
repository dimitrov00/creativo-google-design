import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type GridColumn,
  type GridCommit,
  type GridDraft,
  type GridEvent,
  StaffTimeGrid,
} from './staff-time-grid';

/**
 * The grid's own arithmetic — the axis, the closed shading and the point at
 * which a block stops holding two lines.
 *
 * Worth its own spec rather than being exercised through the page: every one
 * of these is a pure function of the inputs, and reaching them through the
 * store means a failure here reads as a data bug there.
 */

function event(partial: Partial<GridEvent> & Pick<GridEvent, 'id'>): GridEvent {
  return {
    kind: 'visit',
    startMinute: 600,
    endMinute: 645,
    title: 'Георги Петров',
    detail: 'Фейд',
    attribution: null,
    status: 'confirmed',
    terminal: false,
    past: false,
    accessibleName: 'Георги Петров, Фейд, 10:00–10:45',
    statusIcon: null,
    ...partial,
    // AFTER the spread, coalesced: `Partial<GridEvent>` makes this
    // `number | null | undefined`, and `GridEvent` does not accept the
    // undefined. A tone is optional to a caller and never absent on the
    // event itself.
    barberTone: partial.barberTone ?? null,
  };
}

function column(partial: Partial<GridColumn> = {}): GridColumn {
  return {
    id: 'ivan',
    title: 'Иван Колев',
    detail: null,
    dayNumber: null,
    isToday: false,
    avatarSrc: null,
    events: [],
    open: [{ startMinute: 540, endMinute: 1080 }],
    ...partial,
  };
}

describe('StaffTimeGrid', () => {
  let fixture: ComponentFixture<StaffTimeGrid>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StaffTimeGrid],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffTimeGrid);
  });

  function render(columns: readonly GridColumn[]): HTMLElement {
    fixture.componentRef.setInput('columns', columns);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const hours = (host: HTMLElement) =>
    [...host.querySelectorAll('.staff-grid__hour')].map((el) =>
      el.textContent?.trim(),
    );

  const closedRows = (host: HTMLElement, columnIndex = 0) => {
    const columns = host.querySelectorAll('.staff-grid__column');
    const cell = columns.item(columnIndex);
    if (cell === null) throw new Error(`no column at index ${columnIndex}`);
    return [
      ...cell.querySelectorAll<HTMLElement>(
        '[data-testid="staff-grid-closed"]',
      ),
    ].map((el) => el.style.gridRow);
  };

  describe('the axis', () => {
    /*
     * The axis is the DAY, not the roster. A shop that opens at nine still has
     * an eight o'clock, and a walk-in at 08:30 has to have somewhere to land.
     */
    it('runs midnight to midnight whatever the roster says', () => {
      const host = render([
        column({ open: [{ startMinute: 540, endMinute: 1080 }] }),
      ]);
      const labels = hours(host);
      expect(labels).toHaveLength(25);
      expect(labels[0]).toBe('00:00');
      expect(labels[9]).toBe('09:00');
      expect(labels.at(-1)).toBe('00:00');
    });

    // A seat's own start day owns the row, so a cut booked at 23:30 ends at
    // minute 1455 rather than wrapping to 15 — the axis stretches to hold it.
    it('grows for a booking that runs past midnight', () => {
      const host = render([
        column({
          events: [event({ id: 'late', startMinute: 1410, endMinute: 1455 })],
        }),
      ]);
      expect(hours(host)).toHaveLength(26);
    });

    // `empty` now means "no columns" — a day with columns always has an axis,
    // and whether anything is on it is what the shading answers.
    it('draws nothing at all when there are no columns', () => {
      const host = render([]);
      expect(host.querySelector('.staff-grid__frame')).toBeNull();
    });
  });

  describe('the closed shading', () => {
    // 96 slots of 15 minutes: 00:00 is grid line 1, 09:00 is line 37, 18:00 is
    // line 73. Two runs — the shut morning and the shut evening.
    it('shades the hours outside a single working window', () => {
      const host = render([
        column({ open: [{ startMinute: 540, endMinute: 1080 }] }),
      ]);
      expect(closedRows(host)).toEqual(['1 / 37', '73 / 97']);
    });

    it('shades the break in a split shift', () => {
      const host = render([
        column({
          open: [
            { startMinute: 540, endMinute: 780 },
            { startMinute: 840, endMinute: 1080 },
          ],
        }),
      ]);
      expect(closedRows(host)).toEqual(['1 / 37', '53 / 57', '73 / 97']);
    });

    /*
     * The state this whole mechanism exists for: a chair nobody is rostered on
     * used to render exactly like a chair with a wide-open day.
     */
    it('shades a column with no windows solid', () => {
      const host = render([column({ open: [] })]);
      expect(closedRows(host)).toEqual(['1 / 97']);
    });

    // A caller may hand windows over in any order — the store merges lanes,
    // and an unsorted pair would otherwise carve a phantom closed band through
    // the middle of a day two barbers are both working.
    it('merges overlapping and out-of-order windows', () => {
      const host = render([
        column({
          open: [
            { startMinute: 720, endMinute: 1080 },
            { startMinute: 540, endMinute: 780 },
          ],
        }),
      ]);
      expect(closedRows(host)).toEqual(['1 / 37', '73 / 97']);
    });

    it('shades each column against its OWN hours', () => {
      const host = render([
        column({ id: 'ivan', open: [{ startMinute: 540, endMinute: 1080 }] }),
        column({ id: 'niko', open: [{ startMinute: 720, endMinute: 1200 }] }),
      ]);
      expect(closedRows(host, 0)).toEqual(['1 / 37', '73 / 97']);
      expect(closedRows(host, 1)).toEqual(['1 / 49', '81 / 97']);
    });
  });

  describe('a block that cannot hold two lines', () => {
    /*
     * The threshold is 30 minutes, and it is measured: a half-hour block is
     * 56px tall, which seats a footnote title over a caption detail. At the
     * old 40 every 30-minute service — most of the catalogue — silently lost
     * the line that says what was booked.
     */
    it('keeps the service on its own line at half an hour', () => {
      const host = render([
        column({
          events: [event({ id: 'a', startMinute: 600, endMinute: 630 })],
        }),
      ]);
      const block = host.querySelector('[data-testid="staff-grid-event"]');
      expect(block?.hasAttribute('data-short')).toBe(false);
      expect(
        block?.querySelector('.staff-grid__event-detail')?.textContent?.trim(),
      ).toBe('Фейд');
    });

    // A quarter-hour block is 28px and genuinely holds one line — so the
    // service joins the name on it rather than being dropped.
    it('puts the service beside the name on a quarter-hour block', () => {
      const host = render([
        column({
          events: [event({ id: 'a', startMinute: 600, endMinute: 615 })],
        }),
      ]);
      const block = host.querySelector('[data-testid="staff-grid-event"]');
      expect(block?.hasAttribute('data-short')).toBe(true);
      expect(block?.querySelector('.staff-grid__event-detail')).toBeNull();
      expect(
        block?.querySelector('.staff-grid__event-inline')?.textContent?.trim(),
      ).toBe('Фейд');
    });
  });

  describe('overlap', () => {
    // A party is one appointment with several seats, and in the week view
    // every chair is merged into one date column — simultaneous blocks are the
    // normal case there, not a defect.
    it('lanes genuinely overlapping blocks side by side', () => {
      const host = render([
        column({
          events: [
            event({ id: 'a', startMinute: 600, endMinute: 660 }),
            event({ id: 'b', startMinute: 615, endMinute: 675 }),
          ],
        }),
      ]);
      const blocks = [
        ...host.querySelectorAll<HTMLElement>(
          '[data-testid="staff-grid-event"]',
        ),
      ];
      expect(
        blocks.map((b) => b.style.getPropertyValue('--staff-event-lane')),
      ).toEqual(['0', '1']);
      expect(
        blocks.every(
          (b) => b.style.getPropertyValue('--staff-event-lanes') === '2',
        ),
      ).toBe(true);
    });

    // A busy morning must not narrow a quiet afternoon: lanes are shared only
    // inside a cluster of transitively-overlapping blocks.
    it('does not let one cluster narrow the next', () => {
      const host = render([
        column({
          events: [
            event({ id: 'a', startMinute: 600, endMinute: 660 }),
            event({ id: 'b', startMinute: 615, endMinute: 675 }),
            event({ id: 'c', startMinute: 900, endMinute: 960 }),
          ],
        }),
      ]);
      const last = [
        ...host.querySelectorAll<HTMLElement>(
          '[data-testid="staff-grid-event"]',
        ),
      ].at(-1);
      expect(last?.style.getPropertyValue('--staff-event-lanes')).toBe('1');
    });
  });

  describe('a carve-out', () => {
    /*
     * A block is a THING, not the absence of one. It used to arrive as the
     * complement of a roster window and get painted as `aria-hidden` closed
     * shading, so time a barber blocked for themselves was pixel-identical to
     * 03:00 on a Sunday: no name, no hit target, nothing to remove.
     */
    it('draws as a named, pressable object rather than as shading', () => {
      const host = render([
        column({
          events: [
            event({
              id: 'block:ivan:1',
              kind: 'block',
              startMinute: 900,
              endMinute: 960,
              title: 'Blocked',
              detail: null,
              accessibleName: 'Blocked, 15:00–16:00',
            }),
          ],
        }),
      ]);

      const block = host.querySelector<HTMLElement>(
        '[data-testid="staff-grid-block"]',
      );
      expect(block).not.toBeNull();
      expect(block?.tagName).toBe('BUTTON');
      expect(block?.getAttribute('aria-label')).toBe('Blocked, 15:00–16:00');
      // 15:00 is grid line 61 on a 96-slot midnight-origin track.
      expect(block?.style.gridRow).toBe('61 / 65');
      // NOT the shading — which is aria-hidden and pointer-transparent.
      expect(block?.hasAttribute('aria-hidden')).toBe(false);
    });

    it('routes its own tap, apart from a visit and a gap', () => {
      const host = render([
        column({
          events: [
            event({ id: 'block:ivan:1', kind: 'block', title: 'Blocked' }),
          ],
        }),
      ]);
      const picked: string[] = [];
      const visits: string[] = [];
      fixture.componentInstance.blockPicked.subscribe((id) => picked.push(id));
      fixture.componentInstance.eventPicked.subscribe((id) => visits.push(id));

      host
        .querySelector<HTMLButtonElement>('[data-testid="staff-grid-block"]')
        ?.click();

      expect(picked).toEqual(['block:ivan:1']);
      expect(visits).toEqual([]);
    });
  });

  describe('placement', () => {
    const blocks = (host: HTMLElement) => [
      ...host.querySelectorAll<HTMLElement>('[data-testid="staff-grid-event"]'),
    ];

    const firstBlock = (host: HTMLElement): HTMLElement => {
      const block = blocks(host)[0];
      if (block === undefined) throw new Error('no block was drawn');
      return block;
    };

    /*
     * The page grid's placement, and the reason `slots` has to stay the
     * default: a 10:05 start rounds DOWN to 10:00 and a 10:50 end rounds UP
     * to 11:00, so the block meets the rules the eye is already following.
     * 10:00 is grid line 41 on a 96-slot midnight-origin track.
     */
    it('rounds a block outward to the slot track by default', () => {
      const host = render([
        column({
          events: [event({ id: 'a', startMinute: 605, endMinute: 650 })],
        }),
      ]);
      const block = firstBlock(host);
      expect(block.style.gridRow).toBe('41 / 45');
      expect(block.hasAttribute('data-placement')).toBe(false);
      expect(block.style.getPropertyValue('--staff-event-top')).toBe('');
    });

    /*
     * The frame's placement. A five-minute quantum is unrepresentable on a
     * 15-minute track without 288 rows a day, so the block takes a
     * PERCENTAGE of the extent instead — the same mechanism the now-line
     * uses. On a 09:00–12:00 window a 10:05 start is 65 of 180 minutes in.
     */
    it('places a block off the slot boundary when proportional', () => {
      fixture.componentRef.setInput('uiPlacement', 'proportional');
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 540,
        endMinute: 720,
      });
      const host = render([
        column({
          events: [event({ id: 'a', startMinute: 605, endMinute: 650 })],
        }),
      ]);
      const block = firstBlock(host);
      expect(block.getAttribute('data-placement')).toBe('proportional');
      expect(block.style.gridRow).toBe('');
      // 65 / 180 = 0.361111 — a fifth of a slot down, where 10:05 actually is.
      expect(block.style.getPropertyValue('--staff-event-top')).toBe(
        '0.361111',
      );
      expect(block.style.getPropertyValue('--staff-event-height')).toBe('0.25');
    });

    // A neighbour that starts before the window shows the part of itself that
    // is inside it: the block continues, the frame does not.
    it('clamps a block that overruns the window', () => {
      fixture.componentRef.setInput('uiPlacement', 'proportional');
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 540,
        endMinute: 720,
      });
      const host = render([
        column({
          events: [event({ id: 'early', startMinute: 480, endMinute: 570 })],
        }),
      ]);
      const block = firstBlock(host);
      expect(block.style.getPropertyValue('--staff-event-top')).toBe('0');
      // 09:00–09:30 of a three-hour window, not the whole 90 minutes booked.
      expect(block.style.getPropertyValue('--staff-event-height')).toBe(
        '0.166667',
      );
    });

    // A zero-height sliver at the edge would advertise a booking that is not
    // there — and an off-screen block must not narrow a lane on screen.
    it('drops a block that falls entirely outside the window', () => {
      fixture.componentRef.setInput('uiPlacement', 'proportional');
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 540,
        endMinute: 720,
      });
      const host = render([
        column({
          events: [
            event({ id: 'in', startMinute: 600, endMinute: 660 }),
            event({ id: 'far', startMinute: 900, endMinute: 960 }),
          ],
        }),
      ]);
      expect(blocks(host)).toHaveLength(1);
      expect(
        firstBlock(host).style.getPropertyValue('--staff-event-lanes'),
      ).toBe('1');
    });

    it('marks the one block that is being edited', () => {
      fixture.componentRef.setInput('uiEditableEventId', 'b');
      const host = render([
        column({
          events: [
            event({ id: 'a', startMinute: 600, endMinute: 630 }),
            event({ id: 'b', startMinute: 660, endMinute: 690 }),
          ],
        }),
      ]);
      expect(blocks(host).map((b) => b.hasAttribute('data-editable'))).toEqual([
        false,
        true,
      ]);
    });
  });

  describe('the window', () => {
    /*
     * Snapped OUTWARD to whole hours, never inward: the gutter lays its
     * labels out as hour-tall rows from the extent's first minute, so a
     * window opening at 09:35 would print "09:00" thirty-five minutes late
     * and every label under it would inherit the lie.
     */
    it('clamps the axis to whole hours around what was asked for', () => {
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 575,
        endMinute: 665,
      });
      const host = render([column()]);
      expect(hours(host)).toEqual(['09:00', '10:00', '11:00', '12:00']);
    });

    // The shading is drawn against the window's own origin, not midnight —
    // 12:00 is line 13 on a 09:00-origin track, not line 49.
    it('shades the closed hours against the window origin', () => {
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 540,
        endMinute: 720,
      });
      const host = render([
        column({ open: [{ startMinute: 540, endMinute: 660 }] }),
      ]);
      expect(closedRows(host)).toEqual(['9 / 13']);
    });

    /*
     * A run is a `grid-row` against the extent's own track. A shift reaching
     * outside the window — a lunch break at 13:00 while the frame draws
     * 09:00–12:00 — used to ask for rows the column does not have, and the
     * browser invented them: the column grew an hour past its axis and every
     * proportional placement in it drifted.
     */
    it('does not shade a break that falls outside the drawn hours', () => {
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 540,
        endMinute: 720,
      });
      const host = render([
        column({
          open: [
            { startMinute: 540, endMinute: 780 },
            { startMinute: 840, endMinute: 1080 },
          ],
        }),
      ]);
      expect(closedRows(host)).toEqual([]);
    });

    it('leaves the axis at the civil day when nothing is asked for', () => {
      const host = render([column()]);
      expect(hours(host)).toHaveLength(25);
    });
  });

  describe('the framed viewport', () => {
    const chrome = (host: HTMLElement) => ({
      zone: host.querySelector('[data-testid="staff-grid-zone"]'),
      head: host.querySelector('[data-testid="staff-grid-column-head"]'),
      allDay: host.querySelector('[data-testid="staff-grid-allday"]'),
    });

    it('keeps every piece of page chrome on the page', () => {
      fixture.componentRef.setInput('allDayAlways', true);
      const host = render([column({ dayNumber: 12 })]);
      const { zone, head, allDay } = chrome(host);
      expect(zone).not.toBeNull();
      expect(head).not.toBeNull();
      expect(allDay).not.toBeNull();
      expect(
        host.querySelector('.staff-grid__frame')?.getAttribute('data-viewport'),
      ).toBeNull();
    });

    /*
     * A 240px window cannot afford furniture: the sheet's own header already
     * names whose chair this is, the zone is a shop-wide setting nobody
     * changes mid-edit, and an always-on empty all-day row would spend a
     * tenth of the window saying nothing.
     */
    it('drops the head, the zone and an EMPTY all-day row', () => {
      fixture.componentRef.setInput('uiViewport', 'framed');
      fixture.componentRef.setInput('allDayAlways', true);
      const host = render([column({ dayNumber: 12 })]);
      const { zone, head, allDay } = chrome(host);
      expect(zone).toBeNull();
      expect(head).toBeNull();
      expect(allDay).toBeNull();
      // Nothing left in the band, so the band itself does not paint.
      expect(host.querySelector('.staff-grid__chrome')).toBeNull();
      expect(
        host.querySelector('.staff-grid__frame')?.getAttribute('data-viewport'),
      ).toBe('framed');
    });

    /*
     * The row is not dropped, only its empty state: a whole-day closure has
     * no start and no end, and drawn on the axis it would be a 24-hour
     * rectangle under two handles that must refuse every drag.
     */
    it('keeps an all-day row that has something to say', () => {
      fixture.componentRef.setInput('uiViewport', 'framed');
      fixture.componentRef.setInput('allDay', { ivan: ['Отпуск'] });
      const host = render([column()]);
      expect(
        chrome(host)
          .allDay?.querySelector('.staff-grid__allday-chip')
          ?.textContent?.trim(),
      ).toBe('Отпуск');
    });

    /*
     * The gutter lays its labels out as hour-tall rows, so a label on the
     * closing line is a whole extra hour of box — and the body's row sizes to
     * its tallest cell, which drags the columns to that height too. A quarter
     * of a three-hour frame would be blank, and the axis box would stop being
     * the same length as the axis.
     */
    it('drops the closing hour label, so the axis box is the axis', () => {
      fixture.componentRef.setInput('uiViewport', 'framed');
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 540,
        endMinute: 720,
      });
      const host = render([column()]);
      expect(hours(host)).toEqual(['09:00', '10:00', '11:00']);
    });

    it('publishes the snap pitch the drag hint draws at', () => {
      fixture.componentRef.setInput('uiViewport', 'framed');
      fixture.componentRef.setInput('uiSnapMinutes', 5);
      const host = render([column()]);
      const frame = host.querySelector<HTMLElement>('.staff-grid__frame');
      expect(frame?.style.getPropertyValue('--staff-grid-snap')).toBe('5');
    });
  });

  describe('the now-line', () => {
    it('draws only when today is one of the columns', () => {
      fixture.componentRef.setInput('nowMinute', 600);
      const host = render([column({ isToday: false })]);
      expect(host.querySelector('[data-testid="staff-grid-now"]')).toBeNull();

      fixture.componentRef.setInput('columns', [column({ isToday: true })]);
      fixture.detectChanges();
      expect(
        host.querySelector('[data-testid="staff-grid-now"]'),
      ).not.toBeNull();
      expect(
        host
          .querySelector('[data-testid="staff-grid-now-label"]')
          ?.textContent?.trim(),
      ).toBe('10:00');
    });
  });

  /*
   * ── The gesture ──────────────────────────────────────────────────────
   *
   * Every assertion below runs against the FALLBACK scale — jsdom lays
   * nothing out, so `measurePxPerMinute` cannot measure and falls back to the
   * frame's regular-density figure of 2.4px per minute. That is what makes
   * these numbers readable: 24px is ten minutes, 36px is fifteen.
   */
  describe('drag', () => {
    const PX_PER_MINUTE = 2.4;
    /** Minutes → the pointer travel that asks for them. */
    const travel = (minutes: number) => minutes * PX_PER_MINUTE;

    /*
     * A finished drag leaves exactly ONE capture-phase listener behind, to
     * eat the trailing click the browser is about to fire, and clears it on a
     * zero-delay timer. A synchronous test never yields, so the timer never
     * runs and the listener would survive to eat the NEXT test's click.
     */
    afterEach(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    function pointer(type: string, clientY: number): PointerEvent {
      return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientY,
      });
    }

    /** A frame with one editable 10:00–10:45 block, snapping at five. */
    function frame(events?: readonly GridEvent[]): HTMLElement {
      fixture.componentRef.setInput('uiViewport', 'framed');
      fixture.componentRef.setInput('uiPlacement', 'proportional');
      fixture.componentRef.setInput('uiWindow', {
        startMinute: 540,
        endMinute: 720,
      });
      fixture.componentRef.setInput('uiSnapMinutes', 5);
      fixture.componentRef.setInput('uiEditable', true);
      fixture.componentRef.setInput('uiEditableEventId', 'a');
      return render([
        column({
          events: events ?? [
            event({ id: 'a', startMinute: 600, endMinute: 645 }),
          ],
        }),
      ]);
    }

    const grab = (host: HTMLElement, testid: string): HTMLElement => {
      const el = host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
      if (el === null) throw new Error(`no ${testid}`);
      return el;
    };

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

    /*
     * A resize moves ONE edge. The other is what the barber is holding still,
     * and a gesture that quietly carried it along would be a move wearing a
     * resize's clothes — which is exactly the pair the server validates
     * differently.
     */
    it('moves one edge and leaves the other where it was', () => {
      const host = frame();
      const seen = drags();
      const handle = grab(host, 'staff-frame-handle-end');

      handle.dispatchEvent(pointer('pointerdown', 0));
      document.dispatchEvent(pointer('pointermove', travel(15)));
      fixture.detectChanges();

      expect(seen.changed.at(-1)).toEqual({
        id: 'a',
        startMinute: 600,
        endMinute: 660,
      });

      document.dispatchEvent(pointer('pointerup', travel(15)));
      expect(seen.committed).toEqual([
        { id: 'a', startMinute: 600, endMinute: 660, kind: 'resize' },
      ]);
    });

    /*
     * A move holds the DURATION. Naming it a move rather than deriving it
     * from the numbers is the whole point of the second output: a move that
     * happens to land on a legal duration is arithmetically indistinguishable
     * from two resizes.
     */
    it('slides the whole block and keeps its length', () => {
      const host = frame();
      const seen = drags();
      const block = grab(host, 'staff-grid-event');

      block.dispatchEvent(pointer('pointerdown', 0));
      document.dispatchEvent(pointer('pointermove', travel(10)));
      document.dispatchEvent(pointer('pointerup', travel(10)));
      fixture.detectChanges();

      const last = seen.changed.at(-1);
      expect(last).toEqual({ id: 'a', startMinute: 610, endMinute: 655 });
      expect((last?.endMinute ?? 0) - (last?.startMinute ?? 0)).toBe(45);
      expect(seen.committed.at(-1)?.kind).toBe('move');
    });

    /*
     * The block is a tap target as well as a drag surface — it opens the
     * visit. A thumb that wobbles a couple of pixels on the way down has to
     * stay a tap, and a real drag must not ALSO open the sheet it just moved.
     */
    it('stays a tap under the threshold and swallows the click over it', () => {
      const host = frame();
      const opened: string[] = [];

      fixture.componentInstance.eventPicked.subscribe((id) => opened.push(id));
      const block = grab(host, 'staff-grid-event');

      block.dispatchEvent(pointer('pointerdown', 0));
      document.dispatchEvent(pointer('pointermove', 3));
      document.dispatchEvent(pointer('pointerup', 3));
      block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(opened).toEqual(['a']);

      block.dispatchEvent(pointer('pointerdown', 0));
      document.dispatchEvent(pointer('pointermove', travel(10)));
      document.dispatchEvent(pointer('pointerup', travel(10)));
      block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Still one: the drag's trailing click was eaten in the capture phase.
      expect(opened).toEqual(['a']);
    });

    /*
     * `pointercancel` is the iOS case nobody plans for — momentum scroll in
     * an ancestor fires it mid-gesture. It is a REVERT, not a drop, and the
     * caller that was tracking every snap has to be told the interval went
     * back rather than being left holding the last one.
     */
    it('reverts on pointercancel and never commits', () => {
      const host = frame();
      const seen = drags();
      const handle = grab(host, 'staff-frame-handle-start');

      handle.dispatchEvent(pointer('pointerdown', 0));
      document.dispatchEvent(pointer('pointermove', -travel(20)));
      fixture.detectChanges();
      expect(seen.changed.at(-1)?.startMinute).toBe(580);

      document.dispatchEvent(pointer('pointercancel', -travel(20)));
      fixture.detectChanges();
      expect(seen.changed.at(-1)).toEqual({
        id: 'a',
        startMinute: 600,
        endMinute: 645,
      });
      expect(seen.committed).toEqual([]);
      // And the picture went back with it.
      expect(
        grab(host, 'staff-grid-event').style.getPropertyValue(
          '--staff-event-top',
        ),
      ).toBe('0.333333');
    });

    /*
     * The typed rows beside the frame are the real keyboard contract, but a
     * slider that could not be arrowed would be accessibility theatre. Each
     * press is a whole gesture — press and release — so it publishes AND
     * commits; there is nothing left to wait for.
     */
    it('steps by the snap, and by one minute with shift', () => {
      const host = frame();
      const seen = drags();
      const handle = grab(host, 'staff-frame-handle-end');

      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      fixture.detectChanges();
      expect(seen.changed.at(-1)?.endMinute).toBe(650);

      handle.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          shiftKey: true,
          bubbles: true,
        }),
      );
      fixture.detectChanges();
      expect(seen.changed.at(-1)?.endMinute).toBe(651);
      expect(seen.committed.map((c) => c.kind)).toEqual(['resize', 'resize']);

      // The block's own vocabulary: the arrows slide the whole interval.
      grab(host, 'staff-grid-event').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
      );
      fixture.detectChanges();
      expect(seen.changed.at(-1)).toEqual({
        id: 'a',
        startMinute: 595,
        endMinute: 646,
      });
      expect(seen.committed.at(-1)?.kind).toBe('move');
    });

    /* The handles publish their own bounds, which is what makes `Home`/`End`
       land exactly on a limit without anyone being told a limit is there. */
    it('publishes each handle as a bounded slider', () => {
      const host = frame();
      const start = grab(host, 'staff-frame-handle-start');
      const end = grab(host, 'staff-frame-handle-end');
      expect(start.getAttribute('role')).toBe('slider');
      expect(start.getAttribute('aria-valuenow')).toBe('600');
      // The start may not cross the end's floor: 645 − 10.
      expect(start.getAttribute('aria-valuemax')).toBe('635');
      expect(end.getAttribute('aria-valuemin')).toBe('610');
      expect(end.getAttribute('aria-valuenow')).toBe('645');
      // A button, which is what keeps the sheet's own drag out of contention.
      expect(start.closest('button')).toBe(start);
    });

    /* Handles are a permission, not a decoration: the page grid tints the
       open appointment without ever offering the gesture. */
    it('draws no handles until the caller opts in', () => {
      const host = frame();
      fixture.componentRef.setInput('uiEditable', false);
      fixture.detectChanges();
      expect(
        host.querySelector('[data-testid="staff-frame-handle-start"]'),
      ).toBeNull();
    });

    /* Drawn, named and PERMITTED. A barber who parks two clients in one chair
       knows something the model does not; the readout says so and lets him. */
    it('goes destructive over a neighbour and names it', () => {
      const host = frame([
        event({ id: 'a', startMinute: 600, endMinute: 645 }),
        event({ id: 'b', startMinute: 660, endMinute: 700, title: 'Петър' }),
      ]);
      fixture.componentRef.setInput('uiDragCopy', {
        handleStart: 'Начало',
        handleEnd: 'Край',
        blockRole: 'преместваем блок',
        minutes: '{{minutes}} мин',
        overlap: 'Застъпва {{name}} {{time}}',
        outside: 'Извън смяната',
        tooShort: 'Най-малко {{minutes}} мин',
      });
      const handle = grab(host, 'staff-frame-handle-end');
      handle.dispatchEvent(pointer('pointerdown', 0));
      document.dispatchEvent(pointer('pointermove', travel(30)));
      fixture.detectChanges();

      const readout = grab(host, 'staff-frame-readout');
      expect(readout.getAttribute('data-tone')).toBe('destructive');
      expect(readout.textContent).toContain('Застъпва Петър 11:00');
      // PERMITTED: the edge went 30 minutes down, straight past the
      // neighbour's 11:00 start, instead of being stopped a minute short of
      // a collision the barber chose on purpose.
      expect(handle.getAttribute('aria-valuenow')).toBe('675');
    });
  });

  /*
   * ── Chair columns ────────────────────────────────────────────────────
   *
   * §3.4.2's "exactly one column" is reversed (owner, 2026-08-26) so a party
   * across two chairs is legible at a glance. The cap is the load-bearing
   * half of that reversal: 375px minus a 44px gutter is 331px, so two columns
   * are 165px each — a name and a time — and three are 110px, which is
   * neither.
   */
  describe('the column cap', () => {
    const drawn = (host: HTMLElement) =>
      host.querySelectorAll('[data-testid="staff-grid-column"]').length;

    const chair = (id: string, title: string, startMinute: number) =>
      column({
        id,
        title,
        events: [
          event({ id: `${id}-1`, startMinute, endMinute: startMinute + 45 }),
        ],
      });

    it('draws two chairs side by side', () => {
      fixture.componentRef.setInput('uiViewport', 'framed');
      fixture.componentRef.setInput('uiPlacement', 'proportional');
      const host = render([
        chair('ivan', 'Иван', 600),
        chair('petar', 'Петър', 600),
      ]);
      expect(drawn(host)).toBe(2);
      expect(host.querySelector('[data-testid="staff-grid-ghost"]')).toBeNull();
    });

    /*
     * Over the cap the frame does NOT pick two chairs out of three and hope
     * it chose the interesting ones. The chair the sheet was opened at keeps
     * its column and the rest are drawn inside it, named in words — because
     * the 7% tone alone is a wash a bright shop may not show at all.
     */
    it('collapses past the cap to the opened chair, the rest as ghosts', () => {
      fixture.componentRef.setInput('uiViewport', 'framed');
      fixture.componentRef.setInput('uiPlacement', 'proportional');
      fixture.componentRef.setInput('uiEditableEventId', 'petar-1');
      const host = render([
        chair('ivan', 'Иван', 600),
        chair('petar', 'Петър', 600),
        chair('nikolay', 'Николай', 600),
      ]);
      expect(drawn(host)).toBe(1);
      expect(
        host
          .querySelector('[data-testid="staff-grid-column"]')
          ?.getAttribute('data-column'),
      ).toBe('petar');
      const ghosts = [
        ...host.querySelectorAll<HTMLElement>(
          '[data-testid="staff-grid-ghost"]',
        ),
      ];
      expect(ghosts.map((g) => g.textContent?.trim())).toEqual([
        'Иван · 10:00',
        'Николай · 10:00',
      ]);
      // Context, never a control.
      expect(ghosts[0]?.getAttribute('aria-hidden')).toBe('true');
    });

    /* The page is the screen: it scrolls sideways, and a week of seven
       columns is the thing it exists to draw. Only the frame has a ceiling. */
    it('leaves the page grid uncapped', () => {
      const host = render([
        chair('a', 'A', 600),
        chair('b', 'B', 600),
        chair('c', 'C', 600),
        chair('d', 'D', 600),
        chair('e', 'E', 600),
      ]);
      expect(drawn(host)).toBe(5);
    });
  });
});
