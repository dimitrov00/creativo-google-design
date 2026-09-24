import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiIcon, UiIconScale } from './icon';
import { MATERIAL_GLYPHS } from '../material/material-glyphs.generated';
import { UiIconName } from '../manifest/icon-vocabulary';
import {
  UI_ICON_REPORTER,
  UiIconDiagnostic,
  provideUiIcons,
} from '../registry/icon-registry.service';

@Component({
  imports: [UiIcon],
  template: `<ui-icon uiName="appointment.book" [uiScale]="scale()" />`,
})
class HostComponent {
  readonly scale = signal<UiIconScale | null>('medium');
}

@Component({
  imports: [UiIcon],
  template: `<ui-icon [uiName]="name()" [uiLabel]="label()" />`,
})
class DefaultHostComponent {
  readonly name = signal<UiIconName>('sheet.close');
  readonly label = signal<string | null>(null);
}

const pathOf = (glyph: string) => MATERIAL_GLYPHS[glyph];

describe('UiIcon', () => {
  let fixture: ComponentFixture<HostComponent>;
  const diagnostics: UiIconDiagnostic[] = [];

  beforeEach(async () => {
    diagnostics.length = 0;
    await TestBed.configureTestingModule({
      imports: [HostComponent, DefaultHostComponent],
      providers: [
        {
          provide: UI_ICON_REPORTER,
          useValue: { report: (d: UiIconDiagnostic) => diagnostics.push(d) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  const svgOf = (f: ComponentFixture<unknown>): SVGSVGElement | null =>
    (f.nativeElement as HTMLElement).querySelector('svg.ui-icon__glyph');
  const dOf = (f: ComponentFixture<unknown>): string | null | undefined =>
    svgOf(f)?.querySelector('path')?.getAttribute('d');

  it('renders the semantic key as inline SVG path data from the Material table', () => {
    fixture.detectChanges();
    const svg = svgOf(fixture);
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    // 'appointment.book' is an INTENT — the artwork comes from the registry.
    expect(dOf(fixture)).toBe(pathOf('calendar_month'));
    // No text node: nothing to flash while a font loads.
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('tracks semantic-name changes through the registry', () => {
    const f = TestBed.createComponent(DefaultHostComponent);
    f.detectChanges();
    expect(dOf(f)).toBe(pathOf('close'));

    f.componentInstance.name.set('location.directions');
    f.detectChanges();
    expect(dOf(f)).toBe(pathOf('near_me'));
  });

  it('stamps the intent on the host so CSS can address it', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-icon');
    expect(el.getAttribute('data-name')).toBe('appointment.book');
  });

  it('is decorative by default and labelled on request', () => {
    const f = TestBed.createComponent(DefaultHostComponent);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('ui-icon');
    expect(el.classList.contains('ui-icon')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('role')).toBe(false);

    f.componentInstance.label.set('Затвори');
    f.detectChanges();
    expect(el.hasAttribute('aria-hidden')).toBe(false);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Затвори');
  });

  it('defaults UNSCALED: no data-scale attribute, glyph rides the current font', () => {
    const f = TestBed.createComponent(DefaultHostComponent);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('ui-icon');
    expect(el.hasAttribute('data-scale')).toBe(false);
  });

  it('stamps every fixed-ladder step and un-stamps when reset to null', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-icon');
    expect(el.getAttribute('data-scale')).toBe('medium');
    fixture.componentInstance.scale.set('small');
    fixture.detectChanges();
    expect(el.getAttribute('data-scale')).toBe('small');
    fixture.componentInstance.scale.set('large');
    fixture.detectChanges();
    expect(el.getAttribute('data-scale')).toBe('large');
    fixture.componentInstance.scale.set(null);
    fixture.detectChanges();
    expect(el.hasAttribute('data-scale')).toBe(false);
  });

  it('renders a vector (non-Material) key with its own presentation attributes', () => {
    const f = TestBed.createComponent(DefaultHostComponent);
    f.componentInstance.name.set('social.instagram');
    f.detectChanges();
    const paths = svgOf(f)?.querySelectorAll('path') ?? [];
    expect(paths.length).toBe(3);
    expect(paths[0]?.getAttribute('stroke')).toBe('currentColor');
    expect(paths[0]?.getAttribute('fill')).toBe('none');
    expect(paths[0]?.getAttribute('stroke-width')).toBe('2');
  });

  it('renders an alias as its target', () => {
    const f = TestBed.createComponent(DefaultHostComponent);
    f.componentInstance.name.set('gallery.grid');
    f.detectChanges();
    expect(dOf(f)).toBe(pathOf('grid_view'));
    const el: HTMLElement = f.nativeElement.querySelector('ui-icon');
    // The requested INTENT is what the DOM carries, not the alias target.
    expect(el.getAttribute('data-name')).toBe('gallery.grid');
  });

  it('never crashes on an unresolvable key: empty box, data-missing, one report', () => {
    const f = TestBed.createComponent(DefaultHostComponent);
    f.componentInstance.name.set('nope.nothing' as UiIconName);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement.querySelector('ui-icon');
    expect(svgOf(f)).toBeNull();
    expect(el.hasAttribute('data-missing')).toBe(true);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'icon-missing', key: 'nope.nothing' }),
    ]);
  });

  describe('overrides', () => {
    it('provideUiIcons remaps a semantic key without touching the vocabulary', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DefaultHostComponent],
        providers: [provideUiIcons({ 'sheet.close': 'cancel' })],
      }).compileComponents();

      const f = TestBed.createComponent(DefaultHostComponent);
      f.detectChanges();
      expect(dOf(f)).toBe(pathOf('cancel'));

      // Un-remapped keys keep their vocabulary glyph.
      f.componentInstance.name.set('location.call');
      f.detectChanges();
      expect(dOf(f)).toBe(pathOf('call'));
    });

    it('later override layers win, and an override may carry raw vector data', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [DefaultHostComponent],
        providers: [
          provideUiIcons({ 'sheet.close': 'cancel' }),
          provideUiIcons({
            'sheet.close': {
              kind: 'vector',
              viewBox: '0 0 2 2',
              paths: [{ d: 'M0 0h2v2H0z' }],
            },
          }),
        ],
      }).compileComponents();

      const f = TestBed.createComponent(DefaultHostComponent);
      f.detectChanges();
      expect(svgOf(f)?.getAttribute('viewBox')).toBe('0 0 2 2');
      expect(dOf(f)).toBe('M0 0h2v2H0z');
    });
  });
});
