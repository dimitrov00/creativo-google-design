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
      [uiActiveToken]="active()"
      [uiDropdownOpen]="dropdown()"
      uiDropdownLabel="Филтри"
      (uiTokenRemove)="removed.push($event)"
      (uiTokenActivate)="activated.push($event)"
      (uiEscape)="escaped = escaped + 1"
      (uiInput)="value.set($event)"
      (uiFocusChange)="focused.set($event)"
      (uiSubmit)="submitted = submitted + 1"
      (uiNavigate)="navigated = navigated + 1"
    >
      <div uiSearchDropdown>
        <button type="button" data-testid="row">Бръснар</button>
      </div>
    </ui-search-field>
    <button type="button" data-testid="outside">outside</button>
  `,
})
class Host {
  readonly pinned = signal(false);
  readonly value = signal('');
  readonly busy = signal(false);
  readonly focused = signal(false);
  readonly tokens = signal<readonly UiSearchFieldToken[]>([]);
  readonly active = signal<string | null>(null);
  readonly dropdown = signal(false);
  readonly removed: string[] = [];
  readonly activated: string[] = [];
  escaped = 0;
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
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(host.value()).toBe('фейд');
    expect(host.focused()).toBe(true);
    expect(host.submitted).toBe(1);
    expect(host.navigated).toBe(1);
    (el('[data-testid="outside"]') as HTMLButtonElement).focus();
    expect(host.focused()).toBe(false);

    expect(el('[data-testid="probe-busy"]')).toBeNull();
    host.busy.set(true);
    fixture.detectChanges();
    expect(el('[data-testid="probe-busy"]')?.tagName).toBe('UI-PROGRESS-VIEW');
  });

  describe('tokens', () => {
    const BARBERS: UiSearchFieldToken = {
      id: 'BARBER',
      key: 'Бръснар',
      value: 'Николай, Иван',
      faces: [
        { src: null, name: 'Николай' },
        { src: '/ivan.jpg', name: 'Иван' },
      ],
      label: 'Бръснар: Николай, Иван. Промени филтъра',
      removeLabel: 'Махни филтъра Бръснар',
    };
    const WHEN: UiSearchFieldToken = {
      id: 'WHEN',
      key: 'Кога',
      value: 'Тази седмица',
      faces: [],
      label: 'Кога: Тази седмица. Промени филтъра',
      removeLabel: 'Махни филтъра Кога',
    };
    const BUILDING: UiSearchFieldToken = {
      id: 'SERVICE',
      key: 'Услуга',
      value: '',
      faces: [],
      label: 'Услуга: избери стойност',
      removeLabel: 'Махни филтъра Услуга',
    };
    const tokens = () =>
      Array.from(
        fixture.nativeElement.querySelectorAll('.ui-search-field__token'),
      ) as HTMLButtonElement[];
    const text = (token: Element | undefined, part: string) =>
      token
        ?.querySelector(`.ui-search-field__token-${part}`)
        ?.textContent?.trim() ?? null;

    it('has none by default: no tokens, no token hook on the host', () => {
      expect(tokens()).toEqual([]);
      expect(el('ui-search-field')?.hasAttribute('data-has-tokens')).toBe(
        false,
      );
    });

    it('draws each token as a key and its value before the input, faces leading the value, no ✕', () => {
      fixture.componentInstance.tokens.set([BARBERS, WHEN]);
      fixture.detectChanges();
      const [barbers, when] = tokens();
      expect(text(barbers, 'key')).toBe('Бръснар');
      expect(text(barbers, 'text')).toBe('Николай, Иван');
      expect(barbers?.querySelectorAll('ui-avatar').length).toBe(2);
      expect(text(when, 'key')).toBe('Кога');
      expect(text(when, 'text')).toBe('Тази седмица');
      expect(when?.querySelectorAll('ui-avatar').length).toBe(0);
      expect(barbers?.querySelector('[data-name="field.clear"]')).toBeNull();
      expect(barbers?.getAttribute('aria-label')).toBe(
        'Бръснар: Николай, Иван. Промени филтъра',
      );
      expect(el('ui-search-field')?.hasAttribute('data-has-tokens')).toBe(true);
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      expect(
        (when as HTMLElement).compareDocumentPosition(input) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('draws a token still being built as its key alone', () => {
      fixture.componentInstance.tokens.set([BUILDING]);
      fixture.detectChanges();
      const [building] = tokens();
      expect(building?.hasAttribute('data-building')).toBe(true);
      expect(text(building, 'key')).toBe('Услуга');
      expect(
        building?.querySelector('.ui-search-field__token-value'),
      ).toBeNull();
    });

    it('asks the owner to open a pressed token, keeps the focus in the field, and rings the active one', () => {
      fixture.componentInstance.tokens.set([BARBERS, WHEN]);
      fixture.detectChanges();
      tokens()[1]?.click();
      expect(fixture.componentInstance.activated).toEqual(['WHEN']);
      expect(fixture.componentInstance.removed).toEqual([]);
      expect(document.activeElement).toBe(el('[data-testid="probe"]'));
      fixture.componentInstance.active.set('WHEN');
      fixture.detectChanges();
      expect(tokens()[1]?.hasAttribute('data-active')).toBe(true);
      expect(tokens()[0]?.hasAttribute('data-active')).toBe(false);
    });

    it('takes the last token off on Backspace in an empty field, and says so', () => {
      fixture.componentInstance.tokens.set([BARBERS, WHEN]);
      fixture.detectChanges();
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }),
      );
      fixture.detectChanges();
      expect(fixture.componentInstance.removed).toEqual(['WHEN']);
      expect(el('[data-testid="probe-announce"]')?.textContent?.trim()).toBe(
        'Махни филтъра Кога',
      );
    });

    it('leaves the tokens alone on Backspace while there is text to delete', () => {
      fixture.componentInstance.tokens.set([BARBERS]);
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

  describe('the dropdown', () => {
    it('hangs the projected content under the field only while open, named and controlled by the input', () => {
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      expect(el('[data-testid="probe-dropdown"]')).toBeNull();
      expect(input.getAttribute('aria-controls')).toBeNull();
      fixture.componentInstance.dropdown.set(true);
      fixture.detectChanges();
      const dropdown = el('[data-testid="probe-dropdown"]') as HTMLElement;
      expect(dropdown.getAttribute('aria-label')).toBe('Филтри');
      expect(dropdown.querySelector('[data-testid="row"]')).not.toBeNull();
      expect(input.getAttribute('aria-controls')).toBe(dropdown.id);
    });

    it('keeps the focus when a row is pressed, and moving into the list is no blur', () => {
      fixture.componentInstance.dropdown.set(true);
      fixture.detectChanges();
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      const row = el('[data-testid="row"]') as HTMLButtonElement;
      input.focus();
      const press = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      row.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
      row.focus();
      expect(fixture.componentInstance.focused()).toBe(true);
      (el('[data-testid="outside"]') as HTMLButtonElement).focus();
      expect(fixture.componentInstance.focused()).toBe(false);
    });

    it('closes on Escape before the sheet does', () => {
      const input = el('[data-testid="probe"]') as HTMLInputElement;
      const closed = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
      });
      input.dispatchEvent(closed);
      expect(fixture.componentInstance.escaped).toBe(0);
      expect(closed.defaultPrevented).toBe(false);
      fixture.componentInstance.dropdown.set(true);
      fixture.detectChanges();
      const open = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
      });
      input.dispatchEvent(open);
      expect(fixture.componentInstance.escaped).toBe(1);
      expect(open.defaultPrevented).toBe(true);
    });
  });
});
