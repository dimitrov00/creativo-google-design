import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  UiDateField,
  UiDateFieldBlurEvent,
  UiDateFieldParts,
} from './date-field';

@Component({
  imports: [UiDateField],
  template: `<ui-date-field
    label="Birthday"
    [uiLabelHidden]="labelHidden()"
    [hint]="hint()"
    [error]="error()"
    [disabled]="disabled()"
    [(value)]="value"
    (uiBlurred)="blurs.push($event)"
  />`,
})
class HostComponent {
  readonly value = signal<UiDateFieldParts | null>(null);
  readonly hint = signal<string | null>('For birthday surprises.');
  readonly error = signal<string | null>(null);
  readonly disabled = signal(false);
  readonly labelHidden = signal(false);
  readonly blurs: UiDateFieldBlurEvent[] = [];
}

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  });
  return event;
}

describe('UiDateField', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  function slot(segment: 'day' | 'month' | 'year'): HTMLInputElement {
    return fixture.nativeElement.querySelector(`[data-segment="${segment}"]`);
  }

  function type(segment: 'day' | 'month' | 'year', text: string): void {
    const el = slot(segment);
    el.value = text;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('renders three labeled numeric segments inside a fieldset with a legend', () => {
    const fieldset = fixture.nativeElement.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('legend')?.textContent?.trim(),
    ).toBe('Birthday');

    const day = slot('day');
    expect(day.getAttribute('type')).toBe('text');
    expect(day.getAttribute('inputmode')).toBe('numeric');
    expect(day.getAttribute('autocomplete')).toBe('bday-day');
    expect(day.getAttribute('aria-label')).toBe('Day');
    expect(slot('month').getAttribute('autocomplete')).toBe('bday-month');
    expect(slot('year').getAttribute('autocomplete')).toBe('bday-year');
    // No maxlength — it would truncate a pasted date before the handler ran.
    expect(day.hasAttribute('maxlength')).toBe(false);
  });

  it('auto-advances ONLY on a complete segment (owner decision, against GOV.UK — see onInput)', () => {
    type('day', '0');
    expect(document.activeElement).not.toBe(slot('month'));

    type('day', '03');
    expect(document.activeElement).toBe(slot('month'));

    type('month', '07');
    expect(document.activeElement).toBe(slot('year'));
  });

  it('emits parts only when ALL segments are complete, null otherwise', () => {
    type('day', '03');
    type('month', '07');
    expect(fixture.componentInstance.value()).toBeNull();

    type('year', '1990');
    expect(fixture.componentInstance.value()).toEqual({
      day: 3,
      month: 7,
      year: 1990,
    });

    type('year', '199');
    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('backspace in an empty segment moves focus back without deleting', () => {
    type('day', '03');
    const month = slot('month');
    month.focus();
    month.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    fixture.detectChanges();

    expect(document.activeElement).toBe(slot('day'));
    expect(slot('day').value).toBe('03');
  });

  it("distributes a pasted 'DD.MM.YYYY' across the segments", () => {
    slot('day').dispatchEvent(pasteEvent('03.07.1990'));
    fixture.detectChanges();

    expect(slot('day').value).toBe('03');
    expect(slot('month').value).toBe('07');
    expect(slot('year').value).toBe('1990');
    expect(fixture.componentInstance.value()).toEqual({
      day: 3,
      month: 7,
      year: 1990,
    });
  });

  it("distributes a pasted bare 'DDMMYYYY' digit run, even into a middle segment", () => {
    slot('month').dispatchEvent(pasteEvent('03071990'));
    fixture.detectChanges();

    expect(slot('day').value).toBe('03');
    expect(slot('month').value).toBe('07');
    expect(slot('year').value).toBe('1990');
    expect(fixture.componentInstance.value()).toEqual({
      day: 3,
      month: 7,
      year: 1990,
    });
  });

  it("pads single-separator groups ('3.7.1990') on paste", () => {
    slot('day').dispatchEvent(pasteEvent('3.7.1990'));
    fixture.detectChanges();

    expect(slot('day').value).toBe('03');
    expect(slot('month').value).toBe('07');
    expect(fixture.componentInstance.value()).toEqual({
      day: 3,
      month: 7,
      year: 1990,
    });
  });

  it('zero-pads a lone digit when the segment is left', () => {
    type('day', '3');
    slot('day').dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(slot('day').value).toBe('03');
  });

  it('reports empty / partial / complete through uiBlurred when focus leaves the group', () => {
    const host = fixture.componentInstance;

    fixture.nativeElement
      .querySelector('ui-date-field')
      .dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
    expect(host.blurs.at(-1)).toEqual({ kind: 'empty' });

    type('day', '03');
    fixture.nativeElement
      .querySelector('ui-date-field')
      .dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
    expect(host.blurs.at(-1)).toEqual({ kind: 'partial' });

    type('month', '07');
    type('year', '1990');
    fixture.nativeElement
      .querySelector('ui-date-field')
      .dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
    expect(host.blurs.at(-1)).toEqual({
      kind: 'complete',
      parts: { day: 3, month: 7, year: 1990 },
    });
  });

  it('does NOT emit uiBlurred when focus moves between segments', () => {
    const host = fixture.componentInstance;
    fixture.nativeElement
      .querySelector('ui-date-field')
      .dispatchEvent(
        new FocusEvent('focusout', { relatedTarget: slot('month') }),
      );
    expect(host.blurs).toHaveLength(0);
  });

  it('an external value write repopulates the segments zero-padded', async () => {
    fixture.componentInstance.value.set({ day: 5, month: 1, year: 2000 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(slot('day').value).toBe('05');
    expect(slot('month').value).toBe('01');
    expect(slot('year').value).toBe('2000');
  });

  it('propagates error copy with role=alert and aria-describedby, and disabled locks every segment', async () => {
    fixture.componentInstance.error.set('Not a real date.');
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const hostEl: HTMLElement =
      fixture.nativeElement.querySelector('ui-date-field');
    expect(hostEl.getAttribute('data-invalid')).toBe('');
    expect(hostEl.getAttribute('data-disabled')).toBe('');
    const error = fixture.nativeElement.querySelector('.ui-date-field__error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent?.trim()).toBe('Not a real date.');
    const describedBy = slot('day').getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('-hint');
    expect(describedBy).toContain('-error');
    // Disabled rides the FIELDSET (GOV.UK grouping) — every segment locks.
    expect(slot('day').disabled).toBe(true);
    expect(slot('year').disabled).toBe(true);
  });

  it('uiLabelHidden keeps the legend naming the fieldset while removing it visually', () => {
    const legend = () =>
      fixture.nativeElement.querySelector('.ui-date-field__legend');
    expect(legend()?.hasAttribute('data-visually-hidden')).toBe(false);

    fixture.componentInstance.labelHidden.set(true);
    fixture.detectChanges();

    // Still in the DOM (and so still the fieldset's accessible name) —
    // just clipped, so a sheet whose title already says it doesn't repeat.
    expect(legend()).not.toBeNull();
    expect(legend()?.textContent).toContain('Birthday');
    expect(legend()?.hasAttribute('data-visually-hidden')).toBe(true);
  });
});
