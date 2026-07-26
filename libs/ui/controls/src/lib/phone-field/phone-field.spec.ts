import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CountryIso2 } from '@creativo/domain/kernel';
import { afterEach, vi } from 'vitest';
import { UiPhoneField } from './phone-field';

// The component lazy-loads the kernel chunk, so the boundary lint forbids a
// STATIC kernel import anywhere in this project — the spec fetches the same
// functions dynamically (resolved in beforeAll, before any test runs).
type Kernel = typeof import('@creativo/domain/kernel');
let formatPhoneDraft: Kernel['formatPhoneDraft'];
let examplePhoneNumber: Kernel['examplePhoneNumber'];

const BG = 'BG' as string as CountryIso2;

@Component({
  imports: [UiPhoneField],
  template: `<ui-phone-field
    [defaultCountry]="defaultCountry"
    [(country)]="country"
    [(value)]="value"
    label="Phone number"
    [error]="error()"
  />`,
})
class HostComponent {
  defaultCountry = BG;
  readonly country = signal<CountryIso2 | undefined>(undefined);
  readonly value = signal<string | null>(null);
  readonly error = signal<string | null>(null);
}

describe('UiPhoneField', () => {
  let fixture: ComponentFixture<HostComponent>;

  /** A real, valid national number for the default country — sourced from
   *  the kernel's own example data so validity is never a guess. */
  let exampleNational: string;
  let exampleDigits: string;

  beforeAll(async () => {
    const kernel = await import('@creativo/domain/kernel');
    formatPhoneDraft = kernel.formatPhoneDraft;
    examplePhoneNumber = kernel.examplePhoneNumber;
    exampleNational = examplePhoneNumber(BG) as string;
    exampleDigits = exampleNational.replace(/\D/g, '');
  });

  const telInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('[data-testid="phone-field-input"]');
  const trigger = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('[data-testid="phone-field-trigger"]');

  const type = (text: string): void => {
    const input = telInput();
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const openPicker = async (): Promise<void> => {
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    // The kernel phone API is a lazy chunk behind PendingTasks —
    // whenStable resolves once it has landed.
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('formats the draft nationally as the user types (kernel formatting)', () => {
    type(exampleDigits);
    expect(telInput().value).toBe(
      formatPhoneDraft(exampleDigits, BG).formatted,
    );
  });

  it('shows the example number for the effective country as placeholder', () => {
    expect(telInput().placeholder).toBe(exampleNational);
  });

  it('emits E.164 only once the draft is valid, null otherwise', () => {
    type(exampleDigits.slice(0, 3));
    expect(fixture.componentInstance.value()).toBeNull();

    type(exampleDigits);
    expect(fixture.componentInstance.value()).toBe(
      formatPhoneDraft(exampleDigits, BG).e164,
    );

    // Deleting digits invalidates again — value returns to null.
    type(exampleDigits.slice(0, 4));
    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('switches the country model when a +international value is typed', () => {
    type('+49 171 2345678');
    expect(fixture.componentInstance.country()).toBe('DE');
  });

  it('prefilled +E.164 value populates the field and re-detects country', async () => {
    const e164 = formatPhoneDraft(exampleDigits, BG).e164 as string;
    fixture.componentInstance.value.set(e164);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.country()).toBe('BG');
    expect(telInput().value.replace(/\D/g, '')).toBe(e164.replace(/\D/g, ''));
  });

  it('keeps the entered digits when the country changes from the picker', async () => {
    type(exampleDigits);
    await openPicker();

    const germany: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="phone-field-option-DE"]',
    );
    germany.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.country()).toBe('DE');
    expect(telInput().value.replace(/\D/g, '')).toBe(exampleDigits);
    expect(telInput().value).toBe(
      formatPhoneDraft(exampleDigits, 'DE' as string as CountryIso2).formatted,
    );
  });

  it('wires the APG combobox/listbox roles', async () => {
    const combo = trigger();
    expect(combo.getAttribute('role')).toBe('combobox');
    expect(combo.getAttribute('aria-haspopup')).toBe('listbox');
    expect(combo.getAttribute('aria-expanded')).toBe('false');

    await openPicker();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    const listbox: HTMLElement =
      fixture.nativeElement.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(combo.getAttribute('aria-controls')).toBe(listbox.id);

    const options = listbox.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(100);

    const selected = listbox.querySelector('[aria-selected="true"]');
    expect(selected?.getAttribute('data-testid')).toBe('phone-field-option-BG');
    // The selected row carries the checklist.done glyph.
    expect(selected?.querySelector('ui-icon')).toBeTruthy();
  });

  it('moves aria-activedescendant with arrow keys and selects on Enter', async () => {
    await openPicker();
    const search: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="phone-field-search"]',
    );
    const listbox: HTMLElement =
      fixture.nativeElement.querySelector('[role="listbox"]');
    const before = listbox.getAttribute('aria-activedescendant');
    expect(before).toBeTruthy();

    search.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    const after = listbox.getAttribute('aria-activedescendant');
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);

    search.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    fixture.detectChanges();
    // The active (next) option became the selected country and the picker
    // closed.
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    const expectedCode = after?.split('-option-')[1];
    expect(fixture.componentInstance.country()).toBe(expectedCode);
  });

  it('filters countries by name, ISO code and dial code', async () => {
    await openPicker();
    const search: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="phone-field-search"]',
    );

    search.value = '+359';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    let options = fixture.nativeElement.querySelectorAll('[role="option"]');
    expect(options.length).toBe(1);
    expect(options[0].getAttribute('data-testid')).toBe(
      'phone-field-option-BG',
    );

    search.value = 'germ';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    options = fixture.nativeElement.querySelectorAll('[role="option"]');
    expect(options.length).toBe(1);
    expect(options[0].getAttribute('data-testid')).toBe(
      'phone-field-option-DE',
    );
  });

  it('renders aria-hidden SVG flag images on the trigger and picker rows', async () => {
    const triggerFlag = trigger().querySelector(
      '.ui-phone-field__flag',
    ) as HTMLImageElement;
    expect(triggerFlag).toBeTruthy();
    expect(triggerFlag.tagName).toBe('IMG');
    expect(triggerFlag.getAttribute('aria-hidden')).toBe('true');
    expect(triggerFlag.getAttribute('alt')).toBe('');
    expect(triggerFlag.getAttribute('src')).toBe('assets/flags/1x1/bg.svg');
    // The accessible name stays "Country code: Name +dial" — no flag.
    expect(trigger().getAttribute('aria-label')).not.toContain('flag');

    await openPicker();
    const bulgariaFlag = fixture.nativeElement.querySelector(
      '[data-testid="phone-field-option-BG"] .ui-phone-field__option-flag',
    ) as HTMLImageElement;
    expect(bulgariaFlag).toBeTruthy();
    expect(bulgariaFlag.tagName).toBe('IMG');
    expect(bulgariaFlag.getAttribute('aria-hidden')).toBe('true');
    expect(bulgariaFlag.getAttribute('src')).toBe('assets/flags/1x1/bg.svg');
  });

  it('re-renders a messy paste as the canonical national grouping', () => {
    // '08 88-12 34 56'-style mess: same digits, junk separators.
    const messy = `${exampleDigits.slice(0, 2)} ${exampleDigits.slice(
      2,
      4,
    )}-${exampleDigits.slice(4, 6)} ${exampleDigits.slice(6)}`;
    type(messy);
    expect(telInput().value).toBe(
      formatPhoneDraft(exampleDigits, BG).formatted,
    );
  });

  it('snaps the displayed text to canonical grouping on blur', () => {
    // Text the input event never processed (degraded/edge path): write the
    // DOM directly, then blur — the field must re-render canonically.
    const messy = `${exampleDigits.slice(0, 2)} ${exampleDigits.slice(
      2,
      4,
    )}-${exampleDigits.slice(4)}`;
    const input = telInput();
    input.value = messy;
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(input.value).toBe(formatPhoneDraft(exampleDigits, BG).formatted);
    // The blur snap also re-syncs the model — pure E.164.
    expect(fixture.componentInstance.value()).toBe(
      formatPhoneDraft(exampleDigits, BG).e164,
    );
  });

  it('emits E.164 with no whitespace or punctuation, ever', () => {
    const messy = `${exampleDigits.slice(0, 3)} ${exampleDigits.slice(
      3,
      6,
    )}-${exampleDigits.slice(6)}`;
    type(messy);
    const value = fixture.componentInstance.value();
    expect(value).not.toBeNull();
    expect(value).toMatch(/^\+\d+$/);
  });

  it('reflects the consumer error input as data-invalid + aria-invalid', async () => {
    fixture.componentInstance.error.set('Too short');
    fixture.detectChanges();
    await fixture.whenStable();

    const host: HTMLElement =
      fixture.nativeElement.querySelector('ui-phone-field');
    expect(host.getAttribute('data-invalid')).toBe('');
    expect(telInput().getAttribute('aria-invalid')).toBe('true');
    const alert: HTMLElement =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Too short');
    expect(telInput().getAttribute('aria-describedby')).toBe(alert.id);
  });

  describe('per-viewport presentation', () => {
    // jsdom ships no matchMedia — the component then falls back to the
    // sheet (exactly what every spec above exercises). Stubbing it decides
    // the split: matches=true is compact (sheet), false is regular
    // (anchored popover).
    const stubViewport = (compact: boolean): void => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: compact,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const popover = (): HTMLElement | null =>
      fixture.nativeElement.querySelector(
        '[data-testid="phone-field-popover"]',
      );
    const sheetPresented = (): boolean =>
      fixture.nativeElement
        .querySelector('ui-sheet')
        ?.hasAttribute('data-presented') ?? false;

    it('presents an anchored popover on regular widths, not the sheet', async () => {
      stubViewport(false);
      await openPicker();

      expect(popover()).toBeTruthy();
      expect(sheetPresented()).toBe(false);
      // The same combobox wiring: listbox + options render in the panel.
      const listbox = popover()?.querySelector('[role="listbox"]');
      expect(listbox).toBeTruthy();
      expect(
        listbox?.querySelectorAll('[role="option"]').length,
      ).toBeGreaterThan(100);
      expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps the sheet on compact widths', async () => {
      stubViewport(true);
      await openPicker();

      expect(popover()).toBeNull();
      expect(sheetPresented()).toBe(true);
    });

    it('re-resolves the presentation at every open (no reload needed)', async () => {
      stubViewport(false);
      await openPicker();
      expect(popover()).toBeTruthy();

      trigger().click(); // toggle closed
      fixture.detectChanges();
      expect(popover()).toBeNull();

      stubViewport(true); // "resize" to compact
      await openPicker();
      expect(popover()).toBeNull();
      expect(sheetPresented()).toBe(true);
    });

    it('selects from the popover and closes it', async () => {
      stubViewport(false);
      type(exampleDigits);
      await openPicker();

      const germany: HTMLElement = fixture.nativeElement.querySelector(
        '[data-testid="phone-field-option-DE"]',
      );
      germany.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.country()).toBe('DE');
      expect(popover()).toBeNull();
      expect(telInput().value.replace(/\D/g, '')).toBe(exampleDigits);
    });

    it('Escape closes the popover and returns focus to the trigger', async () => {
      stubViewport(false);
      await openPicker();
      const search: HTMLInputElement = fixture.nativeElement.querySelector(
        '[data-testid="phone-field-search"]',
      );

      search.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();

      expect(popover()).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger());
    });

    it('an outside press closes the popover', async () => {
      stubViewport(false);
      await openPicker();
      expect(popover()).toBeTruthy();

      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(popover()).toBeNull();
    });
  });
});
