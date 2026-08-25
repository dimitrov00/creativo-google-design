import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type GridColumn,
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
});
