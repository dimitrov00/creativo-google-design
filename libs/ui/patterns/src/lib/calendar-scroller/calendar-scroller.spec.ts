import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiCalendarScroller } from './calendar-scroller';

@Component({
  imports: [UiCalendarScroller],
  template: `<ui-calendar-scroller data-testid="scroller">
    <div uiCalendarLede data-testid="lede">When suits you?</div>
    <section uiCalendarMonth data-testid="august">August</section>
    <section uiCalendarMonth data-testid="september">September</section>
  </ui-calendar-scroller>`,
})
class HostComponent {}

describe('UiCalendarScroller', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const host = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="scroller"]');

  it('carries the host class the stylesheet targets', () => {
    expect(host().classList.contains('ui-calendar-scroller')).toBe(true);
  });

  it('projects months in order, inside the scrolling wrapper', () => {
    const months = host().querySelector('.ui-calendar-scroller__months');
    expect(months).not.toBeNull();

    const sections = months?.querySelectorAll('[uiCalendarMonth]');
    expect(sections).toHaveLength(2);
    expect(sections?.[0]?.getAttribute('data-testid')).toBe('august');
    expect(sections?.[1]?.getAttribute('data-testid')).toBe('september');
  });

  // The lede exists so the consumer's large title can pass UNDER the page
  // chrome. Rendered in a fixed block above this box it never scrolled, so the
  // house large-title collapse never fired and the chrome's fade had nothing
  // beneath it to dissolve.
  it('projects the lede outside the months, ahead of them', () => {
    const scroller = host();
    const lede = scroller.querySelector('[data-testid="lede"]');
    const months = scroller.querySelector('.ui-calendar-scroller__months');

    expect(lede).not.toBeNull();
    // Not in the months wrapper — that carries the run's own gap and end
    // padding, which would then apply to the heading too.
    expect(months?.contains(lede as Node)).toBe(false);
    // Narrowed rather than optional-chained: the assertion above already
    // established both exist, and `undefined & mask` is silently 0 — a
    // missing lede would have passed this as "not following".
    if (!lede || !months) throw new Error('missing scroller parts');
    expect(
      lede.compareDocumentPosition(months) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // No pinned header slot, on purpose. One briefly existed here, with an
  // opaque fill and a ramp of its own, and it meant the consumer's title
  // collapsed at one scroll position while the key pinned at another — one
  // block behaving as two, over two stacked gradients. The consumer's own
  // chrome re-renders the key beside its collapsed title instead, so this box
  // carries no fade at all.
  it('owns no pinned header, and no fade of its own', () => {
    expect(host().querySelector('.ui-calendar-scroller__key')).toBeNull();
    expect(host().querySelector('[uiCalendarHeader]')).toBeNull();
  });
});
