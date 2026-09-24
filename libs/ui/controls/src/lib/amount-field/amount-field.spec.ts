import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  UiAmountField,
  formatAmountFigure,
  parseAmountFigure,
} from './amount-field';

@Component({
  imports: [UiAmountField],
  template: `
    <ui-amount-field
      uiId="tip"
      [uiValue]="value()"
      uiUnit="€"
      [uiReserve]="reserve()"
      [uiStep]="50"
      [uiMax]="1000"
      uiLabel="Друга сума"
      uiDecreaseLabel="Намали"
      uiIncreaseLabel="Увеличи"
      uiTestId="tip-field"
      (uiInput)="typed.set($event)"
      (uiValueChange)="answers.push($event); value.set($event)"
    />
  `,
})
class Host {
  readonly value = signal<number | null>(null);
  readonly reserve = signal<string | null>('00,00');
  readonly typed = signal('');
  answers: (number | null)[] = [];
}

async function render() {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const native = () => q('tip-field') as HTMLInputElement;
  const type = (raw: string) => {
    native().value = raw;
    native().dispatchEvent(new Event('input'));
    native().dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  return { fixture, host, q, native, type };
}

describe('formatAmountFigure / parseAmountFigure', () => {
  it('write and read the figure a hand writes', () => {
    expect(formatAmountFigure(550)).toBe('5,50');
    expect(formatAmountFigure(5)).toBe('0,05');
    expect(formatAmountFigure(0)).toBe('0,00');
    expect(formatAmountFigure(1234, '.')).toBe('12.34');
    expect(parseAmountFigure('5')).toBe(500);
    expect(parseAmountFigure('5,5')).toBe(550);
    expect(parseAmountFigure(' 5.50 ')).toBe(550);
    expect(parseAmountFigure('0,05')).toBe(5);
    expect(parseAmountFigure('abc')).toBeNull();
    expect(parseAmountFigure('5,555')).toBeNull();
    expect(parseAmountFigure('')).toBeNull();
  });
});

describe('UiAmountField', () => {
  it('shows a muted zero rather than a blank, the unit beside it, and names itself for a reader', async () => {
    const { host, q, native } = await render();
    expect(host.querySelector('.ui-amount-field')?.getAttribute('role')).toBe(
      'group',
    );
    expect(
      host.querySelector('.ui-amount-field')?.getAttribute('aria-label'),
    ).toBe('Друга сума');
    expect(native().value).toBe('');
    expect(native().getAttribute('placeholder')).toBe('0,00');
    expect(native().getAttribute('inputmode')).toBe('decimal');
    expect(native().getAttribute('aria-label')).toBe('Друга сума');
    // The LIVE unit — the reserve carries a hidden twin of it.
    const unit = host.querySelector(
      '.ui-amount-field__line .ui-amount-field__unit',
    );
    expect(unit?.textContent?.trim()).toBe('€');
    expect(unit?.getAttribute('aria-hidden')).toBe('true');
    expect(native().getAttribute('aria-describedby')).toBe(unit?.id);
    // The sizer holds the placeholder so the empty figure is as wide as a zero.
    expect(
      host.querySelector('.ui-amount-field__sizer')?.textContent?.trim(),
    ).toBe('0,00');
    expect(q('tip-field-decrease')?.getAttribute('aria-label')).toBe('Намали');
    expect(q('tip-field-increase')?.getAttribute('aria-label')).toBe('Увеличи');
  });

  it('commits what a keypad produces as minor units, springs back from what is not money, and clears when emptied', async () => {
    const { fixture, native, type } = await render();
    type('5,5');
    expect(fixture.componentInstance.typed()).toBe('5,5');
    expect(fixture.componentInstance.answers).toEqual([550]);
    expect(native().value).toBe('5,50');
    type('7.25');
    expect(fixture.componentInstance.answers).toEqual([550, 725]);
    expect(native().value).toBe('7,25');
    // Not money: nothing is said, the figure comes back.
    type('abc');
    expect(fixture.componentInstance.answers).toEqual([550, 725]);
    expect(native().value).toBe('7,25');
    // Past the ceiling: snapped to it — the snap is the message.
    type('99');
    expect(fixture.componentInstance.answers).toEqual([550, 725, 1000]);
    expect(native().value).toBe('10,00');
    // Emptied: cleared, which is not zero.
    type('');
    expect(fixture.componentInstance.answers).toEqual([550, 725, 1000, null]);
    expect(native().value).toBe('');
  });

  it('steps the sum by its step and never past the floor or the ceiling', async () => {
    const { fixture, q, native } = await render();
    // Nothing yet: down is disabled, up starts the count at one step.
    expect((q('tip-field-decrease') as HTMLButtonElement).disabled).toBe(true);
    q('tip-field-increase')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(50);
    expect(native().value).toBe('0,50');
    q('tip-field-increase')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(100);
    expect((q('tip-field-decrease') as HTMLButtonElement).disabled).toBe(false);
    q('tip-field-decrease')?.click();
    fixture.detectChanges();
    q('tip-field-decrease')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(0);
    expect((q('tip-field-decrease') as HTMLButtonElement).disabled).toBe(true);
    // The ceiling: the last step lands on it and the button goes quiet.
    fixture.componentInstance.value.set(975);
    fixture.detectChanges();
    q('tip-field-increase')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(1000);
    expect((q('tip-field-increase') as HTMLButtonElement).disabled).toBe(true);
    q('tip-field-increase')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(1000);
  });

  it('keeps the cell as wide as what is being typed, then as wide as what was kept, and adds no width of its own', async () => {
    const { fixture, host, native } = await render();
    const sizer = () =>
      host.querySelector('.ui-amount-field__sizer')?.textContent?.trim();
    // A text input is twenty characters wide by default; that must never
    // reach the cell, or the figure drifts off centre towards its unit.
    expect(native().getAttribute('size')).toBe('1');
    native().value = '7,5';
    native().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(sizer()).toBe('7,5');
    native().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(sizer()).toBe('7,50');
    expect(native().value).toBe('7,50');
    // Emptied under the caret: the zero's width again, so the caret has a home.
    native().value = '';
    native().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(sizer()).toBe('0,00');
  });

  it('keeps a reserved width beside the live figure, hidden from a reader, and none when the owner reserves nothing', async () => {
    const { fixture, host } = await render();
    const reserve = host.querySelector<HTMLElement>(
      '.ui-amount-field__reserve',
    );
    expect(reserve?.getAttribute('aria-hidden')).toBe('true');
    expect(
      reserve?.querySelector('.ui-amount-field__reserve-figure')?.textContent,
    ).toBe('00,00');
    // The reserve carries the unit too, so its width is the whole line's.
    expect(
      reserve?.querySelector('.ui-amount-field__unit')?.textContent?.trim(),
    ).toBe('€');
    // The live line is its own box beside it, and the described-by unit
    // is the live one.
    const line = host.querySelector<HTMLElement>('.ui-amount-field__line');
    expect(line?.querySelector('.ui-amount-field__native')).not.toBeNull();
    expect(line?.querySelector('.ui-amount-field__unit')?.id).toBe(
      host
        .querySelector('.ui-amount-field__native')
        ?.getAttribute('aria-describedby'),
    );
    fixture.componentInstance.reserve.set(null);
    fixture.detectChanges();
    expect(host.querySelector('.ui-amount-field__reserve')).toBeNull();
  });
});

@Component({
  imports: [UiAmountField],
  template: `<ui-amount-field
    uiId="pct"
    uiTestId="pct"
    uiUnit="%"
    uiReserve="000"
    [uiFractionDigits]="0"
    [uiStep]="5"
    [uiMax]="100"
    [uiValue]="value()"
    (uiValueChange)="value.set($event); answers.push($event)"
    (uiSubmit)="submits = submits + 1"
  />`,
})
class WholeCountHost {
  value = signal<number | null>(null);
  answers: (number | null)[] = [];
  submits = 0;
}

describe('UiAmountField as a whole count', () => {
  it('writes and reads «10 %» with no places, steps by its step, and reports a typed figure past the ceiling as written', async () => {
    await TestBed.configureTestingModule({
      imports: [WholeCountHost],
    }).compileComponents();
    const fixture = TestBed.createComponent(WholeCountHost);
    fixture.detectChanges();
    const q = (testId: string) =>
      fixture.nativeElement.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLElement | null;
    const native = () => q('pct') as HTMLInputElement;
    const type = (value: string) => {
      native().value = value;
      native().dispatchEvent(new Event('input'));
      native().dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    expect(native().getAttribute('placeholder')).toBe('0');
    expect(native().getAttribute('inputmode')).toBe('numeric');
    expect(
      q('pct')
        ?.closest('ui-amount-field')
        ?.querySelector('.ui-amount-field__line .ui-amount-field__unit')
        ?.textContent,
    ).toBe('%');
    q('pct-increase')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(5);
    expect(native().value).toBe('5');
    type('12');
    expect(fixture.componentInstance.answers).toEqual([5, 12]);
    expect(native().value).toBe('12');
    // Past the ceiling: snapped to it, and the pair goes quiet upward.
    type('140');
    expect(fixture.componentInstance.answers).toEqual([5, 12, 100]);
    expect(native().value).toBe('100');
    expect((q('pct-increase') as HTMLButtonElement).disabled).toBe(true);
    // Not a whole count: nothing is said, the figure comes back.
    type('7,5');
    expect(fixture.componentInstance.answers).toEqual([5, 12, 100]);
    expect(native().value).toBe('100');
    // One press down from the ceiling.
    q('pct-decrease')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(95);
    expect(native().value).toBe('95');
    // Return is the owner's to act on.
    native().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(fixture.componentInstance.submits).toBe(1);
  });
});
