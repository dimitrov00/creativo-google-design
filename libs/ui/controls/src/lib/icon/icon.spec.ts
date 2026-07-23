import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiIcon, UiIconScale } from './icon';
import {
  UI_ICON_REGISTRY,
  UiIconName,
  provideUiIcons,
  resolveUiIcon,
} from './icon-registry';

@Component({
  imports: [UiIcon],
  template: `<ui-icon uiName="appointment.book" [uiScale]="scale()" />`,
})
class HostComponent {
  readonly scale = signal<UiIconScale | null>('medium');
}

@Component({
  imports: [UiIcon],
  template: `<ui-icon [uiName]="name()" />`,
})
class DefaultHostComponent {
  readonly name = signal<UiIconName>('sheet.close');
}

describe('UiIcon', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, DefaultHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  const glyphOf = (f: ComponentFixture<unknown>): HTMLElement =>
    (f.nativeElement as HTMLElement).querySelector('.ui-icon__glyph')!;

  it('resolves the semantic key to its Material Symbols ligature', () => {
    fixture.detectChanges();
    const glyph = glyphOf(fixture);
    expect(glyph.classList.contains('material-symbols-rounded')).toBe(true);
    // 'appointment.book' is an INTENT — the rendered ligature comes from
    // the registry, never the key itself.
    expect(glyph.textContent?.trim()).toBe('calendar_month');
  });

  it('tracks semantic-name changes through the registry', () => {
    const defaultFixture = TestBed.createComponent(DefaultHostComponent);
    defaultFixture.detectChanges();
    expect(glyphOf(defaultFixture).textContent?.trim()).toBe('close');

    defaultFixture.componentInstance.name.set('location.directions');
    defaultFixture.detectChanges();
    expect(glyphOf(defaultFixture).textContent?.trim()).toBe('near_me');
  });

  it('is decorative: aria-hidden on the host', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-icon');
    expect(el.classList.contains('ui-icon')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults UNSCALED: no data-scale attribute, glyph rides the current font', () => {
    const defaultFixture = TestBed.createComponent(DefaultHostComponent);
    defaultFixture.detectChanges();
    const el: HTMLElement =
      defaultFixture.nativeElement.querySelector('ui-icon');
    // Absent attribute = font-riding 1em behavior (inline-text mode);
    // only an EXPLICIT uiScale snaps the glyph onto the fixed ladder.
    expect(el.hasAttribute('data-scale')).toBe(false);
  });

  it('stamps every fixed-ladder step and un-stamps when reset to null', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-icon');
    // Explicit medium is a LADDER step (fixed 1.25rem), not the default.
    expect(el.getAttribute('data-scale')).toBe('medium');

    fixture.componentInstance.scale.set('small');
    fixture.detectChanges();
    expect(el.getAttribute('data-scale')).toBe('small');

    fixture.componentInstance.scale.set('large');
    fixture.detectChanges();
    expect(el.getAttribute('data-scale')).toBe('large');

    // Back to null → attribute removed → font-riding inline behavior.
    fixture.componentInstance.scale.set(null);
    fixture.detectChanges();
    expect(el.hasAttribute('data-scale')).toBe(false);
  });

  describe('registry & overrides', () => {
    it('keeps every registry value a plain ligature (no dots — dots mark semantic keys)', () => {
      for (const [key, glyph] of Object.entries(UI_ICON_REGISTRY)) {
        expect(key).toContain('.');
        expect(glyph).not.toContain('.');
      }
    });

    it('provideUiIcons remaps a semantic key without touching the registry', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DefaultHostComponent],
        providers: [provideUiIcons({ 'sheet.close': 'cancel' })],
      }).compileComponents();

      const overridden = TestBed.createComponent(DefaultHostComponent);
      overridden.detectChanges();
      expect(glyphOf(overridden).textContent?.trim()).toBe('cancel');

      // Un-remapped keys keep their registry glyph.
      overridden.componentInstance.name.set('location.call');
      overridden.detectChanges();
      expect(glyphOf(overridden).textContent?.trim()).toBe('call');
    });

    it('later override layers win (multi-provider ordering)', () => {
      expect(
        resolveUiIcon('location.pin', [
          { 'location.pin': 'distance' },
          { 'location.pin': 'pin_drop' },
        ]),
      ).toBe('pin_drop');
      // A layer that skips the key falls through to the earlier one.
      expect(
        resolveUiIcon('location.pin', [
          { 'location.pin': 'distance' },
          { 'sheet.close': 'cancel' },
        ]),
      ).toBe('distance');
    });

    it('falls back to the raw string at runtime for unregistered names (migration safety net)', () => {
      // The TYPE forbids this at call sites; the runtime must still not
      // render a tofu box for un-migrated/dynamic names.
      expect(resolveUiIcon('science' as UiIconName)).toBe('science');
    });
  });
});
