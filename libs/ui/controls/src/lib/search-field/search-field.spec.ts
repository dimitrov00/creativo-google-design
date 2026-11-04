import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UiSearchField, type UiSearchFieldToken } from './search-field';

@Component({
  imports: [UiSearchField],
  template: `
    <ui-search-field
      [uiPinned]="pinned()"
      [uiValue]="value()"
      uiPlaceholder="Търси услуга…"
      uiTestId="probe"
      [uiBusy]="busy()"
      uiBusyTestId="probe-busy"
      uiClearLabel="Изчисти търсенето"
      [uiTokens]="tokens()"
      (uiTokenRemove)="removed.push($event)"
      (uiInput)="value.set($event)"
      (uiFocusChange)="focused.set($event)"
      (uiSubmit)="submitted = submitted + 1"
      (uiNavigate)="navigated = navigated + 1"
    />
  `,
})
class Host {
  readonly pinned = signal(false);
  readonly value = signal('');
  readonly busy = signal(false);
  readonly focused = signal(false);
  readonly tokens = signal<readonly UiSearchFieldToken[]>([]);
  readonly removed: string[] = [];
  submitted = 0;
  navigated = 0;
}

describe('UiSearchField', () => {
  let fixture: ComponentFixture<Host>;
  const el = (selector: string) =>
    fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('is a search field with the glyph leading, named by its placeholder', () => {
    const input = el('[data-testid="probe"]') as HTMLInputElement;
    expect(input.type).toBe('search');
    expect(input.getAttribute('aria-label')).toBe('Търси услуга…');
    expect(input.getAttribute('enterkeyhint')).toBe('search');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(el('[data-testid="probe-glyph"]')?.tagName).toBe('UI-ICON');
  });

  it('pins as a band of the regular material only when asked', () => {
    const host = el('ui-search-field');
    expect(host?.hasAttribute('data-pinned')).toBe(false);
    expect(host?.hasAttribute('data-material')).toBe(false);
    fixture.componentInstance.pinned.set(true);
    fixture.detectChanges();
    expect(host?.hasAttribute('data-pinned')).toBe(true);
    expect(host?.getAttribute('data-material')).toBe('regular');
  });

  it('draws its own circled clear while there is a query: the query goes, the focus stays', () => {
    const input = el('[data-testid="probe"]') as HTMLInputElement;
    expect(el('[data-testid="probe-clear"]')).toBeNull();
    fixture.componentInstance.value.set('фейд');
    fixture.detectChanges();
    const clear = el('[data-testid="probe-clear"]') as HTMLButtonElement;
    expect(clear.getAttribute('aria-label')).toBe('Изчисти търсенето');
    expect(clear.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
      'field.clear',
    );
    clear.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('');
    expect(document.activeElement).toBe(input);
    expect(el('[data-testid="probe-clear"]')).toBeNull();
  });

  it('reports typing, focus, Return and ↓ — and turns a ring while busy', () => {
    const input = el('[data-testid="probe"]') as HTMLInputElement;
    const host = fixture.componentInstance;
    input.value = 'фейд';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('focus'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(host.value()).toBe('фейд');
    expect(host.focused()).toBe(true);
    expect(host.submitted).toBe(1);
    expect(host.navigated).toBe(1);
    input.dispatchEvent(new Event('blur'));
    expect(host.focused()).toBe(false);

    expect(el('[data-testid="probe-busy"]')).toBeNull();
    host.busy.set(true);
    fixture.detectChanges();
    expect(el('[data-testid="probe-busy"]')?.tagName).toBe('UI-PROGRESS-VIEW');
  });

  describe('tokens', () => {
    const NIKOLAY: UiSearchFieldToken = {
      id: 'barber-nikolay',
      label: 'Николай',
      removeLabel: 'Махни филтъра Николай',
    };
    const FADE: UiSearchFieldToken = {
      id: 'service-fade',
      label: 'Фейд',
      removeLabel: 'Махни филтъра Фейд',
    };
    const chips = () =>
      Array.from(
        fixture.nativeElement.querySelectorAll('.ui-search-field__token'),
      ) as HTMLButtonElement[];

    it('has none by default: no chips, no token hook on the host', () => {
      expect(chips()).toEqual([]);
      expect(el('ui-search-field')?.hasAttribute('data-has-tokens')).toBe(
        false,
      );
    });

    it('draws a removable chip per token before the input, named by what pressing it does', () => {
      fixture.componentInstance.tokens.set([NIKOLAY, FADE]);
      fixture.detectChanges();
      expect(chips().map((chip) => chip.textContent?.trim())).toEqual([
        'Николай',
        'Фейд',
      ]);
      expect(chips()[0]?.getAttribute('aria-label')).toBe(
        'Махни филтъра Николай',
      );
      expect(chips()[0]?.getAttribute('aria-pressed')).toBeNull();
      expect(el('ui-search-field')?.hasAttribute('data-has-tokens')).toBe(true);
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      const lastChip = chips()[1] as HTMLElement;
      expect(
        lastChip.compareDocumentPosition(input) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('removes a token when its chip is pressed, and keeps the focus in the field', () => {
      fixture.componentInstance.tokens.set([NIKOLAY, FADE]);
      fixture.detectChanges();
      chips()[1]?.click();
      expect(fixture.componentInstance.removed).toEqual(['service-fade']);
      expect(document.activeElement).toBe(el('[data-testid="probe"]'));
    });

    it('takes the last chip off on Backspace in an empty field, and says so', () => {
      fixture.componentInstance.tokens.set([NIKOLAY, FADE]);
      fixture.detectChanges();
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
      );
      fixture.detectChanges();
      expect(fixture.componentInstance.removed).toEqual(['service-fade']);
      expect(el('[data-testid="probe-announce"]')?.textContent?.trim()).toBe(
        'Махни филтъра Фейд',
      );
    });

    it('leaves the chips alone on Backspace while there is text to delete', () => {
      fixture.componentInstance.tokens.set([NIKOLAY]);
      fixture.componentInstance.value.set('иван');
      fixture.detectChanges();
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
      );
      expect(fixture.componentInstance.removed).toEqual([]);
    });

    it('does nothing on Backspace with no tokens', () => {
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
      );
      expect(fixture.componentInstance.removed).toEqual([]);
    });
  });
});
